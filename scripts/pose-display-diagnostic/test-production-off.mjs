// Run after pnpm build; never authenticates or reads user data.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const env={...process.env};delete env.POSE_DISPLAY_DIAGNOSTIC_ENABLED;delete env.POSE_DISPLAY_DIAGNOSTIC_USER_IDS;
delete env.POSE_VIEWER_ENABLED;delete env.POSE_VIEWER_AUDIENCE;delete env.POSE_VIEWER_USER_IDS;
const port=4187,origin=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,stdio:'ignore'});
let browser;
try {
  let ready=false;
  for(let i=0;i<80;i++){try{const r=await fetch(origin+'/login');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
  assert(ready,'production server ready');
  for(const path of ['/diagnostics/identity','/diagnostics/pose-display/00000000-0000-4000-8000-000000000001']) {
    const r=await fetch(origin+path);assert.equal(r.status,404);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(r.headers.get('referrer-policy'),'no-referrer');
  }
  for(const path of ['/history','/videos/new']) {
    const r=await fetch(origin+path,{redirect:'manual'});assert.equal(r.status,307);assert.equal(new URL(r.headers.get('location'),origin).pathname,'/login');
  }
  browser=await chromium.launch({headless:true});const page=await browser.newPage();let workers=0;const requests=[];
  page.on('worker',()=>workers++);page.on('request',r=>requests.push(r.url()));
  await page.goto(origin+'/diagnostics/pose-display/00000000-0000-4000-8000-000000000001',{waitUntil:'networkidle'});
  assert.equal(workers,0);assert.equal(await page.locator('[data-diagnostic]').count(),0);
  assert(!requests.some(url=>url.includes('amazonaws.com')||url.includes('pose-assets')||url.includes('mediapipe')));
  console.log('Production OFF: diagnostic routes 404/no-store, no Worker/model/S3; history and videos/new retain login redirects');
} finally {await browser?.close();server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}
