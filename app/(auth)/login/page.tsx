"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error";

export default function LoginPage() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const { error } = await authClient.signIn.email({ email, password });

      if (error) {
        setErrorMessage(authErrorMessage(error, "sign-in"));
        return;
      }

      // TODO(T4-5): ダッシュボード実装後は遷移先をダッシュボードへ変更する。
      router.replace("/");
      router.refresh();
    } catch {
      setErrorMessage(
        "ログイン処理に接続できませんでした。通信環境を確認して、もう一度お試しください。",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="text-sm font-semibold tracking-wide text-muted-foreground">
            tricksight
          </p>
          <CardTitle>
            <h1 className="text-2xl font-semibold tracking-tight">ログイン</h1>
          </CardTitle>
          <CardDescription>
            アカウントにログインして練習記録を確認します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-5"
            onSubmit={handleSubmit}
            aria-busy={isSubmitting}
          >
            <div className="grid gap-2">
              <Label htmlFor="email">メールアドレス</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={isSubmitting}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">パスワード</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                minLength={8}
                maxLength={128}
                required
                disabled={isSubmitting}
              />
            </div>

            {errorMessage ? (
              <p
                role="alert"
                aria-live="polite"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {errorMessage}
              </p>
            ) : null}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? "ログインしています…" : "ログイン"}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center text-sm text-muted-foreground">
          アカウントをお持ちでないですか？
          <Button
            variant="link"
            className="px-1"
            nativeButton={false}
            render={<Link href="/register" />}
          >
            新規登録
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
