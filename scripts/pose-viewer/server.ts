import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { basename, extname, resolve } from "node:path";

import ts from "typescript";

import { POSE_LANDMARKER_CONFIG } from "../../lib/pose/config";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? "4174");
const DIAGNOSTIC_ROOT = resolve("scripts/pose-viewer");
const MODEL_DIRECTORY = resolve("eval/mediapipe-cache");
const MODEL_PATH = resolve(
  MODEL_DIRECTORY,
  `${POSE_LANDMARKER_CONFIG.model.name}.task`,
);
const TASKS_VISION_ROOT = resolve("node_modules/@mediapipe/tasks-vision");

const ALLOWED_WASM_FILES = new Set([
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_module_internal.js",
  "vision_wasm_module_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
]);

function contentType(filePath: string) {
  switch (extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".mjs":
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    case ".task":
      return "application/octet-stream";
    default:
      return "application/octet-stream";
  }
}

async function serveFile(response: ServerResponse, filePath: string) {
  const file = await stat(filePath);
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": file.size,
    "Content-Type": contentType(filePath),
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(filePath).pipe(response);
}

async function ensurePinnedModel() {
  let bytes: Buffer;
  try {
    bytes = await readFile(MODEL_PATH);
  } catch {
    await mkdir(MODEL_DIRECTORY, { recursive: true });
    console.log("Pinned full model is not cached; downloading it now...");
    const response = await fetch(POSE_LANDMARKER_CONFIG.model.url);
    if (!response.ok) {
      throw new Error(
        `Model download failed: ${response.status} ${response.statusText}`,
      );
    }
    bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(MODEL_PATH, bytes);
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== POSE_LANDMARKER_CONFIG.model.sha256) {
    throw new Error(
      `Model hash mismatch: expected ${POSE_LANDMARKER_CONFIG.model.sha256}, received ${sha256}. Delete ${MODEL_PATH} and retry.`,
    );
  }
}

async function main() {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  await Promise.all([
    ensurePinnedModel(),
    access(resolve(DIAGNOSTIC_ROOT, "index.html")),
    access(resolve(TASKS_VISION_ROOT, "vision_bundle.mjs")),
  ]);
  const modules = new Map<string, string>();
  for (const name of ["frame-metrics", "config", "metrics", "measurement", "browser-analysis"]) {
    let source = await readFile(resolve("lib/pose", `${name}.ts`), "utf8");
    // Expose existing pure helpers ONLY in this diagnostic server's in-memory
    // module. Shared frame helpers are public; the Worker boundary stays unchanged.
    if (name === "metrics") source += "\nexport { deriveFrame, hasVisibleIndices, LOWER_BODY_INDICES, quantile };";
    modules.set(`/pose/${name}`, ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    }).outputText);
  }

  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; media-src blob:; img-src 'self' blob: data:; style-src 'self'");
      const url = new URL(request.url ?? "/", `http://${HOST}`);
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET" }).end();
        return;
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        await serveFile(response, resolve(DIAGNOSTIC_ROOT, "index.html"));
        return;
      }
      const moduleSource = modules.get(url.pathname);
      if (moduleSource) {
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
        response.end(moduleSource);
        return;
      }
      if (["/page.mjs", "/worker.mjs", "/series.mjs", "/style.css"].includes(url.pathname)) {
        await serveFile(response, resolve(DIAGNOSTIC_ROOT, url.pathname.slice(1)));
        return;
      }
      if (url.pathname === "/mediapipe/vision_bundle.mjs") {
        await serveFile(
          response,
          resolve(TASKS_VISION_ROOT, "vision_bundle.mjs"),
        );
        return;
      }
      if (url.pathname.startsWith("/mediapipe/wasm/")) {
        const fileName = basename(url.pathname);
        if (!ALLOWED_WASM_FILES.has(fileName)) {
          response.writeHead(404).end();
          return;
        }
        await serveFile(
          response,
          resolve(TASKS_VISION_ROOT, "wasm", fileName),
        );
        return;
      }
      if (url.pathname === "/mediapipe/model") {
        await serveFile(response, MODEL_PATH);
        return;
      }
      if (url.pathname === "/health") {
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ ok: true }));
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
    server.listen(PORT, HOST, resolvePromise);
  });
  console.log(`Pose inspection viewer: http://${HOST}:${PORT}`);

  const stop = () => {
    server.close((error) => {
      if (error) {
        console.error(error);
        process.exitCode = 1;
      }
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
