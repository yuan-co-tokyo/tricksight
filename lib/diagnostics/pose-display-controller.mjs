import { startPoseVideoAnalysis } from '../pose/browser-analysis';

// Temporary T12-2a controller: no persistence, logging, or point-array messages.
export function mountPoseDisplayDiagnostic(root, playbackUrl) {
const $=id=>root.querySelector('[data-diagnostic="'+id+'"]');
let blob=null,objectUrl=null,task=null,controller=null,display=null,generation=0,timer=null,drawPending=false;
let report={state:'IDLE'};
const render=()=>{$('report').textContent=JSON.stringify(report,null,2);$('status').textContent=report.state;};
const releaseOverlay=()=>{display?.terminate();display=null;drawPending=false;const fresh=document.createElement('canvas');fresh.dataset.diagnostic='overlay';fresh.className=$('overlay').className;$('overlay').replaceWith(fresh);};
function cleanup(clearVideo=true) {
  generation++;clearTimeout(timer);controller?.abort();controller=null;task?.cancel();task=null;blob=null;releaseOverlay();$('start').disabled=true;$('fetch').disabled=false;
  if(clearVideo){$('video').pause();$('video').removeAttribute('src');$('video').load();if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;}
}
$('fetch').onclick=async()=>{
  cleanup();const own=generation;
  report={state:'FETCHING',fetchMs:null,blobBytes:null,blobType:null,analysisMs:null,analysisStatus:null,frameCount:null,synchronousPlayCalls:0,pixelReadable:false,pixelNonUniform:false,displayTransferred:false,displayPainted:false,peakVideoElements:0,cleanup:false};render();
  const url=new URL(playbackUrl);
  // Native playback remains independently available when CORS fetch fails.
  $('video').src=url.href;
  controller=new AbortController();timer=setTimeout(()=>controller?.abort(),120000);$('fetch').disabled=true;
  const started=performance.now();
  try {
    const response=await fetch(url.href,{mode:'cors',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',redirect:'error',signal:controller.signal});
    if(!response.ok||response.type==='opaque')throw Error();
    const length=Number(response.headers.get('content-length'));if(length>100*1024*1024)throw Error();
    const reader=response.body.getReader(),parts=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>100*1024*1024){await reader.cancel();throw Error();}parts.push(value);}
    if(own!==generation)return;
    blob=new Blob(parts,{type:response.headers.get('content-type')?.split(';')[0]||'video/mp4'});
    objectUrl=URL.createObjectURL(blob);$('video').src=objectUrl;
    report={...report,state:'READY_TO_START',fetchMs:Math.round(performance.now()-started),blobBytes:blob.size,blobType:['video/mp4','video/quicktime'].includes(blob.type)?blob.type:'other'};$('start').disabled=false;
  }catch {if(own!==generation)return;report.state='FETCH_FAILED_OR_CORS_BLOCKED';}
  finally {if(own===generation){clearTimeout(timer);$('fetch').disabled=false;render();}}
};
function draw(){
  if(!display||drawPending||!$('video').videoWidth)return;
  const rect=$('video').getBoundingClientRect();const dpr=Math.min(devicePixelRatio,2,Math.sqrt(4000000/Math.max(1,rect.width*rect.height)));
  drawPending=true;display.postMessage({type:'draw',width:Math.max(1,Math.floor(rect.width*dpr)),height:Math.max(1,Math.floor(rect.height*dpr)),videoWidth:$('video').videoWidth,videoHeight:$('video').videoHeight});
}
$('start').onclick=async()=>{
  if(!blob||task)return;const own=generation;const started=performance.now();$('start').disabled=true;$('fetch').disabled=true;report.state='MEASURING';
  // startPoseVideoAnalysis invokes A1 play before this handler's first await.
  const original=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(){report.synchronousPlayCalls++;return original.call(this);};
  try {task=startPoseVideoAnalysis(blob,{onProgress:p=>{if(own===generation){report.processedFrames=p.processedFrames;render();}}});}
  finally {HTMLMediaElement.prototype.play=original;}
  report.peakVideoElements=document.querySelectorAll('video').length;
  $('video').play().then(()=>{if(own===generation){report.visiblePlay=true;render();}},()=>{if(own===generation){report.visiblePlay=false;render();}});
  try {
    // Independent of the inference Worker. A failed display capability must not stop normal playback.
    display=new Worker(new URL('./display.worker.mjs', import.meta.url), { type: 'module' });
    const canvas=$('overlay').transferControlToOffscreen();report.displayTransferred=true;
    display.onmessage=({data})=>{if(own!==generation)return;if(data.type==='attached')draw();if(data.type==='drawn'){drawPending=false;report.displayPainted=data.painted;}if(data.type==='failed'){releaseOverlay();report.displayError=true;}render();};
    display.onerror=event=>{event.preventDefault();if(own!==generation)return;releaseOverlay();report.displayError=true;render();};
    display.postMessage({type:'attach',canvas},[canvas]);
  }catch {releaseOverlay();report.displayError=true;}
  render();
  const result=await task.result;if(own!==generation)return;task=null;
  report.analysisMs=Math.round(performance.now()-started);report.analysisStatus=result.status;report.frameCount=result.quality?.frameCount??null;
  try {const c=document.createElement('canvas');c.width=32;c.height=32;const ctx=c.getContext('2d');ctx.drawImage($('video'),0,0,32,32);const bytes=ctx.getImageData(0,0,32,32).data;report.pixelReadable=true;report.pixelNonUniform=bytes.some((v,i)=>i%4!==3&&v!==bytes[i%4]);}catch {report.pixelReadable=false;}
  report.state='FINISHED';blob=null;$('fetch').disabled=false;draw();render();
};
$('stop').onclick=()=>{cleanup();report={...report,state:'DISPOSED',cleanup:true,remainingVideoElements:document.querySelectorAll('video').length};render();};
const videoEvents=['loadeddata','seeked','play','pause'];
for(const event of videoEvents)$('video').addEventListener(event,draw);
const observer=new ResizeObserver(draw);observer.observe($('video'));
const hide=()=>{$('overlay').hidden=true;};const show=()=>{$('overlay').hidden=false;draw();};
for(const event of ['webkitbeginfullscreen','enterpictureinpicture'])$('video').addEventListener(event,hide);
for(const event of ['webkitendfullscreen','leavepictureinpicture'])$('video').addEventListener(event,show);
function background(){cleanup();report={...report,state:'BACKGROUND_DISPOSED',cleanup:true};render();}
const visibility=()=>{if(document.hidden)background();};
addEventListener('pagehide',background);document.addEventListener('visibilitychange',visibility);
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(report,null,2));}catch{$('status').textContent='コピーできません。診断JSON部分だけ選択してください。';}};
render();

return () => {cleanup();for(const event of videoEvents)$('video').removeEventListener(event,draw);for(const event of ['webkitbeginfullscreen','enterpictureinpicture'])$('video').removeEventListener(event,hide);for(const event of ['webkitendfullscreen','leavepictureinpicture'])$('video').removeEventListener(event,show);observer.disconnect();removeEventListener('pagehide',background);document.removeEventListener('visibilitychange',visibility);for(const id of ['fetch','start','stop','copy'])$(id).onclick=null;};
}
