import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { TwelveLabs, TwelvelabsApiError } from "twelvelabs-js";
import { z } from "zod";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const ASSET_POLL_INTERVAL_MS = 3_000;
const ASSET_POLL_TIMEOUT_MS = 5 * 60 * 1_000;
const ASSET_CACHE_PATH = resolve("eval/twelvelabs-assets.json");
const DEFAULT_MODEL_NAME = "pegasus1.5";

const outcomeSchema = z.enum(["LANDED", "BAILED", "UNCLEAR"]);
const sampleSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  file: z.string().min(1),
  trick: z.enum(["OLLIE", "POP_SHOVE_IT", "KICKFLIP"]),
  stance: z.enum(["REGULAR", "GOOFY"]),
  cameraAngle: z.enum(["SIDE", "FRONT", "REAR", "DIAGONAL"]),
  expectedOutcome: outcomeSchema.optional(),
  notes: z.string().max(1_000).optional(),
});
const manifestSchema = z.object({ samples: z.array(sampleSchema).min(1) });
const analysisSchema = z.object({
  summary: z.string(),
  detected: z.object({
    trickMatchesSelection: z.boolean(),
    visibility: z.enum(["GOOD", "PARTIAL", "POOR"]),
  }),
  result: z.object({
    outcome: outcomeSchema,
    confidence: z.number().min(0).max(1),
  }),
  strengths: z
    .array(z.object({ title: z.string(), description: z.string() }))
    .max(3),
  improvements: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        timestampSeconds: z.number().nonnegative().optional(),
      }),
    )
    .max(3),
  nextPractice: z.object({ focus: z.string(), drill: z.string() }),
});
const assetCacheSchema = z.object({
  version: z.literal(1),
  assets: z.record(
    z.string(),
    z.object({
      assetId: z.string(),
      filename: z.string(),
      createdAt: z.string(),
    }),
  ),
});

type Sample = z.infer<typeof sampleSchema>;
type AssetCache = z.infer<typeof assetCacheSchema>;

// TwelveLabs accepts a subset of JSON Schema. Client-side Zod validation above
// enforces constraints such as array length and numeric ranges that its API
// schema does not support.
const twelveLabsAnalysisJsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    detected: {
      type: "object",
      properties: {
        trickMatchesSelection: { type: "boolean" },
        visibility: { type: "string", enum: ["GOOD", "PARTIAL", "POOR"] },
      },
      required: ["trickMatchesSelection", "visibility"],
    },
    result: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: ["LANDED", "BAILED", "UNCLEAR"] },
        confidence: { type: "number" },
      },
      required: ["outcome", "confidence"],
    },
    strengths: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
        },
        required: ["title", "description"],
      },
    },
    improvements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "integer", enum: [1, 2, 3] },
          timestampSeconds: { type: "timestamp", format: "seconds" },
        },
        required: ["title", "description", "priority"],
      },
    },
    nextPractice: {
      type: "object",
      properties: {
        focus: { type: "string" },
        drill: { type: "string" },
      },
      required: ["focus", "drill"],
    },
  },
  required: [
    "summary",
    "detected",
    "result",
    "strengths",
    "improvements",
    "nextPractice",
  ],
} as const;

function requiredEnvironment(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set. Add it to .env.local.`);
  }

  return value;
}

function parseArguments() {
  const manifestIndex = process.argv.indexOf("--manifest");
  const manifestPath =
    manifestIndex === -1 ? "eval/manifest.json" : process.argv[manifestIndex + 1];
  const sampleIndex = process.argv.indexOf("--sample");
  const sampleId = sampleIndex === -1 ? undefined : process.argv[sampleIndex + 1];
  const all = process.argv.includes("--all");

  if (!manifestPath) throw new Error("--manifest needs a file path.");
  if (sampleIndex !== -1 && !sampleId) throw new Error("--sample needs a sample ID.");
  if (sampleId && all) throw new Error("Use either --sample or --all, not both.");

  return { all, manifestPath, sampleId };
}

function buildPrompt(sample: Sample) {
  return `あなたはスケートボードの映像コーチです。映像だけから観察できることだけを日本語で回答してください。\n\n対象トリック: ${sample.trick}\nスタンス: ${sample.stance}\n撮影方向: ${sample.cameraAngle}\n撮影者メモ: ${sample.notes ?? "なし"}\n\n見えない、または確信できない動きは推測せず、visibilityをPARTIALまたはPOORにしてください。strengthsとimprovementsはそれぞれ最大3件に絞り、改善点には映像内で確認できる場合だけtimestampSecondsを付けてください。次回の練習で実行できる具体的なドリルを1つ提案してください。出力は指定されたJSON Schemaに完全に従ってください。`;
}

async function loadAssetCache(): Promise<AssetCache> {
  try {
    return assetCacheSchema.parse(JSON.parse(await readFile(ASSET_CACHE_PATH, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { version: 1, assets: {} };
    }

    throw error;
  }
}

async function saveAssetCache(cache: AssetCache) {
  await mkdir(resolve("eval"), { recursive: true });
  await writeFile(ASSET_CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
}

async function fileSha256(filePath: string) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function waitForAsset(client: TwelveLabs, assetId: string) {
  const deadline = Date.now() + ASSET_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const asset = await client.assets.retrieve(assetId, {
      maxRetries: 1,
      timeoutInSeconds: 30,
    });

    if (asset.status === "ready") return asset;
    if (asset.status === "failed") {
      throw new Error(
        `TwelveLabs asset ${assetId} failed: ${asset.error?.message ?? "unknown error"}`,
      );
    }

    await delay(ASSET_POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for TwelveLabs asset ${assetId}.`);
}

