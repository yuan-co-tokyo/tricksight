"use client";

import { useState } from "react";
import { LoaderCircleIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type DeleteSessionActionProps = {
  sessionId: string;
  sessionLabel: string;
  analysisInProgress: boolean;
};

function deletionErrorMessage(code: unknown) {
  if (code === "ANALYSIS_IN_PROGRESS") {
    return "分析の実行中は削除できません。分析が完了または失敗してから、もう一度お試しください。";
  }

  if (code === "SESSION_NOT_FOUND") {
    return "この練習履歴は見つかりませんでした。すでに削除されている可能性があります。";
  }

  if (code === "UNAUTHENTICATED") {
    return "ログイン状態を確認できませんでした。ページを再読み込みして、もう一度お試しください。";
  }

  return "動画または練習履歴を削除できませんでした。データは削除完了として扱われていません。時間をおいて、もう一度お試しください。";
}

export function DeleteSessionAction({
  sessionId,
  sessionLabel,
  analysisInProgress,
}: DeleteSessionActionProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleDelete() {
    if (pending || analysisInProgress) return;

    setPending(true);
    setErrorMessage(null);

    try {
      const response = await fetch(
        `/api/history/${encodeURIComponent(sessionId)}`,
        {
          method: "DELETE",
          headers: { Accept: "application/json" },
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { code?: unknown };
        } | null;
        setErrorMessage(deletionErrorMessage(body?.error?.code));
        return;
      }

      setOpen(false);
      router.replace("/history?deleted=1");
    } catch {
      setErrorMessage(
        "削除処理に接続できませんでした。通信環境を確認して、もう一度お試しください。",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (pending) return;
          setOpen(nextOpen);
          if (!nextOpen) setErrorMessage(null);
        }}
      >
        <DialogTrigger
          render={
            <Button
              type="button"
              variant="destructive"
              size="lg"
              className="min-h-11 w-full sm:w-auto"
              disabled={analysisInProgress}
            />
          }
        >
          <Trash2Icon aria-hidden="true" />
          練習履歴を削除
        </DialogTrigger>

        <DialogContent showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>この練習履歴を削除しますか？</DialogTitle>
            <DialogDescription className="leading-6">
              「{sessionLabel}」の動画、登録情報、AI分析結果を削除します。この操作は取り消せません。
            </DialogDescription>
          </DialogHeader>

          {errorMessage ? (
            <p
              role="alert"
              className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm leading-6 text-error"
            >
              {errorMessage}
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="min-h-11"
                  disabled={pending}
                />
              }
            >
              キャンセル
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              size="lg"
              className="min-h-11"
              disabled={pending}
              onClick={handleDelete}
            >
              {pending ? (
                <LoaderCircleIcon
                  aria-hidden="true"
                  className="animate-spin"
                />
              ) : (
                <Trash2Icon aria-hidden="true" />
              )}
              {pending ? "削除しています" : "削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {analysisInProgress ? (
        <p className="text-xs leading-5 text-warning">
          分析の実行中は削除できません。完了または失敗してからお試しください。
        </p>
      ) : null}
    </div>
  );
}
