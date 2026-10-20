// Offline structural counts + controlled-latency DOM fixture measurements.
// No browser, network, real account data, deployment or task execution.
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {gzipSync} from 'node:zlib';

const [baseline,candidate]=process.argv.slice(2).map(p=>resolve(p));
if(!baseline||!candidate)throw Error('Usage: node benchmark-performance.mjs BASELINE_ROOT CANDIDATE_ROOT');
const owner='a'.repeat(64),median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
async function measure(root){
 const {harness}=await import(pathToFileURL(root+'/test-provenance/harness.mjs'));
 const h=await harness(),p=h.projects[0],source=(await h.service.postUserMessage(p,{clientId:'benchmark_source',text:'Synthetic benchmark fixture'})).message;
 for(let n=0;n<30;n++)await h.service.createTask(p,{clientId:'benchmark_task_'+n,sourceMessageId:source.id,title:'Fixture '+n,scope:'Synthetic benchmark',action:'proposed',priority:1,priorityReason:'Synthetic',dependencies:[]});
 let count=0;const prepare=h.db.prepare;h.db.prepare=function(sql){count++;return prepare.call(this,sql)};const elapsed=[];let queries=0;
 for(let n=0;n<15;n++){count=0;const start=performance.now();await h.service.tasks(p);elapsed.push(performance.now()-start);queries=count}
 const {fixture,settle,flat,sessions}=createRequire(pathToFileURL(root+'/benchmark-loader.cjs'))('./test-thread-sidebar/sidebar-ui-fixture.cjs');
 const f=fixture({hash:'#project/orgbrain/session/session_A'});await settle();const initialGETs=f.calls.filter(c=>c.method==='GET').length,initialDOMNodes=flat(f.appRoot).length,before=f.calls.length;await f.change('session_B');await f.change('session_A');const switchGETs=f.calls.length-before;f.workspace.destroy();
 async function delayed(warm){
  const values=new Map(),storage={get length(){return values.size},key:i=>[...values.keys()][i]??null,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
  const rows=Array.from({length:50},(_,n)=>({id:'bench_message_'+n,author:n%2?'dot':'user',text:'Synthetic conversation '+n,created_at:'2026-10-15T00:00:00Z',project_id:'orgbrain',sessionId:'session_A',metadata:{mode:'standard'}}));
  if(warm)storage.setItem('dot-session-display:v1:'+owner+':'+JSON.stringify(['orgbrain','session_A']),JSON.stringify({version:1,owner,project:'orgbrain',session:'session_A',savedAt:Date.now(),messages:rows}));
  const request=c=>{let payload=c.resource==='sessions'?{data:sessions}:c.resource==='composer-config'?{files:{available:false}}:c.resource==='notification-status'?{notification:{state:'ready'}}:c.resource==='session-cache-context'?{ownerKey:owner}:{data:c.resource==='messages'&&c.sessionId==='session_A'?rows:[]};return new Promise(r=>setTimeout(()=>r({ok:true,status:200,headers:{get:()=>owner},json:async()=>structuredClone(payload)}),40))};
  const start=performance.now(),view=fixture({hash:'#project/orgbrain/session/session_A',cacheOwner:owner,storage,onRequest:request});let first=null,synced=null;
  while(performance.now()-start<1500){await new Promise(r=>setTimeout(r,2));const pane=view.pane('session_A');if(pane&&flat(pane).some(n=>n.dataset.messageId==='bench_message_0'))first??=performance.now()-start;if(pane&&/同期済み/.test(view.byClass('workspace-status',pane).textContent)){synced=performance.now()-start;break}}
  view.workspace.destroy();if(first===null||synced===null)throw Error('Controlled fixture did not complete');return {firstContentMs:first,serverRevalidatedMs:synced};
 }
 const cold=[],warm=[];for(let n=0;n<5;n++){cold.push(await delayed(false));warm.push(await delayed(true))}
 const html=readFileSync(root+'/dist/index.html'),js=readFileSync(root+'/project-workspace.js');
 return {sqlReadsFor30SharedSourceTasks:queries,sqlLocalMedianMs:median(elapsed),directNamedSessionGETs:initialGETs,directNamedSessionDOMNodes:initialDOMNodes,twoSwitchGETs:switchGETs,controlled40msPerRequest:{coldFirstContentMedianMs:median(cold.map(x=>x.firstContentMs)),warmFirstContentMedianMs:median(warm.map(x=>x.firstContentMs)),warmServerRevalidatedMedianMs:median(warm.map(x=>x.serverRevalidatedMs)),coldSamples:cold,warmSamples:warm},htmlBytes:html.length,htmlGzipBytes:gzipSync(html).length,workspaceSourceBytes:js.length};
}
console.log(JSON.stringify({method:'Offline Node SQLite and deterministic DOM fixture; 40ms simulated per-GET latency, 50 synthetic messages, 5 cold/warm trials; SQL median15. Not browser LCP/INP or production network latency.',baselineRoot:baseline,candidateRoot:candidate,baseline:await measure(baseline),candidate:await measure(candidate)},null,2));
