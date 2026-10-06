import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
const root = 'scripts/pose-display-diagnostic';
// Only the bucket hostname is exposed, never credentials or environment values wholesale.
const bucket = process.env.S3_BUCKET_NAME;
const region = process.env.AWS_REGION;
const host = bucket && region ? `${bucket}.s3.${region}.amazonaws.com` : '';
const modules = ['browser-analysis','config','measurement','metrics','pose-landmarker.worker.ts'];
const wasm = ['vision_wasm_internal.js','vision_wasm_internal.wasm','vision_wasm_module_internal.js','vision_wasm_module_internal.wasm','vision_wasm_nosimd_internal.js','vision_wasm_nosimd_internal.wasm'];
const files = new Map([
  ['/',[`${root}/index.html`,'text/html']],
  ['/page.mjs',[`${root}/page.mjs`,'text/javascript']],
  ['/display-worker.mjs',[`${root}/display-worker.mjs`,'text/javascript']],
  ['/mediapipe/model',['eval/mediapipe-cache/pose_landmarker_full-float16-v1.task','application/octet-stream']],
  ['/pose-assets/tasks-vision-1.0.1/vision_bundle.mjs',['node_modules/@mediapipe/tasks-vision/vision_bundle.mjs','text/javascript']],
]);
for (const file of wasm) files.set(`/pose-assets/tasks-vision-1.0.1/wasm/${file}`,[`node_modules/@mediapipe/tasks-vision/wasm/${file}`,file.endsWith('.wasm')?'application/wasm':'text/javascript']);
const compiled = new Map();
for (const name of modules) compiled.set(`/pose/${name}`,ts.transpileModule(await readFile(`lib/pose/${name.endsWith('.ts')?name:name+'.ts'}`,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
export function createDiagnosticServer({ fixture = false } = {}) {
  return createServer(async (req,res) => {
    // No access logging, uploads, proxy, environment endpoint, or arbitrary file paths.
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; worker-src 'self'; connect-src 'self' ${host?'https://'+host:''}; media-src blob: ${fixture?"'self'":''} ${host?'https://'+host:''}; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
    if(req.method!=='GET' || req.url?.includes('?')) {res.writeHead(405).end();return;}
    try {
      if(fixture && req.url==='/app-harness') {res.setHeader('Content-Type','text/html');res.end((await readFile(`${root}/index.html`,'utf8')).replace('<script type="module" src="/page.mjs"></script>',''));return;}
      if(fixture && req.url==='/app-controller.mjs') {
        res.setHeader('Content-Type','text/javascript');
        const source=await readFile('lib/diagnostics/pose-display-controller.mjs','utf8');
        res.end(source.replace("'../pose/browser-analysis'","'/pose/browser-analysis'").replace('startPoseVideoAnalysis(blob,{onProgress:',"startPoseVideoAnalysis(blob,{assetUrls:{modelUrl:'/mediapipe/model',wasmLoaderMode:'MODULE'},onProgress:"));return;
      }
      if(fixture && req.url==='/display.worker.mjs') {res.setHeader('Content-Type','text/javascript');res.end(await readFile('lib/diagnostics/display.worker.mjs'));return;}
      if(req.url==='/config') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({host,fixture}));return;}
      if(compiled.has(req.url)) {res.setHeader('Content-Type','text/javascript');res.end(compiled.get(req.url));return;}
      const entry=files.get(req.url);
      if(entry) {res.setHeader('Content-Type',entry[1]);res.end(await readFile(resolve(entry[0])));return;}
      // Test-only local synthetic MIME fixtures. Never enable in a public tunnel.
      if(fixture && ['/fixture.mp4','/fixture.mov'].includes(req.url)) {
        res.setHeader('Content-Type',req.url.endsWith('.mov')?'video/quicktime':'video/mp4');
        res.end(await readFile('eval/input/kickflip_10.mp4'));return;
      }
      res.writeHead(404).end();
    } catch {res.writeHead(500).end('Diagnostic asset unavailable');}
  });
}
if(process.argv[1] && resolve(process.argv[1])===resolve(import.meta.filename)) {
  const port=Number(process.env.PORT??4175);
  createDiagnosticServer().listen(port,'127.0.0.1',()=>console.log(`Pose display diagnostic: http://127.0.0.1:${port} (no request logging)`));
}
