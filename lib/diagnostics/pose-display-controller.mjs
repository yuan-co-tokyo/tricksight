import { startPoseDisplay } from '../pose/browser-display';

// Diagnostic-only UI: point arrays never cross the display Worker's boundary.
export function mountPoseDisplayDiagnostic(root, playbackUrl) {
  const $ = id => root.querySelector('[data-diagnostic="' + id + '"]');
  let blob = null, objectUrl = null, task = null, controller = null;
  let generation = 0, timer = null, ready = false, frameCallback = null, raf = null;
  let report = { state: 'IDLE' };
  const render = () => { $('report').textContent = JSON.stringify(report, null, 2); $('status').textContent = report.state; };
  const replaceCanvas = () => {
    const fresh = document.createElement('canvas');
    fresh.dataset.diagnostic = 'overlay'; fresh.className = $('overlay').className;
    $('overlay').replaceWith(fresh);
  };
  function stopClock() {
    if (frameCallback !== null) $('video').cancelVideoFrameCallback?.(frameCallback);
    if (raf !== null) cancelAnimationFrame(raf);
    frameCallback = null; raf = null;
  }
  function cleanup() {
    generation++; ready = false; stopClock(); clearTimeout(timer);
    controller?.abort(); controller = null; task?.dispose(); task = null; blob = null;
    replaceCanvas(); $('start').disabled = true; $('fetch').disabled = false;
    $('video').pause(); $('video').removeAttribute('src'); $('video').load();
    if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null;
    if ($('current')) $('current').textContent = '—';
  }
  function draw(timeMs = $('video').currentTime * 1000) {
    if (!ready || !task || !$('video').videoWidth || $('video').seeking || document.fullscreenElement || document.pictureInPictureElement || $('video').webkitDisplayingFullscreen) return;
    const rect = $('video').getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio, 2, Math.sqrt(4000000 / Math.max(1, rect.width * rect.height)));
    task.render(timeMs, Math.max(1, Math.floor(rect.width * dpr)), Math.max(1, Math.floor(rect.height * dpr)));
  }
  function clock() {
    stopClock();
    if (!ready || $('video').paused) return;
    if (typeof $('video').requestVideoFrameCallback === 'function') {
      frameCallback = $('video').requestVideoFrameCallback((_now, metadata) => { frameCallback = null; draw(metadata.mediaTime * 1000); clock(); });
    } else raf = requestAnimationFrame(() => { raf = null; draw(); clock(); });
  }
  function invalidate() {
    $('overlay').hidden = true; task?.clear();
    if ($('current')) $('current').textContent = '時刻を更新中…';
  }
  $('fetch').onclick = async () => {
    cleanup(); const own = generation;
    report = { state: 'FETCHING', fetchMs: null, blobBytes: null, blobType: null, analysisMs: null,
      analysisStatus: null, frameCount: null, synchronousPlayCalls: 0, displayTransferred: false, displayPainted: false,
      peakVideoElements: 0, cleanup: false, current: null };
    render(); const url = new URL(playbackUrl);
    $('video').src = url.href;
    controller = new AbortController(); timer = setTimeout(() => controller?.abort(), 120000); $('fetch').disabled = true;
    const started = performance.now();
    try {
      const response = await fetch(url.href, { mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal });
      if (!response.ok || response.type === 'opaque') throw Error();
      if (Number(response.headers.get('content-length')) > 100 * 1024 * 1024) throw Error();
      const reader = response.body.getReader(), parts = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 100 * 1024 * 1024) { await reader.cancel(); throw Error(); } parts.push(value);
      }
      if (own !== generation) return;
      blob = new Blob(parts, { type: response.headers.get('content-type')?.split(';')[0] || 'video/mp4' });
      objectUrl = URL.createObjectURL(blob); $('video').src = objectUrl;
      report = { ...report, state: 'READY_TO_START', fetchMs: Math.round(performance.now() - started), blobBytes: blob.size,
        blobType: ['video/mp4', 'video/quicktime'].includes(blob.type) ? blob.type : 'other' };
      $('start').disabled = false;
    } catch { if (own === generation) report.state = 'FETCH_FAILED_OR_CORS_BLOCKED'; }
    finally { if (own === generation) { clearTimeout(timer); $('fetch').disabled = false; render(); } }
  };
  $('start').onclick = async () => {
    if (!blob || task) return;
    const own = generation, started = performance.now();
    $('start').disabled = true; $('fetch').disabled = true; report.state = 'MEASURING';
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { report.synchronousPlayCalls++; return original.call(this); };
    try {
      task = startPoseDisplay(blob, $('overlay'), {
        onProgress: count => { if (own === generation) { report.processedFrames = count; render(); } },
        onError: () => { if (own === generation) { ready = false; stopClock(); replaceCanvas(); report.state = 'DISPLAY_FAILED'; render(); } },
        onSample: sample => {
          if (own !== generation || !ready || $('video').seeking) return;
          // A stopped/slow Worker must not extend stale skeletons during normal playback.
          if (!$('video').paused && Math.abs($('video').currentTime * 1000 - sample.playbackTimestampMs) >= 100) { $('overlay').hidden = true; return; }
          report.current = sample; report.displayPainted = sample.drawnPointCount > 0;
          $('overlay').hidden = Boolean(document.fullscreenElement || document.pictureInPictureElement || $('video').webkitDisplayingFullscreen);
          const val = n => n === null ? '—' : n.toFixed(2);
          if ($('current')) $('current').textContent = `再生 ${sample.playbackTimestampMs.toFixed(0)}ms / 計測 ${sample.sampleTimestampMs ?? '—'}ms | 膝平均 ${val(sample.values.meanKneeAngleDeg)}° / 腰相対高さ ${val(sample.values.hipRelativeHeightTorsoUnits)}胴長 | ${sample.missingReasons.join(', ') || '検出'}`;
          render();
        },
      });
    } finally { HTMLMediaElement.prototype.play = original; }
    report.peakVideoElements = document.querySelectorAll('video').length;
    $('video').play().then(() => { if (own === generation) { report.visiblePlay = true; render(); } }, () => { if (own === generation) { report.visiblePlay = false; render(); } });
    render(); const result = await task.result; if (own !== generation) return;
    report.analysisMs = Math.round(performance.now() - started); report.analysisStatus = result.status;
    report.frameCount = result.status === 'READY' ? result.quality.frameCount : null;
    report.quality = result.status === 'READY' ? result.quality : null;
    ready = result.status === 'READY'; report.displayTransferred = ready;
    try {
      const c = document.createElement('canvas'); c.width = 32; c.height = 32; const ctx = c.getContext('2d');
      ctx.drawImage($('video'), 0, 0, 32, 32); const bytes = ctx.getImageData(0, 0, 32, 32).data;
      report.pixelReadable = true; report.pixelNonUniform = bytes.some((v, i) => i % 4 !== 3 && v !== bytes[i % 4]);
    } catch { report.pixelReadable = false; }
    report.state = ready ? 'FINISHED' : 'DISPLAY_FAILED'; blob = null; $('fetch').disabled = false;
    if (!ready) { task?.dispose(); task = null; replaceCanvas(); }
    draw(); clock(); render();
  };
  $('stop').onclick = () => { cleanup(); report = { ...report, state: 'DISPOSED', current: null, cleanup: true, remainingVideoElements: document.querySelectorAll('video').length }; render(); };
  const events = {
    loadeddata: () => draw(), seeked: () => { draw(); clock(); }, seeking: invalidate,
    ended: () => { stopClock(); draw(); },
    play: () => { draw(); clock(); }, pause: () => { stopClock(); draw(); },
    webkitbeginfullscreen: invalidate, enterpictureinpicture: invalidate,
    webkitendfullscreen: () => draw(), leavepictureinpicture: () => draw(),
  };
  for (const [name, fn] of Object.entries(events)) $('video').addEventListener(name, fn);
  const observer = new ResizeObserver(() => { if (ready) { invalidate(); draw(); } }); observer.observe($('video'));
  function background() { cleanup(); report = { ...report, state: 'BACKGROUND_DISPOSED', current: null, cleanup: true }; render(); }
  const visibility = () => { if (document.hidden) background(); };
  addEventListener('pagehide', background); document.addEventListener('visibilitychange', visibility);
  $('copy').onclick = async () => { try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); } catch { $('status').textContent = 'コピーできません。診断JSON部分だけ選択してください。'; } };
  render();
  return () => { cleanup(); observer.disconnect(); for (const [name, fn] of Object.entries(events)) $('video').removeEventListener(name, fn); removeEventListener('pagehide', background); document.removeEventListener('visibilitychange', visibility); for (const id of ['fetch', 'start', 'stop', 'copy']) $(id).onclick = null; };
}
