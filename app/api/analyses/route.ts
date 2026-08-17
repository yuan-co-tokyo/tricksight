import { after } from "next/server";

import { createAnalysisRouteHandler } from "@/lib/analysis/analysis-route";
import { runQueuedAnalysis } from "@/lib/analysis/run-queued-analysis";
import { createQueuedAnalysis } from "@/lib/db/mutations";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = createAnalysisRouteHandler({
  createQueuedAnalysis,
  runQueuedAnalysis,
  scheduleAfter: after,
});
