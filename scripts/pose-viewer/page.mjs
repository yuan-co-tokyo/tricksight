import { createBrowserFrameSource } from "/pose/browser-analysis";
import { POSE_LANDMARKER_CONFIG as config } from "/pose/config";
import { summarize, visible, names } from "/series.mjs";

const $ = id => document.getElementById(id);
const video = $("source"), canvas = $("stage"), ctx = canvas.getContext("2d");
const controls = ["play", "prev", "next", "minimum", "apex", "landing", "scrub", "export", "json"];
let current = null, job = null, generation = 0, objectUrl = null, downloadUrl = null;
let worker = null, connections = [], recorder = null, exportCancelled = false;
let lastTime = 0, callbackId = null;
const colors = { ink: "#e9f4fa", muted: "#a9bccd", cyan: "#67efdd", low: "#ff756b", amber: "#ffc170", blue: "#80b9ff" };
const num = (value, digits = 1) => value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
const text = (str, x, y, size = 20, color = colors.ink) => { ctx.font = `${size}px sans-serif`; ctx.fillStyle = color; ctx.fillText(str, x, y); };
function status(message, state) { $("status").textContent = message; $("status").dataset.state = state; }
function enable(enabled) {
  for (const id of controls) $(id).disabled = !enabled;
  if (enabled) {
    $("minimum").disabled = current?.kneeMinimumTimestampMs == null;
    $("apex").disabled = current?.calculated.detectedApexTimestampMs == null;
    $("landing").disabled = current?.calculated.detectedLandingTimestampMs == null;
  }
}
function clearDownload() { if (downloadUrl) URL.revokeObjectURL(downloadUrl); downloadUrl = null; $("download").hidden = true; }
function rpcClient(instance) {
  let nextId = 0;
  const pending = new Map();
  instance.onmessage = ({ data }) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    clearTimeout(request.timer);
    if (data.error) request.reject(new Error(data.error)); else request.resolve(data.result);
  };
  const fail = error => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); };
  instance.onerror = event => fail(new Error(event.message));
  return {
    call(type, payload = {}, transfer = []) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("Worker応答が60秒以内にありません")); }, 60_000);
        pending.set(id, { resolve, reject, timer });
        try { instance.postMessage({ id, type, ...payload }, transfer); }
        catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    dispose() { fail(new DOMException("中止", "AbortError")); instance.terminate(); },
  };
}
function eventOnce(target, name, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(`${name} timeout`)), 20_000);
    const success = () => done();
    const failure = () => done(new Error("動画をデコードできませんでした"));
    const abort = () => done(new DOMException("中止", "AbortError"));
    function done(error) {
      clearTimeout(timer); target.removeEventListener(name, success); target.removeEventListener("error", failure); signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    }
    target.addEventListener(name, success, { once: true }); target.addEventListener("error", failure, { once: true }); signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
async function seek(seconds) {
  video.pause(); $("play").textContent = "再生";
  const target = Math.min(Math.max(0, seconds), Math.max(0, video.duration - 0.001));
  if (Math.abs(video.currentTime - target) > 0.00001) {
    const promise = eventOnce(video, "seeked"); video.currentTime = target; await promise;
  }
  render(target);
}

