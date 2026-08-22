import {
  awsCredentialsProvider,
  type AwsCredentialsProviderInit,
} from "@vercel/oidc-aws-credentials-provider";

export const AWS_STS_OIDC_AUDIENCE = "sts.amazonaws.com";

type Environment = Readonly<Record<string, string | undefined>>;
type OidcCredentialsProviderFactory = (
  input: AwsCredentialsProviderInit,
) => ReturnType<typeof awsCredentialsProvider>;

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
