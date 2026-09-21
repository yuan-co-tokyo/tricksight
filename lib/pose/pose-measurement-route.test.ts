import { describe, expect, it, vi } from "vitest";

import { PoseMeasurementSaveError } from "../db/mutations/pose-measurement-core";
import { createPoseMeasurementRouteHandler } from "./pose-measurement-route";

function request(body: unknown) {
  return new Request("http://localhost/api/pose-measurements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("pose measurement route", () => {
  it("returns only the idempotency outcome", async () => {
    const savePoseMeasurement = vi.fn().mockResolvedValue({
      outcome: "ALREADY_EXISTS",
      measurement: { privateServerRow: true },
    });
    const handler = createPoseMeasurementRouteHandler({ savePoseMeasurement });

    const response = await handler(request({ videoId: "video-id" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      outcome: "ALREADY_EXISTS",
    });
  });

  it.each([
    ["UNAUTHENTICATED", 401],
    ["VIDEO_NOT_FOUND", 404],
    ["CONCURRENT_STATE_CHANGED", 409],
  ] as const)("maps %s without leaking internals", async (code, status) => {
    const savePoseMeasurement = vi.fn().mockRejectedValue(
      new PoseMeasurementSaveError(code, "private database detail"),
    );
    const handler = createPoseMeasurementRouteHandler({ savePoseMeasurement });

    const response = await handler(request({}));
    const text = await response.text();

    expect(response.status).toBe(status);
    expect(text).not.toContain("private database detail");
  });
});
