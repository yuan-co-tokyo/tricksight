import Link from "next/link";
import { ArrowRightIcon, UserRoundCogIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireCurrentUser } from "@/lib/current-user";
import { listActiveTricks } from "@/lib/db/queries";

import { VideoUploadForm } from "./video-upload-form";

function todayInTokyo() {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tokyo",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

export default async function NewVideoPage() {
  const user = await requireCurrentUser();

  if (user.stance !== "REGULAR" && user.stance !== "GOOFY") {
    return (
      <section className="mx-auto w-full max-w-3xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            新しい動画を分析する
          </h1>
          <p className="text-muted-foreground">
            動画を選ぶ前に、分析に必要なプロフィールを確認します。
          </p>
        </header>

        <Card>
          <CardHeader>
            <span className="mb-2 grid size-10 place-items-center rounded-full bg-warning/15 text-warning">
              <UserRoundCogIcon aria-hidden="true" className="size-5" />
            </span>
            <CardTitle>先にスタンスを設定してください</CardTitle>
            <CardDescription>
              前足と後ろ足を正しく判定するため、RegularまたはGoofyの設定が必要です。設定後にこの画面へ戻ると、動画を選べるようになります。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              nativeButton={false}
              render={<Link href="/profile" />}
              size="lg"
            >
              プロフィールでスタンスを設定
              <ArrowRightIcon aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  const tricks = await listActiveTricks(user.id);

  return (
    <VideoUploadForm
      tricks={tricks.map((trick) => ({
        id: trick.id,
        name: trick.name,
        description: trick.description,
      }))}
      defaultPracticeDate={todayInTokyo()}
    />
  );
}
