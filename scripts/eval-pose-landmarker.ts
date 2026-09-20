import { chromium, webkit, type Page } from "@playwright/test";
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
import { z } from "zod";

import { POSE_LANDMARKER_CONFIG } from "../lib/pose/config";
import {
  assessPoseQuality,
  calculatePoseMetrics,
  compareMetricGroups,
  comparePoseRuns,
  poseMetricDefinitions,
  poseQualityPolicy,
  type PoseMetrics,
  type PoseQualityAssessment,
  type PoseRun,
} from "./pose-landmarker-metrics";

const MODEL_CACHE_PATH = resolve(
  `eval/mediapipe-cache/${POSE_LANDMARKER_CONFIG.model.name}.task`,
);
const OUTPUT_DIRECTORY = resolve("eval/output");
const browserNameSchema = z.enum(["chromium", "webkit"]);
const PILOT_SAMPLE_IDS = [
  "ollie-001",
  "ollie-003",
  "kickflip-004",
  "ollie-005",
  "kickflip-008",
  "kickflip-009",
] as const;

const sampleSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  file: z.string().min(1),
  trick: z.enum(["OLLIE", "POP_SHOVE_IT", "KICKFLIP"]),
  stance: z.enum(["REGULAR", "GOOFY"]),
  cameraAngle: z.enum(["SIDE", "FRONT", "REAR", "DIAGONAL"]),
  expectedOutcome: z.enum(["LANDED", "BAILED"]),
  notes: z.string().optional(),
});
const manifestSchema = z.object({ samples: z.array(sampleSchema).min(1) });
type Sample = z.infer<typeof sampleSchema>;

type BrowserRunInput = {
  videoUrl: string;
  mode: "fixed" | "all-frames";
  fixedFps: number;
  landmarkerConfig: {
    delegate: "CPU";
    numPoses: number;
    detectionConfidence: number;
    presenceConfidence: number;
    trackingConfidence: number;
  };
};

type Arguments = {
  manifestPath: string;
  selection: "pilot" | "all" | "sample";
  sampleId?: string;
  browserName: z.infer<typeof browserNameSchema>;
  fixedFps: number;
  includeAllFrames: boolean;
};

type EvaluatedSample = {
  sample: Sample;
  qualityAssessment: PoseQualityAssessment;
  runs: {
    fixedFirst: PoseRun;
    fixedSecond: PoseRun;
    allFrames: PoseRun | null;
  };
  metrics: {
    fixedFirst: PoseMetrics;
    fixedSecond: PoseMetrics;
    allFrames: PoseMetrics | null;
  };
  reproducibility: ReturnType<typeof comparePoseRuns> & {
    maximumMetricDelta: number | null;
    maximumPoseMetricDelta: number | null;
  };
};

function argumentValue(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function parseArguments(): Arguments {
  const sampleId = argumentValue("--sample");
  const all = process.argv.includes("--all");
  if (sampleId && all) throw new Error("Use either --sample or --all, not both.");

  const fixedFpsValue = argumentValue("--fixed-fps");
  const fixedFps = fixedFpsValue
    ? z.coerce.number().int().min(1).max(60).parse(fixedFpsValue)
    : POSE_LANDMARKER_CONFIG.sampleRateFps;
  const browserName = browserNameSchema.parse(
    argumentValue("--browser") ?? "chromium",
  );

  return {
    manifestPath: argumentValue("--manifest") ?? "eval/manifest.json",
    selection: sampleId ? "sample" : all ? "all" : "pilot",
    sampleId,
    browserName,
    fixedFps,
    includeAllFrames: !process.argv.includes("--skip-all-frames"),
  };
}

async function loadSamples(arguments_: Arguments) {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(resolve(arguments_.manifestPath), "utf8")),
  );
  let samples: Sample[];

  if (arguments_.selection === "sample") {
    samples = manifest.samples.filter((sample) => sample.id === arguments_.sampleId);
  } else if (arguments_.selection === "all") {
    samples = manifest.samples;
  } else {
    const pilotIds = new Set<string>(PILOT_SAMPLE_IDS);
    samples = manifest.samples.filter((sample) => pilotIds.has(sample.id));
  }

  if (samples.length === 0) {
    throw new Error(`No samples matched selection ${arguments_.selection}.`);
  }
  for (const sample of samples) await access(resolve(sample.file));
  return samples;
}

