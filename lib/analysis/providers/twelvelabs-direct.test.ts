import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  assetCreate: vi.fn(),
  assetRetrieve: vi.fn(),
  getObjectCommand: vi.fn(),
  getSignedUrl: vi.fn(),
  s3Client: vi.fn(),
  twelveLabs: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class MockGetObjectCommand {
    constructor(readonly input: unknown) {
      mocks.getObjectCommand(input);
    }
  },
  S3Client: class MockS3Client {
    constructor(config: unknown) {
      mocks.s3Client(config);
    }
  },
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: mocks.getSignedUrl,
}));

vi.mock("twelvelabs-js", () => ({
  TwelveLabs: class MockTwelveLabs {
    readonly assets = {
      create: mocks.assetCreate,
      retrieve: mocks.assetRetrieve,
    };
    readonly analyze = mocks.analyze;

    constructor(config: unknown) {
      mocks.twelveLabs(config);
    }
  },
}));

import {
  UnsupportedPromptVersionError,
  VideoAnalysisError,
  type VideoAnalysisInput,
} from "../provider";
import {
  skateAnalysisResultJsonSchema,
  toProviderJsonSchema,
} from "../schema";
import {
  createTwelveLabsDirectConfigFromEnv,
  TwelveLabsDirectVideoAnalyzer,
  type TwelveLabsDirectConfig,
} from "./twelvelabs-direct";

const validResult = {
  summary: "安定したオーリーです。",
  detected: {
    trickMatchesSelection: true,
    visibility: "GOOD",
  },
  result: {
    outcome: "LANDED",
    confidence: 0.94,
  },
  scores: {
    setup: 80,
    pop: 78,
    bodyBalance: 82,
    footControl: 76,
    landing: 85,
  },
  strengths: [
    {
      title: "安定した着地",
      description: "両足でボードを捉えています。",
    },
  ],
  improvements: [
    {
      title: "前足の引き上げ",
      description: "前足をもう少し高く引き上げます。",
      priority: 1,
      timestampSeconds: 1.2,
    },
  ],
  nextPractice: {
    focus: "前足の軌道",
    drill: "低いオーリーを反復する",
  },
};

const defaultInput: VideoAnalysisInput = {
  videoS3Uri: "s3://tricksight-videos/uploads/example.mp4",
  trick: "ollie",
  stance: "REGULAR",
  cameraAngle: "SIDE",
  promptVersion: "v2",
};

function createProvider(overrides: Partial<TwelveLabsDirectConfig> = {}) {
  return new TwelveLabsDirectVideoAnalyzer({
    apiKey: "test-api-key",
    s3Bucket: "tricksight-videos",
    awsRegion: "ap-northeast-2",
    ...overrides,
  });
}

