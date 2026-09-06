import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  command: vi.fn(),
  send: vi.fn(),
  sleep: vi.fn(),
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class MockBedrockRuntimeClient {
    readonly send = mocks.send;

    constructor(config: unknown) {
      mocks.client(config);
    }
  },
  ConverseCommand: class MockConverseCommand {
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
  BedrockNovaVideoAnalyzer,
  createBedrockNovaConfigFromEnv,
  DEFAULT_BEDROCK_NOVA_MODEL_ID,
  extractNovaJsonText,
  type BedrockNovaConfig,
} from "./bedrock-nova";

const validResult = {
  summary: "安定したオーリーです。",
  detected: { trickMatchesSelection: true, visibility: "GOOD" },
  result: { outcome: "LANDED", confidence: 0.91 },
  scores: {
    setup: 80,
    pop: 78,
    bodyBalance: 82,
    footControl: 76,
    landing: 85,
  },
  strengths: [
    { title: "安定した着地", description: "両足で捉えています。" },
  ],
  improvements: [
    {
      title: "前足の引き上げ",
      description: "前足をもう少し高く引き上げます。",
      priority: 1,
      timestampSeconds: 1.2,
    },
  ],
  nextPractice: { focus: "前足の軌道", drill: "低いオーリーを反復する" },
};

const defaultInput: VideoAnalysisInput = {
  videoS3Uri: "s3://tricksight-videos/private/example.mp4",
  trick: "ollie",
  stance: "REGULAR",
  cameraAngle: "SIDE",
  promptVersion: "v2",
};

function novaResponse(text: string | null, stopReason = "end_turn") {
  return {
    output: {
      message: {
        role: "assistant",
        content: text === null ? [] : [{ text }],
      },
    },
    stopReason,
    usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
    metrics: { latencyMs: 1_000 },
    $metadata: { requestId: "request-123", httpStatusCode: 200 },
  };
}

function createProvider(overrides: Partial<BedrockNovaConfig> = {}) {
  return new BedrockNovaVideoAnalyzer(
    {
      awsRegion: "ap-northeast-2",
      awsAccountId: "123456789012",
      s3Bucket: "tricksight-videos",
      attemptTimeoutMs: 1_000,
      retryDelayMs: 10,
      ...overrides,
    },
    { sleep: mocks.sleep },
  );
}

describe("extractNovaJsonText", () => {
  it("フェンスなしJSONは前後の空白だけ除去する", () => {
    expect(extractNovaJsonText('  {"ok":true}\n')).toBe('{"ok":true}');
  });

  it("json指定あり・なしのMarkdownフェンスを除去する", () => {
    expect(extractNovaJsonText('```json\n{"ok":true}\n```')).toBe(
      '{"ok":true}',
    );
    expect(extractNovaJsonText('```\n{"ok":true}\n```')).toBe(
      '{"ok":true}',
    );
  });

  it("フェンス前後に説明文があってもJSON部分だけ取り出す", () => {
    expect(
      extractNovaJsonText(
        '分析結果です。\n```json\n{"nested":{"value":1}}\n```\n以上です。',
      ),
    ).toBe('{"nested":{"value":1}}');
  });

  it("不正なJSONは修復せずパーサーで検出できる形のまま返す", () => {
    const extracted = extractNovaJsonText("```json\n{not-json}\n```");

    expect(extracted).toBe("{not-json}");
    expect(() => JSON.parse(extracted)).toThrow();
  });
});

