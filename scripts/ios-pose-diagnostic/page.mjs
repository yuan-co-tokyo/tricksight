import {
  DataStream,
  Endianness,
  MP4BoxBuffer,
  createFile as createMp4File,
} from "/vendor/mp4box/mp4box.all.mjs";
import {
  FilesetResolver,
  PoseLandmarker,
} from "/mediapipe/vision_bundle.mjs";

const SAMPLE_RATE_FPS = 10;
const VIDEO_EVENT_TIMEOUT_MS = 180_000;
const PRIMING_TIMEOUT_MS = 15_000;
const WEBCODECS_TIMEOUT_MS = 120_000;

const fileInput = document.querySelector("#video-file");
const statusElement = document.querySelector("#status");
const progressElement = document.querySelector("#progress");
const progressLabel = document.querySelector("#progress-label");
const summaryElement = document.querySelector("#summary");
const detailsElement = document.querySelector("#details");
const jsonElement = document.querySelector("#result-json");
const copyButton = document.querySelector("#copy-result");

class DiagnosticWorkerClient {
  constructor() {
    this.worker = new Worker("/worker.mjs", { type: "module" });
    this.pending = new Map();
    this.nextId = 1;
    this.failed = false;
    this.worker.addEventListener("message", (event) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      if (event.data.error) pending.reject(new Error(event.data.error));
      else pending.resolve(event.data.result);
    });
    this.worker.addEventListener("error", (event) => {
      this.failed = true;
      for (const pending of this.pending.values()) {
        pending.reject(new Error(event.message || "Pose Worker failed."));
      }
      this.pending.clear();
      this.worker.terminate();
    });
  }

  call(type, payload = {}, transfer = []) {
    if (this.failed) return Promise.reject(new Error("Pose Worker failed."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ id, type, ...payload }, transfer);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async close() {
    try {
      if (!this.failed) {
        await Promise.race([
          this.call("close"),
          new Promise((resolve) => setTimeout(resolve, 1_000)),
        ]);
      }
    } finally {
      this.worker.terminate();
    }
  }
}

function errorMessage(error) {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

function withTimeout(promise, timeoutMs, label) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timeout));
}

