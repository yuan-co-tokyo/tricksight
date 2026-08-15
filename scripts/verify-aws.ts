import {
  BedrockClient,
  GetInferenceProfileCommand,
  ListFoundationModelsCommand,
} from "@aws-sdk/client-bedrock";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";

const DEFAULT_NOVA_INFERENCE_PROFILE_ID = "global.amazon.nova-2-lite-v1:0";

function requiredEnvironment(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set. Add it to .env.local.`);
  }

  return value;
}

async function main() {
  const region = requiredEnvironment("AWS_REGION");
  const bucket = requiredEnvironment("S3_BUCKET_NAME");
  const sts = new STSClient({ region });
  const s3 = new S3Client({ region });
  const bedrock = new BedrockClient({ region });

  await sts.send(new GetCallerIdentityCommand({}));
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));

  const response = await bedrock.send(new ListFoundationModelsCommand({}));
  const novaInferenceProfileId =
    process.env.NOVA_MODEL_ID ?? DEFAULT_NOVA_INFERENCE_PROFILE_ID;

  if (novaInferenceProfileId === "amazon.nova-2-lite-v1:0") {
    throw new Error(
      "NOVA_MODEL_ID must be an inference profile ID. Use global.amazon.nova-2-lite-v1:0 from Seoul.",
    );
  }

  const novaInferenceProfile = await bedrock.send(
    new GetInferenceProfileCommand({
      inferenceProfileIdentifier: novaInferenceProfileId,
    }),
  );
  const videoModels = (response.modelSummaries ?? []).filter((model) =>
    model.inputModalities?.some((modality) => String(modality) === "VIDEO"),
  );

  if (videoModels.length === 0) {
    throw new Error(`No video-capable Bedrock model is available in ${region}.`);
  }

  console.log("AWS credentials and S3 bucket access verified.");
  console.log(
    `Nova inference profile verified: ${novaInferenceProfile.inferenceProfileId ?? novaInferenceProfileId}`,
  );
  console.log(`Video-capable Bedrock models in ${region}:`);

  for (const model of videoModels) {
    console.log(`- ${model.modelId ?? "unknown"} (${model.modelName ?? "unknown"})`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
