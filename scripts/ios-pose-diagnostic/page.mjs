const SAMPLE_RATE_FPS = 10;
const EVENT_TIMEOUT_MS = 180_000;

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

function waitForEvent(target, eventName, timeoutMs = EVENT_TIMEOUT_MS) {
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

async function createVideo(file) {
  const video = document.createElement("video");
  const objectUrl = URL.createObjectURL(file);
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = objectUrl;
  document.body.append(video);
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    await waitForEvent(video, "loadedmetadata");
  }
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await waitForEvent(video, "loadeddata");
  }
  return {
    video,
    close() {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
      URL.revokeObjectURL(objectUrl);
    },
  };
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

function formatMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value >= 1_000
    ? `${(value / 1_000).toFixed(1)}秒`
    : `${value.toFixed(1)}ms`;
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

function diagnosis(seek, inference) {
  if (seek.totalMs >= inference.totalMs * 1.5) {
    return `シーク優位（推論の ${(seek.totalMs / Math.max(inference.totalMs, 0.001)).toFixed(1)}倍）`;
  }
  if (inference.totalMs >= seek.totalMs * 1.5) {
    return `推論優位（シークの ${(inference.totalMs / Math.max(seek.totalMs, 0.001)).toFixed(1)}倍）`;
  }
  return "シークと推論が同程度";
}

function metricCard(label, total, perFrame) {
  return `<article class="metric"><h3>${label}</h3><strong>${formatMs(total)}</strong><span>平均 ${formatMs(perFrame)}</span></article>`;
}

