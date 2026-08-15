import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { TwelveLabs, type TwelvelabsApi } from "twelvelabs-js";

import {
  appendVideoContext,
  getPromptForTrick,
} from "../../../prompts/common-system-v1";

import {
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
  toProviderJsonSchema,
} from "../schema";

const DEFAULT_MODEL_NAME = "pegasus1.5";
const DEFAULT_PRESIGN_EXPIRES_IN_SECONDS = 900;
const DEFAULT_ASSET_POLL_TIMEOUT_MS = 120_000;
const DEFAULT_ASSET_POLL_INTERVAL_MS = 3_000;
const DEFAULT_ANALYZE_TIMEOUT_MS = 150_000;
const DEFAULT_MAX_TOKENS = 2_000;
const SUPPORTED_PROMPT_VERSION: PromptVersionFamily = "v1";
const twelveLabsAnalysisJsonSchema = toProviderJsonSchema(
  skateAnalysisResultJsonSchema,
  {
    strip: [
      "$schema",
      "minimum",
      "maximum",
      "exclusiveMinimum",
      "exclusiveMaximum",
    ],
  },
);

export type TwelveLabsDirectConfig = {
  apiKey: string;
  modelName?: TwelvelabsApi.AnalyzeRequestModelName;
  s3Bucket: string;
  awsRegion: string;
  presignExpiresInSeconds?: number;
  assetPollTimeoutMs?: number;
  assetPollIntervalMs?: number;
  analyzeTimeoutMs?: number;
  maxTokens?: number;
};

type ResolvedTwelveLabsDirectConfig = Required<TwelveLabsDirectConfig>;
type Environment = Readonly<Record<string, string | undefined>>;

