import type { PoseAssetUrls } from "./config";

export type DisplayRequest = { id: number; generation: number } & (
  | { type: "initialize"; assetUrls: PoseAssetUrls; durationMs: number; videoWidth: number; videoHeight: number }
  | { type: "attach"; canvas: OffscreenCanvas }
  | { type: "detect"; bitmap: ImageBitmap; timestampMs: number }
  | { type: "finalize" }
  | { type: "render"; playbackTimestampMs: number; width: number; height: number }
  | { type: "clear" }
  | { type: "dispose" }
);
export type DisplayQuality = {
  status: "ASSESSABLE" | "UNASSESSABLE";
  frameCount: number; poseCoverage: number | null; lowerBodyCoverage: number | null;
};
const reasons = ["NOT_READY", "OUT_OF_RANGE", "POSE_MISSING", "CORE_UNRELIABLE", "LOWER_BODY_UNRELIABLE", "OUT_OF_BOUNDS", "GLOBAL_QUALITY", "PARTIAL_SKELETON"] as const;
export type DisplaySample = {
  playbackTimestampMs: number;
  sampleTimestampMs: number | null;
  // Later features extend this named schema, never a landmark or time-series payload.
  values: { meanKneeAngleDeg: number | null; hipRelativeHeightTorsoUnits: number | null };
  missingReasons: (typeof reasons)[number][];
  drawnPointCount: number;
};
export type DisplayResponse = { id: number; generation: number; result:
  | { type: "initialized" | "attached" | "cleared" | "disposed" }
  | { type: "progress"; processedFrames: number }
  | { type: "ready"; quality: DisplayQuality }
  | { type: "sample"; sample: DisplaySample }
  | { type: "error"; code: "FAILED" | "STALE" | "INVALID_STATE" }
};

// Dependency-free, exact-key runtime schema: used at BOTH ends of the Worker.
// In particular, object spread cannot silently add a raw array to an allowed response.
function keys(value: unknown, names: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}
const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const count = (v: unknown) => number(v) && Number.isInteger(v) && v >= 0;
const nullable = (v: unknown) => v === null || number(v);
function valid(value: unknown): value is DisplayResponse {
  if (!keys(value,["id","generation","result"]) || !count(value.id) || !count(value.generation)) return false;
  const raw=value.result;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const result=raw as Record<string, unknown>;
  switch(result.type) {
    case "initialized": case "attached": case "cleared": case "disposed": return keys(result,["type"]);
    case "error": return keys(result,["type","code"]) && typeof result.code === "string" && ["FAILED","STALE","INVALID_STATE"].includes(result.code);
    case "progress": return keys(result,["type","processedFrames"]) && count(result.processedFrames);
    case "ready": {
      if(!keys(result,["type","quality"]))return false;const q=result.quality;
      return keys(q,["status","frameCount","poseCoverage","lowerBodyCoverage"]) &&
        (q.status==="ASSESSABLE"||q.status==="UNASSESSABLE") && count(q.frameCount) && nullable(q.poseCoverage) && nullable(q.lowerBodyCoverage);
    }
    case "sample": {
      if(!keys(result,["type","sample"]))return false;const s=result.sample;
      return keys(s,["playbackTimestampMs","sampleTimestampMs","values","missingReasons","drawnPointCount"]) &&
        number(s.playbackTimestampMs) && nullable(s.sampleTimestampMs) && count(s.drawnPointCount) &&
        keys(s.values,["meanKneeAngleDeg","hipRelativeHeightTorsoUnits"]) && nullable(s.values.meanKneeAngleDeg) && nullable(s.values.hipRelativeHeightTorsoUnits) &&
        Array.isArray(s.missingReasons) && s.missingReasons.every(r=>typeof r==="string"&&(reasons as readonly string[]).includes(r));
    }
    default: return false;
  }
}
export const displayResponseSchema = {
  parse(value: unknown): DisplayResponse {if(!valid(value))throw new Error("Invalid display response");return value;},
  safeParse(value: unknown): {success:true;data:DisplayResponse}|{success:false} {return valid(value)?{success:true,data:value}:{success:false};},
};
