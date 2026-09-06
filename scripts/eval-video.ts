import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { z } from "zod";

import { createAwsClientConfig } from "../lib/aws/client-config";
import type { SkateAnalysisResult } from "../lib/analysis/schema";
import {
  VideoAnalysisError,
  type VideoAnalysisInput,
} from "../lib/analysis/provider";
import { formatEvaluationError } from "../lib/analysis/evaluation-error";
import {
  BedrockNovaVideoAnalyzer,
  createBedrockNovaConfigFromEnv,
} from "../lib/analysis/providers/bedrock-nova";
import {
  BedrockPegasusVideoAnalyzer,
  createBedrockPegasusConfigFromEnv,
} from "../lib/analysis/providers/bedrock-pegasus";
import type { SupportedTrickSlug } from "../prompts/common-system-v2";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const providerSchema = z.enum(["nova", "pegasus", "both"]);
const videoFormatSchema = z.enum(["mp4", "mov"]);
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

const manifestSchema = z.object({
  samples: z.array(sampleSchema).min(1),
});

type Provider = z.infer<typeof providerSchema>;
type Sample = z.infer<typeof sampleSchema>;

type ProviderResult = {
  provider: "nova" | "pegasus";
  modelId: string;
  durationMs: number;
  attemptCount: number | null;
  rawText: string | null;
  analysis: SkateAnalysisResult | null;
  parseError: string | null;
  error: string | null;
  errorDetails: string | null;
};

type EvaluationResult = {
  sample: Sample;
  s3Uri: string;
  results: ProviderResult[];
};

function requiredEnvironment(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set. Add it to .env.local.`);
  }

  return value;
}

function parseArguments() {
  const providerIndex = process.argv.indexOf("--provider");
  const providerValue = providerIndex === -1 ? "both" : process.argv[providerIndex + 1];
  const provider = providerSchema.safeParse(providerValue);

  if (!provider.success) {
    throw new Error("--provider must be nova, pegasus, or both.");
  }

  const manifestIndex = process.argv.indexOf("--manifest");
  const manifestPath =
    manifestIndex === -1 ? "eval/manifest.json" : process.argv[manifestIndex + 1];
  const sampleIndex = process.argv.indexOf("--sample");
  const sampleId = sampleIndex === -1 ? undefined : process.argv[sampleIndex + 1];

  if (!manifestPath) {
    throw new Error("--manifest needs a file path.");
  }
  if (sampleIndex !== -1 && !sampleId) {
    throw new Error("--sample needs a sample ID.");
  }

  return { manifestPath, provider: provider.data, sampleId };
}

function videoDetails(filePath: string) {
  const extension = extname(filePath).toLowerCase().replace(".", "");
  const format = videoFormatSchema.safeParse(extension);

  if (!format.success) {
    throw new Error(`${filePath} must be an MP4 or MOV file.`);
  }

  return {
    contentType: format.data === "mp4" ? "video/mp4" : "video/quicktime",
    format: format.data,
  };
}

function trickSlug(trick: Sample["trick"]): SupportedTrickSlug {
  switch (trick) {
    case "OLLIE":
      return "ollie";
    case "POP_SHOVE_IT":
      return "pop-shove-it";
    case "KICKFLIP":
      return "kickflip";
  }
}

async function uploadVideo(input: {
  bucket: string;
  key: string;
  filePath: string;
  contentType: string;
  s3: S3Client;
}) {
  const file = await readFile(input.filePath);
  const fileStats = await stat(input.filePath);

  if (fileStats.size > MAX_VIDEO_BYTES) {
    throw new Error(`${input.filePath} is larger than the 100MB MVP limit.`);
  }

  await input.s3.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: file,
      ContentType: input.contentType,
    }),
  );

  return `s3://${input.bucket}/${input.key}`;
}

function providerModelId(
  provider: Exclude<Provider, "both">,
  novaProvider: BedrockNovaVideoAnalyzer | null,
  pegasusProvider: BedrockPegasusVideoAnalyzer | null,
) {
  if (provider === "nova") {
    if (!novaProvider) throw new Error("Nova provider is not configured.");
    return novaProvider.modelId;
  }
  if (!pegasusProvider) throw new Error("Pegasus provider is not configured.");
  return pegasusProvider.modelId;
}

function failedAttemptCount(error: unknown) {
  if (!(error instanceof VideoAnalysisError)) return null;
  const rawResponse = error.rawResponse;
  if (typeof rawResponse !== "object" || rawResponse === null) return null;
  if (!("attemptCount" in rawResponse)) return null;

  return typeof rawResponse.attemptCount === "number"
    ? rawResponse.attemptCount
    : null;
}

