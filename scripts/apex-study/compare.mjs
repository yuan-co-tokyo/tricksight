// Offline experiment. Product source is loaded unchanged; private helpers exposed in memory only.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import assert from 'node:assert/strict';
const read = p => readFileSync(p, 'utf8');
const hash = s => createHash('sha256').update(s).digest('hex');
const source = read('lib/pose/metrics.ts');
function compile(source, require = () => { throw Error('Unexpected import'); }) {
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(require, loaded, loaded.exports);
  return loaded.exports;
}
const config = compile(read('lib/pose/config.ts'));
const frameMetrics = compile(read('lib/pose/frame-metrics.ts'), name => { assert.equal(name, './config'); return config; });
const { deriveFrame, detectMovementWindow, quantile, calculatePoseMetrics } = compile(source + '\nexport { deriveFrame, detectMovementWindow, quantile };', name => { if (name === './frame-metrics') return frameMetrics; assert.equal(name, './config'); return config; });
const median = a => quantile(a, .5);
const inputPath = 'eval/output/pose-landmarker-2026-09-20T13-01-06.200Z.json';
const inputText = read(inputPath), labelText = read('scripts/apex-study/visual-labels.json');
const labels = JSON.parse(labelText);
for (const label of labels) assert.equal(hash(readFileSync(label.file)), label.sha256);
// Fixed before first execution. No labels, outcome, speed or sample id enter candidates.
// Time-based +/-100ms median avoids a different smoothing width for all-frames data.
function smooth(frames) {
  return frames.map(f => ({ ...f, hipY: median(frames.filter(g => Math.abs(g.timestampMs-f.timestampMs)<=100).map(g=>g.hipY)) }));
}
function continuity(raw, t, radius) {
  if (t === null) return false;
  const local = raw.filter(f => Math.abs(f.timestampMs-t)<=radius);
  return local.length>=3 && local[0].timestampMs<=t-radius+100 && local.at(-1).timestampMs>=t+radius-100 && local.every((f,i)=>deriveFrame(f)!==null && (!i || f.timestampMs-local[i-1].timestampMs<=150));
}
function shape(frames,t) {
  if (t===null) return false;
  const peak=frames.find(f=>f.timestampMs===t), h=median(frames.map(f=>f.torsoLength));
  const sides=[frames.filter(f=>f.timestampMs>=t-600&&f.timestampMs<=t-200),frames.filter(f=>f.timestampMs>=t+200&&f.timestampMs<=t+600)];
  return sides.every(side=>side.length>=2 && median(side.map(f=>f.hipY))-peak.hipY>=.05*h);
}
assert.equal(continuity([{timestampMs:0,landmarks:null},{timestampMs:100,landmarks:null},{timestampMs:200,landmarks:null}],100,200),false);
assert.equal(shape([{timestampMs:100,hipY:.5,torsoLength:.2}],100),false);
assert.deepEqual(smooth([{timestampMs:0,hipY:.1},{timestampMs:1000,hipY:.9}]).map(f=>f.hipY),[.1,.9]);
const results=[];
for (const sample of JSON.parse(inputText).samples) {
  const label=labels.find(l=>l.id===sample.sample.id); assert(label);
  for (const mode of ['fixedFirst','fixedSecond','allFrames']) {
    const run=sample.runs[mode], frames=run.frames.map(deriveFrame).filter(Boolean), smoothed=smooth(frames);
    const baseline=detectMovementWindow(frames,run.durationMs).apexTimestampMs;
    assert.equal(baseline,calculatePoseMetrics(run).detectedApexTimestampMs);
    const s=detectMovementWindow(smoothed,run.durationMs).apexTimestampMs;
    const candidates={baseline,median:s,gap:continuity(run.frames,baseline,300)?baseline:null,medianGap:continuity(run.frames,s,300)?s:null,medianShape:shape(smoothed,s)?s:null,combined:continuity(run.frames,s,300)&&shape(smoothed,s)?s:null};
    const correct=t=>label.intervalMs!==null&&t!==null&&t>=label.intervalMs[0]&&t<=label.intervalMs[1];
    const outcomes=Object.fromEntries(Object.entries(candidates).map(([method,t])=>[method,t===null?(label.intervalMs===null?'unknownRejected':correct(baseline)?'lostCorrect':'rejectedWrong'):label.intervalMs===null?'unscorableOutput':correct(t)?'correct':'wrong']));
    const region=run.frames.filter(f=>label.intervalMs&&f.timestampMs>=label.intervalMs[0]&&f.timestampMs<=label.intervalMs[1]);
    const near=run.frames.filter(f=>baseline!==null&&Math.abs(f.timestampMs-baseline)<=200).map(f=>({t:f.timestampMs,derived:deriveFrame(f)}));
    results.push({id:label.id,mode,intervalMs:label.intervalMs,candidates,outcomes,intervalFrames:region.length,intervalPose:region.filter(f=>f.landmarks?.length>=33).length,intervalCore:region.filter(f=>deriveFrame(f)).length,nearBaseline:near});
  }
}
const counts=(rows,method)=>rows.reduce((a,r)=>{const k=r.outcomes[method];a[k]=(a[k]??0)+1;return a;},{});
const summary=Object.fromEntries(['fixedFirst','fixedSecond','allFrames'].map(mode=>[mode,Object.fromEntries(Object.keys(results[0].candidates).map(m=>[m,counts(results.filter(r=>r.mode===mode),m)]))]));
writeFileSync('scripts/apex-study/results.json',JSON.stringify({inputPath,inputSha256:hash(inputText),labelsSha256:hash(labelText),metricsSha256:hash(source),summary,results},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
for(const r of results.filter(r=>r.mode==='fixedFirst')) console.log(r.id,JSON.stringify(r.candidates),'core',r.intervalCore+'/'+r.intervalFrames);