function waitForEvent(target, eventName, timeoutMs = VIDEO_EVENT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`${eventName} event timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    const onEvent = (event) => {
      cleanup();
      resolve(event);
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Video failed while waiting for ${eventName}.`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      target.removeEventListener(eventName, onEvent);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(eventName, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

function videoSnapshot(video) {
  return {
    readyState: video.readyState,
    networkState: video.networkState,
    currentTimeSeconds: round(video.currentTime, 3),
    durationSeconds: Number.isFinite(video.duration)
      ? round(video.duration, 3)
      : null,
    width: video.videoWidth || null,
    height: video.videoHeight || null,
    paused: video.paused,
  };
}

function beginVideoPrimingTrial(file, mode) {
  const startedAt = performance.now();
  const video = document.createElement("video");
  const objectUrl = URL.createObjectURL(file);
  const events = {
    loadstartMs: null,
    loadedmetadataMs: null,
    loadeddataMs: null,
    canplayMs: null,
    playingMs: null,
    firstVideoFrameMs: null,
  };
  const eventNames = [
    "loadstart",
    "loadedmetadata",
    "loadeddata",
    "canplay",
    "playing",
  ];
  for (const eventName of eventNames) {
    video.addEventListener(
      eventName,
      () => {
        events[`${eventName}Ms`] ??= round(performance.now() - startedAt, 3);
      },
      { once: true },
    );
  }

  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  if (mode === "A1_HIDDEN_PLAY") {
    video.style.display = "none";
  } else {
    video.style.cssText =
      "position:fixed;left:0;top:0;width:1px;height:1px;opacity:.01;pointer-events:none";
  }
  video.src = objectUrl;
  document.body.append(video);

  let framePromise;
  if (typeof video.requestVideoFrameCallback === "function") {
    framePromise = new Promise((resolve) => {
      video.requestVideoFrameCallback(() => {
        events.firstVideoFrameMs = round(performance.now() - startedAt, 3);
        resolve();
      });
    });
  } else {
    framePromise = waitForEvent(video, "playing", PRIMING_TIMEOUT_MS);
  }

  // This must remain before the first await after the input change event. On
  // iOS the direct user-activation call is what requests actual frame data;
  // preload="auto" alone is only a hint and can stop at metadata.
  let playPromise;
  try {
    playPromise = video.play();
  } catch (error) {
    playPromise = Promise.reject(error);
  }

  const completion = withTimeout(
    (async () => {
      const playStartedAt = performance.now();
      const measuredPlayPromise = playPromise.then(
        () => performance.now() - playStartedAt,
      );
      const [playPromiseMs] = await Promise.all([
        measuredPlayPromise,
        framePromise,
      ]);
      video.pause();
      return {
        method: mode,
        status: "SUCCEEDED",
        totalMs: round(performance.now() - startedAt),
        playPromiseMs: round(playPromiseMs),
        events,
        video: videoSnapshot(video),
      };
    })(),
    PRIMING_TIMEOUT_MS,
    mode,
  ).catch((error) => {
    video.pause();
    return {
      method: mode,
      status: "FAILED",
      totalMs: round(performance.now() - startedAt),
      error: errorMessage(error),
      events,
      video: videoSnapshot(video),
    };
  });

  return {
    mode,
    video,
    completion,
    close() {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
      URL.revokeObjectURL(objectUrl);
    },
  };
}

function decoderDescription(mp4File, track) {
  const trackBox = mp4File.getTrackById(track.id);
  for (const entry of trackBox.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
    if (!box) continue;
    const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
    box.write(stream);
    return new Uint8Array(stream.buffer.slice(8));
  }
  throw new Error("No avcC, hvcC, vpcC, or av1C decoder configuration found.");
}

async function runWebCodecsTrial(file) {
  const startedAt = performance.now();
  let decoder = null;
  try {
    if (typeof globalThis.VideoDecoder !== "function") {
      throw new Error("VideoDecoder is not available on this browser.");
    }

    const readStartedAt = performance.now();
    const sourceBuffer = await file.arrayBuffer();
    const readMs = performance.now() - readStartedAt;
    const mp4File = createMp4File();
    const extractedSamples = [];
    const readyStartedAt = performance.now();
    const movie = await withTimeout(
      new Promise((resolve, reject) => {
        mp4File.onError = (...messages) =>
          reject(new Error(`MP4Box: ${messages.join(": ")}`));
        mp4File.onSamples = (_trackId, _user, samples) => {
          extractedSamples.push(...samples);
        };
        mp4File.onReady = (info) => {
          const videoTrack = info.videoTracks[0];
          if (!videoTrack?.video) {
            reject(new Error("The file has no video track."));
            return;
          }
          // Configure extraction synchronously inside onReady. MP4Box cleans
          // fully parsed buffers after appendBuffer returns, so deferring this
          // setup to an async continuation loses the media sample bytes.
          mp4File.setExtractionOptions(videoTrack.id, undefined, {
            nbSamples: 100,
          });
          mp4File.start();
          resolve(info);
        };
        try {
          mp4File.appendBuffer(MP4BoxBuffer.fromArrayBuffer(sourceBuffer, 0));
          mp4File.flush();
        } catch (error) {
          reject(error);
        }
      }),
      WEBCODECS_TIMEOUT_MS,
      "MP4 demux",
    );
    const demuxReadyMs = performance.now() - readyStartedAt;
    const track = movie.videoTracks[0];
    if (extractedSamples.length !== track.nb_samples) {
      throw new Error(
        `MP4Box extracted ${extractedSamples.length}/${track.nb_samples} video samples.`,
      );
    }

    const config = {
      codec: track.codec.startsWith("vp08") ? "vp8" : track.codec,
      codedHeight: track.video.height,
      codedWidth: track.video.width,
      description: decoderDescription(mp4File, track),
      hardwareAcceleration: "no-preference",
    };
    const supportStartedAt = performance.now();
    const support = await VideoDecoder.isConfigSupported(config);
    const supportCheckMs = performance.now() - supportStartedAt;
    if (!support.supported) {
      throw new Error(`VideoDecoder does not support codec ${config.codec}.`);
    }

    let encodedChunks = 0;
    let decodedFrames = 0;
    let firstOutputMs = null;
    let decoderError = null;
    const decodeStartedAt = performance.now();
    decoder = new VideoDecoder({
      output(frame) {
        firstOutputMs ??= round(performance.now() - decodeStartedAt, 3);
        decodedFrames += 1;
        frame.close();
      },
      error(error) {
        decoderError = error;
      },
    });
    decoder.configure(config);
    for (const sample of extractedSamples) {
      if (!sample.data) {
        throw new Error(`Sample ${sample.number} has no data.`);
      }
      decoder.decode(
        new EncodedVideoChunk({
          type: sample.is_sync ? "key" : "delta",
          timestamp: (1_000_000 * sample.cts) / sample.timescale,
          duration: (1_000_000 * sample.duration) / sample.timescale,
          data: sample.data,
        }),
      );
      encodedChunks += 1;
    }
    await withTimeout(decoder.flush(), WEBCODECS_TIMEOUT_MS, "WebCodecs decode");
    if (decoderError) throw decoderError;
    if (decodedFrames !== encodedChunks) {
      throw new Error(
        `VideoDecoder output ${decodedFrames}/${encodedChunks} decoded frames.`,
      );
    }

    return {
      method: "B_WEBCODECS",
      status: "SUCCEEDED",
      totalMs: round(performance.now() - startedAt),
      readMs: round(readMs),
      demuxReadyMs: round(demuxReadyMs),
      supportCheckMs: round(supportCheckMs),
      decodeMs: round(performance.now() - decodeStartedAt),
      firstOutputMs,
      codec: config.codec,
      codedWidth: config.codedWidth,
      codedHeight: config.codedHeight,
      expectedSamples: track.nb_samples,
      encodedChunks,
      decodedFrames,
      supported: support.supported,
    };
  } catch (error) {
    return {
      method: "B_WEBCODECS",
      status: "FAILED",
      totalMs: round(performance.now() - startedAt),
      error: errorMessage(error),
    };
  } finally {
    if (decoder && decoder.state !== "closed") decoder.close();
  }
}

async function seekTo(video, seconds) {
  const target = Math.min(seconds, Math.max(0, video.duration - 0.001));
  if (
    Math.abs(video.currentTime - target) < 0.0005 &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
  ) {
    return { elapsedMs: 0, eventFired: false };
  }
  const startedAt = performance.now();
  const seeked = waitForEvent(video, "seeked");
  video.currentTime = target;
  await seeked;
  return { elapsedMs: performance.now() - startedAt, eventFired: true };
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return null;
  const index = Math.min(
    sortedValues.length - 1,
    Math.ceil(sortedValues.length * percentileValue) - 1,
  );
  return sortedValues[index];
}

function summarize(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) {
    return { count: 0, totalMs: 0, meanMs: null, p50Ms: null, p95Ms: null, maxMs: null };
  }
  const sorted = [...finite].sort((left, right) => left - right);
  const totalMs = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    totalMs,
    meanMs: totalMs / finite.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1),
  };
}

