import { chromium, webkit } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

async function main() {
if (process.argv.includes("--exports-only")) { await verifyRecordedExports(); return; }
if (process.argv.includes("--controls-only")) { await verifyControls(); return; }
const origin = process.env.POSE_VIEWER_ORIGIN ?? "http://127.0.0.1:4174";
const outputDir = resolve("eval/output/pose-viewer");
const chosen = ["kickflip-010", "kickflip-004", "kickflip-005", "kickflip-008", "ollie-001", "ollie-004"];
const manifest = JSON.parse(await readFile("eval/manifest.json", "utf8")) as {
  samples: Array<{ id: string; file: string; trick: string; expectedOutcome: string; cameraAngle: string }>;
};
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1240 }, acceptDownloads: true });
page.setDefaultTimeout(180_000);
const errors: string[] = [];
const requests: Array<{ method: string; url: string }> = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("request", request => requests.push({ method: request.method(), url: request.url() }));
const reports: unknown[] = [];
try {
  await page.goto(origin);
  assert.equal((await page.request.post(`${origin}/upload`, { data: "forbidden" })).status(), 405);
  for (const id of chosen) {
    const sample = manifest.samples.find(s => s.id === id);
    assert(sample);
    await page.locator("#note").fill(`${sample.trick} / 自己申告: ${sample.expectedOutcome === "LANDED" ? "成功" : "失敗"} / ${sample.cameraAngle}`);
    await page.locator("#video-file").setInputFiles(resolve(sample.file));
    await page.locator('#status[data-state="done"], #status[data-state="error"]').waitFor();
    assert.equal(await page.locator("#status").getAttribute("data-state"), "done", await page.locator("#status").innerText());
    const result = await page.evaluate(() => (window as unknown as { poseViewer: { result: { frames: Array<{ timestampMs: number; missing: number[]; landmarks: unknown[] | null }>; durationMs: number; measurement: { status: string; metrics: unknown }; missingIntervals: unknown[] } } }).poseViewer.result);
    assert.equal(result.frames.length, Math.floor(result.durationMs / 100));
    assert(result.frames.every((f, i) => Math.abs(f.timestampMs - i * 100) < 1e-6));
    assert.equal(result.measurement.status, ["kickflip-005", "kickflip-008", "ollie-004"].includes(id) ? "UNASSESSABLE" : "COMPLETED");
    if (result.measurement.status === "UNASSESSABLE") assert.equal(result.measurement.metrics, null);
    await page.locator("#next").click();
    await page.waitForFunction(() => Math.abs((document.getElementById("source") as HTMLVideoElement).currentTime - 0.1) < 0.001);
    await page.locator("#prev").click();
    await page.waitForFunction(() => (document.getElementById("source") as HTMLVideoElement).currentTime < 0.001);
    await page.locator("#speed").selectOption("0.25");
    await page.locator("#play").click();
    await page.waitForFunction(() => (document.getElementById("source") as HTMLVideoElement).currentTime > 0.15);
    await page.locator("#play").click();
    assert(await page.locator("#source").evaluate((v: HTMLVideoElement) => v.paused && v.playbackRate === 0.25));
    await page.locator("#speed").selectOption("1");
    if (id === "kickflip-008") {
      const firstMissing = result.frames.find(f => f.missing.length && f.landmarks);
      assert(firstMissing);
      await page.evaluate(t => (window as unknown as { poseViewer: { seek(t: number): Promise<void> } }).poseViewer.seek(t), firstMissing.timestampMs / 1000);
      await page.screenshot({ path: resolve(outputDir, "viewer-screenshot.png"), fullPage: true });
    }
    await page.locator("#export").click();
    await page.locator('#status[data-state="exported"], #status[data-state="error"]').waitFor();
    assert.equal(await page.locator("#status").getAttribute("data-state"), "exported", await page.locator("#status").innerText());
    const downloadPromise = page.waitForEvent("download"); await page.locator("#download").click();
    const download = await downloadPromise;
    const output = resolve(outputDir, download.suggestedFilename()); await download.saveAs(output);
    await writeFile(resolve(outputDir, `${id}.json`), JSON.stringify({ sample, result }, null, 2));
    reports.push({ sample, output, ...result, frames: undefined });
    console.log(JSON.stringify({ id, output, frames: result.frames.length, measurement: result.measurement }));
  }
  // Cancel an in-progress task, then ensure no stale completion revives controls.
  await page.locator("#video-file").setInputFiles(resolve("eval/input/kickflip_10.mp4"));
  await page.locator("#cancel").click();
  await page.locator('#status[data-state="canceled"]').waitFor();
  assert(await page.locator("#export").isDisabled());
  assert.deepEqual(errors, []);
  assert(requests.every(r => r.method === "GET" && (r.url.startsWith(origin) || r.url.startsWith("blob:"))));
  await writeFile(resolve(outputDir, "report.json"), JSON.stringify({ browser: browser.version(), reports, requests }, null, 2));
} finally { await browser.close(); }

