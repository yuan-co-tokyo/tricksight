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

export default function RegisterPage() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const passwordConfirmation = String(
      formData.get("passwordConfirmation") ?? "",
    );

    if (!name) {
      setErrorMessage("表示名を入力してください。");
      return;
    }
    if (password.length < 8) {
      setErrorMessage("パスワードは8文字以上で入力してください。");
      return;
    }
    if (password !== passwordConfirmation) {
      setErrorMessage("パスワードが一致しません。もう一度確認してください。");
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const { error } = await authClient.signUp.email({
        email,
        password,
        name,
      });

      if (error) {
        setErrorMessage(authErrorMessage(error, "sign-up"));
        return;
      }

      // TODO(T4-5): ダッシュボード実装後は遷移先をダッシュボードへ変更する。
      router.replace("/");
      router.refresh();
    } catch {
      setErrorMessage(
        "登録処理に接続できませんでした。通信環境を確認して、もう一度お試しください。",
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
            <h1 className="text-2xl font-semibold tracking-tight">新規登録</h1>
          </CardTitle>
          <CardDescription>
            練習動画の分析と上達の記録を始めましょう。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-5"
            onSubmit={handleSubmit}
            aria-busy={isSubmitting}
          >
            <div className="grid gap-2">
              <Label htmlFor="name">表示名</Label>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                maxLength={100}
                required
                disabled={isSubmitting}
              />
            </div>
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
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                disabled={isSubmitting}
                aria-describedby="password-hint"
              />
              <p id="password-hint" className="text-xs text-muted-foreground">
                8文字以上で入力してください。
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="passwordConfirmation">パスワード（確認）</Label>
              <Input
                id="passwordConfirmation"
                name="passwordConfirmation"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                disabled={isSubmitting}
                aria-invalid={Boolean(errorMessage)}
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
              {isSubmitting ? "登録しています…" : "アカウントを作成"}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center text-sm text-muted-foreground">
          既にアカウントをお持ちですか？
          <Button
            variant="link"
            className="px-1"
            nativeButton={false}
            render={<Link href="/login" />}
          >
            ログイン
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
