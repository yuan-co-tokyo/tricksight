// 一時的な診断用。計測後に削除すること。
import { createHash, timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const TOKEN_ENV_NAME = "MAX_DURATION_DIAGNOSTIC_TOKEN";
const MAX_WAIT_SECONDS = 299;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function isAuthorized(request: NextRequest) {
  const expectedToken = process.env[TOKEN_ENV_NAME];
  const authorization = request.headers.get("authorization");

  if (!expectedToken || !authorization?.startsWith("Bearer ")) {
    return false;
  }

  const providedToken = authorization.slice("Bearer ".length);

  return timingSafeEqual(digest(providedToken), digest(expectedToken));
}

function parseWaitSeconds(value: string | null) {
  if (value === null || value.trim() === "") return null;

  const seconds = Number(value);

  if (
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    seconds > MAX_WAIT_SECONDS
  ) {
    return null;
  }

  return seconds;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return new Response(null, {
      status: 404,
      headers: NO_STORE_HEADERS,
    });
  }

  const waitSeconds = parseWaitSeconds(
    request.nextUrl.searchParams.get("seconds"),
  );

  if (waitSeconds === null) {
    return Response.json(
      {
        error: `seconds must be a number between 0 and ${MAX_WAIT_SECONDS}.`,
      },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  const startedAt = performance.now();

  await new Promise<void>((resolve) => {
    setTimeout(resolve, waitSeconds * 1_000);
  });

  const elapsedMilliseconds = Math.round(performance.now() - startedAt);

  return Response.json(
    {
      requestedSeconds: waitSeconds,
      elapsedMilliseconds,
      elapsedSeconds: elapsedMilliseconds / 1_000,
      configuredMaxDurationSeconds: maxDuration,
    },
    {
      headers: NO_STORE_HEADERS,
    },
  );
}
