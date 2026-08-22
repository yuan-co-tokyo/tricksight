"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2Icon,
  LoaderCircleIcon,
  SparklesIcon,
  WifiOffIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  startAnalysisStatusPolling,
  type AnalysisStatus,
} from "@/lib/analysis/analysis-client";

const statusPresentation = {
  QUEUED: {
    label: "分析待ち",
    title: "分析の開始を待っています",
    description:
      "順番に処理しています。画面を開いたままお待ちください。",
  },
  ANALYZING: {
    label: "分析中",
    title: "AIが動画を分析しています",
    description:
      "動きとフォームを確認しています。完了後に5項目のスコアと改善点が表示されます。",
  },
  COMPLETED: {
    label: "分析完了",
    title: "分析結果を読み込んでいます",
    description: "結果画面へ自動で更新します。",
  },
  FAILED: {
    label: "分析失敗",
    title: "分析状態を更新しています",
    description: "最新の案内へ自動で更新します。",
  },
} satisfies Record<
  AnalysisStatus,
  { label: string; title: string; description: string }
>;

export function AnalysisProgress({
  analysisId,
  initialStatus,
}: {
  analysisId: string;
  initialStatus: Extract<AnalysisStatus, "QUEUED" | "ANALYZING">;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<AnalysisStatus>(initialStatus);
  const [pollingFailed, setPollingFailed] = useState(false);
  const presentation = statusPresentation[status];

  useEffect(() => {
    return startAnalysisStatusPolling({
      analysisId,
      onStatus: (result) => {
        setStatus(result.status);
        setPollingFailed(false);
      },
      onTerminal: () => {
        router.refresh();
      },
      onError: () => {
        setPollingFailed(true);
      },
    });
  }, [analysisId, router]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="overflow-hidden rounded-xl border border-primary/30 bg-primary/5"
    >
      <ol className="grid gap-1 p-4 sm:p-5" aria-label="分析の進捗">
        <li className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success/15 text-success">
            <CheckCircle2Icon aria-hidden="true" className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">
              動画アップロード完了
            </span>
            <span className="block text-xs leading-5 text-muted-foreground">
              分析できる状態になりました
            </span>
          </span>
        </li>

        <li className="flex min-w-0 items-center gap-3 rounded-lg bg-primary/10 px-2 py-3">
          <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
            <SparklesIcon aria-hidden="true" className="size-4" />
            <LoaderCircleIcon
              aria-hidden="true"
              className="absolute size-9 animate-spin motion-reduce:animate-none"
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                AI分析中
              </span>
              <Badge
                variant="outline"
                className="border-primary/30 bg-primary/10 text-primary"
              >
                {presentation.label}
              </Badge>
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              {presentation.title}
            </span>
          </span>
        </li>
      </ol>

      <div className="border-t border-primary/20 px-4 py-4 sm:px-5">
        <p className="text-sm leading-6 text-muted-foreground">
          {presentation.description}
        </p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          この画面は約3秒ごとに確認し、完了すると自動で結果を表示します。
        </p>
        {pollingFailed ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
            <WifiOffIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            状態を取得できませんでした。通信を確認しながら自動で再試行しています。
          </p>
        ) : null}
      </div>
    </div>
  );
}
