// Uses the real application controller, replacing only Worker asset URLs for the standalone server.
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
      const page=await browser.newPage();const errors=[],unexpected=[];
      page.on('pageerror',()=>errors.push('error'));
      page.on('request',r=>{if(r.method()!=='GET'||!(r.url().startsWith(origin+'/')||r.url().startsWith('blob:'+origin+'/')))unexpected.push('unexpected');});
      await page.goto(origin+'/app-harness');
      // Use the established harness DOM; remove all signed URL input and replace old listeners.
      await page.evaluate(async()=>{
        document.querySelector('#url').remove();
        for(const id of ['fetch','start','stop','copy','video','overlay','status','report']){
          const old=document.getElementById(id),fresh=old.cloneNode(true);fresh.dataset.diagnostic=id;old.replaceWith(fresh);
        }
        const {mountPoseDisplayDiagnostic}=await import('/app-controller.mjs');
        window.mountApp=()=>{window.unmountApp=mountPoseDisplayDiagnostic(document.body,location.origin+'/fixture.mp4');};
        window.mountApp();
      });
      for(let round=0;round<3;round++) {
        await page.locator('#fetch').click();await page.waitForFunction(()=>!document.querySelector('[data-diagnostic=start]').disabled);
        await page.locator('#start').click();await page.waitForFunction(()=>JSON.parse(document.querySelector('#report').textContent).state==='FINISHED',{},{timeout:120000});
        await page.waitForFunction(()=>JSON.parse(document.querySelector('#report').textContent).displayPainted);
        const r=JSON.parse(await page.locator('#report').textContent());
        assert.equal(r.analysisStatus,'COMPLETED');assert.equal(r.synchronousPlayCalls,1);assert.equal(r.peakVideoElements,2);assert.equal(r.pixelNonUniform,true);assert.equal(r.visiblePlay,true);
        assert(!JSON.stringify(r).includes(origin));
        await page.locator('#stop').click();assert.equal(await page.locator('video').count(),1);
        console.log(JSON.stringify({browser:name,round:round+1,analysisMs:r.analysisMs,frameCount:r.frameCount,displayPainted:r.displayPainted}));
      }
      // Simulate expired signed GET (403) without logging URL or replacing native playback.
      await page.route('**/fixture.mp4',route=>route.request().resourceType()==='fetch'?route.fulfill({status:403,body:'private failure text'}):route.continue());
      await page.locator('#fetch').click();await page.waitForFunction(()=>JSON.parse(document.querySelector('#report').textContent).state==='FETCH_FAILED_OR_CORS_BLOCKED');
      assert(!(await page.locator('#report').textContent()).includes('private failure text'));
      await page.locator('#video').evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('#video').currentTime>.1);
      await page.unroute('**/fixture.mp4');await page.locator('#stop').click();
      // Simulates React StrictMode effect cleanup/re-mount: no stale listeners or video sources.
      await page.evaluate(()=>{window.unmountApp();window.mountApp();});
      await page.locator('#fetch').click();await page.waitForFunction(()=>!document.querySelector('[data-diagnostic=start]').disabled);await page.locator('#start').click();
      await page.evaluate(()=>{window.unmountApp();});await page.waitForFunction(()=>document.querySelectorAll('video').length===1);
      assert.equal(await page.locator('#video').getAttribute('src'),null);
      assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
    } finally {await browser.close();}
  }
} finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