function renderResult(result) {
  const { timing } = result;
  summaryElement.innerHTML = [
    `<article class="metric accent"><h3>暫定判定</h3><strong>${result.diagnosis}</strong><span>同じ動画・端末内の時間比</span></article>`,
    `<article class="metric"><h3>総所要時間</h3><strong>${formatMs(timing.totalElapsedMs)}</strong><span>${result.processedFrames}/${result.requestedFrames}フレーム</span></article>`,
    metricCard("シーク", timing.seek.totalMs, timing.seek.meanMs),
    metricCard("推論（Worker内）", timing.inference.totalMs, timing.inference.meanMs),
    metricCard("画像化", timing.bitmap.totalMs, timing.bitmap.meanMs),
    metricCard("初期化", timing.initializationMs, timing.initializationMs),
  ].join("");

  const rows = [
    ["シーク", timing.seek],
    ["画像化", timing.bitmap],
    ["推論（Worker内）", timing.inference],
    ["Worker往復", timing.workerRoundTrip],
  ];
  detailsElement.innerHTML = `
    <table>
      <thead><tr><th>区間</th><th>合計</th><th>平均/回</th><th>p95</th><th>最大</th></tr></thead>
      <tbody>${rows
        .map(
          ([label, value]) => `<tr><th>${label}</th><td>${formatMs(value.totalMs)}</td><td>${formatMs(value.meanMs)}</td><td>${formatMs(value.p95Ms)}</td><td>${formatMs(value.maxMs)}</td></tr>`,
        )
        .join("")}</tbody>
    </table>
    <dl>
      <div><dt>動画</dt><dd>${result.file.name} / ${(result.file.sizeBytes / 1024 / 1024).toFixed(1)}MB / ${result.video.durationSeconds.toFixed(2)}秒 / ${result.video.width}x${result.video.height}</dd></div>
      <div><dt>実シーク回数</dt><dd>${result.seekEventCount}回（先頭フレームはcurrentTime=0のため通常スキップ）</dd></div>
      <div><dt>pose検出</dt><dd>${result.poseDetectedFrames}/${result.processedFrames}フレーム</dd></div>
      <div><dt>端末</dt><dd>${result.device.userAgent}</dd></div>
      <div><dt>WebCodecs VideoDecoder</dt><dd>${result.device.webCodecsVideoDecoder ? "利用可能" : "利用不可"}</dd></div>
    </dl>`;
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

async function runDiagnostic(file) {
  const runStartedAt = performance.now();
  const measuredAt = new Date().toISOString();
  let videoSource = null;
  let workerClient = null;
  const frameMeasurements = [];
  const wakeLock = await requestWakeLock();
  fileInput.disabled = true;
  statusElement.dataset.state = "running";
  statusElement.textContent = "動画を準備しています…";
  summaryElement.replaceChildren();
  detailsElement.replaceChildren();
  jsonElement.textContent = "";
  copyButton.disabled = true;

  try {
    videoSource = await createVideo(file);
    const { video } = videoSource;
    const requestedFrames = Math.max(1, Math.floor(video.duration * SAMPLE_RATE_FPS));
    progressElement.max = requestedFrames;
    progressElement.value = 0;
    progressLabel.textContent = `0 / ${requestedFrames}`;

    statusElement.textContent = "fullモデルを初期化しています…";
    workerClient = new DiagnosticWorkerClient();
    const initialized = await workerClient.call("initialize");

    for (let index = 0; index < requestedFrames; index += 1) {
      const timestampMs = Math.round((index * 1_000) / SAMPLE_RATE_FPS);
      statusElement.textContent = `計測中: ${index + 1} / ${requestedFrames}フレーム`;

      const seek = await seekTo(video, timestampMs / 1_000);
      const bitmapStartedAt = performance.now();
      const bitmap = await createImageBitmap(video);
      const bitmapMs = performance.now() - bitmapStartedAt;
      const roundTripStartedAt = performance.now();
      const detected = await workerClient.call(
        "detect",
        { bitmap, timestampMs },
        [bitmap],
      );
      const workerRoundTripMs = performance.now() - roundTripStartedAt;
      frameMeasurements.push({
        index,
        timestampMs,
        seekMs: round(seek.elapsedMs, 3),
        seekEventFired: seek.eventFired,
        bitmapMs: round(bitmapMs, 3),
        inferenceMs: round(detected.inferenceMs, 3),
        workerRoundTripMs: round(workerRoundTripMs, 3),
        poseDetected: detected.poseCount > 0,
      });
      progressElement.value = index + 1;
      progressLabel.textContent = `${index + 1} / ${requestedFrames}`;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const seek = summarize(frameMeasurements.map((frame) => frame.seekMs));
    const bitmap = summarize(frameMeasurements.map((frame) => frame.bitmapMs));
    const inference = summarize(frameMeasurements.map((frame) => frame.inferenceMs));
    const workerRoundTrip = summarize(
      frameMeasurements.map((frame) => frame.workerRoundTripMs),
    );
    const result = {
      schemaVersion: 1,
      status: "COMPLETED",
      measuredAt,
      diagnostic: {
        sampleRateFps: SAMPLE_RATE_FPS,
        model: "pose_landmarker_full-float16-v1",
        delegate: "CPU",
      },
      diagnosis: diagnosis(seek, inference),
      file: { name: file.name, sizeBytes: file.size, type: file.type || null },
      video: {
        durationSeconds: round(video.duration, 3),
        width: video.videoWidth,
        height: video.videoHeight,
      },
      requestedFrames,
      processedFrames: frameMeasurements.length,
      seekEventCount: frameMeasurements.filter((frame) => frame.seekEventFired).length,
      poseDetectedFrames: frameMeasurements.filter((frame) => frame.poseDetected).length,
      timing: {
        totalElapsedMs: round(performance.now() - runStartedAt),
        initializationMs: round(initialized.initializationMs),
        seek: roundedSummary(seek),
        bitmap: roundedSummary(bitmap),
        inference: roundedSummary(inference),
        workerRoundTrip: roundedSummary(workerRoundTrip),
      },
      device: deviceInformation(),
      frames: frameMeasurements,
    };
    renderResult(result);
    statusElement.dataset.state = "done";
    statusElement.textContent = "計測完了。下の結果全体をスクリーンショットしてください。";
  } catch (error) {
    const failure = {
      schemaVersion: 1,
      status: "FAILED",
      measuredAt,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      processedFrames: frameMeasurements.length,
      totalElapsedMs: round(performance.now() - runStartedAt),
      device: deviceInformation(),
      frames: frameMeasurements,
    };
    jsonElement.textContent = JSON.stringify(failure, null, 2);
    copyButton.disabled = false;
    statusElement.dataset.state = "error";
    statusElement.textContent = `計測失敗: ${failure.error}`;
  } finally {
    videoSource?.close();
    await workerClient?.close().catch(() => {});
    await wakeLock?.release().catch(() => {});
    fileInput.disabled = false;
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void runDiagnostic(file);
});

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(jsonElement.textContent ?? "");
  copyButton.textContent = "コピーしました";
  setTimeout(() => {
    copyButton.textContent = "JSONをコピー";
  }, 2_000);
});