async function ensureModel() {
  try {
    await access(MODEL_CACHE_PATH);
  } catch {
    await mkdir(resolve("eval/mediapipe-cache"), { recursive: true });
    console.log(
      `Downloading pinned Pose Landmarker model: ${POSE_LANDMARKER_CONFIG.model.url}`,
    );
    const response = await fetch(POSE_LANDMARKER_CONFIG.model.url);
    if (!response.ok) {
      throw new Error(`Model download failed: ${response.status} ${response.statusText}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 1_000_000) {
      throw new Error(`Downloaded model is unexpectedly small: ${bytes.length} bytes.`);
    }
    await writeFile(MODEL_CACHE_PATH, bytes);
  }

  const bytes = await readFile(MODEL_CACHE_PATH);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== POSE_LANDMARKER_CONFIG.model.sha256) {
    throw new Error(
      `Pose Landmarker model hash mismatch: expected ${POSE_LANDMARKER_CONFIG.model.sha256}, received ${sha256}. Remove ${MODEL_CACHE_PATH} and retry.`,
    );
  }
  return {
    path: MODEL_CACHE_PATH,
    bytes: bytes.byteLength,
    sha256,
  };
}

function contentType(filePath: string) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".mjs":
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    default:
      return "application/octet-stream";
  }
}

async function serveFile(
  response: ServerResponse,
  filePath: string,
  rangeHeader?: string,
) {
  const file = await stat(filePath);
  const headers = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Type": contentType(filePath),
  };

  if (rangeHeader) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    if (!match) {
      response.writeHead(416, { "Content-Range": `bytes */${file.size}` });
      response.end();
      return;
    }
    const start = Number(match[1]);
    const requestedEnd = match[2] ? Number(match[2]) : file.size - 1;
    const end = Math.min(requestedEnd, file.size - 1);
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
    createReadStream(filePath, { start, end }).pipe(response);
    return;
  }

  response.writeHead(200, { ...headers, "Content-Length": file.size });
  createReadStream(filePath).pipe(response);
}

async function startServer(samples: Sample[], modelPath: string) {
  const sampleFiles = new Map(
    samples.map((sample) => [sample.id, resolve(sample.file)]),
  );
  const allowedWasmFiles = new Set([
    "vision_wasm_internal.js",
    "vision_wasm_internal.wasm",
    "vision_wasm_module_internal.js",
    "vision_wasm_module_internal.wasm",
    "vision_wasm_nosimd_internal.js",
    "vision_wasm_nosimd_internal.wasm",
  ]);
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="/scripts/pose-landmarker-page.mjs"></script></body></html>`;

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/") {
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": "text/html; charset=utf-8",
        });
        response.end(html);
        return;
      }
      if (url.pathname === "/scripts/pose-landmarker-page.mjs") {
        await serveFile(response, resolve("scripts/pose-landmarker-page.mjs"));
        return;
      }
      if (url.pathname === "/scripts/pose-landmarker-worker.mjs") {
        await serveFile(response, resolve("scripts/pose-landmarker-worker.mjs"));
        return;
      }
      if (url.pathname === "/mediapipe/vision_bundle.mjs") {
        await serveFile(
          response,
          resolve("node_modules/@mediapipe/tasks-vision/vision_bundle.mjs"),
        );
        return;
      }
      if (url.pathname.startsWith("/mediapipe/wasm/")) {
        const fileName = basename(url.pathname);
        if (!allowedWasmFiles.has(fileName)) {
          response.writeHead(404).end();
          return;
        }
        await serveFile(
          response,
          resolve("node_modules/@mediapipe/tasks-vision/wasm", fileName),
        );
        return;
      }
      if (url.pathname === "/mediapipe/model") {
        await serveFile(response, modelPath);
        return;
      }
      if (url.pathname.startsWith("/video/")) {
        const sampleId = decodeURIComponent(url.pathname.slice("/video/".length));
        const filePath = sampleFiles.get(sampleId);
        if (!filePath) {
          response.writeHead(404).end();
          return;
        }
        await serveFile(
          response,
          filePath,
          typeof request.headers.range === "string" ? request.headers.range : undefined,
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
    throw new Error("Could not determine evaluation server port.");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()));
      }),
  };
}

async function runInBrowser(page: Page, input: BrowserRunInput) {
  return page.evaluate(async (browserInput) => {
    const browserWindow = window as typeof window & {
      runPoseLandmarker(input: BrowserRunInput): Promise<PoseRun>;
    };
    return browserWindow.runPoseLandmarker(browserInput);
  }, input);
}

