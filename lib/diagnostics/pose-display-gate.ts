import { z } from "zod";
import { isPlayableVideoStatus, type OwnedSessionForPlayback } from "../uploads/video-playback-url-core";

export type DiagnosticEnvironment = {
  [name: string]: string | undefined;
  POSE_DISPLAY_DIAGNOSTIC_ENABLED?: string;
  POSE_DISPLAY_DIAGNOSTIC_USER_IDS?: string;
};
export function diagnosticEnabled(env: DiagnosticEnvironment) {
  return env.POSE_DISPLAY_DIAGNOSTIC_ENABLED === "true";
}
export function canUsePoseDisplayDiagnostic(env: DiagnosticEnvironment, userId: string) {
  return diagnosticEnabled(env) && Boolean(userId) &&
    (env.POSE_DISPLAY_DIAGNOSTIC_USER_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean).includes(userId);
}

// Every data access is behind the same server-side gate; no caller-supplied S3 key.
export async function resolvePoseDisplayDiagnostic(input: {
  env: DiagnosticEnvironment;
  sessionId: string;
  getUser(): Promise<{ id: string } | null>;
  getSession(userId: string, sessionId: string): Promise<OwnedSessionForPlayback | null>;
  sign(session: OwnedSessionForPlayback): Promise<string | null>;
}): Promise<{ kind: "denied" } | { kind: "unavailable" } | { kind: "ready"; playbackUrl: string }> {
  if (!diagnosticEnabled(input.env)) return { kind: "denied" };
  try {
    const user = await input.getUser();
    if (!user || !canUsePoseDisplayDiagnostic(input.env, user.id) || !z.uuid().safeParse(input.sessionId).success) return { kind: "denied" };
    const session = await input.getSession(user.id, input.sessionId);
    if (!session?.video || !isPlayableVideoStatus(session.video.status)) return { kind: "denied" };
    const playbackUrl = await input.sign(session);
    return playbackUrl ? { kind: "ready", playbackUrl } : { kind: "unavailable" };
  } catch {
    // Never log raw errors: a storage/auth error can contain a signed URL.
    return { kind: "unavailable" };
  }
}
