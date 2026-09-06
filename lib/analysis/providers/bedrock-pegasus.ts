import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  type InvokeModelCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";

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
} from "../schema";

export const DEFAULT_BEDROCK_PEGASUS_MODEL_ID =
  "twelvelabs.pegasus-1-2-v1:0";
// Pegasus 1.2はこの基盤モデルIDでオンデマンド呼び出しできる。
// Nova 2 LiteやMarengoのように推論プロファイルIDへ置き換えない。

const DEFAULT_MAX_OUTPUT_TOKENS = 2_000;
const DEFAULT_TIMEOUT_MS = 270_000;
const SUPPORTED_PROMPT_VERSION: PromptVersionFamily = promptVersionFamily;
const responseBodySchema = z.looseObject({
  message: z.string(),
  finishReason: z.string().optional(),
});

type Environment = Readonly<Record<string, string | undefined>>;
type BedrockPegasusClient = {
  send(
    command: InvokeModelCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<InvokeModelCommandOutput>;
};

export type BedrockPegasusConfig = {
  awsRegion: string;
  awsAccountId: string;
  s3Bucket: string;
  modelId?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
};

type ResolvedBedrockPegasusConfig = Required<BedrockPegasusConfig>;

function requiredEnvironment(environment: Environment, name: string) {
  const value = environment[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

export function createBedrockPegasusConfigFromEnv(
  environment: Environment = process.env,
): BedrockPegasusConfig {
  return {
    awsRegion: requiredEnvironment(environment, "AWS_REGION"),
    awsAccountId: resolveAwsAccountId(environment),
    s3Bucket: requiredEnvironment(environment, "S3_BUCKET_NAME"),
    modelId:
      environment.PEGASUS_MODEL_ID?.trim() ||
      DEFAULT_BEDROCK_PEGASUS_MODEL_ID,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

function resolveConfig(
  config: BedrockPegasusConfig,
): ResolvedBedrockPegasusConfig {
  const resolved = {
    ...config,
    modelId: config.modelId?.trim() || DEFAULT_BEDROCK_PEGASUS_MODEL_ID,
    maxOutputTokens: config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };

  if (
    !Number.isInteger(resolved.maxOutputTokens) ||
    resolved.maxOutputTokens < 1 ||
    resolved.maxOutputTokens > 4_096
  ) {
    throw new Error("Bedrock Pegasus maxOutputTokens must be 1..4096.");
  }
  if (!Number.isFinite(resolved.timeoutMs) || resolved.timeoutMs <= 0) {
    throw new Error("Bedrock Pegasus timeoutMs must be greater than 0.");
  }

  return resolved;
}

function decodeResponseBody(response: InvokeModelCommandOutput) {
  let decoded: unknown;

  try {
    decoded = JSON.parse(new TextDecoder().decode(response.body));
  } catch (cause) {
    throw new VideoAnalysisError(
      "INVALID_RESPONSE",
      "Bedrock Pegasusのレスポンスが有効なJSONではありません。",
      { cause },
    );
  }

  const parsed = responseBodySchema.safeParse(decoded);
  if (!parsed.success) {
    throw new VideoAnalysisError(
      "INVALID_RESPONSE",
      "Bedrock Pegasusのレスポンス形式が不正です。",
      { cause: parsed.error, rawResponse: decoded },
    );
  }

  return parsed.data;
}

/**
 * 将来の再検証用に残す実験的な経路。
 * 2026-09-06時点では標準H.264の6.7秒/11.8秒動画がBedrock側で
 * "Unprocessable video, please check the video codec or duration"となり、
 * 本番・比較評価には使わない。Novaと共通のAWS/S3/provider基盤を再利用
 * できるため、未対応として削除せず原因調査を再開できる状態で保持する。
 */
export class BedrockPegasusVideoAnalyzer implements VideoAnalysisProvider {
  readonly providerName = "bedrock";
  readonly modelId: string;

  private readonly client: BedrockPegasusClient;
  private readonly config: ResolvedBedrockPegasusConfig;

  constructor(
    config: BedrockPegasusConfig,
    dependencies: { client?: BedrockPegasusClient } = {},
  ) {
    this.config = resolveConfig(config);
    this.modelId = this.config.modelId;
    this.client =
      dependencies.client ??
      new BedrockRuntimeClient({
        ...createAwsClientConfig({ region: this.config.awsRegion }),
        maxAttempts: 1,
      });
  }

  async analyze(input: VideoAnalysisInput): Promise<VideoAnalysisOutput> {
    if (input.promptVersion !== SUPPORTED_PROMPT_VERSION) {
      throw new UnsupportedPromptVersionError(input.promptVersion);
    }

    const { bucket } = parseVideoS3Uri(input.videoS3Uri);
    if (bucket !== this.config.s3Bucket) {
      throw new VideoAnalysisError(
        "BUCKET_MISMATCH",
        `許可されていないS3バケットです: ${bucket}`,
      );
    }

    const resolvedPrompt = resolveVideoAnalysisPrompt(input);
    const response = await this.invokeModel(input.videoS3Uri, resolvedPrompt.prompt);
    const responseBody = decodeResponseBody(response);
    const rawResponse = {
      ...responseBody,
      $metadata: response.$metadata,
    };

    if (
      responseBody.finishReason !== undefined &&
      responseBody.finishReason !== "stop"
    ) {
      throw new VideoAnalysisError(
        "OUTPUT_TRUNCATED",
        `Bedrock Pegasusの分析出力が正常完了しませんでした: finishReason=${responseBody.finishReason}`,
        { rawResponse },
      );
    }

    let parsedResult: unknown;
    try {
      parsedResult = JSON.parse(responseBody.message);
    } catch (cause) {
      throw new VideoAnalysisError(
        "INVALID_JSON",
        "Bedrock Pegasusの分析結果が有効なJSONではありません。",
        { cause, rawResponse },
      );
    }

    const validated = skateAnalysisResultSchema.safeParse(parsedResult);
    if (!validated.success) {
      throw new VideoAnalysisError(
        "SCHEMA_VALIDATION_FAILED",
        `分析結果が期待するスキーマに一致しません: ${validated.error.message}`,
        { cause: validated.error, rawResponse },
      );
    }

    return {
      result: validated.data,
      rawResponse,
      promptVersion: resolvedPrompt.version,
    };
  }

  private async invokeModel(
    videoS3Uri: string,
    prompt: string,
  ): Promise<InvokeModelCommandOutput> {
    try {
      return await this.client.send(
        new InvokeModelCommand({
          modelId: this.config.modelId,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify({
            inputPrompt: prompt,
            mediaSource: {
              s3Location: {
                uri: videoS3Uri,
                // 所有アカウントを固定し、別アカウントのbucketを誤って
                // モデルに読ませるconfused deputyを防ぐ。
                bucketOwner: this.config.awsAccountId,
              },
            },
            maxOutputTokens: this.config.maxOutputTokens,
            temperature: 0,
            // TwelveLabs直接APIと異なり、Bedrockでnumeric constraintsが使えるかを
            // T9-1の実API確認で判定するため、生成元schemaを除去せず渡す。
            responseFormat: { jsonSchema: skateAnalysisResultJsonSchema },
          }),
        }),
        { abortSignal: AbortSignal.timeout(this.config.timeoutMs) },
      );
    } catch (cause) {
      if (cause instanceof VideoAnalysisError) {
        throw cause;
      }
      throw new VideoAnalysisError(
        "BEDROCK_INVOKE_FAILED",
        "Bedrock経由でPegasusを呼び出せませんでした。",
        { cause },
      );
    }
  }
}
