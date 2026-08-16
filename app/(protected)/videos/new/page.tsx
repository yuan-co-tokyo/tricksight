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
