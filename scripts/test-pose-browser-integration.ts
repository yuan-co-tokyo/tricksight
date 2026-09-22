import { chromium, webkit, type BrowserType } from "@playwright/test";
import { createReadStream } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { basename, resolve } from "node:path";
import ts from "typescript";

import { POSE_LANDMARKER_CONFIG } from "../lib/pose/config";

const VIDEO_PATH = resolve("eval/input/kickflip_10.mp4");
const MODEL_PATH = resolve(
  `eval/mediapipe-cache/${POSE_LANDMARKER_CONFIG.model.name}.task`,
);
const POSE_MODULE_DIRECTORY = resolve("lib/pose");
const POSE_MODULES = new Set([
  "browser-analysis",
  "config",
  "measurement",
  "metrics",
  "pose-landmarker.worker.ts",
]);
const ALLOWED_WASM_FILES = new Set([
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_module_internal.js",
  "vision_wasm_module_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
]);
const TASKS_VISION_ASSET_ROOT =
  `/pose-assets/tasks-vision-${POSE_LANDMARKER_CONFIG.tasksVisionVersion}`;

const pageModule = `
import { startPoseVideoAnalysis } from "/pose/browser-analysis";

const originalPlay = HTMLMediaElement.prototype.play;
let playCallCount = 0;
HTMLMediaElement.prototype.play = function () {
  playCallCount += 1;
  return originalPlay.call(this);
};

window.runProductPoseIntegration = async ({ videoUrl }) => {
  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error(\`Video fetch failed: \${response.status}\`);
  const progress = [];
  const playCallsBeforeStart = playCallCount;
  const task = startPoseVideoAnalysis(await response.blob(), {
    timeoutMs: 60_000,
    assetUrls: {
      modelUrl: "/mediapipe/model",
      wasmLoaderMode: "MODULE",
    },
    onProgress: (event) => progress.push(event),
  });
  const synchronousPlayCalls = playCallCount - playCallsBeforeStart;
  return { result: await task.result, progress, synchronousPlayCalls };
};
`;

function transpile(source: string, fileName: string) {
  const output = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
    },
  });
  return output.outputText;
}

