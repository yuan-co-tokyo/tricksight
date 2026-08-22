"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type FormEvent,
  type SyntheticEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CheckCircle2Icon,
  FileVideoIcon,
  InfoIcon,
  TriangleAlertIcon,
  UploadCloudIcon,
  UserRoundCogIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Progress,
  ProgressLabel,
} from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  AnalysisRequestError,
  formatAnalysisResetAt,
  requestAnalysisStart,
  type AnalysisRequestErrorDetail,
} from "@/lib/analysis/analysis-client";
import {
  DirectUploadError,
  uploadVideoDirectlyToS3,
} from "@/lib/uploads/browser-direct-upload";
import {
  validateVideoDuration,
  validateVideoFileBasics,
} from "@/lib/uploads/client-video-validation";
import type { AllowedVideoContentType } from "@/lib/uploads/video-constraints";
import { cn } from "@/lib/utils";

type TrickOption = {
  id: string;
  name: string;
  description: string | null;
};

type SelectedVideo = {
  file: File;
  contentType: AllowedVideoContentType;
  previewUrl: string;
  durationSeconds: number | null;
};

type UploadStatus =
  | "idle"
  | "preparing"
  | "uploading"
  | "verifying"
  | "starting-analysis"
  | "success"
  | "analysis-error"
  | "error";

type PresignedUploadResponse = {
  url: string;
  fields: Record<string, string>;
  sessionId: string;
  videoId: string;
};

type UploadCompletionResponse = {
  status: "UPLOADED" | "READY";
  idempotent: boolean;
};

class UploadPreparationError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("The upload could not be prepared.");
    this.name = "UploadPreparationError";
    this.status = status;
  }
}

class UploadCompletionRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("The uploaded object could not be verified.");
    this.name = "UploadCompletionRequestError";
    this.status = status;
  }
}

const fieldClassName =
  "h-10 w-full rounded-lg border border-input bg-input/30 px-3 text-base text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm";

const fallbackAnalysisStartError: AnalysisRequestErrorDetail = {
  code: "ANALYSIS_UNAVAILABLE",
  message:
    "現在、分析を利用できません。時間をおいてからもう一度お試しください。",
  action: "TRY_LATER",
};

function isPresignedUploadResponse(
  value: unknown,
): value is PresignedUploadResponse {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<PresignedUploadResponse>;

  return (
    typeof candidate.url === "string" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.videoId === "string" &&
    Boolean(candidate.fields) &&
    typeof candidate.fields === "object" &&
    Object.values(candidate.fields).every((field) => typeof field === "string")
  );
}

async function requestPresignedUpload(input: unknown) {
  const response = await fetch("/api/uploads/presigned-post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new UploadPreparationError(response.status);
  }

  const body: unknown = await response.json();

  if (!isPresignedUploadResponse(body)) {
    throw new UploadPreparationError(502);
  }

  return body;
}

function isUploadCompletionResponse(
  value: unknown,
): value is UploadCompletionResponse {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<UploadCompletionResponse>;

  return (
    (candidate.status === "UPLOADED" || candidate.status === "READY") &&
    typeof candidate.idempotent === "boolean"
  );
}

async function notifyUploadComplete(input: {
  sessionId: string;
  videoId: string;
}) {
  const response = await fetch("/api/uploads/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new UploadCompletionRequestError(response.status);
  }

  const body: unknown = await response.json();

  if (!isUploadCompletionResponse(body)) {
    throw new UploadCompletionRequestError(502);
  }

  return body;
}

function formatMegabytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function uploadErrorMessage(error: unknown) {
  if (error instanceof UploadPreparationError) {
    if (error.status === 401) {
      return "セッションの有効期限が切れました。もう一度ログインしてください。";
    }

    if (error.status === 400) {
      return "入力内容を確認してください。選択した動画や練習日を再確認してください。";
    }

    return "アップロードの準備に失敗しました。時間をおいて、もう一度お試しください。";
  }

  if (error instanceof UploadCompletionRequestError) {
    if (error.status === 401) {
      return "セッションの有効期限が切れました。もう一度ログインしてください。";
    }

    if (error.status === 404) {
      return "アップロード情報を確認できませんでした。動画を選び直してください。";
    }

    if (error.status === 409) {
      return "このアップロードは完了状態へ進められません。動画を選び直してください。";
    }

    if (error.status === 422) {
      return "S3上の動画を検証できませんでした。動画の内容を確認して、選び直してください。";
    }

    return "アップロード後の確認に失敗しました。時間をおいて、もう一度お試しください。";
  }

  if (error instanceof DirectUploadError) {
    if (error.status === 403) {
      return "動画が発行済みのアップロード条件に一致しないため、S3に拒否されました。";
    }

    return "S3へのアップロードに接続できませんでした。通信環境を確認してください。";
  }

  return "動画をアップロードできませんでした。時間をおいて、もう一度お試しください。";
}

