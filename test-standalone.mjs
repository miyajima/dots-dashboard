import {harness} from './test-provenance/harness.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const root=process.argv[2]||new URL('.',import.meta.url).pathname.replace(/\/$/,'');
const {default:worker}=await import(pathToFileURL(root+'/dist/server/index.js').href+'?review='+Date.now());
const origin='https://offline.example';const fixture=await harness();
const call=(pathname,method='GET',auth=true)=>worker.fetch(new Request(origin+pathname,{method,headers:auth?{'oai-authenticated-user-id':'offline-reviewer'}:{}}),{DB:fixture.db});
const html=await (await call('/')).text();
const manifestTag=html.match(/<link\b[^>]*\brel=["']manifest["'][^>]*>/i)?.[0];
assert(manifestTag,'HTML must link an app manifest');
assert.match(manifestTag,/crossorigin=["']use-credentials["']/i,'Authenticated manifest must carry credentials');
const manifestPath=manifestTag.match(/href=["']([^"']+)/i)?.[1];assert(manifestPath?.startsWith('/'));
const res=await call(manifestPath);assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/manifest\+json|application\/json/);
const manifest=await res.json();assert.equal(manifest.display,'standalone');assert(manifest.name&&manifest.short_name);assert(new URL(manifest.start_url,origin).origin===origin);assert(new URL(manifest.scope,origin).origin===origin);assert(manifest.icons.length>=1);
assert.match(html,/<meta\b(?=[^>]*name=["']apple-mobile-web-app-capable["'])(?=[^>]*content=["']yes["'])[^>]*>/i);
const appleTag=html.match(/<link\b[^>]*rel=["']apple-touch-icon["'][^>]*>/i)?.[0];assert(appleTag);
const applePath=appleTag.match(/href=["']([^"']+)/i)[1];
const paths=new Set(['/',manifestPath,applePath,...manifest.icons.map(x=>x.src)]);
for(const pathname of paths){assert(pathname.startsWith('/'));const allowed=await call(pathname);assert.equal(allowed.status,200,pathname);assert.match(allowed.headers.get('cache-control'),/private/);assert.match(allowed.headers.get('cache-control'),/no-store/);assert.equal(allowed.headers.get('x-content-type-options'),'nosniff');assert.equal((await call(pathname,'GET',false)).status,401,pathname+' anonymous GET');assert.equal((await call(pathname,'HEAD',false)).status,401,pathname+' anonymous HEAD');const head=await call(pathname,'HEAD');assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);assert.equal((await call(pathname,'POST')).status,405);}
for(const icon of manifest.icons){if(icon.type==='image/png'){const bytes=Buffer.from(await (await call(icon.src)).arrayBuffer());assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));const dimensions=icon.sizes.split('x').map(Number);assert.equal(bytes.readUInt32BE(16),dimensions[0]);assert.equal(bytes.readUInt32BE(20),dimensions[1]);}}
assert.equal((await call('/sw.js')).status,404);assert.equal((await call('/unknown-icon.png')).status,404);assert(!/serviceWorker\.register/.test(html));
assert(!/serviceWorker\.register/.test(readFileSync(root+'/dashboard.js','utf8')));
console.log('PASS: standalone manifest with credentialed fetch, Apple metadata/icons, PNG dimensions, authenticated GET/HEAD, no-store, 401/405/404, and no service-worker registration');

assert.match(html,/html\[data-standalone=true\] \[data-sites-widget="editor-composer"\]\{display:none!important\}/,'Editor bar hiding must be explicitly standalone-scoped');
