import { notFound } from "next/navigation";
import { getCurrentUser } from "../../../lib/current-user";
import { diagnosticEnabled } from "../../../lib/diagnostics/pose-display-gate";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function DiagnosticIdentityPage() {
  if (!diagnosticEnabled(process.env)) notFound();
  const user = await getCurrentUser().catch(() => null);
  if (!user) notFound();
  return <main className="mx-auto w-full max-w-xl space-y-4 p-4">
    <h1 className="text-xl font-bold">本人の診断設定用ID</h1>
    <p>ログイン中のあなたのIDです。Vercelの診断対象者設定にだけ使い、チャットや文書へ貼らないでください。</p>
    <p className="select-all break-all rounded border p-3" data-testid="self-id">{user.id}</p>
    <p>この表示だけでは診断へのアクセスは許可されません。設定後はこのタブを閉じてください。</p>
  </main>;
}