function analysisStartErrorDetail(error: unknown) {
  return error instanceof AnalysisRequestError
    ? error.detail
    : fallbackAnalysisStartError;
}

function analysisStartErrorMessage(detail: AnalysisRequestErrorDetail) {
  if (
    detail.code !== "ANALYSIS_DAILY_LIMIT_REACHED" ||
    !detail.resetAt
  ) {
    return detail.message;
  }

  const resetAt = formatAnalysisResetAt(detail.resetAt);
  if (!resetAt) return detail.message;

  return `${detail.message} ${resetAt}以降に再開できます。`;
}

export function VideoUploadForm({
  tricks,
  defaultPracticeDate,
}: {
  tricks: TrickOption[];
  defaultPracticeDate: string;
}) {
  const router = useRouter();
  const [trickId, setTrickId] = useState(tricks[0]?.id ?? "");
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(
    null,
  );
  const [videoError, setVideoError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [analysisError, setAnalysisError] =
    useState<AnalysisRequestErrorDetail | null>(null);
  const [uploadedSessionId, setUploadedSessionId] = useState<string | null>(
    null,
  );
  const selectedTrick = useMemo(
    () => tricks.find((trick) => trick.id === trickId) ?? null,
    [trickId, tricks],
  );
  const isBusy =
    uploadStatus === "preparing" ||
    uploadStatus === "uploading" ||
    uploadStatus === "verifying" ||
    uploadStatus === "starting-analysis";
  const hasCompletedUpload =
    uploadStatus === "starting-analysis" ||
    uploadStatus === "success" ||
    uploadStatus === "analysis-error";
  const isReadyToSubmit =
    selectedVideo?.durationSeconds !== null &&
    selectedVideo !== null &&
    !videoError &&
    trickId !== "" &&
    !isBusy &&
    !hasCompletedUpload;

  useEffect(() => {
    const previewUrl = selectedVideo?.previewUrl;

    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [selectedVideo?.previewUrl]);

  function resetSubmissionState() {
    setUploadStatus("idle");
    setUploadProgress(0);
    setFeedback(null);
    setAnalysisError(null);
    setUploadedSessionId(null);
  }

  function handleVideoChange(event: ChangeEvent<HTMLInputElement>) {
    resetSubmissionState();
    setVideoError(null);

    const files = event.currentTarget.files;
    if (!files || files.length === 0) {
      setSelectedVideo(null);
      return;
    }

    if (files.length !== 1) {
      setSelectedVideo(null);
      setVideoError("動画は1回につき1本だけ選んでください。");
      event.currentTarget.value = "";
      return;
    }

    const file = files[0];
    const validation = validateVideoFileBasics(file);

    if (!validation.success) {
      setSelectedVideo(null);
      setVideoError(validation.message);
      event.currentTarget.value = "";
      return;
    }

    setSelectedVideo({
      file,
      contentType: validation.contentType,
      previewUrl: URL.createObjectURL(file),
      durationSeconds: null,
    });
  }

  function handleMetadataLoaded(event: SyntheticEvent<HTMLVideoElement>) {
    const durationSeconds = event.currentTarget.duration;
    const validation = validateVideoDuration(durationSeconds);

    setSelectedVideo((current) =>
      current ? { ...current, durationSeconds } : current,
    );
    setVideoError(validation.success ? null : validation.message);
  }

  function handleMetadataError() {
    setVideoError(
      "動画の再生時間を取得できませんでした。別のMP4またはMOVを選んでください。",
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isReadyToSubmit || !selectedVideo) return;

    const formData = new FormData(event.currentTarget);
    const practicedAt = String(formData.get("practicedAt") ?? "");
    const payload = {
      trickId,
      practicedAt: `${practicedAt}T00:00:00+09:00`,
      cameraAngle: String(formData.get("cameraAngle") ?? ""),
      userOutcome: String(formData.get("userOutcome") ?? ""),
      memo: String(formData.get("memo") ?? ""),
      video: {
        originalFilename: selectedVideo.file.name,
        contentType: selectedVideo.contentType,
        fileSize: selectedVideo.file.size,
      },
    };

    setFeedback(null);
    setAnalysisError(null);
    setUploadedSessionId(null);
    setUploadProgress(0);
    setUploadStatus("preparing");

    try {
      const presignedUpload = await requestPresignedUpload(payload);
      setUploadStatus("uploading");

      await uploadVideoDirectlyToS3({
        url: presignedUpload.url,
        fields: presignedUpload.fields,
        file: selectedVideo.file,
        onProgress: setUploadProgress,
      });

      setUploadStatus("verifying");
      await notifyUploadComplete({
        sessionId: presignedUpload.sessionId,
        videoId: presignedUpload.videoId,
      });

      setUploadedSessionId(presignedUpload.sessionId);
      setUploadProgress(100);
      setUploadStatus("starting-analysis");

      try {
        await requestAnalysisStart(presignedUpload.videoId);
        setUploadStatus("success");
        setFeedback(
          "アップロードが完了し、AI分析を開始しました。分析中の画面へ移動します。",
        );
        router.push(`/history/${encodeURIComponent(presignedUpload.sessionId)}`);
      } catch (error) {
        const detail = analysisStartErrorDetail(error);
        setAnalysisError(detail);
        setUploadStatus("analysis-error");
        setFeedback(analysisStartErrorMessage(detail));
      }
    } catch (error) {
      setUploadStatus("error");
      setFeedback(uploadErrorMessage(error));
    }
  }

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          新しい動画を分析する
        </h1>
        <p className="text-muted-foreground">
          練習情報と動画を登録し、AI分析の準備を始めます。
        </p>
      </header>

      <aside className="rounded-xl border border-warning/40 bg-warning/10 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-warning/15 text-warning">
            <TriangleAlertIcon aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0 space-y-2">
            <h2 className="font-semibold text-warning">
              スローモーション動画が必要です
            </h2>
            <p className="text-sm leading-6 text-foreground">
              通常速度の撮影では板の回転が十分なフレームに映らず、分析が成立しません。スロー再生された状態で書き出した、3〜20秒の動画を選んでください。
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              重要なのはfpsの数値ではなく、ファイルを再生したときの長さです。高fpsで撮っただけの通常速度動画ではなく、スロー再生として書き出したファイルを用意してください。
            </p>
          </div>
        </div>
      </aside>

      <Card>
        <CardHeader>
          <CardTitle>練習動画の登録</CardTitle>
          <CardDescription>
            動画はNext.jsサーバーを経由せず、ブラウザからS3へ直接アップロードされます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-8"
            onSubmit={handleSubmit}
            aria-busy={isBusy}
          >
            <fieldset className="grid gap-5" disabled={isBusy || hasCompletedUpload}>
              <legend className="mb-4 text-base font-semibold">練習情報</legend>

              <div className="grid gap-2">
                <Label htmlFor="trickId">トリック</Label>
                <select
                  id="trickId"
                  name="trickId"
                  value={trickId}
                  onChange={(event) => setTrickId(event.target.value)}
                  className={fieldClassName}
                  required
                >
                  {tricks.map((trick) => (
                    <option key={trick.id} value={trick.id}>
                      {trick.name}
                    </option>
                  ))}
                </select>
                {selectedTrick?.description ? (
                  <p className="text-xs leading-5 text-muted-foreground">
                    {selectedTrick.description}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="cameraAngle">撮影方向</Label>
                  <select
                    id="cameraAngle"
                    name="cameraAngle"
                    defaultValue=""
                    className={fieldClassName}
                    required
                  >
                    <option value="" disabled>
                      選択してください
                    </option>
                    <option value="SIDE">横（SIDE）</option>
                    <option value="FRONT">正面（FRONT）</option>
                    <option value="REAR">後方（REAR）</option>
                    <option value="DIAGONAL">斜め（DIAGONAL）</option>
                  </select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="userOutcome">自己申告</Label>
                  <select
                    id="userOutcome"
                    name="userOutcome"
                    defaultValue=""
                    className={fieldClassName}
                    required
                  >
                    <option value="" disabled>
                      選択してください
                    </option>
                    <option value="LANDED">成功（LANDED）</option>
                    <option value="BAILED">失敗（BAILED）</option>
                    <option value="UNCLEAR">不明（UNCLEAR）</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="practicedAt">練習日</Label>
                  <Input
                    id="practicedAt"
                    name="practicedAt"
                    type="date"
                    defaultValue={defaultPracticeDate}
                    max={defaultPracticeDate}
                    className="h-10"
                    required
                  />
                </div>

                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="memo">メモ（任意）</Label>
                  <Textarea
                    id="memo"
                    name="memo"
                    maxLength={2_000}
                    placeholder="練習で意識したこと、うまくいかなかった点など"
                    className="min-h-24"
                  />
                </div>
              </div>
            </fieldset>

            <fieldset className="grid min-w-0 gap-4" disabled={isBusy || hasCompletedUpload}>
              <legend className="mb-4 text-base font-semibold">動画</legend>
              <div className="grid gap-2">
                <Label htmlFor="video">動画ファイル</Label>
                <Input
                  id="video"
                  name="video"
                  type="file"
                  accept="video/mp4,video/quicktime,.mp4,.mov"
                  onChange={handleVideoChange}
                  aria-describedby="video-requirements"
                  aria-invalid={Boolean(videoError)}
                  className="h-auto min-h-11 py-2"
                  required
                />
                <p
                  id="video-requirements"
                  className="text-xs leading-5 text-muted-foreground"
                >
                  MP4またはMOV、再生時間3〜20秒、100MB以下。1回につき1本です。
                </p>
              </div>

              {videoError ? (
                <p
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {videoError}
                </p>
              ) : null}

              {selectedVideo ? (
                <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-background">
                  <video
                    src={selectedVideo.previewUrl}
                    controls
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={handleMetadataLoaded}
                    onError={handleMetadataError}
                    className="aspect-video max-h-[28rem] w-full bg-black object-contain"
                    aria-label="選択した練習動画のプレビュー"
                  />
                  <div className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileVideoIcon
                        aria-hidden="true"
                        className="size-4 shrink-0 text-primary"
                      />
                      <span
                        title={selectedVideo.file.name}
                        className="truncate text-sm font-medium"
                      >
                        {selectedVideo.file.name}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">
                        {formatMegabytes(selectedVideo.file.size)}
                      </Badge>
                      <Badge variant="outline">
                        {selectedVideo.durationSeconds === null
                          ? "長さを確認中"
                          : `${selectedVideo.durationSeconds.toFixed(1)}秒`}
                      </Badge>
                    </div>
                  </div>
                </div>
              ) : null}
            </fieldset>

            {/* クライアント検証は利用者向けの早期フィードバックであり、セキュリティ境界ではない。実際の強制はS3 Presigned POSTポリシーが担う。 */}
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
              <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <p>
                ファイル形式・サイズ・再生時間は送信前に確認します。アップロード時にはS3側でも、発行済みのキー・Content-Type・100MB上限が強制されます。
              </p>
            </div>

            {uploadStatus === "preparing" ||
            uploadStatus === "uploading" ||
            uploadStatus === "verifying" ||
            uploadStatus === "starting-analysis" ||
            uploadStatus === "analysis-error" ||
            uploadStatus === "success" ? (
              <Progress value={uploadProgress} aria-label="アップロード進捗">
                <ProgressLabel>
                  {uploadStatus === "preparing"
                    ? "アップロードを準備しています"
                    : uploadStatus === "verifying"
                      ? "S3上の動画を確認しています"
                    : hasCompletedUpload
                      ? "アップロード完了"
                      : "S3へアップロードしています"}
                </ProgressLabel>
                <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                  {uploadProgress}%
                </span>
              </Progress>
            ) : null}

            {feedback ? (
              <p
                role={
                  uploadStatus === "error" || uploadStatus === "analysis-error"
                    ? "alert"
                    : "status"
                }
                aria-live="polite"
                className={
                  uploadStatus === "error" || uploadStatus === "analysis-error"
                    ? "rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    : "flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"
                }
              >
                {uploadStatus === "success" ? (
                  <CheckCircle2Icon
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0"
                  />
                ) : null}
                <span>{feedback}</span>
              </p>
            ) : null}

            {analysisError && uploadedSessionId ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {analysisError.action === "SET_STANCE" ? (
                  <Link
                    href="/profile"
                    className={cn(
                      buttonVariants({ variant: "default", size: "lg" }),
                      "h-11 w-full",
                    )}
                  >
                    <UserRoundCogIcon aria-hidden="true" />
                    プロフィールでスタンスを設定
                  </Link>
                ) : null}
                <Link
                  href={`/history/${encodeURIComponent(uploadedSessionId)}`}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "lg" }),
                    "h-11 w-full",
                    analysisError.action !== "SET_STANCE" && "sm:col-span-2",
                  )}
                >
                  アップロード済み動画を確認
                </Link>
              </div>
            ) : null}

            <Button
              type="submit"
              size="lg"
              className="h-11 w-full"
              disabled={!isReadyToSubmit}
            >
              <UploadCloudIcon aria-hidden="true" />
              {uploadStatus === "preparing"
                ? "準備しています…"
                : uploadStatus === "uploading"
                  ? `アップロード中 ${uploadProgress}%`
                  : uploadStatus === "verifying"
                    ? "動画を確認しています…"
                  : uploadStatus === "starting-analysis"
                    ? "AI分析を受け付けています…"
                  : uploadStatus === "success"
                    ? "分析中の画面へ移動します…"
                    : uploadStatus === "analysis-error"
                      ? "分析を開始できませんでした"
                    : "S3へ動画をアップロード"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