function maximumMetricDelta(deltas: Record<string, number | null>) {
  const values = Object.values(deltas).filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  return values.length === 0 ? null : Math.max(...values);
}

function maximumPoseMetricDelta(deltas: Record<string, number | null>) {
  return maximumMetricDelta(
    Object.fromEntries(
      Object.entries(deltas).filter(
        ([metric]) => metric !== "meanInferenceMs" && metric !== "p95InferenceMs",
      ),
    ),
  );
}

async function main() {
  const arguments_ = parseArguments();
  const samples = await loadSamples(arguments_);
  const model = await ensureModel();
  const mediapipePackage = JSON.parse(
    await readFile(
      resolve("node_modules/@mediapipe/tasks-vision/package.json"),
      "utf8",
    ),
  ) as { version: string };
  const playwrightPackage = JSON.parse(
    await readFile(resolve("node_modules/@playwright/test/package.json"), "utf8"),
  ) as { version: string };
  const server = await startServer(samples, model.path);
  const browserType = arguments_.browserName === "webkit" ? webkit : chromium;
  const browser = await browserType.launch(
    arguments_.browserName === "chromium"
      ? {
          headless: true,
          args: ["--autoplay-policy=no-user-gesture-required"],
        }
      : { headless: true },
  );
  const browserVersion = browser.version();
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  page.on("console", (message) => console.log(`[browser:${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => console.error(`[browser:error] ${error.message}`));

  const evaluatedSamples: EvaluatedSample[] = [];
  const thresholds = POSE_LANDMARKER_CONFIG.confidenceThresholds;
  const landmarkerConfig: BrowserRunInput["landmarkerConfig"] = {
    delegate: POSE_LANDMARKER_CONFIG.delegate,
    numPoses: POSE_LANDMARKER_CONFIG.numPoses,
    detectionConfidence: thresholds.detection,
    presenceConfidence: thresholds.presence,
    trackingConfidence: thresholds.tracking,
  };
  try {
    await page.goto(server.origin, { waitUntil: "networkidle" });
    for (const [index, sample] of samples.entries()) {
      const videoUrl = `${server.origin}/video/${encodeURIComponent(sample.id)}`;
      console.log(
        `[${index + 1}/${samples.length}] ${sample.id} ${sample.expectedOutcome}: fixed ${arguments_.fixedFps}fps run 1`,
      );
      const fixedFirst = await runInBrowser(page, {
        videoUrl,
        mode: "fixed",
        fixedFps: arguments_.fixedFps,
        landmarkerConfig,
      });
      console.log(
        `[${index + 1}/${samples.length}] ${sample.id}: fixed ${arguments_.fixedFps}fps run 2`,
      );
      const fixedSecond = await runInBrowser(page, {
        videoUrl,
        mode: "fixed",
        fixedFps: arguments_.fixedFps,
        landmarkerConfig,
      });
      const allFrames = arguments_.includeAllFrames
        ? await runInBrowser(page, {
            videoUrl,
            mode: "all-frames",
            fixedFps: arguments_.fixedFps,
            landmarkerConfig,
          })
        : null;
      if (arguments_.includeAllFrames) {
        console.log(
          `[${index + 1}/${samples.length}] ${sample.id}: all presented frames complete`,
        );
      }

      const reproducibility = comparePoseRuns(fixedFirst, fixedSecond);
      const fixedMetrics = calculatePoseMetrics(fixedFirst);
      const fixedSecondMetrics = calculatePoseMetrics(fixedSecond);
      const allFrameMetrics = allFrames ? calculatePoseMetrics(allFrames) : null;
      evaluatedSamples.push({
        sample,
        qualityAssessment: assessPoseQuality(fixedMetrics),
        runs: {
          fixedFirst,
          fixedSecond,
          allFrames,
        },
        metrics: {
          fixedFirst: fixedMetrics,
          fixedSecond: fixedSecondMetrics,
          allFrames: allFrameMetrics,
        },
        reproducibility: {
          ...reproducibility,
          maximumMetricDelta: maximumMetricDelta(reproducibility.metricDeltas),
          maximumPoseMetricDelta: maximumPoseMetricDelta(
            reproducibility.metricDeltas,
          ),
        },
      });
      console.log(
        `  coverage=${fixedMetrics.poseCoverage?.toFixed(3)} lowerBody=${fixedMetrics.lowerBodyCoverage?.toFixed(3)} processing=${Math.round(fixedFirst.processingMs)}ms maxLandmarkDelta=${reproducibility.maximumLandmarkDelta}`,
      );
    }
  } finally {
    await page.close();
    await browser.close();
    await server.close();
  }

  const comparisons = compareMetricGroups(
    evaluatedSamples.map(({ sample, metrics }) => ({
      expectedOutcome: sample.expectedOutcome,
      metrics: metrics.fixedFirst,
    })),
  );
  const slowMotionComparisons = {
    slow: compareMetricGroups(
      evaluatedSamples
        .filter(({ sample }) => sample.notes?.includes("スロー"))
        .map(({ sample, metrics }) => ({
          expectedOutcome: sample.expectedOutcome,
          metrics: metrics.fixedFirst,
        })),
    ),
    normal: compareMetricGroups(
      evaluatedSamples
        .filter(({ sample }) => !sample.notes?.includes("スロー"))
        .map(({ sample, metrics }) => ({
          expectedOutcome: sample.expectedOutcome,
          metrics: metrics.fixedFirst,
        })),
    ),
  };
  const assessableSamples = evaluatedSamples.filter(
    ({ qualityAssessment }) => qualityAssessment.status === "ASSESSABLE",
  );
  const unassessableSamples = evaluatedSamples.filter(
    ({ qualityAssessment }) => qualityAssessment.status === "UNASSESSABLE",
  );
  const outcomeCounts = (
    samplesToCount: typeof evaluatedSamples,
  ) => ({
    landed: samplesToCount.filter(
      ({ sample }) => sample.expectedOutcome === "LANDED",
    ).length,
    bailed: samplesToCount.filter(
      ({ sample }) => sample.expectedOutcome === "BAILED",
    ).length,
  });
  const comparisonInput = (samplesToCompare: typeof evaluatedSamples) =>
    samplesToCompare.map(({ sample, metrics }) => ({
      expectedOutcome: sample.expectedOutcome,
      metrics: metrics.fixedFirst,
    }));
  const qualityStrata = {
    policy: poseQualityPolicy,
    assessable: {
      sampleIds: assessableSamples.map(({ sample }) => sample.id),
      outcomeCounts: outcomeCounts(assessableSamples),
      comparisons: compareMetricGroups(comparisonInput(assessableSamples)),
    },
    unassessable: {
      samples: unassessableSamples.map(({ sample, qualityAssessment, metrics }) => ({
        id: sample.id,
        expectedOutcome: sample.expectedOutcome,
        trick: sample.trick,
        cameraAngle: sample.cameraAngle,
        isSlowMotion: sample.notes?.includes("スロー") ?? false,
        poseCoverage: metrics.fixedFirst.poseCoverage,
        lowerBodyCoverage: metrics.fixedFirst.lowerBodyCoverage,
        reasons: qualityAssessment.reasons,
      })),
      outcomeCounts: outcomeCounts(unassessableSamples),
      comparisons: compareMetricGroups(comparisonInput(unassessableSamples)),
    },
  };
  const output = {
    generatedAt: new Date().toISOString(),
    environment: {
      browser: arguments_.browserName,
      browserVersion,
      playwrightVersion: playwrightPackage.version,
      mediapipeTasksVisionVersion: mediapipePackage.version,
      model: {
        name: POSE_LANDMARKER_CONFIG.model.name,
        url: POSE_LANDMARKER_CONFIG.model.url,
        bytes: model.bytes,
        sha256: model.sha256,
      },
      delegate: "CPU",
      fixedFps: arguments_.fixedFps,
    },
    selection: arguments_.selection,
    metricDefinitions: poseMetricDefinitions,
    samples: evaluatedSamples,
    comparisons,
    qualityStrata,
    slowMotionComparisons,
  };

  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const fileName = `pose-landmarker-${output.generatedAt.replaceAll(":", "-")}.json`;
  const outputPath = resolve(OUTPUT_DIRECTORY, fileName);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);

  console.log(`Pose evaluation result: ${outputPath}`);
  console.table(
    comparisons.map((comparison) => ({
      metric: comparison.metric,
      landedMedian: comparison.landedMedian,
      bailedMedian: comparison.bailedMedian,
      cliffsDelta: comparison.cliffsDelta,
    })),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