async function sendFile(
  response: ServerResponse,
  path: string,
  contentType: string,
  rangeHeader?: string,
) {
  const file = await stat(path);
  const headers = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  };
  if (rangeHeader) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    if (!match) {
      response.writeHead(416, { "Content-Range": `bytes */${file.size}` });
      response.end();
      return;
    }
    const start = Number(match[1]);
    const end = Math.min(
      match[2] ? Number(match[2]) : file.size - 1,
      file.size - 1,
    );
    if (start >= file.size || end < start) {
      response.writeHead(416, { "Content-Range": `bytes */${file.size}` });
      response.end();
      return;
    }
    response.writeHead(206, {
      ...headers,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${file.size}`,
    });
    createReadStream(path, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { ...headers, "Content-Length": file.size });
  createReadStream(path).pipe(response);
}

async function startIntegrationServer() {
  await Promise.all([access(VIDEO_PATH), access(MODEL_PATH)]);
  const transpiledModules = new Map<string, string>();
  for (const moduleName of POSE_MODULES) {
    const sourceName = moduleName.endsWith(".ts")
      ? moduleName
      : `${moduleName}.ts`;
    const source = await readFile(
      resolve(POSE_MODULE_DIRECTORY, sourceName),
      "utf8",
    );
    transpiledModules.set(moduleName, transpile(source, sourceName));
  }

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/") {
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": "text/html; charset=utf-8",
        });
        response.end(
          '<!doctype html><html><body><script type="module" src="/integration-page.mjs"></script></body></html>',
        );
        return;
      }
      if (url.pathname === "/integration-page.mjs") {
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": "text/javascript; charset=utf-8",
        });
        response.end(pageModule);
        return;
      }
      if (url.pathname.startsWith("/pose/")) {
        const moduleName = url.pathname.slice("/pose/".length);
        const source = transpiledModules.get(moduleName);
        if (!source) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": "text/javascript; charset=utf-8",
        });
        response.end(source);
        return;
      }
      if (url.pathname === `${TASKS_VISION_ASSET_ROOT}/vision_bundle.mjs`) {
        await sendFile(
          response,
          resolve("node_modules/@mediapipe/tasks-vision/vision_bundle.mjs"),
          "text/javascript; charset=utf-8",
        );
        return;
      }
      if (url.pathname.startsWith(`${TASKS_VISION_ASSET_ROOT}/wasm/`)) {
        const fileName = basename(url.pathname);
        if (!ALLOWED_WASM_FILES.has(fileName)) {
          response.writeHead(404).end();
          return;
        }
        const contentType = fileName.endsWith(".wasm")
          ? "application/wasm"
          : "text/javascript; charset=utf-8";
        await sendFile(
          response,
          resolve("node_modules/@mediapipe/tasks-vision/wasm", fileName),
          contentType,
        );
        return;
      }
      if (url.pathname === "/mediapipe/model") {
        await sendFile(response, MODEL_PATH, "application/octet-stream");
        return;
      }
      if (url.pathname === "/video/sample.mp4") {
        await sendFile(
          response,
          VIDEO_PATH,
          "video/mp4",
          typeof request.headers.range === "string"
            ? request.headers.range
            : undefined,
        );
        return;
      }
      if (url.pathname === "/video/sample.mov") {
        await sendFile(
          response,
          VIDEO_PATH,
          "video/quicktime",
          typeof request.headers.range === "string"
            ? request.headers.range
            : undefined,
        );
        return;
      }
      response.writeHead(404).end();
    })().catch((error) => {
      console.error(error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine integration server port.");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()));
      }),
  };
}

type IntegrationOutput = {
  result: {
    status: string;
    metrics: Record<string, number | null> | null;
    quality: { frameCount: number } | null;
  };
  progress: Array<{ phase: string; processedFrames: number; totalFrames: number }>;
  synchronousPlayCalls: number;
};

async function verifyBrowser(
  name: "chromium" | "webkit" | "crios-simulated",
  browserType: BrowserType,
  origin: string,
  userAgent?: string,
) {
  const browser = await browserType.launch({ headless: true });
  const page = await browser.newPage({ userAgent });
  page.setDefaultTimeout(0);
  page.on("console", (message) =>
    console.log(`[${name}:${message.type()}] ${message.text()}`),
  );
  page.on("pageerror", (error) =>
    console.error(`[${name}:error] ${error.message}`),
  );
  try {
    await page.goto(origin, { waitUntil: "networkidle" });
    for (const extension of ["mp4", "mov"] as const) {
      const output = await page.evaluate(async (input) => {
        const integrationWindow = window as typeof window & {
          runProductPoseIntegration(input: {
            videoUrl: string;
          }): Promise<IntegrationOutput>;
        };
        return integrationWindow.runProductPoseIntegration(input);
      }, { videoUrl: `${origin}/video/sample.${extension}` });

      if (output.result.status !== "COMPLETED") {
        throw new Error(
          `${name}/${extension}: expected COMPLETED, received ${JSON.stringify(output.result)}`,
        );
      }
      if (output.synchronousPlayCalls !== 1) {
        throw new Error(
          `${name}/${extension}: expected one synchronous play(), received ${output.synchronousPlayCalls}`,
        );
      }
      const metrics = output.result.metrics;
      if (
        !metrics ||
        !Number.isFinite(metrics.minimumMeanKneeAngleDeg) ||
        !Number.isFinite(metrics.kneeExtensionRangeDeg) ||
        !Number.isFinite(metrics.hipVerticalRangeTorsoUnits) ||
        !Number.isFinite(metrics.landingTrunkTiltDeg)
      ) {
        throw new Error(`${name}/${extension}: four aggregate metrics are required.`);
      }
      if (JSON.stringify(output.result).includes("landmarks")) {
        throw new Error(`${name}/${extension}: raw landmarks escaped the Worker.`);
      }
      if (
        output.progress.at(0)?.phase !== "INITIALIZING" ||
        output.progress.at(-1)?.phase !== "FINALIZING"
      ) {
        throw new Error(`${name}/${extension}: progress phases are incomplete.`);
      }
      console.log(
        JSON.stringify({
          browser: name,
          browserVersion: browser.version(),
          format: extension.toUpperCase(),
          frameCount: output.result.quality?.frameCount,
          metrics,
          progressEvents: output.progress.length,
          synchronousPlayCalls: output.synchronousPlayCalls,
        }),
      );
    }
  } finally {
    await page.close();
    await browser.close();
  }
}

async function main() {
  const server = await startIntegrationServer();
  try {
    await verifyBrowser("chromium", chromium, server.origin);
    await verifyBrowser("webkit", webkit, server.origin);
    await verifyBrowser(
      "crios-simulated",
      chromium,
      server.origin,
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/153.0.8010.12 Mobile/15E148 Safari/604.1",
    );
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
