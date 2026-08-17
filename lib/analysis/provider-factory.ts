import "server-only";

import {
  createTwelveLabsDirectConfigFromEnv,
  TwelveLabsDirectVideoAnalyzer,
} from "./providers/twelvelabs-direct";

export function createVideoAnalysisProvider() {
  return new TwelveLabsDirectVideoAnalyzer(
    createTwelveLabsDirectConfigFromEnv(),
  );
}
