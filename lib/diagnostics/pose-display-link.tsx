import Link from "next/link";
import { canUsePoseDisplayDiagnostic, type DiagnosticEnvironment } from "./pose-display-gate";

export function PoseDisplayDiagnosticLink({ env, userId, sessionId }: {
  env: DiagnosticEnvironment; userId: string; sessionId: string;
}) {
  if (!canUsePoseDisplayDiagnostic(env, userId)) return null;
  return <Link prefetch={false} className="inline-flex min-h-11 items-center underline" href={`/diagnostics/pose-display/${sessionId}`}>表示診断</Link>;
}
