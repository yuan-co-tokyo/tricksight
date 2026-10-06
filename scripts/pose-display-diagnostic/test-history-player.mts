/* eslint-disable @typescript-eslint/no-explicit-any -- Browser fixture globals deliberately model malformed and delayed replies. */
// Actual product markup + controller + display Worker; fixture-only assets, no user data.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile, readdir } from "node:fs/promises";
import { chromium, webkit, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const PoseVideoPlayer = createRequire(import.meta.url)("../../app/(protected)/history/[sessionId]/pose-video-player.tsx").default;
import { createDiagnosticServer } from "./server.mjs";
const cssFiles=(await readdir('.next/static/chunks')).filter(f=>f.endsWith('.css'));
const css=(await Promise.all(cssFiles.map(f=>readFile('.next/static/chunks/'+f,'utf8')))).join('\n');
const markup=renderToStaticMarkup(React.createElement(PoseVideoPlayer,{playbackUrl:"/fixture.mp4",filename:"test.mp4",savedStatus:"COMPLETED"}));
const server=createDiagnosticServer({fixture:true,playerHtml:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><main style="padding:16px;max-width:700px;margin:auto">${markup}<a href="#analysis" id="analysis">AI分析を見る</a><button id="reanalyze">再分析</button><button id="delete">削除</button></main>`});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
async function mount(page:Page,mode="real",timeoutMs=120000){
  await page.evaluate(async({mode,timeoutMs})=>{
    const w=window as any; // Test harness only, no production global state.
    w.__name=(fn:any)=>fn; // tsx may name nested mock functions in evaluate.
    w.cleanup?.();w.disposals=0;w.starts=0;w.synchronousPlays=0;
    const {mountPosePlayer}=await import(/* webpackIgnore: true */ String('/pose/player/controller'));
    const load=mode==='real'?undefined:async()=>({startPoseDisplay:(_blob:any,_canvas:any,options:any)=>{
      w.starts++;let closed=false;
      const status=mode==='partial'?'UNASSESSABLE':'ASSESSABLE';
      const sample={playbackTimestampMs:3000,sampleTimestampMs:3000,values:{meanKneeAngleDeg:mode==='partial'?null:120,hipRelativeHeightTorsoUnits:mode==='partial'?null:1},missingReasons:mode==='partial'?['GLOBAL_QUALITY']:['PARTIAL_SKELETON'],drawnPointCount:24};
      w.late=()=>options.onSample(sample);w.fail=()=>options.onError();
      return {result: mode==='pending'?new Promise(resolve=>{w.resolve=resolve;}):Promise.resolve(['FAILED','CANCELED','TIMED_OUT'].includes(mode)?{status:mode}:{status:'READY',quality:{status,frameCount:89,poseCoverage:1,lowerBodyCoverage:1}}),render(){if(!closed)options.onSample(sample);},clear(){},dispose(){closed=true;w.disposals++;}};
    }});
    w.cleanup=mountPosePlayer(document.querySelector('[data-pose-player]'),'/fixture.mp4',{load,timeoutMs});
    document.querySelector<HTMLButtonElement>('#reanalyze')!.onclick=()=>{w.reanalyzed=true;};
    document.querySelector<HTMLButtonElement>('#delete')!.onclick=()=>{w.cleanup();w.deleted=true;};
    const original=HTMLMediaElement.prototype.play;
    w.originalPlay??=original;
    HTMLMediaElement.prototype.play=function(){w.synchronousPlays++;return w.originalPlay.call(this);};
  },{mode,timeoutMs});
}
const el=(page:Page,name:string)=>page.locator(`[data-pose="${name}"]`);
async function prepare(page:Page){await el(page,'fetch').click();await el(page,'start').waitFor({state:'visible'}).catch(async e=>{console.log('prepare:',await el(page,'status').textContent());throw e;});await el(page,'start').click();}
try{
  for(const [name,browserType] of [['Chromium',chromium],['WebKit',webkit]] as const){
    const browser=await browserType.launch({headless:true});
    try{
      const page=await browser.newPage({viewport:{width:320,height:850}});const errors:string[]=[],requests:string[]=[];
      page.on('pageerror',e=>errors.push(e.name));
      page.on('request',r=>{if(r.method()!=='GET'||(!r.url().startsWith(origin)&&!r.url().startsWith('blob:')))requests.push('unexpected');});
      await page.goto(origin+'/player-harness');await mount(page);
      await page.screenshot({path:'/tmp/pose-width.png',fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true, await page.evaluate(()=>Array.from(document.querySelectorAll('*')).filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>e.tagName+' '+e.className).join('; ')));
      await prepare(page);await el(page,'toggle').waitFor({state:'visible',timeout:120000});
      assert.equal(await page.evaluate(()=>(window as any).synchronousPlays),1);
      await el(page,'video').evaluate((v:HTMLVideoElement)=>{v.pause();v.currentTime=3;});
      await page.waitForFunction(()=>document.querySelector('[data-pose=times]')!.textContent!.includes('計測 3.00秒')).catch(async e=>{ console.log(await el(page,'status').textContent(),await el(page,'times').textContent(),errors);await page.screenshot({path:'/tmp/pose-failed.png',fullPage:true});throw e;});
      assert.notEqual(await el(page,'knee').textContent(),'—');
      await page.screenshot({path:`/tmp/pose-product-${name}.png`,fullPage:true});
      await el(page,'toggle').click();assert.equal(await el(page,'values').isVisible(),false);
      await el(page,'toggle').click();await el(page,'values').waitFor({state:'visible'});
      await el(page,'forward').focus();await page.keyboard.press('Enter');
      await page.waitForFunction(()=>Math.abs((document.querySelector('[data-pose=video]') as HTMLVideoElement).currentTime-3.1)<.01);
      await el(page,'speed').selectOption('0.5');assert.equal(await el(page,'video').evaluate((v:HTMLVideoElement)=>v.playbackRate),.5);
      await page.setViewportSize({width:700,height:400});await page.waitForTimeout(100);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await el(page,'video').evaluate(v=>v.dispatchEvent(new Event('enterpictureinpicture')));assert.equal(await el(page,'overlay').isVisible(),false);
      await el(page,'video').evaluate(v=>v.dispatchEvent(new Event('leavepictureinpicture')));
      await el(page,'stop').click();assert.equal(await el(page,'video').getAttribute('src'),'/fixture.mp4');assert.equal(await el(page,'knee').textContent(),'—');
      await el(page,'video').evaluate((v:HTMLVideoElement)=>v.play());await page.waitForTimeout(100);assert.equal(await el(page,'video').evaluate((v:HTMLVideoElement)=>v.paused),false);await el(page,'video').evaluate((v:HTMLVideoElement)=>v.pause());
      // Failures never replace native video or disable unrelated page actions.
      for(const status of [401,403,404]){
        await page.route('**/fixture.mp4',r=>r.request().resourceType()==='fetch'?r.fulfill({status,body:'private error'}):r.continue());
        await mount(page);await el(page,'fetch').click();await page.waitForFunction(()=>document.querySelector('[data-pose=status]')!.textContent!.includes('準備できませんでした'));
        assert(!(await page.content()).includes('private error'));assert.equal(await el(page,'video').getAttribute('src'),'/fixture.mp4');await page.locator('#reanalyze').click();assert(await page.evaluate(()=>(window as any).reanalyzed));await page.unroute('**/fixture.mp4');
      }
      for(const mode of ['FAILED','TIMED_OUT','CANCELED','partial','valid']){
        console.log('checking',name,mode);await mount(page,mode);await prepare(page);
        if(['partial','valid'].includes(mode)){
          await el(page,'toggle').waitFor({state:'visible'});
          assert.equal(await el(page,'knee').textContent(),mode==='partial'?'—':'120.0°');
          if(mode==='valid')assert((await el(page,'detection').textContent())!.includes('骨格の一部'));
          await el(page,'toggle').click();assert.equal(await page.evaluate(()=>(window as any).disposals),0);
          await el(page,'toggle').click();
          await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
          await page.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));(window as any).late();});
          assert.equal(await el(page,'knee').textContent(),'—');assert.equal(await el(page,'overlay').isVisible(),false);assert.equal(await page.evaluate(()=>(window as any).starts),1);
        }else await page.waitForFunction(()=>document.querySelector('[data-pose=status]')!.textContent!.includes('準備できませんでした'));
      }
      // Cancellation while inference is pending, followed by a late completion/sample.
      await mount(page,'pending');await prepare(page);await el(page,'stop').click();
      await page.evaluate(()=>{(window as any).resolve({status:'READY',quality:{status:'ASSESSABLE'}});(window as any).late();});
      assert.equal(await el(page,'knee').textContent(),'—');assert.equal(await page.evaluate(()=>(window as any).disposals),1);
      // Fetch timeout and non-support, with no inference start.
      await page.route('**/fixture.mp4',async r=>{if(r.request().resourceType()==='fetch'){await new Promise(resolve=>setTimeout(resolve,100));await r.fulfill({status:403}).catch(()=>{});}else await r.continue();});
      await mount(page,'valid',20);await el(page,'fetch').click();await page.waitForFunction(()=>document.querySelector('[data-pose=status]')!.textContent!.includes('準備できませんでした'));await page.unroute('**/fixture.mp4');
      await mount(page,'valid');await page.evaluate(()=>{(window as any).transfer=HTMLCanvasElement.prototype.transferControlToOffscreen;(HTMLCanvasElement.prototype as any).transferControlToOffscreen=undefined;});
      await el(page,'fetch').click();assert((await el(page,'status').textContent())!.includes('準備できませんでした'));await page.evaluate(()=>{HTMLCanvasElement.prototype.transferControlToOffscreen=(window as any).transfer;});
      // Deletion/route unmount after a successful preparation clears retained content.
      await mount(page,'valid');await prepare(page);await el(page,'toggle').waitFor({state:'visible'});await page.locator('#delete').click();assert.equal(await el(page,'overlay').count(),0);
      assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
      console.log(`${name}: product playback, 320px, real skeleton, saved-independent UI, failures, timeout, cancel, bfcache and unmount passed`);
    }finally{await browser.close();}
  }
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
