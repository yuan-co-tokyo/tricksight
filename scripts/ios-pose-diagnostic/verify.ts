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
  for (const {
    name,
    browserType,
    userAgent,
    defaultWorkerSucceeds,
  } of [
    {
      name: "chromium",
      browserType: chromium,
      userAgent: undefined,
      defaultWorkerSucceeds: true,
    },
    {
      name: "webkit",
      browserType: webkit,
      userAgent: undefined,
      defaultWorkerSucceeds: true,
    },
    {
      name: "crios-simulated",
      browserType: chromium,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/153.0.8010.12 Mobile/15E148 Safari/604.1",
      defaultWorkerSucceeds: false,
    },
  ] as const) {
    const browser = await browserType.launch({ headless: true });
    const page = await browser.newPage({
      hasTouch: true,
      isMobile: true,
      userAgent,
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
        schemaVersion: number;
        status: string;
        frameSourceDecision: string;
        poseInputFrameSourceMethod: string;
        poseImplementationCandidate: string;
        methods: {
          a1HiddenPlay: { status: string };
          a2RenderedPlay: { status: string };
          webCodecs: {
            status: string;
            expectedSamples: number;
            decodedFrames: number;
          };
        };
        poseMethods: {
          c0DefaultWorker: {
            status: string;
            error?: string;
            environment: {
              documentAvailable: boolean;
              offscreenCanvasAvailable: boolean;
              offscreenCanvasWebgl2: boolean;
              mediaPipeSupportsOffscreenCanvas: boolean;
            };
          };
          c1ExplicitOffscreenWorker: {
            status: string;
            executionThread: string;
            canvasMode: string;
            frameSourceMethod: string;
            requestedFrames: number;
            processedFrames: number;
            timing: {
              seek: { count: number };
              inference: { count: number };
            };
          };
          c2MainThreadCanvas: {
            status: string;
            executionThread: string;
            canvasMode: string;
            frameSourceMethod: string;
            requestedFrames: number;
            processedFrames: number;
            maxMainThreadBlockMs: number;
            timing: {
              seek: { count: number };
              inference: { count: number };
            };
          };
        };
      };
      const { c0DefaultWorker: c0, c1ExplicitOffscreenWorker: c1, c2MainThreadCanvas: c2 } =
        result.poseMethods;
      if (
        result.schemaVersion !== 3 ||
        result.status !== "COMPLETED" ||
        result.frameSourceDecision !== "PENDING" ||
        result.poseInputFrameSourceMethod !== "A1_HIDDEN_PLAY" ||
        result.poseImplementationCandidate !==
          "C1_EXPLICIT_OFFSCREEN_WORKER" ||
        result.methods.a1HiddenPlay.status !== "SUCCEEDED" ||
        result.methods.a2RenderedPlay.status !== "SUCCEEDED" ||
        result.methods.webCodecs.status !== "SUCCEEDED" ||
        result.methods.webCodecs.decodedFrames !==
          result.methods.webCodecs.expectedSamples ||
        c0.status !== (defaultWorkerSucceeds ? "SUCCEEDED" : "FAILED") ||
        (!defaultWorkerSucceeds && !c0.error?.includes("document")) ||
        c0.environment.documentAvailable ||
        !c0.environment.offscreenCanvasAvailable ||
        !c0.environment.offscreenCanvasWebgl2 ||
        c0.environment.mediaPipeSupportsOffscreenCanvas !==
          defaultWorkerSucceeds ||
        c1.status !== "SUCCEEDED" ||
        c1.executionThread !== "WORKER" ||
        c1.canvasMode !== "EXPLICIT_OFFSCREEN" ||
        c1.frameSourceMethod !== result.poseInputFrameSourceMethod ||
        c1.processedFrames !== c1.requestedFrames ||
        c1.timing.seek.count !== c1.requestedFrames ||
        c1.timing.inference.count !== c1.requestedFrames ||
        c2.status !== "SUCCEEDED" ||
        c2.executionThread !== "MAIN" ||
        c2.canvasMode !== "EXPLICIT_HTML_CANVAS" ||
        c2.frameSourceMethod !== result.poseInputFrameSourceMethod ||
        c2.processedFrames !== c2.requestedFrames ||
        c2.timing.seek.count !== c2.requestedFrames ||
        c2.timing.inference.count !== c2.requestedFrames ||
        !(c2.maxMainThreadBlockMs > 0)
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
          poseImplementationCandidate: result.poseImplementationCandidate,
          poseInputFrameSourceMethod: result.poseInputFrameSourceMethod,
          methods: Object.fromEntries(
            Object.entries(result.methods).map(([method, value]) => [
              method,
              value.status,
            ]),
          ),
          c0Environment: c0.environment,
          c1: {
            status: c1.status,
            frames: c1.processedFrames,
            timing: c1.timing,
          },
          c2: {
            status: c2.status,
            frames: c2.processedFrames,
            maxMainThreadBlockMs: c2.maxMainThreadBlockMs,
            timing: c2.timing,
          },
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
