import {
  DEFAULT_POSE_ASSET_URLS,
  POSE_LANDMARKER_CONFIG,
  POSE_MEASUREMENT_METADATA,
  type PoseAssetUrls,
} from "./config";
import type { PoseWorkerRequest, PoseWorkerResponse } from "./protocol";
import type {
  PoseAnalysisProgress,
  PoseAnalysisTask,
  PoseFailureCode,
  PoseMeasurementResult,
} from "./types";

type WorkerLike = Pick<
  Worker,
  "addEventListener" | "postMessage" | "removeEventListener" | "terminate"
>;

type FrameSource = {
  durationMs: number;
  videoWidth: number;
  videoHeight: number;
  frameAt(timestampMs: number, signal: AbortSignal): Promise<ImageBitmap>;
  close(): void;
};

type InternalDependencies = {
  createWorker(): WorkerLike;
  createFrameSource(video: Blob, signal: AbortSignal): Promise<FrameSource>;
  now(): number;
};

export type PoseAnalysisOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?(progress: PoseAnalysisProgress): void;
  /** Asset URL overrides are intended for same-version offline/integration tests. */
  assetUrls?: Partial<PoseAssetUrls>;
};

type PendingCall = {
  resolve(value: PoseWorkerResult): void;
  reject(error: Error): void;
};

type PoseWorkerResult = Extract<
  PoseWorkerResponse,
  { result: unknown }
>["result"];

type PoseWorkerRequestWithoutId = PoseWorkerRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, "id">
    : never
  : never;

class PoseWorkerClient {
  private readonly pending = new Map<number, PendingCall>();
  private nextId = 1;
  private terminated = false;

  constructor(private readonly worker: WorkerLike) {
    worker.addEventListener("message", this.onMessage as EventListener);
    worker.addEventListener("error", this.onError as EventListener);
  }

  call(
    request: PoseWorkerRequestWithoutId,
    transfer: Transferable[] = [],
  ) {
    if (this.terminated) {
      return Promise.reject(new Error("Pose Worker is terminated."));
    }
    const id = this.nextId++;
    return new Promise<PoseWorkerResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ id, ...request }, transfer);
      } catch (error) {
        this.pending.delete(id);
        reject(
          new PoseAnalysisFailure(
            "WORKER_MESSAGE_FAILED",
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    });
  }

  terminate(error = new Error("Pose Worker was terminated.")) {
    if (this.terminated) return;
    this.terminated = true;
    this.worker.removeEventListener("message", this.onMessage as EventListener);
    this.worker.removeEventListener("error", this.onError as EventListener);
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private readonly onMessage = (event: MessageEvent<PoseWorkerResponse>) => {
    const pending = this.pending.get(event.data.id);
    if (!pending) return;
    this.pending.delete(event.data.id);
    if ("error" in event.data) {
      pending.reject(
        new PoseAnalysisFailure(
          event.data.error.code,
          event.data.error.message,
        ),
      );
    }
    else pending.resolve(event.data.result);
  };

  private readonly onError = (event: ErrorEvent) => {
    this.terminate(
      new PoseAnalysisFailure(
        "WORKER_RUNTIME_FAILED",
        event.message || "Pose Worker failed.",
      ),
    );
  };
}

class PoseCancellationError extends Error {}
class PoseTimeoutError extends Error {}
class PoseAnalysisFailure extends Error {
  constructor(
    readonly code: PoseFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "PoseAnalysisFailure";
  }
}

function terminalResult(
  status: "CANCELED" | "TIMED_OUT",
  startedAt: number,
  now: () => number,
): PoseMeasurementResult {
  return {
    status,
    metadata: POSE_MEASUREMENT_METADATA,
    quality: null,
    metrics: null,
    processingDurationMs: Math.max(0, now() - startedAt),
  };
}

