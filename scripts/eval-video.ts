import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { z } from "zod";

import {
  skateAnalysisResultJsonSchema,
  skateAnalysisResultSchema,
  type SkateAnalysisResult,
} from "../lib/analysis/schema";
import {
  appendVideoContext,
  getPromptForTrick,
  type SupportedTrickSlug,
} from "../prompts/common-system-v1";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
// Nova 2 Lite is invoked through a Bedrock inference profile.  The bare
// foundation-model ID does not support on-demand throughput.
const DEFAULT_NOVA_MODEL_ID = "global.amazon.nova-2-lite-v1:0";
const DEFAULT_PEGASUS_MODEL_ID = "twelvelabs.pegasus-1-2-v1:0";

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
  rawText: string | null;
  analysis: SkateAnalysisResult | null;
  parseError: string | null;
  error: string | null;
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

function novaModelId() {
  const modelId = process.env.NOVA_MODEL_ID ?? DEFAULT_NOVA_MODEL_ID;

  if (modelId === "amazon.nova-2-lite-v1:0") {
    throw new Error(
      "NOVA_MODEL_ID must be an inference profile ID, not amazon.nova-2-lite-v1:0. Set it to global.amazon.nova-2-lite-v1:0 for this Seoul-region evaluation.",
    );
  }

  return modelId;
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

  if (!manifestPath) {
    throw new Error("--manifest needs a file path.");
  }

  return { manifestPath, provider: provider.data };
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

function promptForSample(sample: Sample) {
  const resolved = getPromptForTrick(trickSlug(sample.trick));
  return {
    ...resolved,
    prompt: appendVideoContext(resolved.prompt, {
      stance: sample.stance,
      cameraAngle: sample.cameraAngle,
    }),
  };
}

function parseAnalysis(rawText: string) {
  try {
    const parsedJson: unknown = JSON.parse(rawText);
    const parsedAnalysis = skateAnalysisResultSchema.safeParse(parsedJson);

    if (!parsedAnalysis.success) {
      return {
        analysis: null,
        parseError: parsedAnalysis.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      };
    }

    return { analysis: parsedAnalysis.data, parseError: null };
  } catch (error) {
    return {
      analysis: null,
      parseError: error instanceof Error ? error.message : "Invalid JSON response.",
    };
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

async function analyzeWithNova(input: {
  bedrock: BedrockRuntimeClient;
  modelId: string;
  prompt: string;
  s3Uri: string;
  format: z.infer<typeof videoFormatSchema>;
}) {
  const startedAt = performance.now();
  const response = await input.bedrock.send(
    new ConverseCommand({
      modelId: input.modelId,
      messages: [
        {
          role: "user",
          content: [
            {
              video: {
                format: input.format,
                source: { s3Location: { uri: input.s3Uri } },
              },
            },
            { text: input.prompt },
          ],
        },
      ],
      inferenceConfig: { maxTokens: 2_000, temperature: 0 },
    }),
  );
  const durationMs = Math.round(performance.now() - startedAt);
  const content = response.output?.message?.content ?? [];
  const rawText = content.find(
    (content): content is { text: string } => "text" in content,
  )?.text;

  if (!rawText) {
    throw new Error("Nova returned no text content.");
  }

  const { analysis, parseError } = parseAnalysis(rawText);

  return {
    provider: "nova" as const,
    modelId: input.modelId,
    durationMs,
    rawText,
    analysis,
    parseError,
    error: null,
  };
}

async function analyzeWithPegasus(input: {
  bedrock: BedrockRuntimeClient;
  modelId: string;
  prompt: string;
  s3Uri: string;
}) {
  const startedAt = performance.now();
  const response = await input.bedrock.send(
    new InvokeModelCommand({
      modelId: input.modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        inputPrompt: input.prompt,
        mediaSource: { s3Location: { uri: input.s3Uri } },
        maxOutputTokens: 2_000,
        temperature: 0,
        responseFormat: { jsonSchema: skateAnalysisResultJsonSchema },
      }),
    }),
  );
  const durationMs = Math.round(performance.now() - startedAt);
  const responseBody: unknown = JSON.parse(new TextDecoder().decode(response.body));
  const rawText = z.object({ message: z.string() }).parse(responseBody).message;
  const { analysis, parseError } = parseAnalysis(rawText);

  return {
    provider: "pegasus" as const,
    modelId: input.modelId,
    durationMs,
    rawText,
    analysis,
    parseError,
    error: null,
  };
}

function providerModelId(provider: Exclude<Provider, "both">) {
  return provider === "nova"
    ? novaModelId()
    : process.env.PEGASUS_MODEL_ID ?? DEFAULT_PEGASUS_MODEL_ID;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    const requestId =
      typeof error === "object" &&
      "$metadata" in error &&
      typeof error.$metadata === "object" &&
      error.$metadata !== null &&
      "requestId" in error.$metadata &&
      typeof error.$metadata.requestId === "string"
        ? ` (request ID: ${error.$metadata.requestId})`
        : "";

    return `${error.name}: ${error.message}${requestId}`;
  }

  return String(error);
}

async function runProvider(input: {
  provider: Exclude<Provider, "both">;
  bedrock: BedrockRuntimeClient;
  sample: Sample;
  s3Uri: string;
  format: z.infer<typeof videoFormatSchema>;
}) {
  const { prompt } = promptForSample(input.sample);

  if (input.provider === "nova") {
    return analyzeWithNova({
      bedrock: input.bedrock,
      modelId: novaModelId(),
      prompt,
      s3Uri: input.s3Uri,
      format: input.format,
    });
  }

  return analyzeWithPegasus({
    bedrock: input.bedrock,
    modelId: process.env.PEGASUS_MODEL_ID ?? DEFAULT_PEGASUS_MODEL_ID,
    prompt,
    s3Uri: input.s3Uri,
  });
}

async function main() {
  const { manifestPath, provider } = parseArguments();
  const manifestContents = await readFile(resolve(manifestPath), "utf8");
  const manifest = manifestSchema.parse(JSON.parse(manifestContents));
  const region = requiredEnvironment("AWS_REGION");
  const bucket = requiredEnvironment("S3_BUCKET_NAME");
  const selectedProviders: Array<Exclude<Provider, "both">> =
    provider === "both" ? ["nova", "pegasus"] : [provider];

  // Fail before uploading a video (and incurring storage/API costs) if a
  // foundation-model ID was configured in place of Nova's inference profile.
  if (selectedProviders.includes("nova")) {
    novaModelId();
  }
  const s3 = new S3Client({ region });
  const bedrock = new BedrockRuntimeClient({ region, maxAttempts: 1 });
  const evaluations: EvaluationResult[] = [];

  for (const sample of manifest.samples) {
    const filePath = resolve(sample.file);
    const { contentType, format } = videoDetails(filePath);
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
            bedrock,
            sample,
            s3Uri,
            format,
          }),
        );
      } catch (error) {
        const message = errorMessage(error);
        console.error(`${sample.id} | ${selectedProvider} | ERROR | ${message}`);
        results.push({
          provider: selectedProvider,
          modelId: providerModelId(selectedProvider),
          durationMs: Math.round(performance.now() - startedAt),
          rawText: null,
          analysis: null,
          parseError: null,
          error: message,
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
