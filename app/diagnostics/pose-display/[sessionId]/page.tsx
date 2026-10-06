import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "../../../../lib/current-user";
import { getPracticeSessionDetail } from "../../../../lib/db/queries";
import { createOwnedVideoPlaybackUrl } from "../../../../lib/uploads/video-playback-url";
import { resolvePoseDisplayDiagnostic } from "../../../../lib/diagnostics/pose-display-gate";
import DiagnosticLoader from "./diagnostic-loader";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function PoseDisplayDiagnosticPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const result = await resolvePoseDisplayDiagnostic({
    env: process.env, sessionId, getUser: getCurrentUser,
    getSession: getPracticeSessionDetail, sign: createOwnedVideoPlaybackUrl,
  });
  if (result.kind === "denied") notFound();
  return <main className="mx-auto w-full max-w-3xl space-y-4 p-4">
    <Link prefetch={false} href={`/history/${sessionId}`} className="underline">履歴に戻る</Link>
    <h1 className="text-xl font-bold">動画表示の診断</h1>
    {result.kind === "ready" ? <DiagnosticLoader playbackUrl={result.playbackUrl} /> :
      <p>動画を準備できませんでした。履歴を再読み込みして試してください。</p>}
  </main>;
}
