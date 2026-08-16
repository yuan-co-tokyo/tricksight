import {
  MAX_VIDEO_DURATION_SECONDS,
  MAX_VIDEO_FILE_SIZE,
  MIN_VIDEO_DURATION_SECONDS,
  type AllowedVideoContentType,
} from "./video-constraints";

type VideoFileIdentity = {
  name: string;
  size: number;
  type: string;
};

export type VideoFileValidationResult =
  | { success: true; contentType: AllowedVideoContentType }
  | { success: false; message: string };

function extensionOf(filename: string) {
  const lastDot = filename.lastIndexOf(".");
  return lastDot < 0 ? "" : filename.slice(lastDot).toLowerCase();
}

export function validateVideoFileBasics(
  file: VideoFileIdentity,
): VideoFileValidationResult {
  if (file.size <= 0) {
    return {
      success: false,
      message: "空の動画ファイルはアップロードできません。",
    };
  }

  if (file.size > MAX_VIDEO_FILE_SIZE) {
    return {
      success: false,
      message: "動画ファイルは100MB以下にしてください。",
    };
  }

  const extension = extensionOf(file.name);
  const contentTypeByExtension = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
  } as const;
  const expectedContentType =
    contentTypeByExtension[
      extension as keyof typeof contentTypeByExtension
    ];

  if (
    !expectedContentType ||
    (file.type !== "" && file.type !== expectedContentType)
  ) {
    return {
      success: false,
      message: "MP4またはMOV形式の動画を選んでください。",
    };
  }

  return { success: true, contentType: expectedContentType };
}

export function validateVideoDuration(durationSeconds: number) {
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds < MIN_VIDEO_DURATION_SECONDS ||
    durationSeconds > MAX_VIDEO_DURATION_SECONDS
  ) {
    return {
      success: false as const,
      message: `動画の再生時間は${MIN_VIDEO_DURATION_SECONDS}秒以上${MAX_VIDEO_DURATION_SECONDS}秒以下にしてください。`,
    };
  }

  return { success: true as const };
}
