import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  command: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class MockBedrockRuntimeClient {
    readonly send = mocks.send;

    constructor(config: unknown) {
      mocks.client(config);
    }
  },
  InvokeModelCommand: class MockInvokeModelCommand {
    constructor(readonly input: unknown) {
      mocks.command(input);
    }
  },
}));

import {
  UnsupportedPromptVersionError,
  VideoAnalysisError,
  type VideoAnalysisInput,
} from "../provider";
import {
  BedrockPegasusVideoAnalyzer,
  createBedrockPegasusConfigFromEnv,
  DEFAULT_BEDROCK_PEGASUS_MODEL_ID,
  type BedrockPegasusConfig,
} from "./bedrock-pegasus";

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
  videoS3Uri: "s3://tricksight-videos/private/example.mp4",
  trick: "ollie",
  stance: "REGULAR",
  cameraAngle: "SIDE",
  promptVersion: "v2",
};

function responseBody(body: unknown) {
  return {
    body: new TextEncoder().encode(JSON.stringify(body)),
    contentType: "application/json",
    $metadata: { requestId: "request-123", httpStatusCode: 200 },
  };
}

function createProvider(overrides: Partial<BedrockPegasusConfig> = {}) {
  return new BedrockPegasusVideoAnalyzer({
    awsRegion: "ap-northeast-2",
    awsAccountId: "123456789012",
    s3Bucket: "tricksight-videos",
    timeoutMs: 1_000,
    ...overrides,
  });
}

describe("BedrockPegasusVideoAnalyzer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.send.mockResolvedValue(
      responseBody({
        message: JSON.stringify(validResult),
        finishReason: "stop",
      }),
    );
  });

  it("env helperでリージョン、bucket、既定モデルを解決する", () => {
    expect(
      createBedrockPegasusConfigFromEnv({
        AWS_REGION: " ap-northeast-2 ",
        AWS_ACCOUNT_ID: " 123456789012 ",
        S3_BUCKET_NAME: " tricksight-videos ",
      }),
    ).toEqual({
      awsRegion: "ap-northeast-2",
      awsAccountId: "123456789012",
      s3Bucket: "tricksight-videos",
      modelId: DEFAULT_BEDROCK_PEGASUS_MODEL_ID,
      maxOutputTokens: 2_000,
      timeoutMs: 270_000,
    });
  });

  it("AWS共通設定でBedrock clientを作る", () => {
    createProvider();

    expect(mocks.client).toHaveBeenCalledWith({
      region: "ap-northeast-2",
      maxAttempts: 1,
    });
  });

  it("v2以外のpromptVersionをSDK呼び出し前に拒否する", async () => {
    const provider = createProvider();

    await expect(
      provider.analyze({ ...defaultInput, promptVersion: "v1" }),
    ).rejects.toBeInstanceOf(UnsupportedPromptVersionError);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("設定と異なるS3 bucketを拒否する", async () => {
    const provider = createProvider();

    await expect(
      provider.analyze({
        ...defaultInput,
        videoS3Uri: "s3://another-bucket/private/example.mp4",
      }),
    ).rejects.toMatchObject({ code: "BUCKET_MISMATCH" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("S3 URIとnumeric constraintsを含むJSON SchemaでInvokeModelする", async () => {
    const provider = createProvider();

    const output = await provider.analyze(defaultInput);
    const commandInput = mocks.command.mock.calls[0]?.[0] as {
      modelId: string;
      contentType: string;
      accept: string;
      body: string;
    };
    const body = JSON.parse(commandInput.body);

    expect(commandInput).toMatchObject({
      modelId: DEFAULT_BEDROCK_PEGASUS_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
    });
    expect(body).toMatchObject({
      inputPrompt: expect.stringContaining(
        "分析対象情報:\n- スタンス: REGULAR\n- 撮影方向: SIDE",
      ),
      mediaSource: {
        s3Location: {
          uri: "s3://tricksight-videos/private/example.mp4",
          bucketOwner: "123456789012",
        },
      },
      maxOutputTokens: 2_000,
      temperature: 0,
    });
    expect(
      body.responseFormat.jsonSchema.properties.result.properties.confidence,
    ).toMatchObject({ minimum: 0, maximum: 1 });
    expect(
      body.responseFormat.jsonSchema.properties.scores.properties.setup,
    ).toMatchObject({ minimum: 0, maximum: 100 });
    expect(mocks.send.mock.calls[0]?.[1]).toEqual({
      abortSignal: expect.any(AbortSignal),
    });
    expect(output).toEqual({
      result: validResult,
      rawResponse: {
        message: JSON.stringify(validResult),
        finishReason: "stop",
        $metadata: { requestId: "request-123", httpStatusCode: 200 },
      },
      promptVersion: "common-system-v2+ollie-v1",
    });
    expect(provider.providerName).toBe("bedrock");
    expect(provider.modelId).toBe(DEFAULT_BEDROCK_PEGASUS_MODEL_ID);
  });

  it("length終了をOUTPUT_TRUNCATEDとして生レスポンス付きで返す", async () => {
    mocks.send.mockResolvedValue(
      responseBody({ message: '{"summary":"途中', finishReason: "length" }),
    );
    const provider = createProvider();

    await expect(provider.analyze(defaultInput)).rejects.toMatchObject({
      code: "OUTPUT_TRUNCATED",
      rawResponse: expect.objectContaining({ finishReason: "length" }),
    });
  });

  it("SDKエラーをBEDROCK_INVOKE_FAILEDへ変換する", async () => {
    const sdkError = Object.assign(new Error("Access denied"), {
      name: "AccessDeniedException",
      $metadata: { requestId: "request-denied", httpStatusCode: 403 },
    });
    mocks.send.mockRejectedValue(sdkError);
    const provider = createProvider();

    const error = await provider.analyze(defaultInput).catch((cause) => cause);

    expect(error).toBeInstanceOf(VideoAnalysisError);
    expect(error).toMatchObject({ code: "BEDROCK_INVOKE_FAILED" });
    expect((error as VideoAnalysisError).details).toContain("request-denied");
  });

  it("分析messageが不正なJSONならINVALID_JSONを返す", async () => {
    mocks.send.mockResolvedValue(
      responseBody({ message: "not-json", finishReason: "stop" }),
    );
    const provider = createProvider();

    await expect(provider.analyze(defaultInput)).rejects.toMatchObject({
      code: "INVALID_JSON",
      rawResponse: expect.objectContaining({ message: "not-json" }),
    });
  });

  it("分析結果がschema違反ならSCHEMA_VALIDATION_FAILEDを返す", async () => {
    mocks.send.mockResolvedValue(
      responseBody({
        message: JSON.stringify({
          ...validResult,
          result: { outcome: "LANDED", confidence: 94 },
        }),
        finishReason: "stop",
      }),
    );
    const provider = createProvider();

    await expect(provider.analyze(defaultInput)).rejects.toMatchObject({
      code: "SCHEMA_VALIDATION_FAILED",
    });
  });
});
