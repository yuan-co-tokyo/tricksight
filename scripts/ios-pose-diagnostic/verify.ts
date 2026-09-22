import { chromium, webkit } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const origin = process.env.DIAGNOSTIC_ORIGIN ?? "http://127.0.0.1:4173";
const videoPath = resolve(
  process.env.DIAGNOSTIC_VIDEO ?? "eval/input/kickflip_10.mp4",
);

async function main() {
  const screenshotDirectory = resolve("eval/output/ios-pose-diagnostic");
  await mkdir(screenshotDirectory, { recursive: true });
  for (const [name, browserType] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ] as const) {
    const browser = await browserType.launch({ headless: true });
    const page = await browser.newPage({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    });
    page.setDefaultTimeout(300_000);
    page.on("pageerror", (error) => console.error(`[${name}] ${error.message}`));
    try {
      await page.goto(origin, { waitUntil: "networkidle" });
      await page.locator("#video-file").setInputFiles(videoPath);
      await page.locator('#status[data-state="done"]').waitFor();
      const result = JSON.parse(
        await page.locator("#result-json").innerText(),
      ) as {
        status: string;
        adoptionCandidate: string;
        methods: {
          a1HiddenPlay: { status: string };
          a2RenderedPlay: { status: string };
          webCodecs: {
            status: string;
            expectedSamples: number;
            decodedFrames: number;
          };
        };
        poseMeasurement: {
          status: string;
          requestedFrames: number;
          processedFrames: number;
          timing: {
            seek: { count: number };
            inference: { count: number };
          };
        };
      };
      const pose = result.poseMeasurement;
      if (
        result.status !== "COMPLETED" ||
        result.methods.a1HiddenPlay.status !== "SUCCEEDED" ||
        result.methods.a2RenderedPlay.status !== "SUCCEEDED" ||
        result.methods.webCodecs.status !== "SUCCEEDED" ||
        result.methods.webCodecs.decodedFrames !==
          result.methods.webCodecs.expectedSamples ||
        pose.status !== "SUCCEEDED" ||
        pose.processedFrames !== pose.requestedFrames ||
        pose.timing.seek.count !== pose.requestedFrames ||
        pose.timing.inference.count !== pose.requestedFrames
      ) {
        throw new Error(
          `${name}: invalid diagnostic result ${JSON.stringify(result)}`,
        );
      }
      await page.screenshot({
        fullPage: true,
        path: resolve(screenshotDirectory, `${name}.png`),
      });
      console.log(
        JSON.stringify({
          browser: name,
          adoptionCandidate: result.adoptionCandidate,
          methods: result.methods,
          frames: pose.processedFrames,
          timing: pose.timing,
        }),
      );
    } finally {
      await page.close();
      await browser.close();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
