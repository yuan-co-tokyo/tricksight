class PoseWorkerClient {
  constructor() {
    this.worker = new Worker("/scripts/pose-landmarker-worker.mjs", {
      type: "module",
    });
    this.nextId = 1;
    this.pending = new Map();
    this.worker.addEventListener("message", (event) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      if (event.data.error) pending.reject(new Error(event.data.error));
      else pending.resolve(event.data.result);
    });
    this.worker.addEventListener("error", (event) => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error(event.message));
      }
      this.pending.clear();
    });
  }

  call(type, payload = {}, transfer = []) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, ...payload }, transfer);
    });
  }

  async close() {
    try {
      await this.call("close");
    } finally {
      this.worker.terminate();
    }
  }
}

function waitForEvent(target, eventName, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${eventName}.`));
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

async function createVideo(videoUrl) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = videoUrl;
  document.body.replaceChildren(video);
  await waitForEvent(video, "loadedmetadata");
  await waitForEvent(video, "loadeddata");
  return video;
}

async function seek(video, seconds) {
  if (Math.abs(video.currentTime - seconds) < 0.0005 && video.readyState >= 2) {
    return;
  }
  const event = waitForEvent(video, "seeked");
  video.currentTime = Math.min(seconds, Math.max(0, video.duration - 0.001));
  await event;
}

async function detectCurrentFrame(client, video, timestampMs) {
  const bitmap = await createImageBitmap(video);
  const result = await client.call(
    "detect",
    { bitmap, timestampMs },
    [bitmap],
  );
  return {
    timestampMs,
    inferenceMs: result.inferenceMs,
    landmarks: result.landmarks,
    worldLandmarks: result.worldLandmarks,
  };
}

async function runFixed(video, client, fixedFps) {
  const frames = [];
  const frameInterval = 1 / fixedFps;
  const requestedFrameCount = Math.max(1, Math.floor(video.duration * fixedFps));

  for (let index = 0; index < requestedFrameCount; index += 1) {
    const seconds = index * frameInterval;
    await seek(video, seconds);
    frames.push(await detectCurrentFrame(client, video, Math.round(seconds * 1_000)));
  }

  return { frames, presentedFrameGaps: 0 };
}

function nextPresentedFrame(video) {
  return new Promise((resolve, reject) => {
    let callbackId;
    const timeout = setTimeout(() => {
      if (callbackId !== undefined) video.cancelVideoFrameCallback(callbackId);
      reject(new Error("Timed out waiting for a presented video frame."));
    }, 15_000);
    callbackId = video.requestVideoFrameCallback((_now, metadata) => {
      clearTimeout(timeout);
      video.pause();
      resolve(metadata);
    });
    void video.play().catch((error) => {
      clearTimeout(timeout);
      video.cancelVideoFrameCallback(callbackId);
      reject(error);
    });
  });
}

async function runAllFrames(video, client) {
  const frames = [];
  let lastMediaTime = -1;
  let lastPresentedFrames = null;
  let presentedFrameGaps = 0;

  await seek(video, 0);
  while (lastMediaTime < video.duration - 0.001) {
    let metadata;
    try {
      metadata = await nextPresentedFrame(video);
    } catch (error) {
      if (video.ended || video.currentTime >= video.duration - 0.01) break;
      throw error;
    }

    if (
      lastPresentedFrames !== null &&
      metadata.presentedFrames > lastPresentedFrames + 1
    ) {
      presentedFrameGaps += metadata.presentedFrames - lastPresentedFrames - 1;
    }
    lastPresentedFrames = metadata.presentedFrames;

    if (metadata.mediaTime <= lastMediaTime) {
      if (video.ended) break;
      continue;
    }
    lastMediaTime = metadata.mediaTime;
    frames.push(
      await detectCurrentFrame(
        client,
        video,
        Math.round(metadata.mediaTime * 1_000),
      ),
    );
  }

  return { frames, presentedFrameGaps };
}

window.runPoseLandmarker = async ({
  videoUrl,
  mode,
  fixedFps,
  landmarkerConfig,
}) => {
  const video = await createVideo(videoUrl);
  const client = new PoseWorkerClient();
  const initialized = await client.call("initialize", {
    config: landmarkerConfig,
  });
  const startedAt = performance.now();

  try {
    const output =
      mode === "fixed"
        ? await runFixed(video, client, fixedFps)
        : await runAllFrames(video, client);
    return {
      mode,
      fixedFps: mode === "fixed" ? fixedFps : null,
      durationMs: video.duration * 1_000,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      initializationMs: initialized.initializationMs,
      processingMs: performance.now() - startedAt,
      presentedFrameGaps: output.presentedFrameGaps,
      frames: output.frames,
    };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    await client.close();
  }
};
