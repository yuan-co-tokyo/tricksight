"use client";
import dynamic from "next/dynamic";
const Diagnostic = dynamic(() => import("./diagnostic-client"), { ssr: false, loading: () => <p>診断画面を準備中…</p> });
export default function DiagnosticLoader({ playbackUrl }: { playbackUrl: string }) {
  return <Diagnostic playbackUrl={playbackUrl} />;
}
