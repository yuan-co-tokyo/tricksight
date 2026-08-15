import { ProfileForm } from "./profile-form";

import { requireCurrentUser } from "@/lib/current-user";

export default async function ProfilePage() {
  const user = await requireCurrentUser();
  const stance =
    user.stance === "REGULAR" || user.stance === "GOOFY" ? user.stance : null;

  return (
    <ProfileForm
      initialProfile={{
        name: user.name,
        email: user.email,
        stance,
      }}
    />
  );
}
