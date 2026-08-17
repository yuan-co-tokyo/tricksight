import { createAnalysisStatusRouteHandler } from "@/lib/analysis/analysis-status-route";
import { getOwnedAnalysisStatus } from "@/lib/analysis/analysis-status";
import { getCurrentUser } from "@/lib/current-user";

export const runtime = "nodejs";

export const GET = createAnalysisStatusRouteHandler({
  resolveCurrentUser: getCurrentUser,
  getOwnedAnalysisStatus,
});
