import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";

import {
  createAwsClientConfig,
  resolveAwsAccountId,
} from "../../aws/client-config";
import { promptVersionFamily } from "../../../prompts/common-system-v2";

import {
  parseVideoS3Uri,
  resolveVideoAnalysisPrompt,
  UnsupportedPromptVersionError,
  VideoAnalysisError,
  type PromptVersionFamily,
  type VideoAnalysisInput,
  type VideoAnalysisOutput,
  type VideoAnalysisProvider,
} from "../provider";
import {
  skateAnalysisResultJsonSchema,
  skateAnalysisResultSchema,
  type SkateAnalysisResult,
} from "../schema";

export const DEFAULT_BEDROCK_NOVA_MODEL_ID =
  "jp.amazon.nova-2-lite-v1:0";
// Nova 2 LiteはPegasusと異なり、オンデマンド呼び出しにも
// 基盤モデルIDではなく推論プロファイルIDが必要。

const DEFAULT_MAX_TOKENS = 2_000;
const DEFAULT_MAX_ANALYSIS_ATTEMPTS = 2;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 134_500;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const MAX_PROVIDER_DURATION_MS = 270_000;
const SUPPORTED_PROMPT_VERSION: PromptVersionFamily = promptVersionFamily;

type Environment = Readonly<Record<string, string | undefined>>;
type NovaVideoFormat = "mp4" | "mov";
type BedrockNovaClient = {
  send(
    command: ConverseCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<ConverseCommandOutput>;
};

export type BedrockNovaConfig = {
  awsRegion: string;
  awsAccountId: string;
  s3Bucket: string;
  modelId?: string;
  maxTokens?: number;
  maxAnalysisAttempts?: number;
  attemptTimeoutMs?: number;
  retryDelayMs?: number;
};

type ResolvedBedrockNovaConfig = Required<BedrockNovaConfig>;
type NovaOutputFailure = {
  code:
    | "INVALID_RESPONSE"
    | "INVALID_JSON"
    | "SCHEMA_VALIDATION_FAILED"
    | "OUTPUT_TRUNCATED";
  message: string;
  details?: string;
  retryable: boolean;
};

type NovaOutputResult =
  | { success: true; result: SkateAnalysisResult }
  | { success: false; failure: NovaOutputFailure };

function requiredEnvironment(environment: Environment, name: string) {
  const value = environment[name]?.trim();

  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function createBedrockNovaConfigFromEnv(
  environment: Environment = process.env,
): BedrockNovaConfig {
  return {
    awsRegion: requiredEnvironment(environment, "AWS_REGION"),
    awsAccountId: resolveAwsAccountId(environment),
    s3Bucket: requiredEnvironment(environment, "S3_BUCKET_NAME"),
    modelId:
      environment.NOVA_MODEL_ID?.trim() || DEFAULT_BEDROCK_NOVA_MODEL_ID,
    maxTokens: DEFAULT_MAX_TOKENS,
    maxAnalysisAttempts: DEFAULT_MAX_ANALYSIS_ATTEMPTS,
    attemptTimeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
  };
}

function resolveConfig(config: BedrockNovaConfig): ResolvedBedrockNovaConfig {
  const resolved = {
    ...config,
    modelId: config.modelId?.trim() || DEFAULT_BEDROCK_NOVA_MODEL_ID,
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    maxAnalysisAttempts:
      config.maxAnalysisAttempts ?? DEFAULT_MAX_ANALYSIS_ATTEMPTS,
    attemptTimeoutMs:
      config.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS,
    retryDelayMs: config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
  };

  if (resolved.modelId === "amazon.nova-2-lite-v1:0") {
    throw new Error(
      "Bedrock Nova modelId must be an inference profile ID, not the foundation-model ID.",
    );
  }
  if (
    resolved.modelId.startsWith("jp.") &&
    resolved.awsRegion !== "ap-northeast-1"
  ) {
    throw new Error(
      "Bedrock Nova JP inference profiles require AWS_REGION=ap-northeast-1.",
    );
  }
  if (!Number.isInteger(resolved.maxTokens) || resolved.maxTokens < 1) {
    throw new Error("Bedrock Nova maxTokens must be a positive integer.");
  }
  if (
    !Number.isInteger(resolved.maxAnalysisAttempts) ||
    resolved.maxAnalysisAttempts < 1
  ) {
    throw new Error(
      "Bedrock Nova maxAnalysisAttempts must be a positive integer.",
    );
  }
  if (
    !Number.isFinite(resolved.attemptTimeoutMs) ||
    resolved.attemptTimeoutMs <= 0 ||
    !Number.isFinite(resolved.retryDelayMs) ||
    resolved.retryDelayMs < 0
  ) {
    throw new Error(
      "Bedrock Nova timeout and retry delay must be valid non-negative durations.",
    );
  }

  const maximumDuration =
    resolved.attemptTimeoutMs * resolved.maxAnalysisAttempts +
    resolved.retryDelayMs * (resolved.maxAnalysisAttempts - 1);
  if (maximumDuration > MAX_PROVIDER_DURATION_MS) {
    throw new Error(
      `Bedrock Nova retry budget must be ${MAX_PROVIDER_DURATION_MS}ms or less.`,
    );
  }

  return resolved;
}

function resolveVideoFormat(key: string): NovaVideoFormat {
  const extension = key.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  if (extension === "mp4" || extension === "mov") return extension;

  throw new VideoAnalysisError(
    "UNSUPPORTED_VIDEO_FORMAT",
    `Novaで未対応の動画形式です: ${extension ?? "unknown"}`,
  );
}

function outputText(response: ConverseCommandOutput) {
  const content = response.output?.message?.content ?? [];
  return content.find(
    (block): block is { text: string } =>
      "text" in block && typeof block.text === "string",
  )?.text;
}

export function extractNovaJsonText(text: string) {
  const trimmed = text.trim();
  const fencedJson =
    /```[ \t]*(?:json[ \t]*)?(?:\r?\n)?[ \t]*(\{[\s\S]*?\})[ \t]*(?:\r?\n)?```/i.exec(
      trimmed,
    );

  return fencedJson?.[1]?.trim() ?? trimmed;
}

function validateOutput(response: ConverseCommandOutput): NovaOutputResult {
  if (response.stopReason === "max_tokens") {
    return {
      success: false,
      failure: {
        code: "OUTPUT_TRUNCATED",
        message: "Bedrock Novaの分析出力がmax_tokensで打ち切られました。",
        retryable: false,
      },
    };
  }

  const rawText = outputText(response);
  if (!rawText) {
    return {
      success: false,
      failure: {
        code: "INVALID_RESPONSE",
        message: "Bedrock Novaのレスポンスにテキストがありません。",
        retryable: true,
      },
    };
  }

  let parsed: unknown;
  try {
    // NovaはJSONだけを返すよう明示してもコードフェンスを付けることがある。
    // Nova固有の表現だけをここで正規化し、Pegasusのネイティブ構造化出力
    // には影響させない。これにより決定的な形式差を無駄に再試行しない。
    parsed = JSON.parse(extractNovaJsonText(rawText));
  } catch (cause) {
    return {
      success: false,
      failure: {
        code: "INVALID_JSON",
        message: "Bedrock Novaの分析結果が有効なJSONではありません。",
        details: cause instanceof Error ? cause.message : String(cause),
        retryable: true,
      },
    };
  }

  const validated = skateAnalysisResultSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      success: false,
      failure: {
        code: "SCHEMA_VALIDATION_FAILED",
        message: "Bedrock Novaの分析結果が期待するスキーマに一致しません。",
        details: validated.error.message,
        retryable: true,
      },
    };
  }

  return { success: true, result: validated.data };
}

