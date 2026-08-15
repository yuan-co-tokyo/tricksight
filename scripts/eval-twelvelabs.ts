import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { z } from "zod";

import {
  formatVideoAnalysisErrorDetails,
  VideoAnalysisError,
  type VideoAnalysisInput,
} from "../lib/analysis/provider";
import {
  createTwelveLabsDirectConfigFromEnv,
  TwelveLabsDirectVideoAnalyzer,
} from "../lib/analysis/providers/twelvelabs-direct";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

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

type Sample = z.infer<typeof sampleSchema>;

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

function trickSlug(trick: Sample["trick"]): VideoAnalysisInput["trick"] {
  switch (trick) {
    case "OLLIE":
      return "ollie";
    case "POP_SHOVE_IT":
      return "pop-shove-it";
    case "KICKFLIP":
      return "kickflip";
  }
}

function videoDetails(filePath: string) {
  const extension = extname(filePath).toLowerCase();
  if (extension !== ".mp4" && extension !== ".mov") {
    throw new Error(`${filePath} must be an MP4 or MOV file.`);
  }

  return {
    contentType: extension === ".mp4" ? "video/mp4" : "video/quicktime",
    extension,
  };
}

function isNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "NotFound" || error.name === "NoSuchKey") return true;

  return (
    "$metadata" in error &&
    typeof error.$metadata === "object" &&
    error.$metadata !== null &&
    "httpStatusCode" in error.$metadata &&
    error.$metadata.httpStatusCode === 404
  );
}

async function uploadVideoByContentHash(input: {
  bucket: string;
  filePath: string;
  s3: S3Client;
}) {
  const fileStats = await stat(input.filePath);
  if (fileStats.size > MAX_VIDEO_BYTES) {
    throw new Error(`${input.filePath} is larger than the 100MB MVP limit.`);
  }

  const { contentType, extension } = videoDetails(input.filePath);
  const body = await readFile(input.filePath);
  const contentHash = createHash("sha256").update(body).digest("hex");
  const key = `eval/${contentHash}${extension}`;

  try {
    await input.s3.send(
      new HeadObjectCommand({ Bucket: input.bucket, Key: key }),
    );
    console.log(`Reusing s3://${input.bucket}/${key}.`);
  } catch (error) {
    if (!isNotFound(error)) throw error;

    console.log(`Uploading ${input.filePath} to s3://${input.bucket}/${key}...`);
    await input.s3.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        Metadata: { sha256: contentHash },
      }),
    );
  }

  return {
    key,
    s3Uri: `s3://${input.bucket}/${key}`,
  };
}

function rawResponseDetails(rawResponse: unknown) {
  if (typeof rawResponse !== "object" || rawResponse === null) {
    return { finishReason: null, usage: null, rawText: null };
  }

  const response = rawResponse as Record<string, unknown>;
  return {
    finishReason:
      typeof response.finishReason === "string" ? response.finishReason : null,
    usage: response.usage ?? null,
    rawText: typeof response.data === "string" ? response.data : null,
  };
}

function formatError(error: unknown) {
  if (error instanceof VideoAnalysisError) {
    return `${error.name}: ${error.message}`;
  }
  return formatVideoAnalysisErrorDetails(error);
}

function errorDetails(error: unknown): string {
  if (error instanceof VideoAnalysisError && error.details) {
    return error.details;
  }
  return formatVideoAnalysisErrorDetails(error);
}

async function main() {
  const { all, manifestPath, sampleId } = parseArguments();
  const config = createTwelveLabsDirectConfigFromEnv();
  if (config.modelName !== "pegasus1.5") {
    throw new Error(
      `TWELVELABS_MODEL_NAME must be pegasus1.5 (received ${config.modelName}).`,
    );
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

  const provider = new TwelveLabsDirectVideoAnalyzer(config);
  const s3 = new S3Client({ region: config.awsRegion });
  const evaluations = [];

  for (const sample of samples) {
    const startedAt = performance.now();
    let s3Key: string | null = null;
    let s3Uri: string | null = null;

    try {
      const uploaded = await uploadVideoByContentHash({
        bucket: config.s3Bucket,
        filePath: resolve(sample.file),
        s3,
      });
      s3Key = uploaded.key;
      s3Uri = uploaded.s3Uri;
      console.log(`Analyzing ${sample.id} with ${provider.providerName} ${provider.modelId}...`);

      const output = await provider.analyze({
        videoS3Uri: s3Uri,
        trick: trickSlug(sample.trick),
        stance: sample.stance,
        cameraAngle: sample.cameraAngle,
        promptVersion: "v1",
      });
      const { finishReason, usage, rawText } = rawResponseDetails(
        output.rawResponse,
      );

      evaluations.push({
        sample,
        s3Key,
        s3Uri,
        provider: provider.providerName,
        modelId: provider.modelId,
        promptVersion: output.promptVersion,
        durationMs: Math.round(performance.now() - startedAt),
        finishReason,
        usage,
        rawText,
        analysis: output.result,
        parseError: null,
        error_code: null,
        error_details: null,
        error: null,
      });
    } catch (error) {
      const message = formatError(error);
      const errorCode =
        error instanceof VideoAnalysisError ? error.code : "EVAL_FAILED";
      console.error(`${sample.id} | ${provider.providerName} | ERROR | ${message}`);
      evaluations.push({
        sample,
        s3Key,
        s3Uri,
        provider: provider.providerName,
        modelId: provider.modelId,
        promptVersion: null,
        durationMs: Math.round(performance.now() - startedAt),
        finishReason: null,
        usage: null,
        rawText: null,
        analysis: null,
        parseError: null,
        error_code: errorCode,
        error_details: errorDetails(error),
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
      `${evaluation.sample.id} | ${evaluation.provider} | ${evaluation.durationMs}ms | ${evaluation.error ? `ERROR (${evaluation.error_code})` : "OK"}`,
    );
  }
  console.log(`Saved evaluation results to ${outputPath}`);

  if (evaluations.every((evaluation) => evaluation.error)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