async function runProvider(input: {
  provider: Exclude<Provider, "both">;
  novaProvider: BedrockNovaVideoAnalyzer | null;
  pegasusProvider: BedrockPegasusVideoAnalyzer | null;
  sample: Sample;
  s3Uri: string;
}) {
  if (input.provider === "nova") {
    if (!input.novaProvider) throw new Error("Nova provider is not configured.");

    const startedAt = performance.now();
    const output = await input.novaProvider.analyze({
      videoS3Uri: input.s3Uri,
      trick: trickSlug(input.sample.trick),
      stance: input.sample.stance,
      cameraAngle: input.sample.cameraAngle,
      promptVersion: "v2",
    } satisfies VideoAnalysisInput);
    const rawResponse = output.rawResponse as Record<string, unknown>;

    return {
      provider: "nova" as const,
      modelId: input.novaProvider.modelId,
      durationMs: Math.round(performance.now() - startedAt),
      attemptCount:
        typeof rawResponse.attemptCount === "number"
          ? rawResponse.attemptCount
          : null,
      rawText:
        typeof rawResponse.message === "string" ? rawResponse.message : null,
      analysis: output.result,
      parseError: null,
      error: null,
      errorDetails: null,
    };
  }

  if (!input.pegasusProvider) {
    throw new Error("Pegasus provider is not configured.");
  }

  const startedAt = performance.now();
  const output = await input.pegasusProvider.analyze({
    videoS3Uri: input.s3Uri,
    trick: trickSlug(input.sample.trick),
    stance: input.sample.stance,
    cameraAngle: input.sample.cameraAngle,
    promptVersion: "v2",
  } satisfies VideoAnalysisInput);
  const rawResponse = output.rawResponse as Record<string, unknown>;

  return {
    provider: "pegasus" as const,
    modelId: input.pegasusProvider.modelId,
    durationMs: Math.round(performance.now() - startedAt),
    attemptCount: 1,
    rawText:
      typeof rawResponse.message === "string" ? rawResponse.message : null,
    analysis: output.result,
    parseError: null,
    error: null,
    errorDetails: null,
  };
}

async function main() {
  const { manifestPath, provider, sampleId } = parseArguments();
  const manifestContents = await readFile(resolve(manifestPath), "utf8");
  const manifest = manifestSchema.parse(JSON.parse(manifestContents));
  const samples = sampleId
    ? manifest.samples.filter((sample) => sample.id === sampleId)
    : manifest.samples;

  if (samples.length === 0) {
    throw new Error(`Sample ${sampleId} was not found.`);
  }
  const region = requiredEnvironment("AWS_REGION");
  const bucket = requiredEnvironment("S3_BUCKET_NAME");
  const selectedProviders: Array<Exclude<Provider, "both">> =
    provider === "both" ? ["nova", "pegasus"] : [provider];

  const awsClientConfig = createAwsClientConfig({ region });
  const s3 = new S3Client(awsClientConfig);
  const bedrock = new BedrockRuntimeClient({
    ...awsClientConfig,
    maxAttempts: 1,
  });
  const novaProvider = selectedProviders.includes("nova")
    ? new BedrockNovaVideoAnalyzer(createBedrockNovaConfigFromEnv(), {
        client: bedrock,
      })
    : null;
  const pegasusProvider = selectedProviders.includes("pegasus")
    ? new BedrockPegasusVideoAnalyzer(
        createBedrockPegasusConfigFromEnv(),
        { client: bedrock },
      )
    : null;
  const evaluations: EvaluationResult[] = [];

  for (const sample of samples) {
    const filePath = resolve(sample.file);
    const { contentType } = videoDetails(filePath);
    const key = `eval/${sample.id}-${basename(filePath)}`;
    const s3Uri = await uploadVideo({
      bucket,
      key,
      filePath,
      contentType,
      s3,
    });
    const results: ProviderResult[] = [];

    for (const selectedProvider of selectedProviders) {
      console.log(`Analyzing ${sample.id} with ${selectedProvider}...`);
      const startedAt = performance.now();

      try {
        results.push(
          await runProvider({
            provider: selectedProvider,
            novaProvider,
            pegasusProvider,
            sample,
            s3Uri,
          }),
        );
      } catch (error) {
        const formattedError = formatEvaluationError(error);
        console.error(
          `${sample.id} | ${selectedProvider} | ERROR | ${formattedError.message}`,
        );
        results.push({
          provider: selectedProvider,
          modelId: providerModelId(
            selectedProvider,
            novaProvider,
            pegasusProvider,
          ),
          durationMs: Math.round(performance.now() - startedAt),
          attemptCount: failedAttemptCount(error),
          rawText: null,
          analysis: null,
          parseError: null,
          error: formattedError.message,
          errorDetails: formattedError.details,
        });
      }
    }

    evaluations.push({ sample, s3Uri, results });
  }

  await mkdir(resolve("eval/output"), { recursive: true });
  const outputPath = resolve(
    "eval/output",
    `evaluation-${new Date().toISOString().replaceAll(":", "-")}.json`,
  );
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        region,
        provider,
        evaluations,
      },
      null,
      2,
    )}\n`,
  );

  for (const evaluation of evaluations) {
    for (const result of evaluation.results) {
      console.log(
        `${evaluation.sample.id} | ${result.provider} | ${result.durationMs}ms | ${result.error ? "ERROR" : result.parseError ? "INVALID_JSON" : "OK"}`,
      );
    }
  }

  console.log(`Saved evaluation results to ${outputPath}`);

  if (evaluations.every((evaluation) => evaluation.results.every((result) => result.error))) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
