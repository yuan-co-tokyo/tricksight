"use client";
import { useEffect, useRef } from "react";
import { mountPoseDisplayDiagnostic } from "../../../../lib/diagnostics/pose-display-controller.mjs";

export default function DiagnosticClient({ playbackUrl }: { playbackUrl: string }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!root.current) return;
    return mountPoseDisplayDiagnostic(root.current, playbackUrl);
  }, [playbackUrl]);
  const button = "min-h-11 rounded border px-3 py-2 disabled:opacity-40";
  return <div ref={root} className="space-y-4">
    <p>まず小さいMP4で、①S3から取得、②取得後の別操作で再生・計測開始、③枠と十字の描画を確認します。動画や座標は新しく保存しません。</p>
    <div className="flex flex-wrap gap-2">
      <button data-diagnostic="fetch" className={button}>1. 動画を取得</button>
      <button data-diagnostic="start" className={button} disabled>2. 計測と表示テストを開始</button>
      <button data-diagnostic="stop" className={button}>終了・破棄</button>
    </div>
    <p data-diagnostic="status" role="status">未取得</p>
    <div className="relative h-80 w-full bg-black">
      <video data-diagnostic="video" className="h-full w-full object-contain" controls playsInline muted preload="metadata" />
      <canvas data-diagnostic="overlay" className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
    <p>枠と十字は描画の確認用で、骨格ではありません。全画面・PiPは元動画のみです。</p>
    <p>主要3項目を確認したら元MOV、3回の反復、途中取消、背景移動、回転・全画面、大きい素材の順に試してください。途中で止めても下の診断結果を共有できます。</p>
    <p>取得失敗・期限切れは履歴を再読み込みしてください。背景移動・終了後は手動で再取得します。</p>
    <pre data-diagnostic="report" className="overflow-x-auto whitespace-pre-wrap break-all rounded border p-3">{"{}"}</pre>
    <button data-diagnostic="copy" className={button}>安全な診断JSONをコピー</button>
  </div>;
}
