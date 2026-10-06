import type { PoseLandmark } from "./metrics";
import { drawable } from "./display-series";
// MediaPipe pose topology, kept inside the Worker with the point coordinates.
export const POSE_CONNECTIONS: readonly (readonly [number, number])[] = [
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
  [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
  [12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
  [11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28],
  [27,29],[28,30],[29,31],[30,32],[27,31],[28,32],
];
export function containRect(width: number, height: number, videoWidth: number, videoHeight: number) {
  const scale = Math.min(width/videoWidth, height/videoHeight);
  const w=videoWidth*scale,h=videoHeight*scale;
  return {x:(width-w)/2,y:(height-h)/2,width:w,height:h};
}
export function drawPose(canvas: OffscreenCanvas, points: PoseLandmark[] | null, videoWidth: number, videoHeight: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if (!points || points.length < 33) return 0;
  const rect=containRect(canvas.width,canvas.height,videoWidth,videoHeight);
  const xy=(i:number)=>({x:rect.x+points[i]!.x*rect.width,y:rect.y+points[i]!.y*rect.height});
  ctx.strokeStyle="#00ff88";ctx.fillStyle="#00ff88";ctx.lineWidth=2;
  for(const [a,b] of POSE_CONNECTIONS) if(drawable(points[a])&&drawable(points[b])) {
    const p=xy(a),q=xy(b);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();
  }
  let count=0;
  points.forEach((p,i)=>{if(drawable(p)){const q=xy(i);ctx.beginPath();ctx.arc(q.x,q.y,3,0,Math.PI*2);ctx.fill();count++;}});
  return count;
}
