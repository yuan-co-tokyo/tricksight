import { getCurrentUser } from "@/lib/current-user";
import { deletePracticeSession } from "@/lib/db/mutations";
import { createSessionDeletionRouteHandler } from "@/lib/session-deletion/session-deletion-route";

export const runtime = "nodejs";

export const DELETE = createSessionDeletionRouteHandler({
  resolveCurrentUser: getCurrentUser,
  deleteSession: deletePracticeSession,
});
