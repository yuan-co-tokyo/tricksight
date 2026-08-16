import Link from "next/link";
import { SearchXIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

export default function HistoryDetailNotFound() {
  return (
    <Card>
      <CardContent className="grid min-h-72 place-items-center py-10 text-center">
        <div className="max-w-md space-y-5">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <SearchXIcon aria-hidden="true" className="size-5" />
          </span>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">
              練習履歴が見つかりません
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              URLを確認するか、履歴一覧へ戻ってください。
            </p>
          </div>
          <Link
            href="/history"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            履歴一覧へ戻る
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
