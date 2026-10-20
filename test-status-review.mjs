// Independent offline review. All identities and records below exist only in in-memory SQLite.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {harness,reject,root} from './test-provenance/harness.mjs';
import {createProjectStatus,deriveStatus} from './worker/project-status.mjs';
import {projectsAPI} from './worker/projects.mjs';
import {createService} from './worker/chat-task-service.mjs';
import {tools} from './worker/chat-handler.mjs';

const project='astraharness',otherProject='orgbrain',owner='review_owner',origin='https://dashboard.example';
const sourceTime='2026-10-08T00:00:00.000Z',evidenceTime='2026-10-08T00:05:00.000Z',savedTime='2026-10-08T01:00:00.000Z',checkedTime='2026-10-10T12:00:00.000Z';
let seq=0,outbound=0;
globalThis.fetch=async()=>{outbound++;throw Error('Network prohibited in offline status review')};
const uid=prefix=>'status_review_'+prefix+'_'+(++seq);
const statusFor=(h,who=owner,db=h.db,projects=h.projects)=>createProjectStatus({db,owner:who,projects,service:createService({db,owner:who,projects,clock:()=>savedTime}),clock:()=>checkedTime});
async function source(h,{pid=project,mode='standard',service=h.service}={}){
 const saved=await service.postUserMessage(pid,{clientId:uid('source'),text:'Synthetic review-only source',metadata:{mode}});
 h.raw.prepare('UPDATE chat_messages SET created_at=? WHERE id=?').run(sourceTime,saved.message.id);
 return saved.message;
}
async function task(h,{pid=project,mode='standard',service=h.service,src=null,parentTaskId=null,evidence=true}={}){
 src=src||await source(h,{pid,mode,service});
 const t=await service.createTask(pid,{clientId:uid('task'),sourceMessageId:src.id,title:'Synthetic task',scope:'Review only',action:'proposed',priority:50,priorityReason:'Synthetic fixture',dependencies:[],parentTaskId,...(evidence?{progressMark:'partial',progressEvidence:['Synthetic evidence at original observation'],progressVerifiedAt:evidenceTime}:{})});
 return {src,t};
}
async function result(h,{pid=project,mode='standard',kind='work',service=h.service,src=null}={}){
 src=src||await source(h,{pid,mode,service});
 const reply=(await service.postDotReply(pid,{clientId:uid('reply'),replyTo:src.id,text:'Synthetic scoped result'})).message;
 const r=await service.recordRequestResult(pid,{sourceMessageId:src.id,replyMessageId:reply.id,status:'completed',kind,summary:'Synthetic completed scope',observedAt:evidenceTime,evidence:['Synthetic result evidence']});
 return {src,reply,r:r.result};
}
const input=(src,refs,extra={})=>({sourceMessageId:src.id,operationId:uid('record'),expectedRevision:0,summary:'Current scoped status',achievement:'Evidence captured',blocker:'Remaining work exists',next:'Review remaining scope',observedAt:'2026-10-08T00:10:00.000Z',references:refs,...extra});
const taskRef=t=>({kind:'task',id:t.id,revision:t.revision});
const ok=r=>{assert.equal(r.status,200);assert(!r.data.result?.isError,JSON.stringify(r));return r.data.result.structuredContent.data};
const error=(r,code)=>{assert.equal(r.status,200);assert.equal(r.data.result?.isError,true);assert.equal(r.data.result.structuredContent.error,code)};
const tableRows=(h,table)=>h.raw.prepare('SELECT * FROM '+table+' ORDER BY rowid').all();
const snapshot=h=>new Map(h.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='project_status_records' ORDER BY name").all().map(({name})=>[name,tableRows(h,name)]));
const unchanged=(h,before)=>{for(const [name,rows]of before)assert.deepEqual(tableRows(h,name),rows,name+' changed')};
async function route(h,path,{who=owner,method='GET',body,headers={}}={}){
 const r=await h.handleRequest(new Request(origin+path,{method,headers:{...(who?{'oai-authenticated-user-id':who}:{}),...(method==='POST'?{origin,'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}),{DB:h.db},{projects:h.projects});
 return {status:r.status,data:await r.json(),headers:r.headers};
}
function derivedRow(overrides={}){return {id:'task_review_001',title:'Synthetic',source_message_id:'source_review_001',source_mode:'standard',state:'succeeded',action:'proposed',priority:50,revision:2,updated_at:savedTime,result_observed_at:evidenceTime,result_json:JSON.stringify({summary:'Done',evidence:['Evidence']}),progress_evidence_json:'[]',...overrides}}
const workOutcome={id:'result_review_001',sourceMessageId:'source_review_001',kind:'work',status:'completed',recordedAt:savedTime,observedAt:evidenceTime};

test('status migration is additive and has owner/project/revision and owner/operation uniqueness',()=>{
 const raw=new DatabaseSync(':memory:'),files=readdirSync(root+'/drizzle').filter(x=>x.endsWith('.sql')).sort(),name=files.find(x=>x.startsWith('0020_'));assert(name);
 for(const f of files.filter(x=>x<name))raw.exec(readFileSync(root+'/drizzle/'+f,'utf8'));
 raw.prepare('INSERT INTO chat_messages(id,owner_id,project_id,client_id,author,text,created_at) VALUES(?,?,?,?,?,?,?)').run('status_migration_source',owner,project,'status_migration_client','user','Preserve old source',sourceTime);
 const before=raw.prepare('SELECT rowid,* FROM chat_messages').all();raw.exec(readFileSync(root+'/drizzle/'+name,'utf8'));assert.deepEqual(raw.prepare('SELECT rowid,* FROM chat_messages').all(),before);
 assert.equal(raw.prepare('SELECT count(*) AS n FROM project_status_records').get().n,0);
 assert(raw.prepare("PRAGMA index_list('project_status_records')").all().some(x=>x.name==='project_status_operation'&&x.unique===1));
 assert.deepEqual(raw.prepare("PRAGMA table_info('project_status_records')").all().filter(x=>x.pk).sort((a,b)=>a.pk-b.pk).map(x=>x.name),['owner_id','project_id','revision']);raw.close();
});

test('GET and MCP status are authenticated, owner-scoped, no-store, and browser writes are refused',async()=>{
 const h=await harness(),{src,t}=await task(h);const s=statusFor(h),body=input(src,[taskRef(t)]);await s.record(project,body);
 for(const path of ['/api/project-status','/api/projects/'+project+'/status']){
  assert.equal((await route(h,path,{who:null})).status,401);const own=await route(h,path);assert.equal(own.status,200);assert.equal(own.headers.get('Cache-Control'),'private, no-store');
  const theirs=await route(h,path,{who:'review_other'});assert.equal(theirs.status,200);assert(!JSON.stringify(theirs.data).includes(t.id));assert(!JSON.stringify(theirs.data).includes(body.summary));
  assert.equal((await route(h,path,{method:'POST',body})).status,405);
 }
 assert.equal((await h.rpc('project_status_record',{projectId:project,...body},null)).status,401);
 assert.equal((await h.rpc('project_status_record',{projectId:project,...body},owner,{origin})).status,403);
 assert.equal((await h.rpc('project_status_record',{projectId:project,...body},owner,{'sec-fetch-site':'cross-site'})).status,403);
 assert.equal(ok(await h.rpc('project_status_get',{projectId:project})).curated.revision,1);
 assert.equal(ok(await h.rpc('project_status_get',{projectId:project},'review_other')).counts.total,0);
 assert.equal(h.count('project_status_records'),1);assert.equal(outbound,0);
});

test('empty projects and all owner-created dynamic projects have live records; another owner cannot read them',async()=>{
 const h=await harness();const r=await projectsAPI(new Request(origin+'/api/project-registry',{method:'POST',headers:{'oai-authenticated-user-id':owner,origin,'content-type':'application/json'},body:JSON.stringify({clientId:'project_status_review_dynamic',name:'Status dynamic review',description:''})}),{DB:h.db});assert.equal(r.status,201);const {project:p}=await r.json();
 const all=(await route(h,'/api/project-status')).data.projects;assert.deepEqual(new Set(all.map(p=>p.projectId)),new Set([...h.projects,p.id]));
 assert(all.every(p=>p.state==='unconfirmed'&&p.counts.total===0&&p.latestEvidenceAt===null&&p.activityUpdatedAt===null));
 assert.equal((await route(h,'/api/projects/'+p.id+'/status')).status,200);assert.equal((await route(h,'/api/projects/'+p.id+'/status',{who:'review_other'})).status,404);
 const service=createService({db:h.db,owner,projects:[...h.projects,p.id],clock:()=>savedTime}),{t}=await task(h,{pid:p.id,service});const current=ok(await h.rpc('project_status_get',{projectId:p.id}));assert.equal(current.tasks[0].id,t.id);assert.equal(current.state,'queued');assert.equal(current.counts.active,0);
 assert(!ok(await h.rpc('project_status_get',{},'review_other')).projects.some(x=>x.projectId===p.id));
});

test('status reads and curated writes preserve tasks, messages, results, source links and every Events table',async()=>{
 const h=await harness(),{src,t}=await task(h),s=statusFor(h),before=snapshot(h),body=input(src,[taskRef(t)]);
 const saved=await s.record(project,body);assert.equal(saved.replayed,false);assert.equal(saved.record.revision,1);assert.deepEqual(saved.record.evidence,t.progressEvidence);assert.equal(saved.record.references[0].observedAt,evidenceTime);
 await s.read();await s.read(project);await h.rpc('project_status_get',{});assert.equal((await s.record(project,body)).replayed,true);unchanged(h,before);
 const serialized=JSON.stringify(await s.read(project));for(const secret of ['owner_id','fingerprint','request_fingerprint'])assert(!serialized.includes('"'+secret+'"'));
 assert.equal(outbound,0);
});

test('standard source and exact owner/project evidence are mandatory',async()=>{
 const h=await harness(),{src,t}=await task(h),s=statusFor(h),p=await source(h,{mode:'plan_only'}),cross=await task(h,{pid:otherProject}),foreign=await task(h,{service:h.other}),r=await result(h,{pid:otherProject});
 await reject(()=>s.record(project,input(p,[taskRef(t)])),'status_source_must_be_standard');
 await reject(()=>s.record(otherProject,input(src,[taskRef(t)])),'status_source_must_be_standard');
 await reject(()=>s.record(project,input(src,[taskRef(cross.t)])),'status_evidence_changed');
 await reject(()=>s.record(project,input(src,[taskRef(foreign.t)])),'task_not_found');
 await reject(()=>statusFor(h,'review_other').record(project,input(src,[taskRef(t)])),'message_not_found');
 await reject(()=>s.record(project,input(src,[{kind:'result',id:r.r.id}])),'status_evidence_required');
 const otherResult=await result(h,{service:h.other});await reject(()=>s.record(project,input(src,[{kind:'result',id:otherResult.r.id}])),'status_evidence_required');
 const without=await task(h,{evidence:false});await reject(()=>s.record(project,input(src,[taskRef(without.t)])),'status_evidence_required');
 await reject(()=>s.record(project,input(src,[{...taskRef(t),revision:99}])),'status_evidence_changed');
 assert.equal(h.count('project_status_records'),0);
});

test('actual imported standard provenance and stored result references can produce bounded snapshots',async()=>{
 const h=await harness(),{r}=await result(h),s=statusFor(h),src=await h.service.importRequestSource(project,{roomId:uid('room'),messageId:uid('message'),createdAt:sourceTime,text:'Synthetic original main-chat source',mode:'standard',context:[]});
 const before=snapshot(h),saved=await s.record(project,input(src,[{kind:'result',id:r.id}]));assert.equal(saved.record.sourceMessageId,src.id);assert.equal(saved.record.references[0].resultKind,'work');assert.equal(saved.record.references[0].observedAt,evidenceTime);unchanged(h,before);
 const plan=await h.service.importRequestSource(project,{roomId:uid('room'),messageId:uid('message'),createdAt:sourceTime,text:'Synthetic planning-only original source',mode:'plan_only',context:[]});await reject(()=>s.record(project,input(plan,[{kind:'result',id:r.id}],{expectedRevision:1})),'status_source_must_be_standard');
});

test('bounded payload, exact reference keys, valid times and known project fail closed',async()=>{
 const h=await harness(),{src,t}=await task(h),s=statusFor(h),body=input(src,[taskRef(t)]);
 for(const change of [{owner_id:'review_other'},{summary:''},{summary:'x'.repeat(1001)},{references:[]},{references:Array(9).fill(taskRef(t))},{expectedRevision:-1},{expectedRevision:0.1}])await reject(()=>s.record(project,{...body,...change}),'invalid_status_record');
 for(const refs of [[{kind:'other',id:t.id}],[{...taskRef(t),owner_id:'review_other'}],[{kind:'task',id:t.id}],[{kind:'task',id:t.id,revision:2.3}],[null]])await reject(()=>s.record(project,{...body,references:refs}),'invalid_status_reference','task_revision_required');
 for(const observedAt of ['',null,'bad','2099-01-01T00:00:00Z','2026-10-07T00:00:00Z'])await reject(()=>s.record(project,{...body,observedAt}),'invalid_status_time');
 await reject(()=>s.record(project,{...body,observedAt:'2026-10-08T00:01:00Z'}),'status_evidence_required');
 await reject(()=>s.record('unknown-project',body),'unknown_project');assert.equal(h.count('project_status_records'),0);
});

test('status optimistic concurrency, operation conflicts and cross-project replay are guarded',async()=>{
 const h=await harness(),{src,t}=await task(h),s=statusFor(h),body=input(src,[taskRef(t)]);
 const records=await Promise.all([s.record(project,body),s.record(project,body)]);assert.deepEqual(records.map(x=>x.replayed).sort(),[false,true]);assert.equal(h.count('project_status_records'),1);
 for(const change of [{summary:'Changed'},{blocker:'Changed'},{expectedRevision:1}])await reject(()=>s.record(project,{...body,...change}),'operation_id_reused');
 await reject(()=>s.record(otherProject,body),'operation_id_reused');await reject(()=>s.record(project,{...body,operationId:uid('stale')}),'stale_status_revision');
 const concurrent=await Promise.allSettled([s.record(project,{...body,operationId:uid('next'),expectedRevision:1}),s.record(project,{...body,operationId:uid('race'),expectedRevision:1})]);assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(concurrent.find(r=>r.status==='rejected').reason.code,'stale_status_revision');
 assert.equal((await s.read(project)).curated.revision,2);
});

test('idempotency accepts equivalent JSON object ordering and normalized observation times',async()=>{
 const h=await harness(),{src,t}=await task(h),{r}=await result(h),s=statusFor(h),body=input(src,[taskRef(t),{kind:'result',id:r.id}]);await s.record(project,body);
 const reordered=Object.fromEntries(Object.entries(body).reverse());reordered.references=[{id:r.id,kind:'result'},{revision:t.revision,id:t.id,kind:'task'}];reordered.observedAt='2026-10-08T09:10:00+09:00';
 assert.equal((await s.record(project,reordered)).replayed,true);assert.equal(h.count('project_status_records'),1);
 await reject(()=>s.record(project,input(src,[taskRef(t),taskRef(t)],{expectedRevision:1})),'duplicate_status_reference');
});

test('stored snapshot remains immutable after task evidence changes and is marked stale',async()=>{
 const h=await harness(),{src,t}=await task(h),s=statusFor(h),body=input(src,[taskRef(t)]),saved=(await s.record(project,body)).record;
 h.raw.prepare('UPDATE board_tasks SET progress_evidence_json=?, progress_verified_at=?, revision=revision+1, updated_at=? WHERE id=?').run(JSON.stringify(['Later evidence']),checkedTime,'2026-10-10T12:01:00.000Z',t.id);
 assert.deepEqual((await s.record(project,body)).record,saved);const current=await s.read(project);assert.equal(current.curated.stale,true);assert.deepEqual(current.curated.evidence,saved.evidence);assert.deepEqual(current.tasks[0].evidence,['Later evidence']);
});

test('task evidence revision must still match at the atomic status insertion',async()=>{
 const h=await harness(),{src,t}=await task(h);let intercepted=false;
 const db={...h.db,prepare(sql){const prepared=h.db.prepare(sql);if(!sql.startsWith('INSERT INTO project_status_records'))return prepared;return {bind(...args){const bound=prepared.bind(...args);return {...bound,async run(){if(!intercepted){intercepted=true;h.raw.prepare('UPDATE board_tasks SET revision=revision+1, progress_evidence_json=? WHERE id=?').run(JSON.stringify(['Concurrent replacement']),t.id)}return bound.run()}}}}}};
 const s=statusFor(h,owner,db);await assert.rejects(()=>s.record(project,input(src,[taskRef(t)])),e=>e.code==='status_evidence_changed'||e.code==='stale_status_revision');assert.equal(h.count('project_status_records'),0);
});

test('queued is not working; successful parents with unfinished descendants are not effectively complete',()=>{
 const queued=deriveStatus(project,[derivedRow({state:'queued',result_json:null})],[],null,checkedTime);assert.equal(queued.state,'queued');assert.equal(queued.counts.active,0);assert.equal(queued.counts.verifiedCompleted,0);
 const parent=derivedRow(),child=derivedRow({id:'task_review_child',parent_task_id:parent.id,state:'queued',result_json:null}),grandchild=derivedRow({id:'task_review_grandchild',parent_task_id:child.id,state:'running',result_json:null});
 const withChildren=deriveStatus(project,[parent,child,grandchild],[workOutcome],null,checkedTime);assert.equal(withChildren.tasks.find(t=>t.id===parent.id).completionVerified,true);assert.equal(withChildren.tasks.find(t=>t.id===parent.id).effectiveComplete,false);assert.equal(withChildren.counts.verifiedCompleted,0);
 const complete=deriveStatus(project,[parent,derivedRow({id:child.id,parent_task_id:parent.id})],[workOutcome],null,checkedTime);assert(complete.tasks.every(t=>t.effectiveComplete));assert.equal(complete.state,'recorded');assert.notEqual(complete.state,'completed');
});

test('plan/report/unknown outcomes are not work; missing evidence, missing parents and cycles fail completion closed',()=>{
 for(const overrides of [{source_mode:'plan_only'},{action:'investigate_report'}]){const s=deriveStatus(project,[derivedRow(overrides)],[workOutcome],null,checkedTime);assert.equal(s.counts.verifiedCompleted,0)}
 for(const kind of ['plan','report','unknown'])assert.equal(deriveStatus(project,[derivedRow()],[{...workOutcome,kind}],null,checkedTime).tasks[0].effectiveComplete,false);
 for(const overrides of [{result_json:null},{parent_task_id:'task_missing_parent'},{parent_task_id:'task_review_001'}])assert.equal(deriveStatus(project,[derivedRow(overrides)],[workOutcome],null,checkedTime).tasks[0].effectiveComplete,false);
 const cyclic=[derivedRow({id:'task_cycle_A',parent_task_id:'task_cycle_B'}),derivedRow({id:'task_cycle_B',parent_task_id:'task_cycle_A'})];assert(deriveStatus(project,cyclic,[workOutcome],null,checkedTime).tasks.every(t=>!t.effectiveComplete));
 const rows=Array.from({length:35},(_,i)=>derivedRow({id:'task_count_'+i,state:'queued',result_json:null})),truncated=deriveStatus(project,rows,[],null,checkedTime);assert.equal(truncated.tasks.length,30);assert.equal(truncated.tasksTruncated,true);assert.equal(truncated.counts.total,35);assert.equal(truncated.counts.queued,35);
});

test('external evidence observation is never replaced by record, hierarchy update, or check time',async()=>{
 const h=await harness(),{src,t}=await task(h,{evidence:false});await h.service.recordExternal(t.id,{sourceMessageId:src.id,externalTaskRef:'synthetic_external_ref',state:'succeeded',observedAt:evidenceTime,summary:'External scope completed',evidence:['External evidence'],expectedRevision:t.revision,operationId:uid('external')});
 const s=statusFor(h),first=await s.read(project);assert.equal(first.checkedAt,checkedTime);assert.equal(first.tasks[0].observedAt,evidenceTime);assert.equal(first.latestEvidenceAt,evidenceTime);assert.equal(first.activityUpdatedAt,savedTime);
 h.raw.prepare('UPDATE board_tasks SET updated_at=?, revision=revision+1 WHERE id=?').run(checkedTime,t.id);
 const later=await s.read(project);assert.equal(later.tasks[0].observedAt,evidenceTime);assert.equal(later.latestEvidenceAt,evidenceTime);assert.equal(later.activityUpdatedAt,checkedTime);
});

test('native successful-result evidence keeps its original operation date after a hierarchy operation',async()=>{
 const h=await harness(),src=await source(h);let t=await h.service.createTask(project,{clientId:uid('native'),sourceMessageId:src.id,title:'Native synthetic report',scope:'Synthetic read-only report',action:'investigate_report',priority:50,priorityReason:'Fixture',dependencies:[]});
 for(const state of ['claimed','running','verifying','succeeded'])t=(await h.service.advanceTask(t.id,{operationId:uid('advance'),expectedRevision:t.revision,fence:t.fence,state,...(state==='running'?{boundTaskRef:'synthetic_native_worker'}:{}),...(state==='succeeded'?{summary:'Synthetic finished report',evidence:['Native original operation proof']}:{})})).task;
 const s=statusFor(h);assert.equal((await s.read(project)).tasks[0].observedAt,savedTime);
 const later=createService({db:h.db,owner,projects:h.projects,clock:()=>checkedTime});await later.setParent(t.id,{parentTaskId:null,position:20,expectedRevision:t.revision,operationId:uid('hierarchy')});
 const after=await s.read(project);assert.equal(after.tasks[0].observedAt,savedTime);assert.equal(after.latestEvidenceAt,savedTime);assert.equal(after.activityUpdatedAt,checkedTime);
 const recorded=await s.record(project,input(src,[{kind:'task',id:t.id,revision:t.revision+1}],{observedAt:checkedTime}));assert.equal(recorded.record.references[0].observedAt,savedTime);
});

test('curated review date must not refresh the underlying latest evidence date',async()=>{
 const h=await harness(),{src,t}=await task(h),s=statusFor(h);await s.record(project,input(src,[taskRef(t)],{observedAt:checkedTime}));const current=await s.read(project);assert.equal(current.latestEvidenceAt,evidenceTime);
});

test('storage and malformed persisted snapshots fail closed without fallback progress or mutation',async()=>{
 const h=await harness(),{src,t}=await task(h),s=statusFor(h);await s.record(project,input(src,[taskRef(t)]));const before=snapshot(h);
 const broken={prepare(){throw Error('Synthetic failed storage')},batch(){throw Error('Synthetic failed storage')}};
 for(const path of ['/api/project-status','/api/projects/'+project+'/status']){const r=await h.handleRequest(new Request(origin+path,{headers:{'oai-authenticated-user-id':owner}}),{DB:broken},{projects:h.projects});assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'storage_unavailable'})}
 h.raw.prepare('UPDATE project_status_records SET evidence_json=?').run('{}');const malformed=await route(h,'/api/project-status');assert.equal(malformed.status,503);assert.equal(malformed.data.error,'storage_unavailable');unchanged(h,before);assert.equal(outbound,0);
});

test('MCP tools advertise exact owner-context API and bundled Worker routes status reads',()=>{
 const read=tools.find(x=>x.name==='project_status_get'),write=tools.find(x=>x.name==='project_status_record');assert(read);assert(write);assert.equal(read.annotations.readOnlyHint,true);assert.equal(write.annotations.readOnlyHint,false);assert.equal(write.inputSchema.additionalProperties,false);assert.equal(write.inputSchema.properties.references.items.additionalProperties,false);
 const build=readFileSync(root+'/build-worker.mjs','utf8');assert(build.includes("'project-status.mjs'"));assert(build.includes("url.pathname==='/api/project-status'"));
});