function failureResult(
  error: unknown,
  startedAt: number,
  now: () => number,
): PoseMeasurementResult {
  return {
    status: "FAILED",
    metadata: POSE_MEASUREMENT_METADATA,
    quality: null,
    metrics: null,
    errorCode:
      error instanceof PoseAnalysisFailure
        ? error.code
        : error instanceof DOMException
          ? "VIDEO_DECODE_FAILED"
        : "POSE_ANALYSIS_FAILED",
    processingDurationMs: Math.max(0, now() - startedAt),
  };
}

function safelyNotify(
  callback: PoseAnalysisOptions["onProgress"],
  progress: PoseAnalysisProgress,
) {
  try {
    callback?.(progress);
  } catch {
    // Consumer progress rendering must never fail the measurement itself.
  }
}

function createDefaultWorker() {
  return new Worker(new URL("./pose-landmarker.worker.ts", import.meta.url), {
    type: "module",
    name: "tricksight-pose-landmarker",
  });
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  eventName: "playing" | "seeked",
  signal: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(eventName, onEvent);
      video.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(
        new PoseAnalysisFailure(
          "VIDEO_DECODE_FAILED",
          `Video failed while waiting for ${eventName}.`,
        ),
      );
    };
    const onAbort = () => {
      cleanup();
      reject(signal.reason instanceof Error ? signal.reason : new PoseCancellationError());
    };

    if (signal.aborted) {
      onAbort();
      return;
    }
    video.addEventListener(eventName, onEvent, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function waitForFirstVideoFrame(
  video: HTMLVideoElement,
  signal: AbortSignal,
) {
  if (typeof video.requestVideoFrameCallback !== "function") {
    const waiterController = new AbortController();
    const forwardAbort = () => waiterController.abort(signal.reason);
    if (signal.aborted) forwardAbort();
    else signal.addEventListener("abort", forwardAbort, { once: true });
    return {
      promise: waitForVideoEvent(
        video,
        "playing",
        waiterController.signal,
      ).finally(() => signal.removeEventListener("abort", forwardAbort)),
      cancel(error: unknown) {
        waiterController.abort(error);
      },
    };
  }

  let callbackId: number | null = null;
  let rejectWait: ((reason?: unknown) => void) | null = null;
  let settled = false;
  const cleanup = () => {
    video.removeEventListener("error", onError);
    signal.removeEventListener("abort", onAbort);
    if (callbackId !== null) {
      video.cancelVideoFrameCallback(callbackId);
      callbackId = null;
    }
  };
  const fail = (error: unknown) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectWait?.(error);
  };
  const onError = () =>
    fail(
      new PoseAnalysisFailure(
        "VIDEO_DECODE_FAILED",
        "Video failed while waiting for its first presented frame.",
      ),
    );
  const onAbort = () =>
    fail(
      signal.reason instanceof Error
        ? signal.reason
        : new PoseCancellationError(),
    );
  const promise = new Promise<void>((resolve, reject) => {
    rejectWait = reject;
    if (signal.aborted) {
      onAbort();
      return;
    }
    video.addEventListener("error", onError, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
    callbackId = video.requestVideoFrameCallback(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    });
  });

  return { promise, cancel: fail };
}