describe("TwelveLabsDirectVideoAnalyzer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSignedUrl.mockResolvedValue("https://signed.example/video.mp4");
    mocks.assetCreate.mockResolvedValue({
      id: "asset-123",
      status: "processing",
    });
    mocks.assetRetrieve.mockResolvedValue({
      id: "asset-123",
      status: "ready",
    });
    mocks.analyze.mockResolvedValue({
      id: "analysis-123",
      data: JSON.stringify(validResult),
      finishReason: "stop",
    });
  });

  it("env helperでmaxTokensの既定値2000を設定する", () => {
    const config = createTwelveLabsDirectConfigFromEnv({
      TWELVELABS_API_KEY: "test-api-key",
      S3_BUCKET_NAME: "tricksight-videos",
      AWS_REGION: "ap-northeast-2",
    });

    expect(config.maxTokens).toBe(2_000);
  });

  it("v2以外のpromptVersionをAPI呼び出し前に拒否する", async () => {
    const provider = createProvider();

    await expect(
      provider.analyze({ ...defaultInput, promptVersion: "v1" }),
    ).rejects.toBeInstanceOf(UnsupportedPromptVersionError);
    expect(mocks.getSignedUrl).not.toHaveBeenCalled();
    expect(mocks.assetCreate).not.toHaveBeenCalled();
  });

  it("設定と異なるS3 bucketを拒否する", async () => {
    const provider = createProvider();

    await expect(
      provider.analyze({
        ...defaultInput,
        videoS3Uri: "s3://another-bucket/uploads/example.mp4",
      }),
    ).rejects.toMatchObject({ code: "BUCKET_MISMATCH" });
    expect(mocks.getSignedUrl).not.toHaveBeenCalled();
  });

  it("分析レスポンスが不正なJSONならINVALID_JSONを返す", async () => {
    const rawResponse = {
      id: "analysis-123",
      data: "not-json",
      finishReason: "stop",
    };
    mocks.analyze.mockResolvedValue(rawResponse);
    const provider = createProvider();

    await expect(provider.analyze(defaultInput)).rejects.toMatchObject(
      {
        code: "INVALID_JSON",
        rawResponse,
      },
    );
  });

  it("JSONが結果schemaに違反すればSCHEMA_VALIDATION_FAILEDを返す", async () => {
    const rawResponse = {
      id: "analysis-123",
      data: JSON.stringify({
        ...validResult,
        result: { outcome: "LANDED", confidence: 90 },
      }),
      finishReason: "stop",
    };
    mocks.analyze.mockResolvedValue(rawResponse);
    const provider = createProvider();

    await expect(provider.analyze(defaultInput)).rejects.toMatchObject(
      {
        code: "SCHEMA_VALIDATION_FAILED",
        rawResponse,
      },
    );
  });

  it("出力がlengthで打ち切られたらOUTPUT_TRUNCATEDを返す", async () => {
    const rawResponse = {
      id: "analysis-123",
      data: '{"summary":"途中',
      finishReason: "length",
      error: { message: "maximum output length reached" },
    };
    mocks.analyze.mockResolvedValue(rawResponse);
    const provider = createProvider();

    await expect(provider.analyze(defaultInput)).rejects.toMatchObject(
      {
        code: "OUTPUT_TRUNCATED",
        message: expect.stringContaining("finishReason=length"),
        rawResponse,
      },
    );
  });

  it("APIエラーのstatusとbodyを秘密値を除いてdetailsへ保持する", async () => {
    const apiError = Object.assign(new Error("BadRequestError"), {
      statusCode: 422,
      body: {
        code: "parameter_invalid",
        message: "additionalProperties is not supported",
        api_key: "tlk_super-secret-value",
      },
    });
    mocks.analyze.mockRejectedValue(apiError);
    const provider = createProvider();

    const error = await provider.analyze(defaultInput).catch((cause) => cause);

    expect(error).toBeInstanceOf(VideoAnalysisError);
    expect(error).toMatchObject({ code: "ANALYZE_FAILED" });
    expect((error as VideoAnalysisError).details).toContain(
      '"statusCode": 422',
    );
    expect((error as VideoAnalysisError).details).toContain(
      '"code": "parameter_invalid"',
    );
    expect((error as VideoAnalysisError).details).toContain(
      "additionalProperties is not supported",
    );
    expect((error as VideoAnalysisError).details).toContain("[REDACTED]");
    expect((error as VideoAnalysisError).details).not.toContain(
      "tlk_super-secret-value",
    );
  });

  it("設定したmaxTokensをanalyze呼び出しへ渡す", async () => {
    const provider = createProvider({ maxTokens: 2_500 });

    await provider.analyze(defaultInput);

    expect(mocks.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 2_500 }),
      expect.anything(),
    );
  });

  it("検証済み結果、生レスポンス、複合promptVersionを返す", async () => {
    const rawResponse = {
      id: "analysis-123",
      data: JSON.stringify(validResult),
      finishReason: "stop",
      usage: { outputTokens: 420 },
    };
    mocks.analyze.mockResolvedValue(rawResponse);
    const provider = createProvider();

    const output = await provider.analyze(defaultInput);

    expect(output).toEqual({
      result: validResult,
      rawResponse,
      promptVersion: "common-system-v2+ollie-v1",
    });
    expect(mocks.getObjectCommand).toHaveBeenCalledWith({
      Bucket: "tricksight-videos",
      Key: "uploads/example.mp4",
    });
    expect(mocks.getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { expiresIn: 900 },
    );
    expect(mocks.assetCreate).toHaveBeenCalledWith({
      method: "url",
      url: "https://signed.example/video.mp4",
    });
    expect(mocks.assetRetrieve).toHaveBeenCalledWith("asset-123");
    expect(mocks.analyze).toHaveBeenCalledWith(
      {
        modelName: "pegasus1.5",
        video: { type: "asset_id", assetId: "asset-123" },
        prompt: expect.stringContaining(
          "分析対象情報:\n- スタンス: REGULAR\n- 撮影方向: SIDE",
        ),
        temperature: 0,
        maxTokens: 2_000,
        responseFormat: {
          type: "json_schema",
          jsonSchema: toProviderJsonSchema(skateAnalysisResultJsonSchema, {
            strip: [
              "$schema",
              "minimum",
              "maximum",
              "exclusiveMinimum",
              "exclusiveMaximum",
            ],
          }),
        },
      },
      { timeoutInSeconds: 150 },
    );
  });
});
