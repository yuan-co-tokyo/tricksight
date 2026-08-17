import { getCurrentUser } from "@/lib/current-user";
import { completeVideoUpload } from "@/lib/db/mutations";
import { createCompleteUploadRouteHandler } from "@/lib/uploads/complete-upload-route";

export const runtime = "nodejs";

export const POST = createCompleteUploadRouteHandler({
  resolveCurrentUser: getCurrentUser,
  completeUpload: completeVideoUpload,
});
