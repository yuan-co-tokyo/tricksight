"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function LogoutButton() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleLogout() {
    if (isSubmitting) return;

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const { error } = await authClient.signOut();

      if (error) {
        setErrorMessage(
          "ログアウトできませんでした。時間をおいて、もう一度お試しください。",
        );
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setErrorMessage(
        "ログアウト処理に接続できませんでした。通信環境を確認して、もう一度お試しください。",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        onClick={handleLogout}
        disabled={isSubmitting}
      >
        {isSubmitting ? "ログアウトしています…" : "ログアウト"}
      </Button>
      {errorMessage ? (
        <p role="alert" aria-live="polite" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