function promptForAttempt(basePrompt: string, attempt: number) {
  const schemaInstruction = `\n\n出力JSON Schema（この形と型に厳密に従ってください）:\n${JSON.stringify(skateAnalysisResultJsonSchema)}`;
  if (attempt === 1) return `${basePrompt}${schemaInstruction}`;

  return `${basePrompt}${schemaInstruction}\n\n再試行指示: 前回の出力は有効なJSONまたは指定スキーマに一致しませんでした。Markdownのコードフェンスや説明文を付けず、指定スキーマに一致するJSONオブジェクトだけを返してください。`;
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export class BedrockNovaVideoAnalyzer implements VideoAnalysisProvider {
  readonly providerName = "bedrock";
  readonly modelId: string;

  private readonly client: BedrockNovaClient;
  private readonly config: ResolvedBedrockNovaConfig;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    config: BedrockNovaConfig,
    dependencies: {
      client?: BedrockNovaClient;
      sleep?: (milliseconds: number) => Promise<void>;
    } = {},
  ) {
    this.config = resolveConfig(config);
    this.modelId = this.config.modelId;
    this.sleep = dependencies.sleep ?? defaultSleep;
    this.client =
      dependencies.client ??
      new BedrockRuntimeClient({
        ...createAwsClientConfig({ region: this.config.awsRegion }),
        // SDK内部の再試行を無効化し、分析出力だけを明示的に再試行する。
        maxAttempts: 1,
      });
  }

  async analyze(input: VideoAnalysisInput): Promise<VideoAnalysisOutput> {
    if (input.promptVersion !== SUPPORTED_PROMPT_VERSION) {
      throw new UnsupportedPromptVersionError(input.promptVersion);
    }

    const { bucket, key } = parseVideoS3Uri(input.videoS3Uri);
    if (bucket !== this.config.s3Bucket) {
      throw new VideoAnalysisError(
        "BUCKET_MISMATCH",
        `許可されていないS3バケットです: ${bucket}`,
      );
    }
    const format = resolveVideoFormat(key);
    const resolvedPrompt = resolveVideoAnalysisPrompt(input);
    const responses: ConverseCommandOutput[] = [];

    for (let attempt = 1; attempt <= this.config.maxAnalysisAttempts; attempt += 1) {
      const response = await this.invokeModel({
        videoS3Uri: input.videoS3Uri,
        format,
        prompt: promptForAttempt(resolvedPrompt.prompt, attempt),
      });
      responses.push(response);
      const output = validateOutput(response);

      if (output.success) {
        return {
          result: output.result,
          rawResponse: {
            attemptCount: attempt,
            responses,
            message: outputText(response),
          },
          promptVersion: resolvedPrompt.version,
        };
      }

      const finalAttempt = attempt === this.config.maxAnalysisAttempts;
      if (!output.failure.retryable || finalAttempt) {
        throw new VideoAnalysisError(
          output.failure.code,
          output.failure.message,
          {
            details: output.failure.details,
            rawResponse: { attemptCount: attempt, responses },
          },
        );
      }

      await this.sleep(this.config.retryDelayMs);
    }

    throw new Error("Bedrock Nova retry loop ended unexpectedly.");
  }

  private async invokeModel(input: {
    videoS3Uri: string;
    format: NovaVideoFormat;
    prompt: string;
  }): Promise<ConverseCommandOutput> {
    try {
      return await this.client.send(
        new ConverseCommand({
          modelId: this.config.modelId,
          messages: [
            {
              role: "user",
              content: [
                {
                  video: {
                    format: input.format,
                    source: {
                      s3Location: {
                        uri: input.videoS3Uri,
                        bucketOwner: this.config.awsAccountId,
                      },
                    },
                  },
                },
                { text: input.prompt },
              ],
            },
          ],
          inferenceConfig: {
            maxTokens: this.config.maxTokens,
            temperature: 0,
          },
        }),
        { abortSignal: AbortSignal.timeout(this.config.attemptTimeoutMs) },
      );
    } catch (cause) {
      throw new VideoAnalysisError(
        "BEDROCK_INVOKE_FAILED",
        "Bedrock経由でNova 2 Liteを呼び出せませんでした。",
        { cause },
      );
    }
  }
}