function plot(x, y, width, height, values, label, color, position, range) {
  ctx.fillStyle = "#101e2c"; ctx.fillRect(x, y, width, height);
  text(label, x + 10, y + 23, 17, color);
  const finite = values.filter(v => v != null && Number.isFinite(v));
  const lo = range?.[0] ?? Math.min(0, ...finite), hi = range?.[1] ?? Math.max(1, ...finite);
  text(`${num(hi, 1)}`, x + 8, y + 44, 12, colors.muted);
  text(`${num(lo, 1)}`, x + 8, y + height - 9, 12, colors.muted);
  ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2;
  let move = true;
  values.forEach((value, index) => {
    if (value == null || !Number.isFinite(value)) { move = true; return; }
    const px = x + 42 + index / Math.max(1, values.length - 1) * (width - 54);
    const py = y + height - 15 - (value - lo) / Math.max(1e-6, hi - lo) * (height - 50);
    if (move) ctx.moveTo(px, py); else ctx.lineTo(px, py); move = false;
  });
  ctx.stroke();
  const cursor = x + 42 + position / Math.max(1, values.length - 1) * (width - 54);
  ctx.strokeStyle = "#f2f6fc"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cursor, y + 30); ctx.lineTo(cursor, y + height - 9); ctx.stroke();
}
function render(seconds = video.currentTime) {
  lastTime = seconds;
  ctx.fillStyle = "#0a111c"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!current || video.readyState < 2) { text("POSE LAB / 動画を選択して解析", 40, 80, 30); return; }
  const index = Math.min(current.frames.length - 1, Math.max(0, Math.floor((seconds * 1000 + 0.001) / 100)));
  const frame = current.frames[index], d = frame.derived;
  const atSample = Math.abs(seconds * 1000 - frame.timestampMs) < 1;
  const scale = Math.min(1240 / video.videoWidth, 590 / video.videoHeight);
  const width = video.videoWidth * scale, height = video.videoHeight * scale;
  const ox = (1280 - width) / 2, oy = 72 + (590 - height) / 2;
  text(`POSE LAB  /  ${current.filename.slice(0, 58)}`, 24, 28, 23);
  text($("note").value || "検証用 · full / CPU · 固定10fps · 音声なし", 24, 55, 18, colors.muted);
  ctx.drawImage(video, ox, oy, width, height);
  ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, width, height); ctx.clip();
  const landmarks = frame.landmarks;
  if (landmarks) {
    for (const { start, end } of connections) {
      const a = landmarks[start], b = landmarks[end];
      if (!a || !b) continue;
      const valid = visible(a) && visible(b);
      ctx.strokeStyle = valid ? colors.cyan : colors.low;
      ctx.lineWidth = valid ? 3 : 2;
      ctx.setLineDash(!valid || !atSample ? [6, 4] : []);
      ctx.beginPath(); ctx.moveTo(ox + a.x * width, oy + a.y * height); ctx.lineTo(ox + b.x * width, oy + b.y * height); ctx.stroke();
    }
    ctx.setLineDash([]);
    landmarks.forEach((p, i) => {
      ctx.fillStyle = visible(p) ? colors.cyan : colors.low;
      ctx.strokeStyle = "#10202c"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ox + p.x * width, oy + p.y * height, i >= 23 ? 6 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (i >= 23 && !visible(p)) text(String(i), ox + p.x * width + 8, oy + p.y * height - 5, 16, colors.low);
    });
  }
  ctx.restore();
  ctx.fillStyle = "#101f2d"; ctx.fillRect(20, 670, 1240, 41);
  text(`表示 ${num(seconds, 3)} s   |   サンプル #${index}  ${num(frame.timestampMs / 1000, 3)} s`, 34, 697, 21, colors.cyan);
  text(atSample ? "製品サンプル時刻" : "間の表示フレーム：直前の骨格を保持", 700, 697, 20, atSample ? colors.cyan : colors.amber);
  const missing = frame.missing.map(i => names[i]).join("・");
  text(!landmarks ? "POSEなし：骨格を描画しません" : frame.lowerBodyVisible ? "下半身 8/8 · visibility / presence ≥ 0.5" : `下半身不足：${missing}`, 30, 738, 20, frame.lowerBodyVisible ? colors.cyan : colors.low);
  text(`膝平均 ${num(d?.meanKneeAngleDeg)}°  L ${num(d?.leftKneeAngleDeg)}° / R ${num(d?.rightKneeAngleDeg)}°`, 30, 780, 23);
  text(`腰高さ ${num(frame.hipHeightTorso, 3)} 胴長`, 470, 780, 23);
  text(`体幹傾斜 ${num(d?.trunkTiltDeg)}°`, 880, 780, 23);
  text(`左右膝差 ${num(frame.kneeAsymmetryDeg)}°`, 30, 820, 22, colors.muted);
  text(`足首高さ差 ${num(frame.ankleAsymmetryTorso, 3)} 胴長`, 470, 820, 22, colors.muted);
  text(`足幅 ${num(frame.footSeparationHipWidths, 2)} 腰幅`, 880, 820, 22, colors.muted);
  text(`腰画面Y ${num(d?.hipY, 4)}（下向き+） / 高さは全有効フレームYのp80基準、胴長中央値で正規化`, 30, 851, 16, colors.muted);
  plot(25, 866, 400, 120, current.frames.map(f => f.derived?.meanKneeAngleDeg), "膝平均 / deg · 欠損は線を切る", colors.cyan, index, [0, 180]);
  plot(440, 866, 400, 120, current.frames.map(f => f.hipHeightTorso), "腰相対高さ / 胴長", colors.blue, index);
  plot(855, 866, 400, 120, current.frames.map(f => f.derived?.trunkTiltDeg), "体幹傾斜 / deg", colors.amber, index, [0, 90]);
  const q = current.measurement.quality;
  text(`${current.measurement.status}   pose ${num(q.poseCoverage * 100)}% / 下半身 ${num(q.lowerBodyCoverage * 100)}%   ·  ゲート各80%`, 30, 1020, 20, current.measurement.status === "COMPLETED" ? colors.cyan : colors.amber);
  text("診断候補値 · 成功判定ではありません", 870, 1020, 18, colors.muted);
  $("clock").textContent = `${num(seconds, 3)} / ${num(current.durationMs / 1000, 3)} s`;
  $("scrub").value = String(seconds);
}
function startFrameLoop() {
  if (callbackId != null && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(callbackId);
  if (video.requestVideoFrameCallback) {
    const tick = (_now, metadata) => { render(metadata.mediaTime); callbackId = video.requestVideoFrameCallback(tick); };
    callbackId = video.requestVideoFrameCallback(tick);
  }
}
// Fallback browsers repaint from currentTime; the decoded-frame callback is preferred.
function animationLoop() { if (!video.requestVideoFrameCallback && !video.paused) render(); requestAnimationFrame(animationLoop); }
animationLoop();
function summaryDom() {
  const q = current.measurement.quality, m = current.calculated;
  $("summary").replaceChildren();
  const add = (label, value, warning = false) => {
    const div = document.createElement("div"); div.className = "stat";
    const title = document.createElement("span"); title.textContent = label;
    const strong = document.createElement("strong"); strong.textContent = value; if (warning) strong.className = "warning";
    div.append(title, strong); $("summary").append(div);
  };
  add(current.measurement.status === "COMPLETED" ? "品質ゲート通過" : "製品では判定不能・集約値は保存しない", current.measurement.status, current.measurement.status !== "COMPLETED");
  add(`${current.frames.length} サンプル / 固定10fps`, `pose ${num(q.poseCoverage * 100)}% · 下半身 ${num(q.lowerBodyCoverage * 100)}%`);
  const prefix = current.measurement.status === "COMPLETED" ? "製品集約" : "診断参考・製品非表示";
  add(`${prefix}：膝最小値（実装はp05）`, `${num(m.minimumMeanKneeAngleDeg)}°`);
  add(`${prefix}：膝伸展幅（p90−p10）`, `${num(m.kneeExtensionRangeDeg)}°`);
  add(`${prefix}：腰上下幅（p90−p10 / 胴長中央値）`, `${num(m.hipRiseTorsoUnits, 3)} 胴長`);
  add(`${prefix}：推定着地窓の体幹中央値`, `${num(m.landingTrunkTiltDeg)}°`);
  add("単一フレームの膝最小 / p05を挟む時刻", `${num(current.kneeMinimumTimestampMs == null ? null : current.kneeMinimumTimestampMs / 1000, 3)} s / ${current.p05Frames.map(t => num(t / 1000, 3)).join("・")} s`);
  add("推定頂点 / 推定着地（接地の実測ではない）", `${num(m.detectedApexTimestampMs == null ? null : m.detectedApexTimestampMs / 1000, 3)} / ${num(m.detectedLandingTimestampMs == null ? null : m.detectedLandingTimestampMs / 1000, 3)} s`);
}
function abortJob() { job?.abort(); worker?.dispose(); worker = null; }
$("video-file").addEventListener("change", () => {
  const file = $("video-file").files[0]; if (!file) return;
  const mine = ++generation;
  abortJob(); video.pause(); current = null; enable(false); clearDownload(); render(0);
  $("summary").textContent = "新しい動画の解析結果を待っています。";
  if (file.size > 100 * 1024 * 1024) { status("100MB以下の動画を選んでください", "error"); return; }
  job = new AbortController(); const signal = job.signal;
  const startedAt = performance.now();
  // The product helper calls muted play synchronously in this change handler.
  const sourcePromise = createBrowserFrameSource(file, signal);
  $("cancel").disabled = false; $("progress").value = 0; status("動画を準備しています…", "working");
  void (async () => {
    let source, client;
    const timeout = setTimeout(() => { if (mine === generation) abortJob(); }, 180_000);
    try {
      source = await sourcePromise;
      if (mine !== generation || signal.aborted) throw new DOMException("中止", "AbortError");
      if (source.durationMs < 3000 || source.durationMs > 20000) throw new Error("3〜20秒の動画を選んでください");
      client = rpcClient(new Worker("/worker.mjs", { type: "module" })); worker = client;
      const init = performance.now(); const initialized = await client.call("initialize");
      connections = initialized.connections;
      const initializationMs = performance.now() - init;
      const frames = [], count = Math.max(1, Math.floor(source.durationMs / 1000 * config.sampleRateFps));
      for (let i = 0; i < count; i++) {
        if (signal.aborted || mine !== generation) throw new DOMException("中止", "AbortError");
        const timestampMs = i / config.sampleRateFps * 1000;
        const bitmap = await source.frameAt(timestampMs, signal);
        try { frames.push(await client.call("detect", { bitmap, timestampMs }, [bitmap])); }
        finally { bitmap.close(); }
        $("progress").value = (i + 1) / count;
        status(`固定10fpsを解析中 ${i + 1} / ${count}`, "working");
      }
      await client.call("close");
      if (mine !== generation || signal.aborted) throw new DOMException("中止", "AbortError");
      current = { ...summarize({ mode: "fixed", fixedFps: 10, durationMs: source.durationMs,
        videoWidth: source.videoWidth, videoHeight: source.videoHeight, initializationMs,
        processingMs: performance.now() - startedAt, presentedFrameGaps: 0, frames }), filename: file.name };
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(file);
      const loaded = eventOnce(video, "loadeddata", signal); video.src = objectUrl; video.load();
      // Muted play also primes the visible playback element on WebKit.
      await Promise.all([loaded, video.play()]); video.pause();
      await seek(0);
      $("scrub").max = String(Math.max(0, video.duration - 0.001));
      summaryDom(); enable(true); startFrameLoop();
      $("minimum").disabled = current.kneeMinimumTimestampMs == null;
      $("apex").disabled = current.calculated.detectedApexTimestampMs == null;
      $("landing").disabled = current.calculated.detectedLandingTimestampMs == null;
      status(`解析完了 · ${frames.length} サンプル · ${num(current.processingMs / 1000)}秒 · ${current.measurement.status}`, "done");
    } catch (error) {
      if (mine === generation) { current = null; enable(false); status(signal.aborted ? "解析を中止しました。別の動画を選べます。" : String(error), signal.aborted ? "canceled" : "error"); }
    } finally {
      clearTimeout(timeout); source?.close(); client?.dispose();
      if (mine === generation) { worker = null; $("cancel").disabled = true; }
    }
  })();
});
$("cancel").onclick = abortJob;
$("play").onclick = async () => {
  try {
    if (video.paused) { if (video.ended) await seek(0); video.playbackRate = Number($("speed").value); await video.play(); $("play").textContent = "一時停止"; }
    else { video.pause(); $("play").textContent = "再生"; render(); }
  } catch (error) { status(String(error), "error"); }
};
video.onended = () => { $("play").textContent = "再生"; render(Math.max(0, video.duration - 0.001)); };
$("speed").onchange = () => { video.playbackRate = Number($("speed").value); };
$("note").oninput = () => { clearDownload(); render(lastTime); };
$("prev").onclick = () => void seek(Math.max(0, Math.ceil((video.currentTime - 0.001) * 10) - 1) / 10);
$("next").onclick = () => void seek(Math.min(current.frames.length - 1, Math.floor((video.currentTime + 0.001) * 10) + 1) / 10);
$("minimum").onclick = () => void seek(current.kneeMinimumTimestampMs / 1000);
$("apex").onclick = () => void seek(current.calculated.detectedApexTimestampMs / 1000);
$("landing").onclick = () => void seek(current.calculated.detectedLandingTimestampMs / 1000);
$("scrub").onchange = () => void seek(Number($("scrub").value));
$("json").onclick = () => {
  const blob = new Blob([JSON.stringify({ ...current, note: $("note").value, config }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `${current.filename}.pose.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
async function exportVideo() {
  if (!current || recorder) return;
  let stream;
  try {
    if (!canvas.captureStream || typeof MediaRecorder === "undefined") throw new Error("このブラウザでは書き出しできません。デスクトップChromeを使用してください。");
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/mp4"].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error("対応する録画形式がありません");
    clearDownload(); enable(false); $("video-file").disabled = true; $("speed").disabled = true; $("note").disabled = true; $("stop-export").disabled = false;
    exportCancelled = false; await seek(0); video.playbackRate = 1;
    stream = canvas.captureStream(30);
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    const stopped = new Promise((resolve, reject) => {
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = resolve; recorder.onerror = () => reject(new Error("録画エラー"));
    });
    const ended = new Promise(resolve => {
      const onEnd = () => { video.removeEventListener("ended", onEnd); resolve(); };
      video.addEventListener("ended", onEnd, { once: true });
      recorder.addEventListener("stop", onEnd, { once: true });
    });
    status("書き出し中… このタブを前面に保ってください（1×・音声なし）", "exporting");
    recorder.start(250); await video.play();
    const watchdog = setTimeout(() => { exportCancelled = true; if (recorder?.state === "recording") recorder.stop(); }, (video.duration + 20) * 1000);
    await ended; clearTimeout(watchdog);
    video.pause(); if (recorder.state === "recording") recorder.stop(); await stopped;
    if (exportCancelled) { status("書き出しを中止しました。前面のタブで再実行できます。", "done"); return; }
    const blob = new Blob(chunks, { type: mimeType });
    if (!blob.size) throw new Error("空の動画が生成されました");
    downloadUrl = URL.createObjectURL(blob); $("download").href = downloadUrl;
    $("download").download = `${current.filename.replace(/\.[^.]+$/, "")}-pose.${mimeType.includes("mp4") ? "mp4" : "webm"}`;
    $("download").hidden = false;
    status(`書き出し完了 · ${mimeType} · ${num(blob.size / 1024 / 1024, 2)} MB · 「動画を保存」を押してください`, "exported");
  } catch (error) { status(String(error), "error"); }
  finally {
    video.pause(); if (recorder?.state === "recording") recorder.stop(); recorder = null;
    stream?.getTracks().forEach(track => track.stop());
    enable(!!current); $("video-file").disabled = false; $("speed").disabled = false; $("note").disabled = false; $("stop-export").disabled = true;
    video.playbackRate = Number($("speed").value);
  }
}
$("export").onclick = () => void exportVideo();
$("stop-export").onclick = () => { exportCancelled = true; if (recorder?.state === "recording") recorder.stop(); };
document.addEventListener("visibilitychange", () => { if (document.hidden && recorder?.state === "recording") { exportCancelled = true; recorder.stop(); } });
window.addEventListener("pagehide", () => { abortJob(); if (objectUrl) URL.revokeObjectURL(objectUrl); clearDownload(); });
// Diagnostics automation reads only local results. No network endpoint accepts them.
window.poseViewer = { get result() { return current; }, seek, render };
render();
