// 期限は再生開始時ではなくServer Componentのページ描画時から進む。
// 分析結果を読んでから再生・見返し・Range要求を行う時間を確保するため15分にする。
export const VIDEO_PLAYBACK_URL_EXPIRES_IN_SECONDS = 15 * 60;

export type PlaybackVideoStatus =
  | "PENDING_UPLOAD"
  | "UPLOADED"
  | "READY"
  | "FAILED";

export type OwnedSessionForPlayback = {
  video: {
    s3Key: string;
    status: PlaybackVideoStatus;
  } | null;
};

type SignPlaybackUrl = (input: {
  s3Key: string;
  expiresInSeconds: number;
}) => Promise<string>;

export function isPlayableVideoStatus(
  status: PlaybackVideoStatus,
): status is "UPLOADED" | "READY" {
  return status === "UPLOADED" || status === "READY";
}

export function createOwnedVideoPlaybackUrlCreator(dependencies: {
  signPlaybackUrl: SignPlaybackUrl;
  expiresInSeconds?: number;
}) {
  const expiresInSeconds =
    dependencies.expiresInSeconds ?? VIDEO_PLAYBACK_URL_EXPIRES_IN_SECONDS;

  return async function createOwnedVideoPlaybackUrl(
    ownedSession: OwnedSessionForPlayback | null,
  ) {
    const video = ownedSession?.video;

    // 所有者スコープの詳細取得がnullなら、S3署名処理へ到達させない。
    if (!video || !isPlayableVideoStatus(video.status)) return null;

    return dependencies.signPlaybackUrl({
      s3Key: video.s3Key,
      expiresInSeconds,
    });
  };
}
