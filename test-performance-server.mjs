import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './test-provenance/harness.mjs';
import {cacheOwnerKey} from './worker/cache-context.mjs';
import worker from './dist/server/index.js';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {renderUserProjects} from './worker/projects.mjs';

const taskInput=(source,n)=>({clientId:'performance_task_'+n,sourceMessageId:source.id,title:'Synthetic '+n,scope:'Synthetic local regression',action:'proposed',priority:50,priorityReason:'Fixture',dependencies:[]});
test('cache identity is authenticated, non-secret, owner-specific and never a write grant',async()=>{
 const h=await harness(),origin='https://fixture.invalid';
 const call=(path,owner='review_owner',method='GET')=>worker.fetch(new Request(origin+path,{method,headers:owner?{'oai-authenticated-user-id':owner,'content-type':'application/json',origin}: {}}),{DB:h.db});
 assert.equal((await call('/api/session-cache-context',null)).status,401);
 const result=await call('/api/session-cache-context'),body=await result.json();assert.equal(result.status,200);assert.match(result.headers.get('cache-control'),/private, no-store/);assert.equal(body.ownerKey,await cacheOwnerKey('review_owner'));assert.equal(result.headers.get('x-dashboard-cache-owner'),body.ownerKey);assert.match(body.ownerKey,/^[a-f0-9]{64}$/);assert.notEqual(body.ownerKey,(await (await call('/api/session-cache-context','review_other')).json()).ownerKey);
 assert.equal((await call('/api/session-cache-context','review_owner','POST')).status,405);
 const html=await (await call('/')).text();assert(html.includes('<meta name="dashboard-cache-owner" content="'+body.ownerKey+'">'));assert.equal((await call('/',null)).status,401);
 assert.equal(h.count('board_tasks'),0);assert.equal(h.count('event_outbox'),0);assert.equal(h.count('event_subscriptions'),0);
});
test('batched task list equals individual fresh reads across sources, sessions and links',async()=>{
 const h=await harness(),p=h.projects[0],session=await h.service.sessions.create(p,{clientId:'performance_session',title:'Fixture named session',purpose:'conversation'});
 const general=(await h.service.postUserMessage(p,{clientId:'performance_general',text:'General fixture'})).message,named=(await h.service.postUserMessage(p,{clientId:'performance_named',text:'Named fixture',sessionId:session.id,metadata:{mode:'plan_only'}})).message;
 const external=await h.service.importRequestSource(p,{roomId:'performance_room',messageId:'performance_external',createdAt:'2026-10-08T00:00:00Z',text:'External fixture',mode:'standard',context:[]});
 const tasks=[];for(const [n,source]of [general,named,external,general].entries())tasks.push(await h.service.createTask(p,taskInput(source,n)));
 await h.service.linkTaskSource(tasks[0].id,{sourceId:named.id,note:'Fixture link',expectedRevision:tasks[0].revision,operationId:'performance_link'});
 const actual=await h.service.tasks(p),expected=await Promise.all(actual.map(t=>h.service.getTask(t.id)));assert.deepEqual(actual,expected);assert.equal(actual.find(t=>t.source_message_id===named.id).sessionId,session.id);assert.equal(actual.find(t=>t.source_message_id===named.id).requestSource.metadata.mode,'plan_only');assert.equal(actual.find(t=>t.id===tasks[0].id).linkedSources[0].id,named.id);
 const snapshot=JSON.stringify(actual);h.raw.prepare('UPDATE board_tasks SET title=? WHERE id=?').run('New authoritative title',tasks[0].id);const next=await h.service.tasks(p);assert.equal(next.find(t=>t.id===tasks[0].id).title,'New authoritative title');assert.notEqual(JSON.stringify(next),snapshot,'preload never survives into another request');
});
test('task preloads retain owner/project isolation and mutation paths stay fresh',async()=>{
 const h=await harness(),[p,q]=h.projects,source=(await h.service.postUserMessage(p,{clientId:'performance_owner_a',text:'A private'})).message,otherSource=(await h.other.postUserMessage(p,{clientId:'performance_owner_b',text:'B private'})).message,projectSource=(await h.service.postUserMessage(q,{clientId:'performance_project_q',text:'Q private'})).message;
 const a=await h.service.createTask(p,taskInput(source,'a')),b=await h.other.createTask(p,taskInput(otherSource,'b')),other=await h.service.createTask(q,taskInput(projectSource,'q'));
 assert.deepEqual((await h.service.tasks(p)).map(t=>t.id),[a.id]);assert.deepEqual((await h.other.tasks(p)).map(t=>t.id),[b.id]);assert.deepEqual((await h.service.tasks(q)).map(t=>t.id),[other.id]);await assert.rejects(()=>h.other.getTask(a.id),e=>e.code==='task_not_found');
 h.raw.prepare('UPDATE board_tasks SET revision=revision+1 WHERE id=?').run(a.id);assert.equal((await h.service.getTask(a.id)).revision,a.revision+1);assert.equal((await h.service.tasks(p))[0].revision,a.revision+1);
});
test('30 shared-source task reads use four owner-scoped SQL calls and preserve order',async()=>{
 const h=await harness(),p=h.projects[0],source=(await h.service.postUserMessage(p,{clientId:'performance_shared_source',text:'Synthetic benchmark'})).message;
 for(let n=0;n<30;n++)await h.service.createTask(p,taskInput(source,n));
 let reads=0;const original=h.db.prepare;h.db.prepare=function(sql){reads++;return original.call(this,sql)};const actual=await h.service.tasks(p);assert.equal(actual.length,30);assert.equal(reads,4);const first=actual[0];assert.equal((await h.service.getTask(first.id)).id,first.id);
});
test('stale-page JSON/upload mutations are rejected before any new-owner storage or notification',async()=>{
 const h=await harness(),origin='https://fixture.invalid',ownerA=await cacheOwnerKey('review_owner'),p=h.projects[0],before=['chat_messages','board_tasks','event_outbox','chat_attachments','event_deliveries'].map(h.count);
 for(const resource of ['messages','task-requests','files','notify']){
  const response=await h.handleRequest(new Request(origin+'/api/projects/'+p+'/'+resource,{method:'POST',headers:{origin,'content-type':'application/json','oai-authenticated-user-id':'review_other','X-Dashboard-Expected-Owner':ownerA},body:JSON.stringify({clientId:'stale_page_request',text:'PRIVATE OWNER A DRAFT',title:'A task',scope:'A private scope'})}),{DB:h.db},{projects:h.projects});assert.equal(response.status,409);assert.equal((await response.json()).error,'cache_owner_changed');
 }
 assert.deepEqual(['chat_messages','board_tasks','event_outbox','chat_attachments','event_deliveries'].map(h.count),before);
 // Exercise the actual runtime against the actual handler with switched auth.
 const context={document:{},AbortController,setTimeout,clearTimeout,Date};vm.runInNewContext(readFileSync(new URL('./project-workspace.js',import.meta.url),'utf8').replace('export function','function')+';this.runtime=workspaceRuntime;',context);
 const request=(path,options)=>h.handleRequest(new Request(origin+path,{...options,headers:{...options.headers,origin,'oai-authenticated-user-id':'review_other'}}),{DB:h.db},{projects:h.projects}),runtime=context.runtime(request,{cacheOwner:ownerA});
 await assert.rejects(()=>runtime.api('/api/projects/'+p+'/messages',{clientId:'actual_stale_runtime',text:'PRIVATE OWNER A DRAFT'}),e=>e.status===401);assert.equal(runtime.authorized,false);assert.deepEqual(['chat_messages','board_tasks','event_outbox','chat_attachments','event_deliveries'].map(h.count),before);
});
test('small id/name bootstrap preserves complete rendered archive and custom project views',()=>{
 const html=readFileSync(new URL('./dist/index.html',import.meta.url),'utf8'),projects=JSON.parse(readFileSync(new URL('./projects.json',import.meta.url),'utf8')).projects,parse=page=>JSON.parse(page.match(/<script id="project-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
 assert.deepEqual(parse(html),projects.map(({id,name})=>({id,name})));const escape=x=>x.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#x27;');for(const p of projects)assert(html.includes(escape(p.headline)),'rendered archival headline remains for '+p.id);
 const custom={id:'project-performance-custom',name:'Custom <project>',description:'Private detailed description',created_at:'2026-10-15T00:00:00Z'},page=renderUserProjects(html,[custom]);assert.deepEqual(parse(page).at(-1),{id:custom.id,name:custom.name});assert(page.includes('Private detailed description'));assert(page.includes('Custom &lt;project&gt;'));assert(!page.includes('"description":"Private detailed description"'));assert(html.includes('状況・記録'));
});
