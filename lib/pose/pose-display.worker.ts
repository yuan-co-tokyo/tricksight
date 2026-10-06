import { createDisplayWorkerCore } from "./display-worker-core";
import { createDisplayLandmarker } from "./display-landmarker";
import type { DisplayRequest } from "./display-protocol";
const handle = createDisplayWorkerCore(createDisplayLandmarker);
// Serial processing: one bitmap in flight and no concurrent model mutation.
let queue=Promise.resolve();
self.addEventListener("message", (event: MessageEvent<DisplayRequest>) => {
  const request=event.data;
  if(!request || !Number.isSafeInteger(request.id) || request.id<0 || !Number.isSafeInteger(request.generation) || request.generation<0) {
    try {if(request?.type==="detect")request.bitmap.close();} catch {}
    return;
  }
  queue=queue.then(async()=>{self.postMessage(await handle(request));}).catch(()=>{
    self.postMessage({id:request.id,generation:request.generation,result:{type:"error",code:"FAILED"}});
  });
});
