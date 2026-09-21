import { describe, expect, it, vi } from "vitest";

import { POSE_MEASUREMENT_METADATA } from "./config";
import {
  detectPoseRuntimeFamily,
  savePoseMeasurementResult,
} from "./pose-measurement-client";

const videoId = "11111111-1111-4111-8111-111111111111";

describe("pose measurement client", () => {
  it.each([
    ["Mozilla/5.0 AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15", "WEBKIT"],
    ["Mozilla/5.0 AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36", "CHROMIUM"],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/153.0 Mobile/15E148",
      "WEBKIT",
    ],
  ] as const)("maps the browser engine to %s", (userAgent, expected) => {
    expect(detectPoseRuntimeFamily(userAgent)).toBe(expected);
  });

  it("strips client metadata and uses a navigation-safe request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ outcome: "CREATED" }, { status: 201 }),
    );

    await expect(
      savePoseMeasurementResult(
        {
          videoId,
          runtimeFamily: "CHROMIUM",
          measurement: {
            status: "COMPLETED",
            metadata: POSE_MEASUREMENT_METADATA,
            quality: {
              frameCount: 10,
              poseFrameCount: 9,
              lowerBodyFrameCount: 9,
              poseCoverage: 0.9,
              lowerBodyCoverage: 0.9,
              reasons: [],
            },
            metrics: {
              minimumMeanKneeAngleDeg: 70,
              kneeExtensionRangeDeg: 55,
              hipVerticalRangeTorsoUnits: 0.8,
              landingTrunkTiltDeg: null,
            },
            processingDurationMs: 411.59999990463257,
          },
        },
        { fetcher },
      ),
    ).resolves.toEqual({ outcome: "CREATED" });

    const request = fetcher.mock.calls[0]?.[1];
    expect(request).toMatchObject({ method: "POST", keepalive: true });
    const body = JSON.parse(String(request?.body));
    expect(body.measurement).not.toHaveProperty("metadata");
    expect(body).toMatchObject({ videoId, runtimeFamily: "CHROMIUM" });
    expect(body.measurement.processingDurationMs).toBe(412);
  });
});
