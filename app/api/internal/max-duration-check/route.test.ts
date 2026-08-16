import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET, maxDuration, runtime } from "./route";

const TOKEN_ENV_NAME = "MAX_DURATION_DIAGNOSTIC_TOKEN";
const TEST_TOKEN = "temporary-diagnostic-test-token";
let originalToken: string | undefined;

function request(seconds: string, token?: string) {
  return new NextRequest(
    `http://localhost/api/internal/max-duration-check?seconds=${seconds}`,
    {
      headers: token
        ? {
            Authorization: `Bearer ${token}`,
          }
        : undefined,
    },
  );
}

describe("temporary max-duration diagnostic route", () => {
  beforeEach(() => {
    originalToken = process.env[TOKEN_ENV_NAME];
    process.env[TOKEN_ENV_NAME] = TEST_TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env[TOKEN_ENV_NAME];
    } else {
      process.env[TOKEN_ENV_NAME] = originalToken;
    }
  });

  it("declares the Node.js runtime and a 300 second max duration", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(300);
  });

  it.each([undefined, "wrong-token"])(
    "returns an indistinguishable 404 for a missing or invalid token",
    async (token) => {
      const response = await GET(request("0", token));

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("also returns 404 when the server-side token is not configured", async () => {
    delete process.env[TOKEN_ENV_NAME];

    const response = await GET(request("0", TEST_TOKEN));

    expect(response.status).toBe(404);
  });

  it.each(["", "not-a-number", "-1", "300"])(
    "rejects an invalid or unsafe wait value",
    async (seconds) => {
      const response = await GET(request(seconds, TEST_TOKEN));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "seconds must be a number between 0 and 299.",
      });
    },
  );

  it("waits and reports elapsed time for an authorized request", async () => {
    const response = await GET(request("0", TEST_TOKEN));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      requestedSeconds: 0,
      configuredMaxDurationSeconds: 300,
    });
    expect(body.elapsedMilliseconds).toBeGreaterThanOrEqual(0);
    expect(body.elapsedSeconds).toBeGreaterThanOrEqual(0);
  });
});
