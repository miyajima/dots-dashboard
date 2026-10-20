import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {harness,root} from './test-provenance/harness.mjs';
import {createSessions} from './worker/sessions.mjs';

const roomId='room_review_12345678',rootMessageId='Sentinel_review_root',canonicalRootRef='room_review_12345678~CalpicoMessage~Sentinel_review_root';
const createdAt='2026-10-08T00:00:00.000Z',childAt='2026-10-08T00:01:00.000Z';
const rootQuote=()=>({messageId:rootMessageId,canonicalRef:canonicalRootRef,replyToRef:null,replyRootRef:null,author:'dot',text:'Actual historical root',createdAt,mode:'unknown'});
const childQuote=(id='review_child',extra={})=>({messageId:id,canonicalRef:'room_review_12345678~CalpicoMessage~'+id,replyToRef:canonicalRootRef,replyRootRef:canonicalRootRef,author:'user',text:'Actual historical child',createdAt:childAt,mode:'plan_only',...extra});
async function setup(purpose='conversation'){
 const f=await harness(),p=f.projects[0];
 const source=(await f.service.postUserMessage(p,{clientId:'binding_source_1234',text:'Create a bounded project topic thread'})).message;
 const session=await f.service.sessions.create(p,{clientId:'session_client_1234',title:'Review topic',purpose});
 const bind={sessionId:session.id,roomId,canonicalRootRef,rootMessageId,sourceMessageId:source.id};
 await f.service.sessions.bind(p,bind);
 return {...f,p,source,session,bind,batch:messages=>({sessionId:session.id,roomId,canonicalRootRef,messages})};
}
const mustReject=(fn,...codes)=>assert.rejects(fn,e=>codes.length===0||codes.includes(e.code));
const data=r=>{assert.equal(r.status,200);assert.equal(r.data.result?.isError,undefined);return r.data.result.structuredContent.data};
const error=r=>r.data.result?.structuredContent?.error||r.data.error;
const counts=f=>Object.fromEntries(['chat_messages','event_outbox','board_tasks','task_operations','external_task_progress','event_deliveries','event_subscriptions','external_request_sources','task_source_links','request_results','session_deliveries'].map(t=>[t,f.count(t)]));
function barrierDb(db,match,required=2){let n=0,release;const gate=new Promise(r=>release=r);return {batch:ops=>db.batch(ops),prepare(sql){const s=db.prepare(sql);return {bind(...args){const q=s.bind(...args);return {run:()=>q.run(),async all(){const out=await q.all();if(match(sql,args)){if(++n===required)release();await gate}return out}}}}}}}
const sessionService=(f,db)=>createSessions({db,owner:'review_owner',projects:f.projects,clock:()=>new Date('2026-10-08T01:00:00Z').toISOString()});

