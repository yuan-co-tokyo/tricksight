"use client";

import { useEffect, useRef } from "react";
import { mountPosePlayer } from "../../../../lib/pose/player/controller";
import { viewerOffer, viewerMessages, type SavedPoseStatus } from "../../../../lib/pose/player/policy";

const buttonClass = "min-h-11 max-w-full rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring";
export default function PoseVideoPlayer({ playbackUrl, filename, savedStatus }: {
  playbackUrl: string; filename: string; savedStatus: SavedPoseStatus;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => root.current ? mountPosePlayer(root.current, playbackUrl) : undefined, [playbackUrl]);
  return <div ref={root} className="min-w-0 space-y-3" data-pose-player>
    <div className="relative flex max-h-[70svh] min-h-40 items-center justify-center overflow-hidden rounded-lg border border-border bg-black" data-pose="surface">
      <video data-pose="video" src={playbackUrl} controls playsInline preload="metadata" aria-label={`${filename} の再生`} className="max-h-[70svh] w-full object-contain" />
      <span data-pose="badge" hidden className="pointer-events-none absolute top-2 left-2 rounded bg-black/70 px-2 py-1 text-xs text-white">参考表示</span>
    </div>
    <p className="text-xs leading-5 text-muted-foreground">再生URLはページを表示するたびに短時間だけ発行されます。期限切れの場合はページを再読み込みしてください。</p>
    <div className="min-w-0 space-y-3 rounded-lg border border-border p-3 text-sm">
      <p className="font-medium">骨格と現在の数値</p>
      <p>動きの参考表示です。成功・失敗や成績を表す数値ではありません。</p>
      <p className="text-xs leading-5 text-muted-foreground">この端末で今回表示用に計測します。下のフォーム計測カードは登録時に保存した集約結果です。今回の値で保存結果は変わりません。</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-pose="fetch" className={buttonClass}>{viewerOffer(true, savedStatus).label}</button>
        <button type="button" data-pose="start" hidden className={buttonClass}>計測を開始</button>
        <button type="button" data-pose="toggle" hidden className={buttonClass}>骨格を隠す</button>
        <button type="button" data-pose="stop" hidden className={buttonClass}>表示を終了</button>
      </div>
      <p data-pose="status" role="status" aria-live="polite">{viewerMessages.OFF}</p>
      <progress data-pose="progress" hidden className="w-full" aria-label="表示の準備" />
      <div data-pose="values" hidden className="space-y-2">
        <p data-pose="times" className="text-xs tabular-nums">再生 — / 計測 —</p>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div><dt>現在の左右膝平均角</dt><dd data-pose="knee" className="text-lg tabular-nums">—</dd></div>
          <div><dt>現在の腰相対高さ</dt><dd data-pose="hip" className="text-lg tabular-nums">—</dd></div>
        </dl>
        <p data-pose="detection" className="text-xs leading-5" />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-pose="back" className={buttonClass} aria-label="0.1秒前へ">−0.1秒</button>
        <button type="button" data-pose="forward" className={buttonClass} aria-label="0.1秒先へ">＋0.1秒</button>
        <label className="flex min-h-11 items-center gap-2">再生速度<select data-pose="speed" defaultValue="1" className="min-h-11 rounded border border-border bg-background px-2"><option value="0.5">0.5倍</option><option value="1">1倍</option><option value="1.5">1.5倍</option></select></label>
      </div>
      <p className="text-xs text-muted-foreground">全画面・ピクチャーインピクチャーでは元動画のみを表示します。</p>
      <details className="text-xs leading-5 text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3">表示について</summary><p>約0.1秒ごとの推定を重ねています。間の映像では直前の計測を表示します。腰の高さは相対値で、跳躍高や接地を実測したものではありません。計測環境の違いで登録時と値が変わることがあります。骨格を隠しても再表示できます。表示の終了や別の画面への移動で今回の計測を破棄し、再開時には計測し直します。</p></details>
    </div>
  </div>;
}
