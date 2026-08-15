"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

type Stance = "REGULAR" | "GOOFY";

type ProfileFormProps = {
  initialProfile: {
    name: string;
    email: string;
    stance: Stance | null;
  };
};

const stanceOptions: Array<{
  value: Stance;
  label: string;
  description: string;
}> = [
  {
    value: "REGULAR",
    label: "Regular",
    description: "左足を前にして滑る",
  },
  {
    value: "GOOFY",
    label: "Goofy",
    description: "右足を前にして滑る",
  },
];

export function ProfileForm({ initialProfile }: ProfileFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialProfile.name);
  const [stance, setStance] = useState<Stance | null>(initialProfile.stance);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  function handleNameChange(value: string) {
    setName(value);
    setFeedback(null);
  }

  function handleStanceChange(value: Stance) {
    setStance(value);
    setFeedback(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setFeedback({ kind: "error", message: "表示名を入力してください。" });
      return;
    }

    setFeedback(null);
    setIsSubmitting(true);

    try {
      // Better Authのupdate-user endpointがCookieのセッションから更新対象を解決する。
      // クライアントからuser IDは送らず、現在のユーザー以外を指定できない形にする。
      const { error } = await authClient.updateUser({
        name: trimmedName,
        ...(stance ? { stance } : {}),
      });

      if (error) {
        setFeedback({
          kind: "error",
          message:
            error.status === 401
              ? "セッションの有効期限が切れました。もう一度ログインしてください。"
              : "プロフィールを保存できませんでした。時間をおいて、もう一度お試しください。",
        });
        return;
      }

      setName(trimmedName);
      setFeedback({
        kind: "success",
        message: "プロフィールを保存しました。",
      });
      router.refresh();
    } catch {
      setFeedback({
        kind: "error",
        message:
          "保存処理に接続できませんでした。通信環境を確認して、もう一度お試しください。",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-2xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">プロフィール</h1>
        <p className="text-muted-foreground">
          表示名とスケートボードのスタンスを設定します。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>基本情報</CardTitle>
          <CardDescription>
            メールアドレスは現在変更できません。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-6"
            onSubmit={handleSubmit}
            aria-busy={isSubmitting}
          >
            <div className="grid gap-2">
              <Label htmlFor="email">メールアドレス</Label>
              <Input id="email" value={initialProfile.email} readOnly />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="name">表示名</Label>
              <Input
                id="name"
                value={name}
                onChange={(event) => handleNameChange(event.target.value)}
                maxLength={100}
                required
                disabled={isSubmitting}
              />
            </div>

            <fieldset className="grid gap-3" disabled={isSubmitting}>
              <legend className="text-sm font-medium">スタンス</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {stanceOptions.map((option) => {
                  const selected = stance === option.value;

                  return (
                    <Button
                      key={option.value}
                      type="button"
                      variant={selected ? "default" : "outline"}
                      className="h-auto justify-start py-3 text-left"
                      aria-pressed={selected}
                      onClick={() => handleStanceChange(option.value)}
                    >
                      <span className="grid gap-0.5">
                        <span>{option.label}</span>
                        <span className="text-xs font-normal opacity-80">
                          {option.description}
                        </span>
                      </span>
                    </Button>
                  );
                })}
              </div>
              <p className="text-sm text-muted-foreground">
                {stance === null
                  ? "現在は未設定です。Regular または Goofy を選んでください。"
                  : `現在の設定: ${stance === "REGULAR" ? "Regular" : "Goofy"}`}
              </p>
            </fieldset>

            {feedback ? (
              <p
                role={feedback.kind === "error" ? "alert" : "status"}
                aria-live="polite"
                className={
                  feedback.kind === "error"
                    ? "rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    : "rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
                }
              >
                {feedback.message}
              </p>
            ) : null}

            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting ? "保存しています…" : "保存する"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
