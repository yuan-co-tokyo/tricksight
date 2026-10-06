import { describe, expect, it, vi } from "vitest";
import { createDisplayWorkerCore } from "./display-worker-core";
import { DEFAULT_POSE_ASSET_URLS } from "./config";
import { displayResponseSchema, type DisplayRequest, type DisplayResponse } from "./display-protocol";
import { calculatePoseMetrics, type PoseFrame, type PoseLandmark } from "./metrics";
import { deriveFrame, quantile } from "./frame-metrics";
import { displaySeries, displaySample } from "./display-series";
import { containRect, drawPose, POSE_CONNECTIONS } from "./display-drawing";

function points(hip=.5):PoseLandmark[] {
  const p=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:1,presence:1}));
  for(const [i,x,y] of [[11,.4,hip-.3],[12,.6,hip-.3],[23,.4,hip],[24,.6,hip],[25,.4,hip+.2],[26,.6,hip+.2],[27,.4,hip+.4],[28,.6,hip+.4]])p[i]={...p[i]!,x,y};
  return p;
}
function frame(t=0,hip=.5):PoseFrame {const p=points(hip);return {timestampMs:t,inferenceMs:1,landmarks:p,worldLandmarks:structuredClone(p)};}
function surface(){const ctx={clearRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn(),arc:vi.fn(),fill:vi.fn(),strokeStyle:"",fillStyle:"",lineWidth:0};return {ctx,canvas:{width:320,height:320,getContext:()=>ctx} as unknown as OffscreenCanvas};}
const metadata={durationMs:1000,videoWidth:1920,videoHeight:1080};
function forbiddenKeys(value:unknown):string[]{if(!value||typeof value!=="object")return [];return Object.entries(value).flatMap(([k,v])=>[...(["landmarks","worldLandmarks","frames","series","points"].includes(k)?[k]:[]),...forbiddenKeys(v)]);}
describe("display computation and rendering",()=>{
  it("uses the same 3D knee and p80 hip / median torso math without changing four aggregates",()=>{
    const frames=[.55,.55,.5,.4,.3,.4,.5,.55,.55,.55].map((y,i)=>frame(i*100,y));
    const series=displaySeries(frames);
    for(let i=0;i<frames.length;i++){
      const d=deriveFrame(frames[i]!)!;const {sample}=displaySample(frames,series,1000,true,i*100);
      expect(sample.values.meanKneeAngleDeg).toBe(d.meanKneeAngleDeg);
      expect(sample.values.hipRelativeHeightTorsoUnits).toBe((quantile(frames.map(f=>deriveFrame(f)!.hipY),.8)!-d.hipY)/quantile(frames.map(f=>deriveFrame(f)!.torsoLength),.5)!);
    }
    const metrics=calculatePoseMetrics({...metadata,mode:"fixed",fixedFps:10,initializationMs:0,processingMs:1,presentedFrameGaps:0,frames});
    expect(metrics.minimumMeanKneeAngleDeg).toBe(180);expect(metrics.kneeExtensionRangeDeg).toBe(0);
    expect(metrics.hipRiseTorsoUnits).toBeCloseTo(.5333333333333333);expect(metrics.landingTrunkTiltDeg).toBe(0);
  });
  it("holds only previous <100ms sample, including missing slots, never across a gap or end",()=>{
    const frames=[frame(0),{...frame(100),landmarks:null},frame(300)];const s=displaySeries(frames);
    expect(displaySample(frames,s,350,true,99.99).sample.sampleTimestampMs).toBe(0);
    expect(displaySample(frames,s,350,true,100).sample.missingReasons).toContain("POSE_MISSING");
    for(const t of [-1,200,299,350])expect(displaySample(frames,s,350,true,t).index).toBe(-1);
    expect(displaySample(frames,s,350,true,349).sample.sampleTimestampMs).toBe(300);
  });
  it("hides values for global gate, current missing lower body, high-confidence out-of-bounds and degenerate angles",()=>{
    const f=frame(),s=displaySeries([f]);expect(displaySample([f],s,100,false,0).sample.values).toEqual({meanKneeAngleDeg:null,hipRelativeHeightTorsoUnits:null});
    f.landmarks![25]!.visibility=.1;expect(displaySample([f],displaySeries([f]),100,true,0).sample.values.meanKneeAngleDeg).toBeNull();
    f.landmarks![25]!.visibility=1;f.landmarks![23]!.x=-.01;
    const out=displaySample([f],displaySeries([f]),100,true,0).sample;expect(out.missingReasons).toContain("OUT_OF_BOUNDS");expect(out.values.hipRelativeHeightTorsoUnits).toBeNull();
    const deg=frame();deg.worldLandmarks![25]=deg.worldLandmarks![23]!;const missing=displaySample([deg],displaySeries([deg]),100,true,0).sample;expect(missing.values.meanKneeAngleDeg).toBeNull();expect(missing.missingReasons).toContain("LOWER_BODY_UNRELIABLE");
  });
  it("maps object-contain and omits unreliable/outside points AND attached edges",()=>{
    expect(containRect(320,320,1920,1080)).toEqual({x:0,y:70,width:320,height:180});
    const {ctx,canvas}=surface(),p=points();p[11]!.x=-.1;p[25]!.visibility=.2;p[0]!.y=Infinity;
    expect(drawPose(canvas,p,1920,1080)).toBe(30);
    expect(ctx.stroke).toHaveBeenCalledTimes(POSE_CONNECTIONS.filter(([a,b])=>![0,11,25].includes(a)&&![0,11,25].includes(b)).length);
    expect(drawPose(canvas,null,1920,1080)).toBe(0);expect(ctx.clearRect).toHaveBeenCalledTimes(2);
  });
});
describe("display Worker lifecycle and outgoing privacy boundary",()=>{
  it("retains privately after finalize, closes model/bitmaps, rejects stale draws, releases on dispose",async()=>{
    const p=points();const model={detectForVideo:vi.fn(()=>({landmarks:[p],worldLandmarks:[p]})),close:vi.fn()};
    const handle=createDisplayWorkerCore(async()=>model);let id=0;
    async function send(body:Omit<DisplayRequest,"id"|"generation">,generation=0){const r=await handle({...body,id:++id,generation} as DisplayRequest);expect(displayResponseSchema.safeParse(r).success).toBe(true);expect(forbiddenKeys(r)).toEqual([]);return r;}
    await send({type:"initialize",assetUrls:DEFAULT_POSE_ASSET_URLS,...metadata} as never);const {canvas,ctx}=surface();await send({type:"attach",canvas} as never);
    for(let i=0;i<10;i++){const bitmap={close:vi.fn()} as unknown as ImageBitmap;await send({type:"detect",timestampMs:i*100,bitmap} as never);expect(bitmap.close).toHaveBeenCalledTimes(1);}
    expect((await send({type:"finalize"})).result.type).toBe("ready");expect(model.close).toHaveBeenCalledTimes(1);
    const r=await send({type:"render",playbackTimestampMs:350,width:320,height:320} as never,2);
    expect(r.result.type).toBe("sample");if(r.result.type==="sample"){expect(r.result.sample.sampleTimestampMs).toBe(300);expect(r.result.sample.drawnPointCount).toBe(33);}
    const paints=ctx.clearRect.mock.calls.length;
    expect((await send({type:"render",playbackTimestampMs:0,width:320,height:320} as never,1)).result).toEqual({type:"error",code:"STALE"});expect(ctx.clearRect).toHaveBeenCalledTimes(paints);
    await send({type:"clear"},3);expect(ctx.clearRect).toHaveBeenCalledTimes(paints+1);
    await send({type:"dispose"},4);expect(canvas.width).toBe(1);expect(canvas.height).toBe(1);
    const after=await send({type:"render",playbackTimestampMs:300,width:320,height:320} as never,5);
    if(after.result.type!=="sample")throw Error();expect(after.result.sample.missingReasons).toEqual(["NOT_READY"]);expect(after.result.sample.sampleTimestampMs).toBeNull();
  });
  it("closes a bitmap on inference failure and a late model after dispose",async()=>{
    const model={detectForVideo:()=>{throw new Error("private details");},close:vi.fn()};
    const handle=createDisplayWorkerCore(async()=>model);await handle({type:"initialize",id:1,generation:0,assetUrls:DEFAULT_POSE_ASSET_URLS,...metadata});
    const bitmap={close:vi.fn()} as unknown as ImageBitmap;const error=await handle({type:"detect",id:2,generation:0,timestampMs:0,bitmap});
    expect(error.result).toEqual({type:"error",code:"FAILED"});expect(bitmap.close).toHaveBeenCalledOnce();expect(model.close).toHaveBeenCalledOnce();
    let resolve!:(m:typeof model)=>void;const late=createDisplayWorkerCore(()=>new Promise(r=>{resolve=r;}));
    const pending=late({type:"initialize",id:1,generation:0,assetUrls:DEFAULT_POSE_ASSET_URLS,...metadata});await late({type:"dispose",id:2,generation:1});resolve(model);expect((await pending).result).toEqual({type:"error",code:"STALE"});expect(model.close).toHaveBeenCalledTimes(2);
  });
  it("strict protocol disallows raw data at every level, including numeric-feature expansion",()=>{
    const valid={id:1,generation:1,result:{type:"sample",sample:{playbackTimestampMs:5,sampleTimestampMs:0,values:{meanKneeAngleDeg:180,hipRelativeHeightTorsoUnits:0},missingReasons:[],drawnPointCount:33}}};
    expect(displayResponseSchema.safeParse(valid).success).toBe(true);
    for(const value of [{...valid,landmarks:points()},{...valid,result:{type:"raw",frames:[frame()]}},{...valid,result:{...valid.result,frames:[frame()]}},{...valid,result:{...valid.result,sample:{...valid.result.sample,landmarks:points()}}},{...valid,result:{...valid.result,sample:{...valid.result.sample,values:{...valid.result.sample.values,worldLandmarks:points()}}}}])expect(displayResponseSchema.safeParse(value).success).toBe(false);
    // @ts-expect-error No raw message exists on the product response union.
    const impossible:DisplayResponse={id:1,generation:1,result:{type:"raw",frames:[]}};void impossible;
  });
});
