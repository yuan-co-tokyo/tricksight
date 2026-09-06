export type VideoAnalysisProviderSelection =
  | "twelvelabs-direct"
  | "bedrock-pegasus"
  | "bedrock-nova";

type Environment = Readonly<Record<string, string | undefined>>;

export function resolveVideoAnalysisProviderSelection(
  environment: Environment = process.env,
): VideoAnalysisProviderSelection {
  const selection =
    environment.VIDEO_ANALYSIS_PROVIDER?.trim() || "twelvelabs-direct";

  if (
    selection !== "twelvelabs-direct" &&
    selection !== "bedrock-pegasus" &&
    selection !== "bedrock-nova"
  ) {
    throw new Error(`VIDEO_ANALYSIS_PROVIDER is invalid: ${selection}`);
  }

  return selection;
}
