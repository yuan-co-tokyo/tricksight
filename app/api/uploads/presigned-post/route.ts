import { getCurrentUser } from "@/lib/current-user";
import { createPendingUpload } from "@/lib/db/mutations/pending-upload";
import { createVideoPresignedPost } from "@/lib/uploads/presigned-post";
import { createPresignedUploadRouteHandler } from "@/lib/uploads/presigned-upload-route";

export const runtime = "nodejs";

export const POST = createPresignedUploadRouteHandler({
  resolveCurrentUser: getCurrentUser,
  createPendingUpload,
  createVideoPresignedPost,
});