test('migration 0012 preserves legacy message bytes and maps them only to General',()=>{
 const raw=new DatabaseSync(':memory:'),migrations=readdirSync(root+'/drizzle').filter(x=>x.endsWith('.sql')).sort();
 for(const file of migrations.filter(x=>x<'0012'))raw.exec(readFileSync(root+'/drizzle/'+file,'utf8'));
 raw.prepare('INSERT INTO chat_messages(id,owner_id,project_id,client_id,author,text,created_at,mode,skill_references_json) VALUES(?,?,?,?,?,?,?,?,?)').run('msg_legacy_1234','review_owner','astraharness','legacy_client_1234','user','Legacy\n文字','2026-10-01T01:00:00Z','plan_only','["Sites"]');
 const before=raw.prepare('SELECT rowid,* FROM chat_messages').all();
 for(const file of migrations.filter(x=>x>='0012'))raw.exec(readFileSync(root+'/drizzle/'+file,'utf8'));
 const after=raw.prepare('SELECT rowid,* FROM chat_messages').all();assert.equal(after[0].session_id,null);delete after[0].session_id;assert.deepEqual(after,before);
});
test('session creation is idempotent, immutable, owner and project scoped',async()=>{
 const f=await setup();const second=await f.device.sessions.create(f.p,{clientId:'session_client_1234',title:'Review topic',purpose:'conversation'});assert.equal(second.id,f.session.id);
 await mustReject(()=>f.service.sessions.create(f.p,{clientId:'session_client_1234',title:'Changed',purpose:'conversation'}),'session_client_reused');
 await mustReject(()=>f.other.sessions.get(f.p,f.session.id),'session_not_found');await mustReject(()=>f.service.sessions.get(f.projects[1],f.session.id),'session_not_found');
 const other=await f.other.sessions.create(f.p,{clientId:'session_client_1234',title:'Review topic',purpose:'conversation'});assert.notEqual(other.id,f.session.id);
});
test('native General/A/B isolation and reply inheritance',async()=>{
 const f=await setup(),s2=await f.service.sessions.create(f.p,{clientId:'second_session_1234',title:'Second',purpose:'conversation'});
 const a=(await f.service.postUserMessage(f.p,{clientId:'message_a_1234',text:'A',sessionId:f.session.id})).message;
 const b=(await f.service.postUserMessage(f.p,{clientId:'message_b_1234',text:'B',sessionId:s2.id})).message;
 const reply=(await f.service.postDotReply(f.p,{clientId:'reply_a_1234',replyTo:a.id,text:'A reply'})).message;assert.equal(reply.sessionId,f.session.id);
 assert.deepEqual((await f.service.messages(f.p)).map(m=>m.id),[f.source.id]);assert.deepEqual((await f.service.messages(f.p,s2.id)).map(m=>m.id),[b.id]);assert.deepEqual((await f.service.messages(f.p,f.session.id)).map(m=>m.id),[a.id,reply.id]);
 await mustReject(()=>f.service.postDotReply(f.p,{clientId:'reply_bad_1234',replyTo:a.id,text:'Bad',sessionId:s2.id}),'reply_session_mismatch');
 await mustReject(()=>f.service.postUserMessage(f.p,{clientId:'message_a_1234',text:'A',sessionId:s2.id}),'client_id_reused');
 const pending=await f.service.pendingMessages();assert(pending.messages.some(m=>m.messageId===b.id&&m.sessionId===s2.id));assert(!pending.messages.some(m=>m.messageId===a.id));
});
test('malformed empty session ID is rejected without creating an invisible native row',async()=>{
 const f=await setup(),before=f.count('chat_messages');await mustReject(()=>f.service.postUserMessage(f.p,{clientId:'empty_session_1234',text:'Invisible',sessionId:''}));assert.equal(f.count('chat_messages'),before);
});
test('malformed numeric/boolean session IDs are rejected',async()=>{
 const f=await setup();for(const value of [0,false]){const before=f.count('chat_messages');await assert.rejects(()=>f.service.postUserMessage(f.p,{clientId:'malformed_'+String(value)+'_1234',text:'Bad session',sessionId:value}),e=>e.status===400);assert.equal(f.count('chat_messages'),before,'Malformed session must not write a row')}
});
test('history is read-only; mirrors are not request sources or pending/receipts/tasks',async()=>{
 const f=await setup('history'),before=counts(f);await f.service.sessions.import(f.p,f.batch([rootQuote(),childQuote()]));assert.deepEqual(counts(f),before);
 const messages=await f.service.messages(f.p,f.session.id);assert.equal(messages.length,2);assert(messages.every(m=>m.receipt===null&&m.requestResult===null&&m.provenance.executionAuthorization==='none'&&m.provenance.historical));
 await mustReject(()=>f.service.postUserMessage(f.p,{clientId:'history_post_1234',text:'No',sessionId:f.session.id}),'historical_session_read_only');
 await mustReject(()=>f.service.requestSource(messages[1].id),'message_not_found');assert(!(await f.service.pendingMessages()).messages.some(m=>m.messageId===messages[1].id));
});
test('binding immutable, unique root, exact owner isolation; plan-only source cannot bind',async()=>{
 const f=await setup();assert.equal((await f.service.sessions.bind(f.p,f.bind)).thread.canonicalRootRef,canonicalRootRef);
 await mustReject(()=>f.service.sessions.bind(f.p,{...f.bind,roomId:'other_room_1234'}),'thread_binding_conflict');
 const s2=await f.service.sessions.create(f.p,{clientId:'other_session_1234',title:'Other',purpose:'conversation'});await mustReject(()=>f.service.sessions.bind(f.p,{...f.bind,sessionId:s2.id}),'thread_binding_conflict');
 assert.equal(await f.other.sessions.resolve({roomId,canonicalRootRef}),null);assert.equal((await f.service.sessions.resolve({roomId,canonicalRootRef})).session.id,f.session.id);
 const plan=(await f.service.postUserMessage(f.p,{clientId:'plan_source_1234',text:'Plan only',metadata:{mode:'plan_only'}})).message;await mustReject(()=>f.service.sessions.bind(f.p,{...f.bind,sessionId:s2.id,canonicalRootRef:'new_root_1234',sourceMessageId:plan.id}),'binding_requires_user_source');
});
test('mirror ancestry root, missing parent, self parent and timestamp guards',async()=>{
 const f=await setup();await f.service.sessions.import(f.p,f.batch([rootQuote()]));
 await mustReject(()=>f.service.sessions.import(f.p,f.batch([childQuote('wrong_root',{replyRootRef:'wrong_root'})])),'mirror_wrong_root');
 await mustReject(()=>f.service.sessions.import(f.p,f.batch([childQuote('missing_parent',{replyToRef:'not_observed'})])),'mirror_parent_not_observed');
 await mustReject(()=>f.service.sessions.import(f.p,f.batch([childQuote('self_parent',{replyToRef:'room_review_12345678~CalpicoMessage~self_parent'})])),'mirror_self_parent');
 await mustReject(()=>f.service.sessions.import(f.p,f.batch([childQuote('early_child',{createdAt:'2026-10-07T23:00:00Z'})])),'mirror_parent_time');
 await f.service.sessions.import(f.p,f.batch([childQuote('explicit_unknown',{replyToRef:'not_observed',allowUnresolvedParent:true})]));assert((await f.service.sessions.mirrors(f.p,f.session.id)).find(m=>m.provenance.messageId==='explicit_unknown').provenance.unresolvedParent);
});
test('immutable mirror message replay and cross-session reuse',async()=>{
 const f=await setup();await f.service.sessions.import(f.p,f.batch([rootQuote(),childQuote()]));await f.service.sessions.import(f.p,f.batch([rootQuote(),childQuote()]));assert.equal(f.count('session_mirror_messages'),2);
 await mustReject(()=>f.service.sessions.import(f.p,f.batch([childQuote('review_child',{text:'Changed'})])),'mirror_message_conflict');
 const s2=await f.service.sessions.create(f.p,{clientId:'reuse_session_1234',title:'Other',purpose:'history'});await f.service.sessions.bind(f.p,{...f.bind,sessionId:s2.id,canonicalRootRef:'other_canonical_root',rootMessageId:'other_root_msg'});
 await mustReject(()=>f.service.sessions.import(f.p,{sessionId:s2.id,roomId,canonicalRootRef:'other_canonical_root',messages:[childQuote('review_child',{replyRootRef:'other_canonical_root',replyToRef:'other_canonical_root',allowUnresolvedParent:true})]}),'mirror_message_conflict');
});
test('mirror batch canonical alias collision rolls back all rows',async()=>{
 const f=await setup(),alias='collision_ref';const a=childQuote('alias_first',{canonicalRef:alias}),b=childQuote('alias_second',{canonicalRef:alias});
 await mustReject(()=>f.service.sessions.import(f.p,f.batch([rootQuote(),a,b])));assert.equal(f.count('session_mirror_messages'),0,'Rejected batch must leave zero rows');
});
test('mirror batch duplicate external ID with conflicting text rolls back all rows',async()=>{
 const f=await setup();await mustReject(()=>f.service.sessions.import(f.p,f.batch([rootQuote(),childQuote(),childQuote('review_child',{text:'Conflicting duplicate'})])));assert.equal(f.count('session_mirror_messages'),0,'Rejected batch must leave zero rows');
});
test('concurrent conflicting mirror batches are all-or-none',async()=>{
 const f=await setup();await f.service.sessions.import(f.p,f.batch([rootQuote()]));const db=barrierDb(f.db,(sql,args)=>sql.startsWith('SELECT fingerprint FROM session_mirror_messages')&&args[2]==='shared_child');const s=sessionService(f,db);
 const outcomes=await Promise.allSettled([s.import(f.p,f.batch([childQuote('shared_child',{text:'Version A'}),childQuote('unique_a')])),s.import(f.p,f.batch([childQuote('shared_child',{text:'Version B'}),childQuote('unique_b')]))]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);assert.equal(f.count('session_mirror_messages'),3,'Only root and the two rows from the successful batch may persist');
});
test('a non-root message cannot claim the bound canonical root alias',async()=>{
 const f=await setup();await mustReject(()=>f.service.sessions.import(f.p,f.batch([childQuote('fake_root_alias',{canonicalRef:canonicalRootRef,replyToRef:'some_unknown_parent',allowUnresolvedParent:true})])));assert.equal(f.count('session_mirror_messages'),0);
});
test('explicit unresolved ancestry cannot form a cycle after another message arrives',async()=>{
 const f=await setup(),a=childQuote('cycle_a',{replyToRef:'room_review_12345678~CalpicoMessage~cycle_b',allowUnresolvedParent:true}),b=childQuote('cycle_b',{replyToRef:a.canonicalRef});
 await mustReject(()=>f.service.sessions.import(f.p,f.batch([rootQuote(),a,b])));assert.equal(f.count('session_mirror_messages'),0);
});
test('delivery text binds actual native source and plan metadata; receipts unchanged',async()=>{
 const f=await setup(),m=(await f.service.postUserMessage(f.p,{clientId:'native_delivery_1234',text:'Read only please',sessionId:f.session.id,metadata:{mode:'plan_only',skillReferences:['Sites']}})).message;
 const prepared=await f.service.sessions.prepareDelivery(f.p,{sessionId:f.session.id,messageId:m.id});assert(prepared.text.includes('計画のみ・実行しない'));assert(prepared.text.includes('スキル参照：Sites'));assert.equal(prepared.delivery,null);assert.equal(prepared.automaticSend,false);
 const x={sessionId:f.session.id,messageId:m.id,roomId,canonicalRootRef,externalMessageId:'external_sent_1234',text:prepared.text,sentAt:'2026-10-08T01:00:00.000Z'};await f.service.sessions.recordDelivery(f.p,x);await f.service.sessions.recordDelivery(f.p,x);assert.equal(f.count('session_deliveries'),1);assert.equal((await f.service.readMessage(m.id)).receipt,null);
 await mustReject(()=>f.service.sessions.recordDelivery(f.p,{...x,text:'different'}),'mirror_delivery_text_mismatch');await mustReject(()=>f.service.sessions.recordDelivery(f.p,{...x,externalMessageId:'changed_external'}),'delivery_conflict');
 await mustReject(()=>f.service.sessions.prepareDelivery(f.p,{sessionId:f.session.id,messageId:f.source.id}),'session_message_not_found');await mustReject(()=>f.other.sessions.recordDelivery(f.p,x),'session_not_found');
 await mustReject(()=>f.service.sessions.import(f.p,f.batch([childQuote('external_sent_1234',{allowUnresolvedParent:true})])),'mirror_is_outbound_echo');
 assert.equal((await f.service.sessions.prepareDelivery(f.p,{sessionId:f.session.id,messageId:m.id})).delivery.externalMessageId,x.externalMessageId);
});
test('previously imported message cannot become a delivery receipt',async()=>{
 const f=await setup();await f.service.sessions.import(f.p,f.batch([rootQuote(),childQuote('imported_first')]));const m=(await f.service.postUserMessage(f.p,{clientId:'imported_delivery_1234',text:'Native',sessionId:f.session.id})).message,prep=await f.service.sessions.prepareDelivery(f.p,{sessionId:f.session.id,messageId:m.id});
 await mustReject(()=>f.service.sessions.recordDelivery(f.p,{sessionId:f.session.id,messageId:m.id,roomId,canonicalRootRef,externalMessageId:'imported_first',text:prep.text,sentAt:'2026-10-08T01:00:00.000Z'}),'delivery_is_imported_echo');
});
test('concurrent import and delivery cannot both own the same external ID',async()=>{
 const f=await setup();await f.service.sessions.import(f.p,f.batch([rootQuote()]));const m=(await f.service.postUserMessage(f.p,{clientId:'racing_delivery_1234',text:'Native',sessionId:f.session.id})).message,prep=await f.service.sessions.prepareDelivery(f.p,{sessionId:f.session.id,messageId:m.id});
 const db=barrierDb(f.db,(sql,args)=>(sql.startsWith('SELECT message_id FROM session_deliveries WHERE owner_id=? AND room_id=?')||sql.startsWith('SELECT id FROM session_mirror_messages WHERE owner_id=? AND room_id=?'))&&args[2]==='racing_external');const s=sessionService(f,db);
 const outcomes=await Promise.allSettled([s.import(f.p,f.batch([childQuote('racing_external')])),s.recordDelivery(f.p,{sessionId:f.session.id,messageId:m.id,roomId,canonicalRootRef,externalMessageId:'racing_external',text:prep.text,sentAt:'2026-10-08T01:00:00.000Z'})]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1,'One side must reject the external ID already claimed by the other');
});
test('MCP session contracts enforce auth and browser-origin guards',async()=>{
 const f=await setup();assert.equal((await f.rpc('project_sessions_list',{projectId:f.p},null)).status,401);assert.equal((await f.rpc('project_session_create',{projectId:f.p,clientId:'browser_source_1234',title:'Bad',purpose:'conversation'},'review_owner',{origin:'https://dashboard.example'})).status,403);
 const rows=data(await f.rpc('project_sessions_list',{projectId:f.p}));assert(rows.some(x=>x.id===f.session.id));assert.equal(error(await f.rpc('project_session_mirror_import',{projectId:f.p,...f.batch([rootQuote()])},'review_other')),'session_not_found');
 assert.equal(data(await f.rpc('project_session_thread_get',{roomId,canonicalRootRef})).session.id,f.session.id);assert.equal(data(await f.rpc('project_session_thread_get',{roomId,canonicalRootRef},'review_other')),null);
});
test('MCP selected session listing excludes other native sessions',async()=>{
 const f=await setup(),m=(await f.service.postUserMessage(f.p,{clientId:'rpc_message_1234',text:'Topic A',sessionId:f.session.id})).message;
 assert(data(await f.rpc('project_messages_list',{projectId:f.p,sessionId:f.session.id})).some(x=>x.id===m.id));assert(!data(await f.rpc('project_messages_list',{projectId:f.p})).some(x=>x.id===m.id));
});
async function api(f,resource,body){const origin='https://dashboard.example';const response=await f.handleRequest(new Request(origin+'/api/projects/'+f.p+'/'+resource,{method:body?'POST':'GET',headers:{'oai-authenticated-user-id':'review_owner',...(body?{'content-type':'application/json',origin}:{})},...(body?{body:JSON.stringify(body)}:{})}),{DB:f.db},{projects:f.projects});return {status:response.status,data:await response.json()}}
test('task requests preserve session and aggregate project-wide',async()=>{
 const f=await setup(),body={clientId:'session_task_request_1234',title:'Task',scope:'Scope',sessionId:f.session.id};const posted=await api(f,'task-requests',body);assert.equal(posted.status,201);assert.equal(posted.data.task.sessionId,f.session.id);assert.equal((await f.service.readMessage(posted.data.sourceMessageId)).sessionId,f.session.id);
 assert((await f.service.tasks(f.p)).some(t=>t.id===posted.data.task.id));assert.equal((await api(f,'task-requests',body)).data.task.id,posted.data.task.id);assert.equal((await api(f,'task-requests',{...body,sessionId:'general'})).status,409);
});
test('interrupted task request recovers an existing source-only message in its session',async()=>{
 const f=await setup();for(const sessionId of ['general',f.session.id]){const body={clientId:sessionId==='general'?'orphan_general_1234':'orphan_topic_1234',title:'Recover',scope:'Recover source',sessionId};
 const source=(await f.service.postUserMessage(f.p,{clientId:'source_'+body.clientId,text:'タスクの依頼：'+body.title+'\n'+body.scope+'\n登録のみ。実行前にdotが対象・依存関係・必要な承認を確認します。',sessionId})).message;
 const recovered=await api(f,'task-requests',body);assert.equal(recovered.status,201,JSON.stringify(recovered.data));assert.equal(recovered.data.sourceMessageId,source.id);assert.equal(recovered.data.task.sessionId,sessionId)}
});
test('result remains request-bound and isolated from General and other sessions',async()=>{
 const f=await setup(),s2=await f.service.sessions.create(f.p,{clientId:'result_other_1234',title:'Other',purpose:'conversation'}),source=(await f.service.postUserMessage(f.p,{clientId:'result_source_1234',text:'Make a plan',sessionId:f.session.id,metadata:{mode:'plan_only'}})).message,reply=(await f.service.postDotReply(f.p,{clientId:'result_reply_1234',replyTo:source.id,text:'Here is the plan'})).message;
 await f.service.recordRequestResult(f.p,{sourceMessageId:source.id,replyMessageId:reply.id,status:'completed',kind:'plan',summary:'Plan finished',observedAt:'2026-10-08T01:00:00.000Z',evidence:['Plan exists in the actual reply']});
 assert((await f.service.messages(f.p,f.session.id)).find(m=>m.id===source.id).requestResult);assert(!(await f.service.messages(f.p)).some(m=>m.requestResult));assert.deepEqual(await f.service.messages(f.p,s2.id),[]);
});
function batchBarrierDb(db){let arrivals=0,release;const gate=new Promise(r=>release=r);return {prepare:sql=>db.prepare(sql),async batch(ops){if(++arrivals===2)release();await gate;return db.batch(ops)}}}
async function nativeDelivery(f,clientId,externalMessageId){const m=(await f.service.postUserMessage(f.p,{clientId,text:'Mirror this native message',sessionId:f.session.id})).message,p=await f.service.sessions.prepareDelivery(f.p,{sessionId:f.session.id,messageId:m.id});return {sessionId:f.session.id,messageId:m.id,roomId,canonicalRootRef,externalMessageId,text:p.text,sentAt:'2026-10-08T01:00:00.000Z'}}
function noOrphanClaims(f){const expected=new Set();for(const m of f.raw.prepare('SELECT * FROM session_mirror_messages').all()){expected.add('external:'+m.message_id);if(m.canonical_ref)expected.add('canonical:'+m.canonical_ref)}for(const d of f.raw.prepare('SELECT * FROM session_deliveries').all()){expected.add('external:'+d.external_message_id);expected.add('native:'+d.message_id)}assert.deepEqual(new Set(f.raw.prepare('SELECT claim_key FROM session_external_claims').all().map(c=>c.claim_key)),expected,'Every claim must correspond to an actual mirror or delivery row')}
test('concurrent different deliveries for one native message leave no losing claim',async()=>{
 const f=await setup(),a=await nativeDelivery(f,'native_one_race_1234','external_one_race'),b={...a,externalMessageId:'external_other_race'},s=sessionService(f,batchBarrierDb(f.db));
 const outcomes=await Promise.allSettled([s.recordDelivery(f.p,a),s.recordDelivery(f.p,b)]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.count('session_deliveries'),1);noOrphanClaims(f);
});
test('concurrent different native messages cannot claim the same external delivery',async()=>{
 const f=await setup(),a=await nativeDelivery(f,'native_first_race_1234','shared_external_race'),b=await nativeDelivery(f,'native_second_race_1234','shared_external_race'),s=sessionService(f,batchBarrierDb(f.db));
 const outcomes=await Promise.allSettled([s.recordDelivery(f.p,a),s.recordDelivery(f.p,b)]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.count('session_deliveries'),1);noOrphanClaims(f);
});
test('concurrent canonical alias conflict is all-or-none and leaves no orphan claim',async()=>{
 const f=await setup();await f.service.sessions.import(f.p,f.batch([rootQuote()]));const s=sessionService(f,batchBarrierDb(f.db));
 const outcomes=await Promise.allSettled([s.import(f.p,f.batch([childQuote('canonical_first',{canonicalRef:'shared_canonical_alias'}),childQuote('canonical_unique_a')])),s.import(f.p,f.batch([childQuote('canonical_second',{canonicalRef:'shared_canonical_alias'}),childQuote('canonical_unique_b')]))]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.count('session_mirror_messages'),3);noOrphanClaims(f);
});
test('concurrent identical imports preserve one set of rows and exact claims',async()=>{
 const f=await setup(),s=sessionService(f,batchBarrierDb(f.db));const outcomes=await Promise.allSettled([s.import(f.p,f.batch([rootQuote(),childQuote()])),s.import(f.p,f.batch([rootQuote(),childQuote()]))]);assert(outcomes.every(x=>x.status==='fulfilled'));assert.equal(f.count('session_mirror_messages'),2);noOrphanClaims(f);
});
test('concurrent identical delivery is idempotent with no orphan claims',async()=>{
 const f=await setup(),x=await nativeDelivery(f,'identical_delivery_1234','identical_external'),s=sessionService(f,batchBarrierDb(f.db));const outcomes=await Promise.allSettled([s.recordDelivery(f.p,x),s.recordDelivery(f.p,x)]);assert(outcomes.every(x=>x.status==='fulfilled'));assert.equal(f.count('session_deliveries'),1);noOrphanClaims(f);
});
test('concurrent unresolved imports cannot close a parent cycle',async()=>{
 const f=await setup();await f.service.sessions.import(f.p,f.batch([rootQuote()]));const s=sessionService(f,batchBarrierDb(f.db)),a=childQuote('concurrent_cycle_a',{replyToRef:'room_review_12345678~CalpicoMessage~concurrent_cycle_b',allowUnresolvedParent:true}),b=childQuote('concurrent_cycle_b',{replyToRef:a.canonicalRef,allowUnresolvedParent:true});
 const outcomes=await Promise.allSettled([s.import(f.p,f.batch([a])),s.import(f.p,f.batch([b]))]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1,'Second transaction must reject the now-observable cycle');assert.equal(f.count('session_mirror_messages'),2);noOrphanClaims(f);
});
test('later resolution of an unresolved parent cannot contradict child time',async()=>{
 const f=await setup();await f.service.sessions.import(f.p,f.batch([rootQuote(),childQuote('early_unresolved_child',{replyToRef:'room_review_12345678~CalpicoMessage~late_parent',allowUnresolvedParent:true})]));
 await mustReject(()=>f.service.sessions.import(f.p,f.batch([childQuote('late_parent',{createdAt:'2026-10-08T00:02:00.000Z'})])));assert.equal(f.count('session_mirror_messages'),2);noOrphanClaims(f);
});