describe("BedrockNovaVideoAnalyzer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sleep.mockResolvedValue(undefined);
    mocks.send.mockResolvedValue(novaResponse(JSON.stringify(validResult)));
  });

  it("env helperでリージョン、bucket、既定の推論プロファイルを解決する", () => {
    expect(
      createBedrockNovaConfigFromEnv({
        AWS_REGION: " ap-northeast-2 ",
        AWS_ACCOUNT_ID: " 123456789012 ",
        S3_BUCKET_NAME: " tricksight-videos ",
      }),
    ).toEqual({
      awsRegion: "ap-northeast-2",
      awsAccountId: "123456789012",
      s3Bucket: "tricksight-videos",
      modelId: DEFAULT_BEDROCK_NOVA_MODEL_ID,
      maxTokens: 2_000,
      maxAnalysisAttempts: 2,
      attemptTimeoutMs: 134_500,
      retryDelayMs: 1_000,
    });
  });

  it("AWS共通設定を使いSDK内蔵retryを無効にする", () => {
    createProvider();

    expect(mocks.client).toHaveBeenCalledWith({
      region: "ap-northeast-2",
      maxAttempts: 1,
    });
  });

  it("基盤モデルIDを拒否して推論プロファイルを要求する", () => {
    expect(() =>
      createProvider({ modelId: "amazon.nova-2-lite-v1:0" }),
    ).toThrow("must be an inference profile ID");
  });

  it("最大2回の呼び出しを270秒以内に制限する", () => {
    expect(() =>
      createProvider({
        maxAnalysisAttempts: 2,
        attemptTimeoutMs: 135_000,
        retryDelayMs: 1,
      }),
    ).toThrow("retry budget must be 270000ms or less");
  });

  it("v2以外のpromptVersionをSDK呼び出し前に拒否する", async () => {
    const provider = createProvider();

    await expect(
      provider.analyze({ ...defaultInput, promptVersion: "v1" }),
    ).rejects.toBeInstanceOf(UnsupportedPromptVersionError);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("bucketと動画形式をSDK呼び出し前に検証する", async () => {
    const provider = createProvider();

    await expect(
      provider.analyze({
        ...defaultInput,
        videoS3Uri: "s3://another-bucket/private/example.mp4",
      }),
    ).rejects.toMatchObject({ code: "BUCKET_MISMATCH" });
    await expect(
      provider.analyze({
        ...defaultInput,
        videoS3Uri: "s3://tricksight-videos/private/example.webm",
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_VIDEO_FORMAT" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("S3 URIとJSON Schema文字列を含むプロンプトでConverseする", async () => {
    const provider = createProvider();

    const output = await provider.analyze(defaultInput);
    const commandInput = mocks.command.mock.calls[0]?.[0] as {
      modelId: string;
      messages: Array<{
        content: Array<{
          video?: {
            format: string;
            source: {
              s3Location: { uri: string; bucketOwner: string };
            };
          };
          text?: string;
        }>;
      }>;
      inferenceConfig: { maxTokens: number; temperature: number };
    };

    expect(commandInput.modelId).toBe(DEFAULT_BEDROCK_NOVA_MODEL_ID);
    expect(commandInput.messages[0]?.content[0]?.video).toEqual({
      format: "mp4",
      source: {
        s3Location: {
          uri: "s3://tricksight-videos/private/example.mp4",
          bucketOwner: "123456789012",
        },
      },
    });
    expect(commandInput.messages[0]?.content[1]?.text).toContain(
      '"confidence":{"type":"number","minimum":0,"maximum":1}',
    );
    expect(commandInput.inferenceConfig).toEqual({
      maxTokens: 2_000,
      temperature: 0,
    });
    expect(mocks.send.mock.calls[0]?.[1]).toEqual({
      abortSignal: expect.any(AbortSignal),
    });
    expect(output).toEqual({
      result: validResult,
      rawResponse: {
        attemptCount: 1,
        responses: [novaResponse(JSON.stringify(validResult))],
        message: JSON.stringify(validResult),
      },
      promptVersion: "common-system-v2+ollie-v1",
    });
    expect(provider.providerName).toBe("bedrock");
    expect(provider.modelId).toBe(DEFAULT_BEDROCK_NOVA_MODEL_ID);
  });

  it("不正JSONなら1秒待って補強プロンプトで1回だけ再試行する", async () => {
    mocks.send
      .mockResolvedValueOnce(novaResponse("not-json"))
      .mockResolvedValueOnce(novaResponse(JSON.stringify(validResult)));
    const provider = createProvider({ retryDelayMs: 1_000 });

    const output = await provider.analyze(defaultInput);

    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.sleep).toHaveBeenCalledOnce();
    expect(mocks.sleep).toHaveBeenCalledWith(1_000);
    const retryInput = mocks.command.mock.calls[1]?.[0] as {
      messages: Array<{ content: Array<{ text?: string }> }>;
    };
    expect(retryInput.messages[0]?.content[1]?.text).toContain("再試行指示");
    expect(output.rawResponse).toMatchObject({ attemptCount: 2 });
  });

  it("フェンス付きの有効JSONは初回で検証を通し再試行しない", async () => {
    mocks.send.mockResolvedValueOnce(
      novaResponse(`説明です。\n\`\`\`json\n${JSON.stringify(validResult)}\n\`\`\`\n以上です。`),
    );
    const provider = createProvider();

    const output = await provider.analyze(defaultInput);

    expect(output.result).toEqual(validResult);
    expect(output.rawResponse).toMatchObject({ attemptCount: 1 });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.sleep).not.toHaveBeenCalled();
  });

  it("schema違反は2回で上限に達し全response付きで失敗する", async () => {
    const invalid = {
      ...validResult,
      result: { outcome: "LANDED", confidence: 91 },
    };
    mocks.send.mockResolvedValue(novaResponse(JSON.stringify(invalid)));
    const provider = createProvider();

    const error = await provider.analyze(defaultInput).catch((cause) => cause);

    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.sleep).toHaveBeenCalledOnce();
    expect(error).toBeInstanceOf(VideoAnalysisError);
    expect(error).toMatchObject({
      code: "SCHEMA_VALIDATION_FAILED",
      rawResponse: {
        attemptCount: 2,
        responses: expect.any(Array),
      },
    });
  });

  it("max_tokens打ち切りとSDKエラーは再試行しない", async () => {
    const provider = createProvider();
    mocks.send.mockResolvedValueOnce(novaResponse("{}", "max_tokens"));

    await expect(provider.analyze(defaultInput)).rejects.toMatchObject({
      code: "OUTPUT_TRUNCATED",
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    const sdkError = Object.assign(new Error("Access denied"), {
      name: "AccessDeniedException",
      $metadata: { requestId: "request-denied", httpStatusCode: 403 },
    });
    mocks.send.mockRejectedValueOnce(sdkError);

    const error = await provider.analyze(defaultInput).catch((cause) => cause);

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ code: "BEDROCK_INVOKE_FAILED" });
    expect((error as VideoAnalysisError).details).toContain("request-denied");
  });
});
