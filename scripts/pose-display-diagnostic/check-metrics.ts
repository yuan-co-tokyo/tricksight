import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { calculatePoseMetrics, type PoseRun } from "../../lib/pose/metrics";
import { POSE_LANDMARKER_CONFIG } from "../../lib/pose/config";
const baseline=JSON.parse(readFileSync("scripts/pose-display-diagnostic/aggregate-baseline.json","utf8"));
const data=JSON.parse(readFileSync("eval/output/pose-landmarker-2026-09-20T13-01-06.200Z.json","utf8"));
assert.equal(POSE_LANDMARKER_CONFIG.algorithmVersion,baseline.algorithmVersion);
let count=0;
for(const sample of data.samples){const expected=baseline.samples.find((s:{id:string})=>s.id===sample.sample.id);assert(expected);for(const [name,run] of Object.entries(sample.runs)){assert.deepEqual(calculatePoseMetrics(run as PoseRun),expected.runs[name]);count++;}}
console.log(`All metrics unchanged: ${count} runs, algorithmVersion unchanged; upload Worker source remains separate`);