// WebKit smoke: actual decoding, sample stepping and quality; not iPhone proof.
const safari = await webkit.launch({ headless: true });
try {
  const page = await safari.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(180_000);
  await page.goto(origin);
  await page.locator("#video-file").setInputFiles(resolve("eval/input/kickflip_10.mp4"));
  await page.locator('#status[data-state="done"], #status[data-state="error"]').waitFor();
  assert.equal(await page.locator("#status").getAttribute("data-state"), "done", await page.locator("#status").innerText());
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator("#next").click();
  await page.waitForFunction(() => Math.abs((document.getElementById("source") as HTMLVideoElement).currentTime - 0.1) < 0.001);
  console.log(`WebKit ${safari.version()}: decode/analysis/step/mobile width passed`);
} finally { await safari.close(); }
await verifyRecordedExports();
await verifyControls();

}
async function verifyControls() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(180_000);
    await page.goto(process.env.POSE_VIEWER_ORIGIN ?? "http://127.0.0.1:4174");
    await page.locator("#video-file").setInputFiles(resolve("eval/input/kickflip_10.mp4"));
    await page.locator('#status[data-state="done"]').waitFor();
    await page.locator("#export").click();
    await page.locator('#status[data-state="exporting"]').waitFor();
    await page.locator("#stop-export").click();
    await page.locator('#status[data-state="done"]').waitFor();
    assert(await page.locator("#download").isHidden());
    assert(await page.locator("#export").isEnabled());
    await page.locator("#video-file").setInputFiles(resolve("eval/input/kickflip_8.mp4"));
    assert.equal(await page.locator("#summary").innerText(), "新しい動画の解析結果を待っています。");
    assert(await page.locator("#minimum").isDisabled());
    await page.locator("#cancel").click();
    await page.locator('#status[data-state="canceled"]').waitFor();
    assert(await page.locator("#play").isDisabled());
    console.log("Controls: export cancel / stale summary reset / analysis cancel passed");
  } finally { await browser.close(); }
}

async function verifyRecordedExports() {
  const directory = resolve("eval/output/pose-viewer");
  const browser = await chromium.launch({ headless: true });
  const report = JSON.parse(await readFile(resolve(directory, "report.json"), "utf8")) as {
    reports: Array<{ output: string; sample: { id: string }; durationMs: number }>
  };
  const outputChecks = [];
  try {
    const page = await browser.newPage();
    for (const entry of report.reports) {
      await page.setContent('<input id="file" type="file"><video id="v" muted playsinline></video>');
      await page.locator("#file").setInputFiles(entry.output);
      // tsx preserves nested function names via __name; supply its identity helper in the test document.
      await page.evaluate("globalThis.__name = (fn) => fn");
      const result = await page.evaluate(async (captureTime) => {
        const input = document.getElementById("file") as HTMLInputElement;
        const video = document.getElementById("v") as HTMLVideoElement;
        const url = URL.createObjectURL(input.files![0]!);
        video.src = url;
        const canvas = document.createElement("canvas");
        let decodedFrames = 0, lastTimestamp = 0, capture = "";
        let firstCapture = "";
        const ended = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Recorded video playback timeout")), 40_000);
          video.onended = () => { clearTimeout(timeout); resolve(); };
          video.onerror = () => { clearTimeout(timeout); reject(new Error("Recorded video decode error")); };
        });
        const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
          decodedFrames++;
          lastTimestamp = metadata.mediaTime;
          if (!firstCapture || (!capture && metadata.mediaTime >= captureTime)) {
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            canvas.getContext("2d")!.drawImage(video, 0, 0);
            const image = canvas.toDataURL("image/png");
            if (!firstCapture) firstCapture = image;
            if (metadata.mediaTime >= captureTime) capture = image;
          }
          video.requestVideoFrameCallback(onFrame);
        };
        video.requestVideoFrameCallback(onFrame);
        await video.play(); await ended;
        URL.revokeObjectURL(url);
        return { decodedFrames, lastTimestamp, width: video.videoWidth, height: video.videoHeight, capture, changed: capture !== firstCapture };
      }, entry.sample.id === "kickflip-005" ? 6 : 1);
      assert(result.decodedFrames > 20);
      assert(Math.abs(result.lastTimestamp - entry.durationMs / 1000) < 1.0);
      assert.equal(result.width, 1280); assert.equal(result.height, 1050);
      assert(result.capture && result.changed);
      await writeFile(resolve(directory, `${entry.sample.id}-export-frame.png`), Buffer.from(result.capture.split(",")[1]!, "base64"));
      outputChecks.push({ id: entry.sample.id, ...result, capture: undefined });
    }
    await writeFile(resolve(directory, "export-validation.json"), JSON.stringify(outputChecks, null, 2));
    console.log(JSON.stringify({ exportedPlayback: outputChecks }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