function round(value, digits = 1) {
  return typeof value === "number" && Number.isFinite(value)
    ? Number(value.toFixed(digits))
    : value;
}

function roundedSummary(summary) {
  return Object.fromEntries(
    Object.entries(summary).map(([key, value]) => [key, round(value)]),
  );
}

function assertValidPoseVideo(video) {
  if (
    !Number.isFinite(video.duration) ||
    video.duration <= 0 ||
    video.videoWidth <= 0 ||
    video.videoHeight <= 0
  ) {
    throw new Error("Video metadata is invalid after priming.");
  }
}

async function runPoseFrames(video, runner) {
  const startedAt = performance.now();
  const frameMeasurements = [];
  try {
    assertValidPoseVideo(video);
    const requestedFrames = Math.max(1, Math.floor(video.duration * SAMPLE_RATE_FPS));
    progressElement.max = requestedFrames;
    progressElement.value = 0;
    progressLabel.textContent = `${runner.shortLabel} 0 / ${requestedFrames}`;
    statusElement.textContent = `${runner.label}でfullモデルを初期化しています…`;
    const initialized = await runner.initialize();

    for (let index = 0; index < requestedFrames; index += 1) {
      const timestampMs = Math.round((index * 1_000) / SAMPLE_RATE_FPS);
      statusElement.textContent = `${runner.label}: ${index + 1} / ${requestedFrames}フレーム`;
      const seek = await seekTo(video, timestampMs / 1_000);
      const bitmapStartedAt = performance.now();
      const bitmap = await createImageBitmap(video);
      const bitmapMs = performance.now() - bitmapStartedAt;
      const roundTripStartedAt = performance.now();
      const detected = await runner.detect(bitmap, timestampMs);
      const executionRoundTripMs = performance.now() - roundTripStartedAt;
      frameMeasurements.push({
        index,
        timestampMs,
        seekMs: round(seek.elapsedMs, 3),
        seekEventFired: seek.eventFired,
        bitmapMs: round(bitmapMs, 3),
        inferenceMs: round(detected.inferenceMs, 3),
        executionRoundTripMs: round(executionRoundTripMs, 3),
        poseDetected: detected.poseCount > 0,
      });
      progressElement.value = index + 1;
      progressLabel.textContent = `${runner.shortLabel} ${index + 1} / ${requestedFrames}`;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const seek = summarize(frameMeasurements.map((frame) => frame.seekMs));
    const bitmap = summarize(frameMeasurements.map((frame) => frame.bitmapMs));
    const inference = summarize(frameMeasurements.map((frame) => frame.inferenceMs));
    const executionRoundTrip = summarize(
      frameMeasurements.map((frame) => frame.executionRoundTripMs),
    );
    return {
      method: runner.method,
      executionThread: runner.executionThread,
      canvasMode: runner.canvasMode,
      frameSourceMethod: runner.frameSourceMethod,
      status: "SUCCEEDED",
      totalMs: round(performance.now() - startedAt),
      video: videoSnapshot(video),
      requestedFrames,
      processedFrames: frameMeasurements.length,
      seekEventCount: frameMeasurements.filter((frame) => frame.seekEventFired).length,
      poseDetectedFrames: frameMeasurements.filter((frame) => frame.poseDetected).length,
      timing: {
        initializationMs: round(initialized.initializationMs),
        seek: roundedSummary(seek),
        bitmap: roundedSummary(bitmap),
        inference: roundedSummary(inference),
        executionRoundTrip: roundedSummary(executionRoundTrip),
      },
      maxMainThreadBlockMs:
        runner.executionThread === "MAIN" ? round(inference.maxMs) : null,
      frames: frameMeasurements,
    };
  } catch (error) {
    return {
      method: runner.method,
      executionThread: runner.executionThread,
      canvasMode: runner.canvasMode,
      frameSourceMethod: runner.frameSourceMethod,
      status: "FAILED",
      totalMs: round(performance.now() - startedAt),
      processedFrames: frameMeasurements.length,
      error: errorMessage(error),
      frames: frameMeasurements,
    };
  } finally {
    await runner.close().catch(() => {});
  }
}

async function runDefaultWorkerTrial() {
  const startedAt = performance.now();
  const workerClient = new DiagnosticWorkerClient();
  let environment = null;
  try {
    environment = await workerClient.call("environment");
    statusElement.textContent = "C0: MediaPipe既定Worker初期化を確認しています…";
    const initialized = await workerClient.call("initialize", {
      canvasMode: "DEFAULT",
    });
    return {
      method: "C0_DEFAULT_WORKER",
      status: "SUCCEEDED",
      totalMs: round(performance.now() - startedAt),
      initializationMs: round(initialized.initializationMs),
      environment,
    };
  } catch (error) {
    return {
      method: "C0_DEFAULT_WORKER",
      status: "FAILED",
      totalMs: round(performance.now() - startedAt),
      error: errorMessage(error),
      environment,
    };
  } finally {
    await workerClient.close().catch(() => {});
  }
}

function runExplicitOffscreenWorkerTrial(video, frameSourceMethod) {
  const workerClient = new DiagnosticWorkerClient();
  return runPoseFrames(video, {
    method: "C1_EXPLICIT_OFFSCREEN_WORKER",
    executionThread: "WORKER",
    canvasMode: "EXPLICIT_OFFSCREEN",
    frameSourceMethod,
    label: "C1 明示OffscreenCanvas Worker",
    shortLabel: "C1",
    initialize: () =>
      workerClient.call("initialize", {
        canvasMode: "EXPLICIT_OFFSCREEN",
      }),
    async detect(bitmap, timestampMs) {
      try {
        return await workerClient.call(
          "detect",
          { bitmap, timestampMs },
          [bitmap],
        );
      } catch (error) {
        try {
          bitmap.close();
        } catch {
          // The bitmap was already detached if postMessage succeeded.
        }
        throw error;
      }
    },
    close: () => workerClient.close(),
  });
}

function runMainThreadCanvasTrial(video, frameSourceMethod) {
  let mainThreadLandmarker = null;
  return runPoseFrames(video, {
    method: "C2_EXPLICIT_HTML_CANVAS_MAIN",
    executionThread: "MAIN",
    canvasMode: "EXPLICIT_HTML_CANVAS",
    frameSourceMethod,
    label: "C2 明示HTMLCanvas メインスレッド",
    shortLabel: "C2",
    async initialize() {
      const startedAt = performance.now();
      const [vision, modelResponse] = await Promise.all([
        // The main-thread loader injects a classic script element, so it must
        // use the non-module Emscripten loader. Workers use the module loader.
        FilesetResolver.forVisionTasks("/mediapipe/wasm"),
        fetch("/mediapipe/model"),
      ]);
      if (!modelResponse.ok) {
        throw new Error(`Pose model download failed: ${modelResponse.status}`);
      }
      const modelAssetBuffer = new Uint8Array(await modelResponse.arrayBuffer());
      const canvas = document.createElement("canvas");
      mainThreadLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetBuffer, delegate: "CPU" },
        canvas,
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
      return { initializationMs: performance.now() - startedAt };
    },
    async detect(bitmap, timestampMs) {
      if (!mainThreadLandmarker) {
        bitmap.close();
        throw new Error("Main-thread Pose Landmarker is not initialized.");
      }
      const startedAt = performance.now();
      try {
        const result = mainThreadLandmarker.detectForVideo(bitmap, timestampMs);
        const poseCount = result.landmarks.length;
        result.close?.();
        return {
          inferenceMs: performance.now() - startedAt,
          poseCount,
        };
      } finally {
        bitmap.close();
      }
    },
    async close() {
      mainThreadLandmarker?.close();
      mainThreadLandmarker = null;
    },
  });
}

function formatMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value >= 1_000
    ? `${(value / 1_000).toFixed(1)}秒`
    : `${value.toFixed(1)}ms`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function deviceInformation() {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGb: navigator.deviceMemory ?? null,
    maxTouchPoints: navigator.maxTouchPoints,
    screen: `${screen.width}x${screen.height}@${window.devicePixelRatio}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    webCodecsVideoDecoder: typeof globalThis.VideoDecoder === "function",
    crossOriginIsolated: globalThis.crossOriginIsolated,
  };
}

function timingDiagnosis(seek, inference) {
  if (seek.totalMs >= inference.totalMs * 1.5) {
    return `シーク優位（推論の ${(seek.totalMs / Math.max(inference.totalMs, 0.001)).toFixed(1)}倍）`;
  }
  if (inference.totalMs >= seek.totalMs * 1.5) {
    return `推論優位（シークの ${(inference.totalMs / Math.max(seek.totalMs, 0.001)).toFixed(1)}倍）`;
  }
  return "シークと推論が同程度";
}

function poseImplementationCandidate(poseMethods) {
  if (poseMethods.c1ExplicitOffscreenWorker?.status === "SUCCEEDED") {
    return "C1_EXPLICIT_OFFSCREEN_WORKER";
  }
  if (poseMethods.c2MainThreadCanvas?.status === "SUCCEEDED") {
    return "C2_EXPLICIT_HTML_CANVAS_MAIN";
  }
  return "NONE";
}

function poseCandidateLabel(candidate) {
  const labels = {
    C1_EXPLICIT_OFFSCREEN_WORKER: "C1: Worker + 明示OffscreenCanvas",
    C2_EXPLICIT_HTML_CANVAS_MAIN: "C2: メインスレッド + HTMLCanvas",
    NONE: "動作候補なし",
  };
  return labels[candidate];
}

function methodCard(label, method, note) {
  const succeeded = method.status === "SUCCEEDED";
  const detail = succeeded ? note(method) : method.error;
  return `<article class="metric method ${succeeded ? "success" : "failure"}"><h3>${escapeHtml(label)}</h3><strong>${succeeded ? "成功" : "失敗"} / ${formatMs(method.totalMs)}</strong><span>${escapeHtml(detail ?? "詳細なし")}</span></article>`;
}

function metricCard(label, total, perFrame) {
  return `<article class="metric"><h3>${escapeHtml(label)}</h3><strong>${formatMs(total)}</strong><span>平均 ${formatMs(perFrame)}</span></article>`;
}

function renderResult(result) {
  const { methods, poseMethods } = result;
  const c0 = poseMethods.c0DefaultWorker;
  const c1 = poseMethods.c1ExplicitOffscreenWorker;
  const c2 = poseMethods.c2MainThreadCanvas;
  const primaryPose =
    c1?.status === "SUCCEEDED"
      ? c1
      : c2?.status === "SUCCEEDED"
        ? c2
        : null;
  summaryElement.innerHTML = [
    `<article class="metric accent"><h3>Pose実行方式の候補</h3><strong>${escapeHtml(poseCandidateLabel(result.poseImplementationCandidate))}</strong><span>実機結果をleaderが確認するまで製品には適用しません</span></article>`,
    `<article class="metric accent"><h3>フレーム取得方式</h3><strong>採用判断は保留</strong><span>C1/C2の入力には ${escapeHtml(result.poseInputFrameSourceMethod ?? "利用可能なA方式なし")} を使用</span></article>`,
    methodCard("A1 非表示 + play", methods.a1HiddenPlay, (method) =>
      `最初のフレーム ${formatMs(method.events.firstVideoFrameMs)}`,
    ),
    methodCard("A2 1px表示 + play", methods.a2RenderedPlay, (method) =>
      `最初のフレーム ${formatMs(method.events.firstVideoFrameMs)}`,
    ),
    methodCard("B WebCodecs", methods.webCodecs, (method) =>
      `${method.codec} / ${method.decodedFrames}フレームdecode`,
    ),
    methodCard("C0 既定Worker", c0, (method) =>
      `MediaPipe自動判定=${method.environment.mediaPipeSupportsOffscreenCanvas}`,
    ),
    c1
      ? methodCard("C1 OffscreenCanvas Worker", c1, (method) =>
          `${method.processedFrames}/${method.requestedFrames}フレーム完走`,
        )
      : "",
    c2
      ? methodCard("C2 HTMLCanvas Main", c2, (method) =>
          `${method.processedFrames}/${method.requestedFrames}完走 / 最大block ${formatMs(method.maxMainThreadBlockMs)}`,
        )
      : "",
  ].join("");
  if (primaryPose) {
    const timing = primaryPose.timing;
    summaryElement.innerHTML += [
      `<article class="metric accent"><h3>採用候補の律速</h3><strong>${escapeHtml(timingDiagnosis(timing.seek, timing.inference))}</strong><span>${primaryPose.processedFrames}/${primaryPose.requestedFrames}フレーム完走</span></article>`,
      metricCard("シーク", timing.seek.totalMs, timing.seek.meanMs),
      metricCard("推論", timing.inference.totalMs, timing.inference.meanMs),
      metricCard("画像化", timing.bitmap.totalMs, timing.bitmap.meanMs),
    ].join("");
  }

  const primingRows = [
    ["A1 非表示", methods.a1HiddenPlay],
    ["A2 1px表示", methods.a2RenderedPlay],
    ["B WebCodecs", methods.webCodecs],
  ];
  let detailHtml = `
    <h2>方式別の結果</h2>
    <table>
      <thead><tr><th>方式</th><th>成否</th><th>所要時間</th><th>詳細</th></tr></thead>
      <tbody>${primingRows
        .map(([label, method]) => {
          const detail =
            method.status === "SUCCEEDED"
              ? label.startsWith("A")
                ? `readyState=${method.video.readyState}, loadeddata=${formatMs(method.events.loadeddataMs)}, firstFrame=${formatMs(method.events.firstVideoFrameMs)}`
                : `${method.codec}, ${method.decodedFrames}/${method.expectedSamples} frames`
              : method.error;
          return `<tr><th>${escapeHtml(label)}</th><td>${method.status === "SUCCEEDED" ? "成功" : "失敗"}</td><td>${formatMs(method.totalMs)}</td><td class="wrap">${escapeHtml(detail)}</td></tr>`;
        })
        .join("")}</tbody>
    </table>`;

  const poseRows = [
    ["C0 既定Worker", c0],
    ["C1 明示OffscreenCanvas Worker", c1],
    ["C2 明示HTMLCanvas Main", c2],
  ].filter(([, method]) => method);
  detailHtml += `
    <h2>Pose実行方式の結果</h2>
    <table>
      <thead><tr><th>方式</th><th>成否</th><th>所要時間</th><th>詳細</th></tr></thead>
      <tbody>${poseRows
        .map(([label, method]) => {
          let detail = method.error;
          if (method.status === "SUCCEEDED") {
            detail = label.startsWith("C0")
              ? `default init ${formatMs(method.initializationMs)}`
              : `${method.processedFrames}/${method.requestedFrames} frames${method.executionThread === "MAIN" ? `, max block ${formatMs(method.maxMainThreadBlockMs)}` : ""}`;
          }
          return `<tr><th>${escapeHtml(label)}</th><td>${method.status === "SUCCEEDED" ? "成功" : "失敗"}</td><td>${formatMs(method.totalMs)}</td><td class="wrap">${escapeHtml(detail)}</td></tr>`;
        })
        .join("")}</tbody>
    </table>`;

  for (const [label, pose] of [
    ["C1 Worker", c1],
    ["C2 Main", c2],
  ]) {
    if (pose?.status !== "SUCCEEDED") continue;
    const timingRows = [
      ["シーク", pose.timing.seek],
      ["画像化", pose.timing.bitmap],
      ["推論", pose.timing.inference],
      ["実行往復", pose.timing.executionRoundTrip],
    ];
    detailHtml += `
      <h2>${escapeHtml(label)}の時間内訳</h2>
      <table>
        <thead><tr><th>区間</th><th>合計</th><th>平均/回</th><th>p95</th><th>最大</th></tr></thead>
        <tbody>${timingRows
          .map(
            ([label, value]) => `<tr><th>${label}</th><td>${formatMs(value.totalMs)}</td><td>${formatMs(value.meanMs)}</td><td>${formatMs(value.p95Ms)}</td><td>${formatMs(value.maxMs)}</td></tr>`,
          )
          .join("")}</tbody>
      </table>`;
  }
  const workerEnvironment = c0.environment;
  const video =
    methods.a1HiddenPlay.video?.durationSeconds !== null
      ? methods.a1HiddenPlay.video
      : methods.a2RenderedPlay.video;
  detailHtml += `
    <dl>
      <div><dt>動画</dt><dd>${escapeHtml(result.file.name)} / ${(result.file.sizeBytes / 1024 / 1024).toFixed(1)}MB${video?.durationSeconds ? ` / ${video.durationSeconds.toFixed(2)}秒` : ""}${video?.width ? ` / ${video.width}x${video.height}` : ""}</dd></div>
      <div><dt>端末</dt><dd>${escapeHtml(result.device.userAgent)}</dd></div>
      <div><dt>WebCodecs VideoDecoder</dt><dd>${result.device.webCodecsVideoDecoder ? "利用可能" : "利用不可"}</dd></div>
      <div><dt>Worker UA</dt><dd>${escapeHtml(workerEnvironment?.userAgent ?? "取得失敗")}</dd></div>
      <div><dt>Worker document</dt><dd>${workerEnvironment?.documentAvailable ? "あり" : "なし"}</dd></div>
      <div><dt>Worker OffscreenCanvas / WebGL2</dt><dd>${workerEnvironment?.offscreenCanvasAvailable ? "あり" : "なし"} / ${workerEnvironment?.offscreenCanvasWebgl2 ? "取得成功" : "取得失敗"}</dd></div>
      <div><dt>MediaPipe自動判定</dt><dd>${workerEnvironment?.mediaPipeSupportsOffscreenCanvas ? "対応扱い" : "非対応扱い"}（WebKit=${String(workerEnvironment?.mediaPipeIsWebKit)}, Safari major=${workerEnvironment?.mediaPipeSafariMajorVersion ?? "取得なし"}）</dd></div>
    </dl>`;
  detailsElement.innerHTML = detailHtml;
  jsonElement.textContent = JSON.stringify(result, null, 2);
  copyButton.disabled = false;
}

async function requestWakeLock() {
  try {
    return await navigator.wakeLock?.request("screen");
  } catch {
    return null;
  }
}

async function runDiagnostic(file, primingTrials) {
  const runStartedAt = performance.now();
  const measuredAt = new Date().toISOString();
  const wakeLock = await requestWakeLock();
  fileInput.disabled = true;
  statusElement.dataset.state = "running";
  statusElement.textContent = "A1/A2の動画読み込み方式を比較しています…";
  progressElement.max = 3;
  progressElement.value = 0;
  progressLabel.textContent = "方式比較 0 / 3";
  summaryElement.replaceChildren();
  detailsElement.replaceChildren();
  jsonElement.textContent = "";
  copyButton.disabled = true;

  try {
    const [a1HiddenPlay, a2RenderedPlay] = await Promise.all(
      primingTrials.map((trial) => trial.completion),
    );
    progressElement.value = 2;
    progressLabel.textContent = "方式比較 2 / 3";

    statusElement.textContent = "B: WebCodecsで同じ動画をdemux・decodeしています…";
    const webCodecs = await runWebCodecsTrial(file);
    progressElement.value = 3;
    progressLabel.textContent = "方式比較 3 / 3";

    const methods = { a1HiddenPlay, a2RenderedPlay, webCodecs };
    const selectedTrial =
      a1HiddenPlay.status === "SUCCEEDED"
        ? primingTrials[0]
        : a2RenderedPlay.status === "SUCCEEDED"
          ? primingTrials[1]
          : null;
    const c0DefaultWorker = await runDefaultWorkerTrial();
    const c1ExplicitOffscreenWorker = selectedTrial
      ? await runExplicitOffscreenWorkerTrial(
          selectedTrial.video,
          selectedTrial.mode,
        )
      : null;
    const c2MainThreadCanvas = selectedTrial
      ? await runMainThreadCanvasTrial(selectedTrial.video, selectedTrial.mode)
      : null;
    const poseMethods = {
      c0DefaultWorker,
      c1ExplicitOffscreenWorker,
      c2MainThreadCanvas,
    };
    const result = {
      schemaVersion: 3,
      status: "COMPLETED",
      measuredAt,
      totalElapsedMs: round(performance.now() - runStartedAt),
      diagnostic: {
        sampleRateFps: SAMPLE_RATE_FPS,
        model: "pose_landmarker_full-float16-v1",
        delegate: "CPU",
        mp4boxVersion: "2.4.1",
      },
      frameSourceDecision: "PENDING",
      poseInputFrameSourceMethod: selectedTrial?.mode ?? null,
      poseImplementationCandidate: poseImplementationCandidate(poseMethods),
      file: { name: file.name, sizeBytes: file.size, type: file.type || null },
      methods,
      poseMethods,
      device: deviceInformation(),
    };
    renderResult(result);
    statusElement.dataset.state = "done";
    statusElement.textContent = "比較完了。結果全体をスクリーンショットし、JSON全文も共有してください。";
  } catch (error) {
    const failure = {
      schemaVersion: 3,
      status: "FAILED",
      measuredAt,
      error: errorMessage(error),
      totalElapsedMs: round(performance.now() - runStartedAt),
      device: deviceInformation(),
    };
    jsonElement.textContent = JSON.stringify(failure, null, 2);
    copyButton.disabled = false;
    statusElement.dataset.state = "error";
    statusElement.textContent = `診断自体が失敗: ${failure.error}`;
  } finally {
    for (const trial of primingTrials) trial.close();
    await wakeLock?.release().catch(() => {});
    fileInput.disabled = false;
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  // Both play() calls happen synchronously in the trusted file-input change
  // handler. Do not insert an await before these calls: iOS can consume the
  // transient user activation before an asynchronous continuation resumes.
  const primingTrials = [
    beginVideoPrimingTrial(file, "A1_HIDDEN_PLAY"),
    beginVideoPrimingTrial(file, "A2_RENDERED_PLAY"),
  ];
  void runDiagnostic(file, primingTrials);
});

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(jsonElement.textContent ?? "");
  copyButton.textContent = "コピーしました";
  setTimeout(() => {
    copyButton.textContent = "JSONをコピー";
  }, 2_000);
});