async function createBrowserFrameSource(videoBlob: Blob, signal: AbortSignal) {
  const video = document.createElement("video");
  const objectUrl = URL.createObjectURL(videoBlob);
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.style.display = "none";
  video.src = objectUrl;
  document.body.append(video);

  const close = () => {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const firstFrame = waitForFirstVideoFrame(video, signal);
  let playPromise: Promise<void>;
  try {
    // Keep this direct call before this async function's first await. The
    // caller starts analysis inside the trusted file-input change handler, so
    // iOS can use that transient user activation to decode real frame data.
    playPromise = video.play();
  } catch (error) {
    firstFrame.cancel(error);
    close();
    throw error;
  }

  try {
    await Promise.all([playPromise, firstFrame.promise]);
    video.pause();
  } catch (error) {
    firstFrame.cancel(error);
    close();
    throw error;
  }

  const source: FrameSource = {
    durationMs: video.duration * 1_000,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    async frameAt(timestampMs, frameSignal) {
      const seconds = Math.min(
        timestampMs / 1_000,
        Math.max(0, video.duration - 0.001),
      );
      if (
        Math.abs(video.currentTime - seconds) >= 0.0005 ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        const seeked = waitForVideoEvent(video, "seeked", frameSignal);
        video.currentTime = seconds;
        await seeked;
      }
      if (frameSignal.aborted) {
        throw frameSignal.reason;
      }
      return createImageBitmap(video);
    },
    close,
  };
  return source;
}

const defaultDependencies: InternalDependencies = {
  createWorker: createDefaultWorker,
  createFrameSource: createBrowserFrameSource,
  now: () => performance.now(),
};

function startWithDependencies(
  video: Blob,
  options: PoseAnalysisOptions,
  dependencies: InternalDependencies,
): PoseAnalysisTask {
  const abortController = new AbortController();
  const startedAt = dependencies.now();
  let abortKind: "CANCELED" | "TIMED_OUT" | null = null;
  let workerClient: PoseWorkerClient | null = null;
  let frameSource: FrameSource | null = null;
  let primedBitmap: ImageBitmap | null = null;

  const abort = (kind: "CANCELED" | "TIMED_OUT") => {
    if (abortController.signal.aborted) return;
    abortKind = kind;
    const error =
      kind === "TIMED_OUT"
        ? new PoseTimeoutError("Pose measurement timed out.")
        : new PoseCancellationError("Pose measurement was canceled.");
    abortController.abort(error);
    workerClient?.terminate(error);
  };

  const timeoutMs = options.timeoutMs ?? POSE_LANDMARKER_CONFIG.defaultTimeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be a positive finite number.");
  }
  const timeout = setTimeout(() => abort("TIMED_OUT"), timeoutMs);
  const onExternalAbort = () => abort("CANCELED");
  if (options.signal?.aborted) abort("CANCELED");
  else options.signal?.addEventListener("abort", onExternalAbort, { once: true });

  const result = (async (): Promise<PoseMeasurementResult> => {
    try {
      frameSource = await dependencies.createFrameSource(
        video,
        abortController.signal,
      );
      if (
        !Number.isFinite(frameSource.durationMs) ||
        frameSource.durationMs <= 0 ||
        !Number.isFinite(frameSource.videoWidth) ||
        frameSource.videoWidth <= 0 ||
        !Number.isFinite(frameSource.videoHeight) ||
        frameSource.videoHeight <= 0
      ) {
        throw new PoseAnalysisFailure(
          "VIDEO_METADATA_INVALID",
          "Video metadata is invalid for pose measurement.",
        );
      }
      const totalFrames = Math.max(
        1,
        Math.floor(
          (frameSource.durationMs / 1_000) *
            POSE_LANDMARKER_CONFIG.sampleRateFps,
        ),
      );
      safelyNotify(options.onProgress, {
        phase: "INITIALIZING",
        processedFrames: 0,
        totalFrames,
        percent: 0,
      });

      try {
        workerClient = new PoseWorkerClient(dependencies.createWorker());
      } catch (error) {
        throw new PoseAnalysisFailure(
          "WORKER_BOOT_FAILED",
          error instanceof Error ? error.message : String(error),
        );
      }
      const assetUrls = { ...DEFAULT_POSE_ASSET_URLS, ...options.assetUrls };
      // iOS pays a one-time createImageBitmap cost of about one second. Start
      // that work while the Worker loads WASM/model data, then reuse the same
      // bitmap for frame zero instead of adding the costs serially.
      const [initialization, firstFrame] = await Promise.allSettled([
        workerClient.call({ type: "initialize", assetUrls }),
        frameSource.frameAt(0, abortController.signal),
      ]);
      if (initialization.status === "rejected") {
        if (firstFrame.status === "fulfilled") firstFrame.value.close();
        throw initialization.reason;
      }
      if (initialization.value.type !== "initialized") {
        if (firstFrame.status === "fulfilled") firstFrame.value.close();
        throw new PoseAnalysisFailure(
          "WORKER_PROTOCOL_FAILED",
          "Pose Worker returned an unexpected initialize result.",
        );
      }
      if (firstFrame.status === "rejected") throw firstFrame.reason;
      primedBitmap = firstFrame.value;

      let lastProgressAt = dependencies.now();
      for (let index = 0; index < totalFrames; index += 1) {
        if (abortController.signal.aborted) throw abortController.signal.reason;
        const timestampMs = Math.round(
          (index * 1_000) / POSE_LANDMARKER_CONFIG.sampleRateFps,
        );
        const bitmap =
          index === 0 && primedBitmap
            ? primedBitmap
            : await frameSource.frameAt(
                timestampMs,
                abortController.signal,
              );
        primedBitmap = null;
        let progress: PoseWorkerResult;
        try {
          progress = await workerClient.call(
            { type: "detect", bitmap, timestampMs },
            [bitmap],
          );
        } catch (error) {
          // If transfer failed, ownership stayed on the main thread. If the
          // Worker already closed it this is harmless; never retain a frame.
          try {
            bitmap.close();
          } catch {
            // The successful transfer already detached it.
          }
          throw error;
        }
        if (progress.type !== "progress") {
          throw new PoseAnalysisFailure(
            "WORKER_PROTOCOL_FAILED",
            "Pose Worker returned an unexpected detect result.",
          );
        }

        const now = dependencies.now();
        const isLast = progress.processedFrames === totalFrames;
        if (
          isLast ||
          progress.processedFrames %
            POSE_LANDMARKER_CONFIG.progress.frameInterval ===
            0 ||
          now - lastProgressAt >=
            POSE_LANDMARKER_CONFIG.progress.minimumIntervalMs
        ) {
          lastProgressAt = now;
          safelyNotify(options.onProgress, {
            phase: "PROCESSING",
            processedFrames: progress.processedFrames,
            totalFrames,
            percent: progress.processedFrames / totalFrames,
          });
        }
      }

      safelyNotify(options.onProgress, {
        phase: "FINALIZING",
        processedFrames: totalFrames,
        totalFrames,
        percent: 1,
      });
      const finished = await workerClient.call({
        type: "finish",
        durationMs: frameSource.durationMs,
        videoWidth: frameSource.videoWidth,
        videoHeight: frameSource.videoHeight,
      });
      if (finished.type !== "finished") {
        throw new PoseAnalysisFailure(
          "WORKER_PROTOCOL_FAILED",
          "Pose Worker returned an unexpected finish result.",
        );
      }
      await workerClient.call({ type: "close" });
      return finished.measurement;
    } catch (error) {
      if (abortKind === "TIMED_OUT" || error instanceof PoseTimeoutError) {
        return terminalResult("TIMED_OUT", startedAt, dependencies.now);
      }
      if (abortKind === "CANCELED" || error instanceof PoseCancellationError) {
        return terminalResult("CANCELED", startedAt, dependencies.now);
      }
      return failureResult(error, startedAt, dependencies.now);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onExternalAbort);
      primedBitmap?.close();
      frameSource?.close();
      workerClient?.terminate();
    }
  })();

  return {
    result,
    cancel: () => abort("CANCELED"),
  };
}

export function startPoseVideoAnalysis(
  video: Blob,
  options: PoseAnalysisOptions = {},
): PoseAnalysisTask {
  return startWithDependencies(video, options, defaultDependencies);
}

export const poseAnalysisTesting = {
  startWithDependencies,
};

export type { FrameSource, InternalDependencies, WorkerLike };
