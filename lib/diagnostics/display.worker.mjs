let canvas;
onmessage = ({data}) => {
  try {
    if(data.type==='attach') {canvas=data.canvas; postMessage({type:'attached'});return;}
    if(data.type==='draw') {
      canvas.width=data.width;canvas.height=data.height;
      const ctx=canvas.getContext('2d');
      const scale=Math.min(canvas.width/data.videoWidth,canvas.height/data.videoHeight);
      const w=data.videoWidth*scale,h=data.videoHeight*scale,x=(canvas.width-w)/2,y=(canvas.height-h)/2;
      ctx.clearRect(0,0,canvas.width,canvas.height);ctx.strokeStyle='#00ff88';ctx.lineWidth=3;
      ctx.strokeRect(x+3,y+3,w-6,h-6);ctx.beginPath();ctx.moveTo(x+w/2-12,y+h/2);ctx.lineTo(x+w/2+12,y+h/2);ctx.moveTo(x+w/2,y+h/2-12);ctx.lineTo(x+w/2,y+h/2+12);ctx.stroke();
      // Readback demonstrates that the transferred display surface was drawn.
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      let painted=false;for(let i=3;i<pixels.length;i+=4)if(pixels[i]){painted=true;break;}
      postMessage({type:'drawn',painted});
    }
  } catch {postMessage({type:'failed'});}
};
