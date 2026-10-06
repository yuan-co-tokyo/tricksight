import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
import { createDiagnosticServer } from './server.mjs';
const server=createDiagnosticServer({fixture:true});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
try {
  for(const [name,type] of [['Chromium',chromium],['WebKit',webkit]]) {
    const browser=await type.launch({headless:true});
    try {
      const page=await browser.newPage();const errors=[];const forbidden=[];
      page.on('pageerror',()=>errors.push('pageerror'));
      page.on('request',r=>{if(r.method()!=='GET'||!(r.url().startsWith(origin+'/')||r.url().startsWith('blob:'+origin+'/')))forbidden.push('unexpected request');});
      await page.goto(origin);
      for(const extension of ['mp4','mov']) {
        await page.locator('#url').fill(`${origin}/fixture.${extension}`);await page.locator('#fetch').click();
        await page.waitForFunction(()=>JSON.parse(document.querySelector('#report').textContent).state==='READY_TO_START');
        assert.equal(await page.locator('#url').inputValue(),'');
        await page.locator('#start').click();
        await page.waitForFunction(()=>JSON.parse(document.querySelector('#report').textContent).state==='FINISHED',{},{timeout:120000});
        await page.waitForFunction(()=>JSON.parse(document.querySelector('#report').textContent).displayPainted===true);
        const result=JSON.parse(await page.locator('#report').textContent());
        assert.equal(result.analysisStatus,'COMPLETED');assert.equal(result.synchronousPlayCalls,1);assert.equal(result.peakVideoElements,2);assert.equal(result.pixelReadable,true);assert.equal(result.pixelNonUniform,true);assert(result.frameCount>0);
        // Seek/resize draw; native playback survives completion.
        await page.setViewportSize({width:320,height:700});
        await page.locator('#video').evaluate(async v=>{v.currentTime=1;await v.play();});
        await page.waitForFunction(()=>document.querySelector('#video').currentTime>1.1);
        await page.locator('#stop').click();
        assert.equal(await page.locator('video').count(),1);assert.equal(await page.locator('#video').getAttribute('src'),null);
        console.log(JSON.stringify({browser:name,mime:extension,...result}));
      }
      // Fetch failure preserves native video playback; no proxy/fallback fetch.
      await page.route('**/fixture.mp4',route=>route.request().resourceType()==='fetch'?route.abort():route.continue());
      await page.locator('#url').fill(`${origin}/fixture.mp4`);await page.locator('#fetch').click();
      await page.waitForFunction(()=>JSON.parse(document.querySelector('#report').textContent).state==='FETCH_FAILED_OR_CORS_BLOCKED');
      await page.locator('#video').evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('#video').currentTime>.1);
      await page.unroute('**/fixture.mp4');await page.locator('#stop').click();
      // Simulated unsupported display transfer does not prevent analysis/playback.
      await page.evaluate(()=>{window.savedTransfer=HTMLCanvasElement.prototype.transferControlToOffscreen;HTMLCanvasElement.prototype.transferControlToOffscreen=function(){throw new Error('simulated unsupported');};});
      await page.locator('#url').fill(`${origin}/fixture.mp4`);await page.locator('#fetch').click();await page.waitForFunction(()=>!document.querySelector('#start').disabled);await page.locator('#start').click();
      await page.waitForFunction(()=>JSON.parse(document.querySelector('#report').textContent).state==='FINISHED',{},{timeout:120000});
      const fallback=JSON.parse(await page.locator('#report').textContent());assert.equal(fallback.displayError,true);assert.equal(fallback.analysisStatus,'COMPLETED');assert.equal(fallback.visiblePlay,true);
      await page.evaluate(()=>{HTMLCanvasElement.prototype.transferControlToOffscreen=window.savedTransfer;delete window.savedTransfer;});await page.locator('#stop').click();
      // Cancel while measuring, re-create canvas, then background while ready.
      await page.locator('#url').fill(`${origin}/fixture.mp4`);await page.locator('#fetch').click();await page.locator('#start').waitFor({state:'visible'});
      await page.waitForFunction(()=>!document.querySelector('#start').disabled);await page.locator('#start').click();await page.locator('#stop').click();
      await page.waitForFunction(()=>document.querySelectorAll('video').length===1);
      assert.equal(JSON.parse(await page.locator('#report').textContent()).state,'DISPOSED');
      await page.locator('#url').fill(`${origin}/fixture.mp4`);await page.locator('#fetch').click();await page.waitForFunction(()=>!document.querySelector('#start').disabled);
      await page.evaluate(()=>dispatchEvent(new Event('pagehide')));assert.equal(JSON.parse(await page.locator('#report').textContent()).state,'BACKGROUND_DISPOSED');
      await page.locator('#url').fill('https://not-allowed.example/private');await page.locator('#fetch').click();assert.equal(JSON.parse(await page.locator('#report').textContent()).state,'INVALID_URL');
      assert.deepEqual(errors,[]);assert.deepEqual(forbidden,[]);
      assert.equal((await page.request.post(origin+'/upload',{data:'x'})).status(),405);
      console.log(name+' cleanup/background/invalid URL/no upload passed');
    } finally {await browser.close();}
  }
} finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
