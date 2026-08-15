import { TwelveLabs } from "twelvelabs-js";

function requiredEnvironment(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set. Add it to .env.local.`);
  }

  return value;
}

async function main() {
  const apiKey = requiredEnvironment("TWELVELABS_API_KEY");
  const modelName = process.env.TWELVELABS_MODEL_NAME ?? "pegasus1.5";

  if (modelName !== "pegasus1.5") {
    throw new Error(
      `TWELVELABS_MODEL_NAME must be pegasus1.5 for this evaluation (received ${modelName}).`,
    );
  }

  const client = new TwelveLabs({ apiKey });
  await client.assets.list(
    { page: 1, pageLimit: 1 },
    { maxRetries: 1, timeoutInSeconds: 30 },
  );

  console.log("TwelveLabs API key verified.");
  console.log(`Evaluation model: ${modelName}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
});