async function getOrCreateAsset(input: {
  cache: AssetCache;
  client: TwelveLabs;
  filePath: string;
  sample: Sample;
}) {
  const fileStats = await stat(input.filePath);
  if (fileStats.size > MAX_VIDEO_BYTES) {
    throw new Error(`${input.filePath} is larger than the 100MB MVP limit.`);
  }

  const extension = extname(input.filePath).toLowerCase();
  if (extension !== ".mp4" && extension !== ".mov") {
    throw new Error(`${input.filePath} must be an MP4 or MOV file.`);
  }

  const hash = await fileSha256(input.filePath);
  const cached = input.cache.assets[hash];

  if (cached) {
    try {
      const asset = await waitForAsset(input.client, cached.assetId);
      console.log(`Reusing TwelveLabs asset ${cached.assetId}.`);
      return asset;
    } catch (error) {
      if (!(error instanceof TwelvelabsApiError) || error.statusCode !== 404) {
        throw error;
      }

      delete input.cache.assets[hash];
    }
  }

  console.log(`Uploading ${input.sample.id} to TwelveLabs...`);
  const created = await input.client.assets.create(
    {
      method: "direct",
      file: createReadStream(input.filePath),
      filename: `${input.sample.id}${extension}`,
      userMetadata: JSON.stringify({
        source: "tricksight-phase0",
        sampleId: input.sample.id,
      }),
    },
    { maxRetries: 1, timeoutInSeconds: 120 },
  );

  if (!created.id) throw new Error("TwelveLabs returned no asset ID.");
  input.cache.assets[hash] = {
    assetId: created.id,
    filename: `${input.sample.id}${extension}`,
    createdAt: new Date().toISOString(),
  };
  await saveAssetCache(input.cache);
  return waitForAsset(input.client, created.id);
}

function formatError(error: unknown) {
  if (error instanceof TwelvelabsApiError) {
    return `${error.name}: ${error.message}${error.statusCode ? ` (HTTP ${error.statusCode})` : ""}`;
  }
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function main() {
  const { all, manifestPath, sampleId } = parseArguments();
  const apiKey = requiredEnvironment("TWELVELABS_API_KEY");
  const modelName = process.env.TWELVELABS_MODEL_NAME ?? DEFAULT_MODEL_NAME;
  if (modelName !== "pegasus1.5") {
    throw new Error(`TWELVELABS_MODEL_NAME must be pegasus1.5 (received ${modelName}).`);
  }

  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(resolve(manifestPath), "utf8")),
  );
  const samples = all
    ? manifest.samples
    : sampleId
      ? manifest.samples.filter((sample) => sample.id === sampleId)
      : manifest.samples.slice(0, 1);

  if (samples.length === 0) throw new Error(`Sample ${sampleId} was not found.`);
  if (!all && !sampleId) {
    console.log(`No sample specified; evaluating only ${samples[0].id}.`);
  }

  const client = new TwelveLabs({ apiKey });
  const cache = await loadAssetCache();
  const evaluations = [];

  for (const sample of samples) {
    const filePath = resolve(sample.file);
    let assetId: string | null = null;
    const startedAt = performance.now();

    try {
      const asset = await getOrCreateAsset({ cache, client, filePath, sample });
      if (!asset.id) throw new Error("TwelveLabs returned no ready asset ID.");
      assetId = asset.id;
      console.log(`Analyzing ${sample.id} with TwelveLabs ${modelName}...`);

      const response = await client.analyze(
        {
          modelName,
          video: { type: "asset_id", assetId },
          prompt: buildPrompt(sample),
          temperature: 0,
          responseFormat: {
            type: "json_schema",
            jsonSchema: twelveLabsAnalysisJsonSchema,
          },
          maxTokens: 1_200,
        },
        { maxRetries: 1, timeoutInSeconds: 10 * 60 },
      );

      const rawText = response.data ?? "";
      const parsedJson: unknown = JSON.parse(rawText);
      const parsedAnalysis = analysisSchema.safeParse(parsedJson);
      evaluations.push({
        sample,
        assetId,
        provider: "twelvelabs",
        modelId: modelName,
        durationMs: Math.round(performance.now() - startedAt),
        finishReason: response.finishReason ?? null,
        usage: response.usage ?? null,
        rawText,
        analysis: parsedAnalysis.success ? parsedAnalysis.data : null,
        parseError: parsedAnalysis.success
          ? null
          : parsedAnalysis.error.issues
              .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
              .join("; "),
        error: response.error?.message ?? null,
      });
    } catch (error) {
      const message = formatError(error);
      console.error(`${sample.id} | twelvelabs | ERROR | ${message}`);
      evaluations.push({
        sample,
        assetId,
        provider: "twelvelabs",
        modelId: modelName,
        durationMs: Math.round(performance.now() - startedAt),
        finishReason: null,
        usage: null,
        rawText: null,
        analysis: null,
        parseError: null,
        error: message,
      });
    }
  }

  await mkdir(resolve("eval/output"), { recursive: true });
  const outputPath = resolve(
    "eval/output",
    `twelvelabs-${new Date().toISOString().replaceAll(":", "-")}.json`,
  );
  await writeFile(
    outputPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), evaluations }, null, 2)}\n`,
  );

  for (const evaluation of evaluations) {
    console.log(
      `${evaluation.sample.id} | twelvelabs | ${evaluation.durationMs}ms | ${evaluation.error ? "ERROR" : evaluation.parseError ? "INVALID_JSON" : "OK"}`,
    );
  }
  console.log(`Saved evaluation results to ${outputPath}`);

  if (evaluations.every((evaluation) => evaluation.error)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