function requiredEnvironment(
  environment: Environment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export function createTwelveLabsDirectConfigFromEnv(
  environment: Environment = process.env,
): TwelveLabsDirectConfig {
  const configuredModelName =
    environment.TWELVELABS_MODEL_NAME?.trim() || DEFAULT_MODEL_NAME;
  if (
    configuredModelName !== "pegasus1.2" &&
    configuredModelName !== "pegasus1.5"
  ) {
    throw new Error(
      `TWELVELABS_MODEL_NAME is invalid: ${configuredModelName}`,
    );
  }

  return {
    apiKey: requiredEnvironment(environment, "TWELVELABS_API_KEY"),
    modelName: configuredModelName,
    s3Bucket: requiredEnvironment(environment, "S3_BUCKET_NAME"),
    awsRegion: requiredEnvironment(environment, "AWS_REGION"),
    presignExpiresInSeconds: DEFAULT_PRESIGN_EXPIRES_IN_SECONDS,
    assetPollTimeoutMs: DEFAULT_ASSET_POLL_TIMEOUT_MS,
    assetPollIntervalMs: DEFAULT_ASSET_POLL_INTERVAL_MS,
    analyzeTimeoutMs: DEFAULT_ANALYZE_TIMEOUT_MS,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}

function resolveConfig(
  config: TwelveLabsDirectConfig,
): ResolvedTwelveLabsDirectConfig {
  return {
    ...config,
    modelName: config.modelName ?? DEFAULT_MODEL_NAME,
    presignExpiresInSeconds:
      config.presignExpiresInSeconds ?? DEFAULT_PRESIGN_EXPIRES_IN_SECONDS,
    assetPollTimeoutMs:
      config.assetPollTimeoutMs ?? DEFAULT_ASSET_POLL_TIMEOUT_MS,
    assetPollIntervalMs:
      config.assetPollIntervalMs ?? DEFAULT_ASSET_POLL_INTERVAL_MS,
    analyzeTimeoutMs: config.analyzeTimeoutMs ?? DEFAULT_ANALYZE_TIMEOUT_MS,
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
}

function parseS3Uri(uri: string): { bucket: string; key: string } {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) {
    throw new VideoAnalysisError(
      "INVALID_S3_URI",
      `S3 URIの形式が不正です: ${uri}`,
    );
  }

  return { bucket: match[1], key: match[2] };
}

function stringifyUnknown(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class TwelveLabsDirectVideoAnalyzer implements VideoAnalysisProvider {
  readonly providerName = "twelvelabs";
  readonly modelId: string;

  private readonly config: ResolvedTwelveLabsDirectConfig;
  private readonly s3Client: S3Client;
  private readonly client: TwelveLabs;

  constructor(config: TwelveLabsDirectConfig) {
    this.config = resolveConfig(config);
    this.modelId = this.config.modelName;
    this.s3Client = new S3Client({ region: this.config.awsRegion });
    this.client = new TwelveLabs({ apiKey: this.config.apiKey });
  }

  async analyze(input: VideoAnalysisInput): Promise<VideoAnalysisOutput> {
    if (input.promptVersion !== SUPPORTED_PROMPT_VERSION) {
      throw new UnsupportedPromptVersionError(input.promptVersion);
    }

    const { bucket, key } = parseS3Uri(input.videoS3Uri);
    if (bucket !== this.config.s3Bucket) {
      throw new VideoAnalysisError(
        "BUCKET_MISMATCH",
        `許可されていないS3バケットです: ${bucket}`,
      );
    }

    const url = await this.createPresignedUrl(bucket, key);
    const assetId = await this.createAsset(url);
    await this.waitForAsset(assetId);

    const resolvedPrompt = getPromptForTrick(input.trick);
    const analysisPrompt = appendVideoContext(resolvedPrompt.prompt, {
      stance: input.stance,
      cameraAngle: input.cameraAngle,
    });
    const rawResponse = await this.runAnalysis(assetId, analysisPrompt);
    if (rawResponse.finishReason !== "stop") {
      throw new VideoAnalysisError(
        "OUTPUT_TRUNCATED",
        `TwelveLabsの分析出力が正常完了しませんでした: finishReason=${rawResponse.finishReason ?? "undefined"}`,
      );
    }
    const parsed = this.parseResponse(rawResponse.data);
    const validated = skateAnalysisResultSchema.safeParse(parsed);

    if (!validated.success) {
      throw new VideoAnalysisError(
        "SCHEMA_VALIDATION_FAILED",
        `分析結果が期待するスキーマに一致しません: ${validated.error.message}`,
        { cause: validated.error },
      );
    }

    return {
      result: validated.data,
      rawResponse,
      promptVersion: resolvedPrompt.version,
    };
  }

  private async createPresignedUrl(
    bucket: string,
    key: string,
  ): Promise<string> {
    try {
      return await getSignedUrl(
        this.s3Client,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: this.config.presignExpiresInSeconds },
      );
    } catch (cause) {
      throw new VideoAnalysisError(
        "PRESIGN_FAILED",
        "動画のpresigned GET URLを発行できませんでした。",
        { cause },
      );
    }
  }

  private async createAsset(url: string): Promise<string> {
    try {
      const asset = await this.client.assets.create({ method: "url", url });
      if (!asset.id) {
        throw new Error("TwelveLabsのasset IDが返されませんでした。");
      }
      if (asset.status === "failed") {
        throw new VideoAnalysisError(
          "ASSET_FAILED",
          "TwelveLabsで動画assetの処理に失敗しました。",
        );
      }
      return asset.id;
    } catch (cause) {
      if (cause instanceof VideoAnalysisError) {
        throw cause;
      }
      throw new VideoAnalysisError(
        "ASSET_CREATE_FAILED",
        "TwelveLabsに動画assetを作成できませんでした。",
        { cause },
      );
    }
  }

  private async waitForAsset(assetId: string): Promise<void> {
    const deadline = Date.now() + this.config.assetPollTimeoutMs;

    while (Date.now() < deadline) {
      let asset;
      try {
        asset = await this.client.assets.retrieve(assetId);
      } catch (cause) {
        throw new VideoAnalysisError(
          "ASSET_FAILED",
          "TwelveLabsの動画asset状態を取得できませんでした。",
          { cause },
        );
      }

      if (asset.status === "ready") {
        return;
      }
      if (asset.status === "failed") {
        throw new VideoAnalysisError(
          "ASSET_FAILED",
          `TwelveLabsで動画assetの処理に失敗しました: ${asset.error?.message ?? "詳細不明"}`,
        );
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break;
      }
      await delay(Math.min(this.config.assetPollIntervalMs, remainingMs));
    }

    throw new VideoAnalysisError(
      "ASSET_TIMEOUT",
      "TwelveLabsの動画assetが準備完了になる前にタイムアウトしました。",
    );
  }

  private async runAnalysis(assetId: string, prompt: string) {
    try {
      // 120秒のasset待機 + 150秒の分析 = 最悪270秒で、Vercelの300秒制限内に収める。
      const response = await this.client.analyze(
        {
          modelName: this.config.modelName,
          video: { type: "asset_id", assetId },
          prompt,
          temperature: 0,
          maxTokens: this.config.maxTokens,
          responseFormat: {
            type: "json_schema",
            jsonSchema: twelveLabsAnalysisJsonSchema,
          },
        },
        {
          timeoutInSeconds: Math.ceil(this.config.analyzeTimeoutMs / 1_000),
        },
      );

      // length時のerrorはSDK上「打ち切り警告」なので、呼び出し失敗とは分けて
      // analyze()側のfinishReason検証でOUTPUT_TRUNCATEDとして報告する。
      if (response.error && response.finishReason === "stop") {
        throw new Error(stringifyUnknown(response.error));
      }
      return response;
    } catch (cause) {
      throw new VideoAnalysisError(
        "ANALYZE_FAILED",
        "TwelveLabsで動画を分析できませんでした。",
        { cause },
      );
    }
  }

  private parseResponse(data: string | undefined): unknown {
    try {
      return JSON.parse(data ?? "");
    } catch (cause) {
      throw new VideoAnalysisError(
        "INVALID_JSON",
        "TwelveLabsの分析結果が有効なJSONではありません。",
        { cause },
      );
    }
  }
}
