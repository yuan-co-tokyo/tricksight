import "server-only";

import {
  BedrockNovaVideoAnalyzer,
  createBedrockNovaConfigFromEnv,
} from "./providers/bedrock-nova";
import {
  BedrockPegasusVideoAnalyzer,
  createBedrockPegasusConfigFromEnv,
} from "./providers/bedrock-pegasus";
import {
  createTwelveLabsDirectConfigFromEnv,
  TwelveLabsDirectVideoAnalyzer,
} from "./providers/twelvelabs-direct";
import { resolveVideoAnalysisProviderSelection } from "./provider-selection";

type Environment = Readonly<Record<string, string | undefined>>;

export function createVideoAnalysisProvider(
  environment: Environment = process.env,
) {
  const selection = resolveVideoAnalysisProviderSelection(environment);

  if (selection === "bedrock-pegasus") {
    return new BedrockPegasusVideoAnalyzer(
      createBedrockPegasusConfigFromEnv(environment),
    );
  }

  if (selection === "bedrock-nova") {
    return new BedrockNovaVideoAnalyzer(
      createBedrockNovaConfigFromEnv(environment),
    );
  }

  return new TwelveLabsDirectVideoAnalyzer(
    createTwelveLabsDirectConfigFromEnv(environment),
  );
}
