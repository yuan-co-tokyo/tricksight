import { VideoIcon } from "lucide-react";
import { isPlayableVideoStatus, type PlaybackVideoStatus } from "../../../../lib/uploads/video-playback-url-core";
import { canUsePoseViewer, type SavedPoseStatus, type ViewerEnvironment } from "../../../../lib/pose/player/policy";
import PoseVideoPlayer from "./pose-video-player";
type Video = { id: string; originalFilename: string; status: string } | null;
export function HistoryVideoPlayback(props: { video: Video; playbackUrl: string | null; playbackUrlFailed: boolean; savedStatus: SavedPoseStatus; userId: string; env: ViewerEnvironment }) {
  const { video, playbackUrl, savedStatus } = props;
  if (video && playbackUrl && isPlayableVideoStatus(video.status as PlaybackVideoStatus) && canUsePoseViewer(props.env, props.userId)) {
    return <PoseVideoPlayer key={video.id} playbackUrl={playbackUrl} filename={video.originalFilename} savedStatus={savedStatus} />;
  }
  return <VideoPlayback video={video} playbackUrl={playbackUrl} playbackUrlFailed={props.playbackUrlFailed} />;
}
// Preserve the pre-feature server markup for OFF/excluded/unavailable users.
function VideoPlayback({
  video,
  playbackUrl,
  playbackUrlFailed,
}: {
  video: Video;
  playbackUrl: string | null;
  playbackUrlFailed: boolean;
}) {
  if (playbackUrl && video) {
    return (
      <>
        <div className="flex max-h-[70svh] min-h-40 items-center justify-center overflow-hidden rounded-lg border border-border bg-black">
          <video
            src={playbackUrl}
            controls
            playsInline
            preload="metadata"
            aria-label={`${video.originalFilename} の再生`}
            className="max-h-[70svh] w-full object-contain"
          />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          再生URLはページを表示するたびに短時間だけ発行されます。期限切れの場合はページを再読み込みしてください。
        </p>
      </>
    );
  }

  let title = "この練習に動画はありません";
  let description = "動画が登録されると、ここで再生できます。";

  if (video && !isPlayableVideoStatus(video.status as PlaybackVideoStatus)) {
    title =
      video.status === "PENDING_UPLOAD"
        ? "動画のアップロードを確認中です"
        : "この動画は再生できません";
    description =
      video.status === "PENDING_UPLOAD"
        ? "アップロードの確認が完了すると再生できるようになります。"
        : "動画のアップロードに失敗したため、再生URLを発行していません。";
  } else if (playbackUrlFailed) {
    title = "動画を読み込めませんでした";
    description =
      "再生URLを発行できませんでした。時間をおいてページを再読み込みしてください。";
  }

  return (
    <div className="grid min-h-40 place-items-center overflow-hidden rounded-lg border border-border bg-muted text-center text-muted-foreground sm:min-h-56">
      <span className="grid max-w-xs justify-items-center gap-2 px-4 text-sm">
        <VideoIcon aria-hidden="true" className="size-8" />
        <span className="font-medium text-foreground">{title}</span>
        <span className="text-xs leading-5">{description}</span>
      </span>
    </div>
  );
}

