import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AWS_STS_OIDC_AUDIENCE,
  createAwsClientConfig,
  resolveAwsAccountId,
} from "./client-config";

describe("createAwsClientConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("AWS_ROLE_ARNがなければSDKの既定認証情報チェーンを使う", () => {
    const createOidcCredentialsProvider = vi.fn();

    const config = createAwsClientConfig({
      region: "ap-northeast-2",
      environment: {
        AWS_ACCESS_KEY_ID: "AKIA_LOCAL",
        AWS_SECRET_ACCESS_KEY: "local-secret",
      },
      createOidcCredentialsProvider,
    });

    expect(config).toEqual({ region: "ap-northeast-2" });
    expect(config).not.toHaveProperty("credentials");
    expect(createOidcCredentialsProvider).not.toHaveBeenCalled();
  });

  it("ローカルの環境変数アクセスキーをSDKの既定チェーンで解決できる", async () => {
    vi.stubEnv("AWS_ROLE_ARN", "");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIA_TEST_LOCAL");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test-local-secret");
    vi.stubEnv("AWS_SESSION_TOKEN", "test-local-session-token");

    const client = new S3Client(
      createAwsClientConfig({ region: "ap-northeast-2" }),
    );

    await expect(client.config.credentials()).resolves.toMatchObject({
      accessKeyId: "AKIA_TEST_LOCAL",
      secretAccessKey: "test-local-secret",
      sessionToken: "test-local-session-token",
    });
  });

  it("空白だけのAWS_ROLE_ARNも未設定として扱う", () => {
    const createOidcCredentialsProvider = vi.fn();

    const config = createAwsClientConfig({
      region: "ap-northeast-2",
      environment: { AWS_ROLE_ARN: "   " },
      createOidcCredentialsProvider,
    });

    expect(config).toEqual({ region: "ap-northeast-2" });
    expect(createOidcCredentialsProvider).not.toHaveBeenCalled();
  });

  it("AWS_ROLE_ARNがあればVercel OIDCの認証情報プロバイダを使う", () => {
    const oidcCredentialsProvider = vi.fn();
    const createOidcCredentialsProvider = vi
      .fn()
      .mockReturnValue(oidcCredentialsProvider);

    const config = createAwsClientConfig({
      region: "ap-northeast-2",
      environment: {
        AWS_ROLE_ARN:
          "  arn:aws:iam::123456789012:role/tricksight-vercel-role  ",
        AWS_ACCESS_KEY_ID: "AKIA_MUST_NOT_BE_SELECTED",
      },
      createOidcCredentialsProvider,
    });

    expect(createOidcCredentialsProvider).toHaveBeenCalledWith({
      roleArn: "arn:aws:iam::123456789012:role/tricksight-vercel-role",
      audience: AWS_STS_OIDC_AUDIENCE,
      clientConfig: { region: "ap-northeast-2" },
    });
    expect(config).toEqual({
      region: "ap-northeast-2",
      credentials: oidcCredentialsProvider,
    });
  });
});

describe("resolveAwsAccountId", () => {
  it("12桁のAWSアカウントIDをtrimして返す", () => {
    expect(resolveAwsAccountId({ AWS_ACCOUNT_ID: " 123456789012 " })).toBe(
      "123456789012",
    );
  });

  it("未設定または12桁でない値を拒否する", () => {
    expect(() => resolveAwsAccountId({})).toThrow(
      "AWS_ACCOUNT_ID is required",
    );
    expect(() =>
      resolveAwsAccountId({ AWS_ACCOUNT_ID: "123" }),
    ).toThrow("must be a 12-digit AWS account ID");
  });
});
