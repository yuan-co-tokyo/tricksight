import { afterEach, describe, expect, it, vi } from "vitest";
const sourceMock=vi.hoisted(()=>({create:vi.fn()}));
vi.mock("./browser-analysis",()=>({createBrowserFrameSource:sourceMock.create}));
import { startPoseDisplay } from "./browser-display";
import type { DisplayRequest, DisplayResponse } from "./display-protocol";

class FakeWorker {
  static instances:FakeWorker[]=[];
  events=new Map<string,(e:{data:unknown})=>void>();
  requests:DisplayRequest[]=[];
  terminate=vi.fn();
  constructor(){FakeWorker.instances.push(this);}
  addEventListener(name:string,fn:(e:{data:unknown})=>void){this.events.set(name,fn);}
  postMessage(request:DisplayRequest){
    this.requests.push(request);
    const simple={initialize:"initialized",attach:"attached",clear:"cleared",dispose:"disposed"} as const;
    if(request.type in simple)this.reply(request,{type:simple[request.type as keyof typeof simple]});
    if(request.type==="detect"){request.bitmap.close();this.reply(request,{type:"progress",processedFrames:request.timestampMs/100+1});}
    if(request.type==="finalize")this.reply(request,{type:"ready",quality:{status:"ASSESSABLE",frameCount:2,poseCoverage:1,lowerBodyCoverage:1}});
  }
  reply(request:DisplayRequest,result:DisplayResponse["result"]){queueMicrotask(()=>this.events.get("message")?.({data:{id:request.id,generation:request.generation,result}}));}
}
function setup(){
  FakeWorker.instances=[];vi.stubGlobal("Worker",FakeWorker);
  const close=vi.fn(),bitmaps:ImageBitmap[]=[];
  sourceMock.create.mockImplementation(async()=>({durationMs:200,videoWidth:100,videoHeight:100,close,frameAt:async()=>{const b={close:vi.fn()} as unknown as ImageBitmap;bitmaps.push(b);return b;}}));
  const canvas={transferControlToOffscreen:()=>({})} as HTMLCanvasElement;
  return {canvas,close,bitmaps};
}
const sample=(time:number)=>({type:"sample" as const,sample:{playbackTimestampMs:time,sampleTimestampMs:Math.floor(time/100)*100,values:{meanKneeAngleDeg:100,hipRelativeHeightTorsoUnits:0},missingReasons:[],drawnPointCount:33}});
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();vi.useRealTimers();});
describe("display client lifetime and stale responses",()=>{
  it("primes synchronously, closes frame source after finalize but retains Worker until dispose",async()=>{
    const {canvas,close,bitmaps}=setup();const task=startPoseDisplay(new Blob(),canvas);
    expect(sourceMock.create).toHaveBeenCalledOnce();expect((await task.result).status).toBe("READY");expect(close).toHaveBeenCalledOnce();
    const worker=FakeWorker.instances[0]!;expect(worker.terminate).not.toHaveBeenCalled();expect(bitmaps).toHaveLength(2);for(const b of bitmaps)expect(b.close).toHaveBeenCalledOnce();
    task.dispose();task.dispose();expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("keeps only one render in flight plus latest, dropping old seek replies",async()=>{
    const {canvas}=setup(),onSample=vi.fn();const task=startPoseDisplay(new Blob(),canvas,{onSample});await task.result;const worker=FakeWorker.instances[0]!;
    task.render(1,100,100);task.render(101,100,100);task.clear();task.render(151,100,100);
    const renders=()=>worker.requests.filter(r=>r.type==="render");expect(renders()).toHaveLength(1);
    worker.reply(renders()[0]!,sample(1));await new Promise(r=>setTimeout(r,0));expect(onSample).not.toHaveBeenCalled();expect(renders()).toHaveLength(2);
    const last=renders()[1]!;expect(last.playbackTimestampMs).toBe(151);worker.reply(last,sample(151));await new Promise(r=>setTimeout(r,0));expect(onSample).toHaveBeenCalledWith(sample(151).sample);
    task.dispose();worker.reply(last,sample(151));await new Promise(r=>setTimeout(r,0));expect(onSample).toHaveBeenCalledTimes(1);
  });
  it("cancels initialization and closes a source that arrives late",async()=>{
    const {canvas,close}=setup();let resolve!:(value:unknown)=>void;sourceMock.create.mockImplementation(()=>new Promise(r=>{resolve=r;}));
    const task=startPoseDisplay(new Blob(),canvas);task.dispose();resolve({durationMs:200,videoWidth:100,videoHeight:100,close});expect(await task.result).toEqual({status:"CANCELED"});expect(close).toHaveBeenCalledOnce();expect(FakeWorker.instances).toHaveLength(0);
  });
  it("rejects unexpected raw output, terminates and does not deliver it to UI",async()=>{
    const {canvas}=setup(),onSample=vi.fn(),onError=vi.fn();const task=startPoseDisplay(new Blob(),canvas,{onSample,onError});await task.result;const worker=FakeWorker.instances[0]!;
    worker.events.get("message")?.({data:{id:99,generation:0,result:{type:"raw",landmarks:[]}}});expect(worker.terminate).toHaveBeenCalled();expect(onSample).not.toHaveBeenCalled();expect(onError).toHaveBeenCalledOnce();
  });
  it("absolute timeout aborts an outstanding frame-source startup",async()=>{
    vi.useFakeTimers();const {canvas}=setup();sourceMock.create.mockImplementation((_blob,signal:AbortSignal)=>new Promise((_r,reject)=>signal.addEventListener("abort",()=>reject(new Error("aborted")))));
    const task=startPoseDisplay(new Blob(),canvas,{timeoutMs:50});await vi.advanceTimersByTimeAsync(50);expect(await task.result).toEqual({status:"TIMED_OUT"});
  });
});
