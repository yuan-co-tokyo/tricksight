export const MAX_VIDEO_FILE_SIZE = 100 * 1024 * 1024;
export const MIN_VIDEO_DURATION_SECONDS = 3;
export const MAX_VIDEO_DURATION_SECONDS = 20;

export const allowedVideoContentTypes = [
  "video/mp4",
  "video/quicktime",
] as const;

export type AllowedVideoContentType =
  (typeof allowedVideoContentTypes)[number];
