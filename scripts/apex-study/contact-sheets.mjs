// Offline visual annotation aid. No pose outputs or candidate algorithms used.
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const samples = JSON.parse(await readFile('eval/manifest.json', 'utf8')).samples;
const ranges = process.argv[2] ? JSON.parse(await readFile(process.argv[2], 'utf8')) : null;
const output = 'eval/output/apex-study';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const sample of samples) {
    if (ranges && !ranges[sample.id]) continue;
    await page.setContent('<input type="file"><video muted></video><canvas></canvas>');
    await page.locator('input').setInputFiles(sample.file);
    const data = await page.evaluate(async ({ id, range }) => {
      const video = document.querySelector('video');
      video.src = URL.createObjectURL(document.querySelector('input').files[0]);
      await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
      const times = range ? Array.from({ length: 20 }, (_, i) => range[0] + i * range[1])
        : Array.from({ length: 30 }, (_, i) => (i + 1) * video.duration / 32);
      const canvas = document.querySelector('canvas');
      canvas.width = 1500; canvas.height = Math.ceil(times.length / 5) * 320;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const [i, time] of times.entries()) {
        video.currentTime = Math.min(video.duration - .01, time);
        await new Promise(resolve => { video.onseeked = resolve; });
        const x = (i % 5) * 300, y = Math.floor(i / 5) * 320;
        const crop = range && !["kickflip-004", "kickflip-005", "ollie-007", "ollie-008", "ollie-009"].includes(id);
        const sw = crop ? video.videoWidth / 3 : video.videoWidth;
        const sx = crop ? video.videoWidth / 3 : 0;
        const scale = Math.min(300 / sw, 290 / video.videoHeight);
        const w = sw * scale, h = video.videoHeight * scale;
        ctx.drawImage(video, sx, 0, sw, video.videoHeight, x + (300 - w) / 2, y, w, h);
        ctx.fillStyle = 'black'; ctx.font = '16px sans-serif'; ctx.fillText(`${id} ${time.toFixed(2)}s`, x + 4, y + 312);
      }
      URL.revokeObjectURL(video.src);
      return { base64: canvas.toDataURL().split(',')[1], times, duration: video.duration };
    }, { id: sample.id, range: ranges?.[sample.id] });
    const stem = `${output}/${sample.id}-${ranges ? 'detail' : 'overview'}`;
    await writeFile(`${stem}.png`, Buffer.from(data.base64, 'base64'));
    await writeFile(`${stem}.json`, JSON.stringify({ file: sample.file, times: data.times, duration: data.duration }, null, 2));
    console.log(sample.id);
  }
} finally { await browser.close(); }
