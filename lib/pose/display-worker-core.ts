import { calculatePoseMetrics, assessPoseQuality, type PoseFrame, type PoseLandmark } from "./metrics";
import { displaySeries, displaySample } from "./display-series";
import { drawPose } from "./display-drawing";
import { displayResponseSchema, type DisplayRequest, type DisplayResponse, type DisplayQuality } from "./display-protocol";
import type { DisplayLandmarker } from "./display-landmarker";
import type { PoseAssetUrls } from "./config";

const clonePose = (pose: PoseLandmark[] | undefined) => pose?.map(({x,y,z,visibility,presence})=>({x,y,z,visibility,presence})) ?? null;
export function createDisplayWorkerCore(createModel: (assets: PoseAssetUrls)=>Promise<DisplayLandmarker>) {
  // No accessor exports these arrays. They die with this Worker or dispose().
  let frames: PoseFrame[] = [];
  let series: ReturnType<typeof displaySeries> | null = null;
  let model: DisplayLandmarker | null = null;
  let canvas: OffscreenCanvas | null = null;
  let quality: DisplayQuality | null = null;
  let metadata: {durationMs:number;videoWidth:number;videoHeight:number} | null = null;
  let generation = -1, epoch = 0;
  function release() {
    epoch++; const retired=model, retiredCanvas=canvas;
    model=null;frames=[];series=null;quality=null;metadata=null;canvas=null;
    try {retired?.close();} catch {/* Drop references even if the model cleanup fails. */}
    try {if(retiredCanvas){retiredCanvas.width=1;retiredCanvas.height=1;}} catch {/* Detached canvas is already owned by the renderer. */}
  }
  return async function handle(request: DisplayRequest): Promise<DisplayResponse> {
    let result: DisplayResponse["result"];
    try {
      if(request.generation < generation) return displayResponseSchema.parse({id:request.id,generation:request.generation,result:{type:"error",code:"STALE"}});
      generation=request.generation;
      switch(request.type) {
        case "initialize": {
          release();
          if(!Number.isFinite(request.durationMs)||request.durationMs<=0||request.durationMs>20000||![request.videoWidth,request.videoHeight].every(n=>Number.isFinite(n)&&n>0)) throw new Error();
          const ownEpoch=epoch;
          const created=await createModel(request.assetUrls);
          if(ownEpoch!==epoch){created.close();return {id:request.id,generation:request.generation,result:{type:"error",code:"STALE"}};}
          model=created;metadata={durationMs:request.durationMs,videoWidth:request.videoWidth,videoHeight:request.videoHeight};
          result={type:"initialized"};break;
        }
        case "attach":
          if(!metadata||canvas)throw new Error();canvas=request.canvas;result={type:"attached"};break;
        case "detect": {
          if(!model||!metadata||series||frames.length>=Math.max(1,Math.floor(metadata.durationMs/100))||request.timestampMs!==frames.length*100)throw new Error();
          const start=performance.now();const pose=model.detectForVideo(request.bitmap,request.timestampMs);
          frames.push({timestampMs:request.timestampMs,inferenceMs:performance.now()-start,landmarks:clonePose(pose.landmarks[0]),worldLandmarks:clonePose(pose.worldLandmarks[0])});
          result={type:"progress",processedFrames:frames.length};break;
        }
        case "finalize": {
          if(!model||!metadata||frames.length!==Math.max(1,Math.floor(metadata.durationMs/100)))throw new Error();
          const metrics=calculatePoseMetrics({ ...metadata, mode:"fixed",fixedFps:10,initializationMs:0,processingMs:0,presentedFrameGaps:0,frames });
          quality={status:assessPoseQuality(metrics).status,frameCount:frames.length,poseCoverage:metrics.poseCoverage,lowerBodyCoverage:metrics.lowerBodyCoverage};
          series=displaySeries(frames);model.close();model=null;
          result={type:"ready",quality};break;
        }
        case "render": {
          if(!series||!metadata||!canvas||!quality) {
            result={type:"sample",sample:{playbackTimestampMs:request.playbackTimestampMs,sampleTimestampMs:null,values:{meanKneeAngleDeg:null,hipRelativeHeightTorsoUnits:null},missingReasons:["NOT_READY"],drawnPointCount:0}};break;
          }
          if(![request.width,request.height].every(n=>Number.isInteger(n)&&n>0)||request.width*request.height>4000000||!Number.isFinite(request.playbackTimestampMs))throw new Error();
          if(canvas.width!==request.width)canvas.width=request.width;
          if(canvas.height!==request.height)canvas.height=request.height;
          const {index,sample}=displaySample(frames,series,metadata.durationMs,quality.status==="ASSESSABLE",request.playbackTimestampMs);
          sample.drawnPointCount=drawPose(canvas,index<0?null:frames[index]!.landmarks,metadata.videoWidth,metadata.videoHeight);
          result={type:"sample",sample};break;
        }
        case "clear":
          if(canvas)canvas.getContext("2d")?.clearRect(0,0,canvas.width,canvas.height);
          result={type:"cleared"};break;
        case "dispose": release();result={type:"disposed"};break;
        default: throw new Error();
      }
    } catch {release();result={type:"error",code:"FAILED"};}
    finally {if(request.type==="detect")request.bitmap.close();}
    // Runtime allowlist is the sole outgoing boundary; extra fields/point arrays are rejected.
    return displayResponseSchema.parse({id:request.id,generation:request.generation,result});
  };
}
