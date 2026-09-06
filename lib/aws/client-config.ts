import {
  awsCredentialsProvider,
  type AwsCredentialsProviderInit,
} from "@vercel/oidc-aws-credentials-provider";

export const AWS_STS_OIDC_AUDIENCE = "sts.amazonaws.com";

type Environment = Readonly<Record<string, string | undefined>>;
type OidcCredentialsProviderFactory = (
  input: AwsCredentialsProviderInit,
) => ReturnType<typeof awsCredentialsProvider>;

export function resolveAwsAccountId(
  environment: Environment = process.env,
) {
  const accountId = environment.AWS_ACCOUNT_ID?.trim();

  if (!accountId) throw new Error("AWS_ACCOUNT_ID is required.");
  if (!/^\d{12}$/.test(accountId)) {
    throw new Error("AWS_ACCOUNT_ID must be a 12-digit AWS account ID.");
  }

  return accountId;
}

export function createAwsClientConfig(input: {
  region: string;
  environment?: Environment;
  createOidcCredentialsProvider?: OidcCredentialsProviderFactory;
}) {
  const environment = input.environment ?? process.env;
  const roleArn = environment.AWS_ROLE_ARN?.trim();

  if (!roleArn) {
    // ローカルやLambdaではcredentialsを指定せず、AWS SDKの既定チェーンを使う。
    return { region: input.region };
  }

  const createOidcCredentialsProvider =
    input.createOidcCredentialsProvider ?? awsCredentialsProvider;

  return {
    region: input.region,
    credentials: createOidcCredentialsProvider({
      roleArn,
      audience: AWS_STS_OIDC_AUDIENCE,
      clientConfig: { region: input.region },
    }),
  };
}
