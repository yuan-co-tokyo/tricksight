import { createBrowserFrameSource, type FrameSource } from "./browser-analysis";
import { DEFAULT_POSE_ASSET_URLS, type PoseAssetUrls } from "./config";
import { displayResponseSchema, type DisplayRequest, type DisplayResponse, type DisplaySample, type DisplayQuality } from "./display-protocol";

type RequestBody = DisplayRequest extends infer R ? R extends {id:number;generation:number} ? Omit<R,"id"|"generation"> : never : never;
export type DisplayTask = {
  result: Promise<{ status:"READY";quality:DisplayQuality } | {status:"FAILED"|"CANCELED"|"TIMED_OUT"}>;
  render(timeMs:number,width:number,height:number): void;
  clear(): void;
  dispose(): void;
};
export function startPoseDisplay(blob: Blob, canvas: HTMLCanvasElement, options: {
  assetUrls?: Partial<PoseAssetUrls>;
  onProgress?(count:number):void;
  onSample?(sample:DisplaySample):void;
  onError?():void;
  timeoutMs?:number;
} = {}): DisplayTask {
  const controller=new AbortController();
  let worker:Worker|null=null,source:FrameSource|null=null,ready=false,disposed=false,id=0,generation=0;
  let stopStatus:"CANCELED"|"TIMED_OUT"="CANCELED";
  const pending=new Map<number,{generation:number;resolve:(r:DisplayResponse["result"])=>void;reject:()=>void}>();
  let renderPending=false,latest:{time:number;width:number;height:number;generation:number}|null=null;
  const notify=<T>(fn:((value:T)=>void)|undefined,value:T)=>{try{fn?.(value);}catch{/* UI callbacks cannot retain the Worker on failure. */}};
  function terminate(){worker?.terminate();worker=null;for(const p of pending.values())p.reject();pending.clear();}
  function dispose(){if(disposed)return;disposed=true;ready=false;latest=null;controller.abort();source?.close();source=null;terminate();}
  function call(body:RequestBody,transfer:Transferable[]=[],version=generation) {
    return new Promise<DisplayResponse["result"]>((resolve,reject)=>{
      if(!worker||disposed){reject(new Error("Disposed"));return;}
      const next=++id;pending.set(next,{generation:version,resolve,reject:()=>reject(new Error("Display failed"))});
      try{worker.postMessage({...body,id:next,generation:version},transfer);}catch{pending.delete(next);reject(new Error("Display transfer failed"));}
    });
  }
  async function pump(){
    if(renderPending||!latest||!ready||disposed)return;
    const request=latest;latest=null;renderPending=true;
    try {
      const response=await call({type:"render",playbackTimestampMs:request.time,width:request.width,height:request.height},[],request.generation);
      if(!disposed&&request.generation===generation&&response.type==="sample")notify(options.onSample,response.sample);
    }catch {if(!disposed){dispose();notify(options.onError,undefined);}}
    finally {renderPending=false;void pump();}
  }
  const timeout=setTimeout(()=>{stopStatus="TIMED_OUT";dispose();},options.timeoutMs??120000);
  const result=(async():DisplayTask["result"] extends Promise<infer R>?Promise<R>:never=>{
    try {
      // Synchronous A1 play before the first await, exactly as in upload analysis.
      source=await createBrowserFrameSource(blob,controller.signal);
      if(disposed)throw new Error();
      if(source.durationMs>20000||source.durationMs<=0)throw new Error();
      worker=new Worker(new URL("./pose-display.worker.ts",import.meta.url),{type:"module",name:"tricksight-pose-display"});
      worker.addEventListener("message",event=>{
        const parsed=displayResponseSchema.safeParse(event.data);
        if(!parsed.success){terminate();if(ready){dispose();notify(options.onError,undefined);}return;}
        const {id:replyId,result:reply}=parsed.data;const p=pending.get(replyId);pending.delete(replyId);
        if(reply.type==="error"||parsed.data.generation!==p?.generation)p?.reject();else p?.resolve(reply);
      });
      worker.addEventListener("error",event=>{event.preventDefault();terminate();if(ready){dispose();notify(options.onError,undefined);}});
      const assets={...DEFAULT_POSE_ASSET_URLS,...options.assetUrls};
      await call({type:"initialize",assetUrls:assets,durationMs:source.durationMs,videoWidth:source.videoWidth,videoHeight:source.videoHeight});
      const offscreen=canvas.transferControlToOffscreen();
      await call({type:"attach",canvas:offscreen},[offscreen]);
      const count=Math.max(1,Math.floor(source.durationMs/100));
      for(let i=0;i<count;i++) {
        if(disposed)throw new Error();const bitmap=await source.frameAt(i*100,controller.signal);
        try {await call({type:"detect",bitmap,timestampMs:i*100},[bitmap]);}catch{bitmap.close();throw new Error();}
        if(i%5===0||i===count-1)notify(options.onProgress,i+1);
      }
      const response=await call({type:"finalize"});if(response.type!=="ready")throw new Error();
      ready=true;return {status:"READY",quality:response.quality};
    }catch {const status=disposed?stopStatus:"FAILED";dispose();return {status};}
    finally {clearTimeout(timeout);source?.close();source=null;}
  })();
  return {result,dispose,clear(){if(!ready||disposed)return;generation++;latest=null;void call({type:"clear"}).catch(()=>{});},
    render(time,width,height){if(!ready||disposed)return;latest={time,width,height,generation:++generation};void pump();}};
}
