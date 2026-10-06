import type { DisplayTask, startPoseDisplay as StartPoseDisplay } from "../browser-display";
import type { DisplaySample } from "../display-protocol";
import { viewerMessages, type ViewerState } from "./policy";

type Dependencies = { load?: () => Promise<{ startPoseDisplay: typeof StartPoseDisplay }>; timeoutMs?: number };
export function mountPosePlayer(root: HTMLElement, playbackUrl: string, dependencies: Dependencies = {}) {
  const get = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-pose="${name}"]`)!;
  const video = get<HTMLVideoElement>("video");
  const button = (name: string) => get<HTMLButtonElement>(name);
  let task: DisplayTask | null = null, blob: Blob | null = null, abort: AbortController | null = null;
  let start: typeof StartPoseDisplay | null = null, timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0, state: ViewerState = "OFF", hidden = false, alive = true;
  let frame: number | null = null, raf: number | null = null;
  let canvas: HTMLCanvasElement;
  function freshCanvas() {
    canvas?.remove(); canvas = document.createElement("canvas");
    canvas.dataset.pose = "overlay"; canvas.hidden = true;
    canvas.className = "pointer-events-none absolute inset-0 h-full w-full";
    get("surface").append(canvas);
  }
  const prepared = () => state === "READY" || state === "PARTIAL";
  const fullscreen = () => Boolean(document.fullscreenElement || document.pictureInPictureElement || (video as HTMLVideoElement & { webkitDisplayingFullscreen?: boolean }).webkitDisplayingFullscreen);
  function blank() {
    canvas.hidden = true; get("badge").hidden = true;
    get("knee").textContent = "—"; get("hip").textContent = "—";
    get("times").textContent = "再生 — / 計測 —"; get("detection").textContent = "";
  }
  function setState(next: ViewerState) {
    state = next; get("status").textContent = viewerMessages[next];
    button("fetch").hidden = !["OFF", "ERROR", "STOPPED", "BACKGROUND"].includes(next);
    button("start").hidden = next !== "READY_TO_START";
    button("stop").hidden = ["OFF", "STOPPED", "BACKGROUND", "ERROR"].includes(next);
    button("toggle").hidden = !prepared(); button("toggle").textContent = hidden ? "骨格を再表示" : "骨格を隠す";
    button("toggle").setAttribute("aria-pressed", String(!hidden));
    get("values").hidden = !prepared() || hidden;
    get("progress").hidden = next !== "FETCHING" && next !== "MEASURING";
  }
  function stopClock() { if (frame !== null) video.cancelVideoFrameCallback?.(frame); if (raf !== null) cancelAnimationFrame(raf); frame = raf = null; }
  function release() {
    generation++; stopClock(); clearTimeout(timer); abort?.abort(); abort = null;
    task?.dispose(); task = null; blob = null; start = null; hidden = false; freshCanvas(); blank();
    // The native video's source, position and controls belong to ordinary playback.
  }
  function finish(next: ViewerState) { release(); if (alive) setState(next); }
  function invalidate() { blank(); task?.clear(); }
  function draw(time = video.currentTime * 1000) {
    if (!prepared() || hidden || video.seeking || !video.videoWidth || fullscreen()) return;
    const rect = video.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio, 2, Math.sqrt(4000000 / Math.max(1, rect.width * rect.height)));
    task?.render(time, Math.max(1, Math.floor(rect.width * dpr)), Math.max(1, Math.floor(rect.height * dpr)));
  }
  function clock() {
    stopClock(); if (!prepared() || hidden || video.paused) return;
    if (video.requestVideoFrameCallback) frame = video.requestVideoFrameCallback((_now, metadata) => { frame = null; draw(metadata.mediaTime * 1000); clock(); });
    else raf = requestAnimationFrame(() => { raf = null; draw(); clock(); });
  }
  function sample(value: DisplaySample) {
    if (!prepared() || hidden || video.seeking || fullscreen()) return;
    if (!video.paused && Math.abs(video.currentTime * 1000 - value.playbackTimestampMs) >= 100) { blank(); return; }
    canvas.hidden = false; get("badge").hidden = false;
    get("times").textContent = `再生 ${(value.playbackTimestampMs / 1000).toFixed(2)}秒 / 計測 ${value.sampleTimestampMs === null ? "—" : (value.sampleTimestampMs / 1000).toFixed(2) + "秒"}`;
    get("knee").textContent = value.values.meanKneeAngleDeg === null ? "—" : `${value.values.meanKneeAngleDeg.toFixed(1)}°`;
    get("hip").textContent = value.values.hipRelativeHeightTorsoUnits === null ? "—" : `${value.values.hipRelativeHeightTorsoUnits.toFixed(2)} 胴長`;
    const messages = [];
    if (value.missingReasons.includes("PARTIAL_SKELETON")) messages.push("骨格の一部を検出できません。検出できた部分だけを表示しています。");
    if (!value.drawnPointCount) messages.push("この時刻の骨格は表示できません。");
    if (value.values.meanKneeAngleDeg === null || value.values.hipRelativeHeightTorsoUnits === null) messages.push("必要な部位を十分に検出できない数値は「—」です。");
    get("detection").textContent = messages.join(" ");
  }
  freshCanvas(); setState("OFF");
  button("fetch").onclick = async () => {
    release(); setState("FETCHING"); const own = generation;
    if (!HTMLCanvasElement.prototype.transferControlToOffscreen || typeof Worker === "undefined") { finish("ERROR"); return; }
    abort = new AbortController(); const signal = abort.signal;
    timer = setTimeout(() => { if (own === generation) finish("ERROR"); }, dependencies.timeoutMs ?? 120000);
    const progress = get<HTMLProgressElement>("progress"); progress.removeAttribute("value");
    try {
      const response = await fetch(playbackUrl, { signal, mode: "cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", redirect: "error" });
      if (!response.ok || response.type === "opaque" || !response.body) throw new Error();
      const mime = response.headers.get("content-type")?.split(";")[0];
      if (mime !== "video/mp4" && mime !== "video/quicktime") throw new Error();
      const length = Number(response.headers.get("content-length")); if (length > 100 * 1024 * 1024) throw new Error();
      const reader = response.body.getReader(), parts: BlobPart[] = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 100 * 1024 * 1024) { await reader.cancel(); throw new Error(); }
        parts.push(value); if (length > 0) { progress.max = Math.max(length, size); progress.value = size; }
      }
      const loaded = await (dependencies.load ?? (() => import("../browser-display")))();
      if (own !== generation || !alive) return;
      blob = new Blob(parts, { type: mime }); start = loaded.startPoseDisplay;
      clearTimeout(timer); setState("READY_TO_START");
    } catch { if (own === generation && alive) finish("ERROR"); }
  };
  button("start").onclick = async () => {
    if (!blob || !start || state !== "READY_TO_START") return;
    const own = generation; setState("MEASURING");
    const progress = get<HTMLProgressElement>("progress"); progress.removeAttribute("value");
    try {
      // Loaded during fetch: calling here preserves A1's synchronous user activation.
      task = start(blob, canvas, { timeoutMs: dependencies.timeoutMs, minimumDurationMs: 3000,
        onProgress: count => { if (own === generation) { get("status").textContent = `骨格と数値を準備しています… ${count}枚を計測しました。`; } },
        onSample: value => { if (own === generation) sample(value); },
        onError: () => { if (own === generation) finish("ERROR"); },
      });
      const result = await task.result;
      if (own !== generation || !alive) return;
      blob = null; start = null;
      if (result.status !== "READY") { finish("ERROR"); return; }
      setState(result.quality.status === "ASSESSABLE" ? "READY" : "PARTIAL"); draw(); clock();
    } catch { if (own === generation && alive) finish("ERROR"); }
  };
  button("stop").onclick = () => finish("STOPPED");
  button("toggle").onclick = () => { hidden = !hidden; invalidate(); setState(state); if (hidden) stopClock(); else { draw(); clock(); } };
  function step(delta: number) { if (!Number.isFinite(video.duration)) return; video.pause(); invalidate(); video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + delta)); }
  button("back").onclick = () => step(-.1); button("forward").onclick = () => step(.1);
  get<HTMLSelectElement>("speed").onchange = event => { video.playbackRate = Number((event.target as HTMLSelectElement).value); };
  const events: Record<string, () => void> = {
    seeking: invalidate, seeked: () => { draw(); clock(); }, play: () => { draw(); clock(); }, pause: () => { stopClock(); draw(); }, ended: () => { stopClock(); draw(); },
    error: () => finish("ERROR"), emptied: () => finish("STOPPED"),
    webkitbeginfullscreen: invalidate, enterpictureinpicture: invalidate, webkitendfullscreen: () => draw(), leavepictureinpicture: () => draw(),
  };
  for (const [name, fn] of Object.entries(events)) video.addEventListener(name, fn);
  const resize = new ResizeObserver(() => { invalidate(); draw(); }); resize.observe(video);
  const background = () => finish("BACKGROUND");
  const visibility = () => { if (document.hidden) background(); };
  const restore = (event: PageTransitionEvent) => { if (event.persisted) background(); };
  const full = () => { invalidate(); draw(); };
  addEventListener("pagehide", background); addEventListener("pageshow", restore);
  document.addEventListener("visibilitychange", visibility); document.addEventListener("fullscreenchange", full);
  return () => {
    alive = false; release(); canvas.remove(); resize.disconnect();
    for (const [name, fn] of Object.entries(events)) video.removeEventListener(name, fn);
    removeEventListener("pagehide", background); removeEventListener("pageshow", restore);
    document.removeEventListener("visibilitychange", visibility); document.removeEventListener("fullscreenchange", full);
    for (const name of ["fetch", "start", "stop", "toggle", "back", "forward"]) button(name).onclick = null;
    get<HTMLSelectElement>("speed").onchange = null;
  };
}
