import type { PoseMeasurementResult } from "./types";

export type PoseRuntimeFamily = "WEBKIT" | "CHROMIUM";

type SavePoseMeasurementResponse = {
  outcome: "CREATED" | "ALREADY_EXISTS";
};

type SavePoseMeasurementOptions = {
  fetcher?: typeof fetch;
};

export class PoseMeasurementRequestError extends Error {
  constructor(readonly status: number) {
    super("The pose measurement could not be saved.");
    this.name = "PoseMeasurementRequestError";
  }
}

export function detectPoseRuntimeFamily(
  userAgent = navigator.userAgent,
): PoseRuntimeFamily {
  // Every browser on iOS uses WebKit even when the product token says CriOS
  // or FxiOS. Runtime family follows the engine because that is what changes
  // the deterministic pose values used for history comparison.
  if (/(?:iPhone|iPad|iPod)/.test(userAgent)) return "WEBKIT";
  const chromium = /(?:Chrome|Chromium|Edg|OPR)\//.test(userAgent);
  return chromium ? "CHROMIUM" : "WEBKIT";
}

function isSaveResponse(value: unknown): value is SavePoseMeasurementResponse {
  if (!value || typeof value !== "object") return false;
  const outcome = (value as Partial<SavePoseMeasurementResponse>).outcome;
  return outcome === "CREATED" || outcome === "ALREADY_EXISTS";
}

function persistencePayload(measurement: PoseMeasurementResult) {
  const payload = {
    status: measurement.status,
    quality: measurement.quality,
    metrics: measurement.metrics,
    processingDurationMs: measurement.processingDurationMs,
  };

  return measurement.status === "FAILED"
    ? { ...payload, errorCode: measurement.errorCode }
    : payload;
}

export async function savePoseMeasurementResult(
  input: {
    videoId: string;
    runtimeFamily: PoseRuntimeFamily;
    measurement: PoseMeasurementResult;
  },
  options: SavePoseMeasurementOptions = {},
) {
  const response = await (options.fetcher ?? fetch)("/api/pose-measurements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      videoId: input.videoId,
      runtimeFamily: input.runtimeFamily,
      measurement: persistencePayload(input.measurement),
    }),
    // The result-page action may navigate while this small request is in
    // flight. Keeping it alive lets a CANCELED terminal result persist without
    // ever delaying or aborting the upload/LLM flow.
    keepalive: true,
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Invalid or empty server responses use the same fail-soft client state.
  }

  if (!response.ok || !isSaveResponse(body)) {
    throw new PoseMeasurementRequestError(response.ok ? 502 : response.status);
  }

  return body;
}
