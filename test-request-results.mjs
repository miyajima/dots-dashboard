// Independent, bounded, synthetic SQLite/MCP review. No production calls or writes.
import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,root,reject} from './test-provenance/harness.mjs';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';

let outbound=0;
globalThis.fetch=async()=>{outbound++;throw Error('Network is forbidden in this offline review')};
const project='astraharness',otherProject='orgbrain';
let sequence=0;
async function pair(f,{pid=project,mode='standard',sourceAt='2026-10-08T00:00:00Z',replyAt='2026-10-08T00:10:00Z',service=f.service}={}){
 const n=++sequence;
 const source=(await service.postUserMessage(pid,{clientId:'result_review_source_'+n,text:'Synthetic bounded request '+n,metadata:{mode}})).message;
 const reply=(await service.postDotReply(pid,{clientId:'result_review_reply_'+n,replyTo:source.id,text:'Synthetic actual dot report '+n})).message;
 f.raw.prepare('UPDATE chat_messages SET created_at=? WHERE id=?').run(sourceAt,source.id);
 f.raw.prepare('UPDATE chat_messages SET created_at=? WHERE id=?').run(replyAt,reply.id);
 return {source,reply,input:{sourceMessageId:source.id,replyMessageId:reply.id,status:'completed',kind:'work',summary:'Scoped request completed with synthetic evidence.',observedAt:'2026-10-08T00:05:00Z',evidence:['Offline test evidence; no real user task or publication.']}};
}
const snapshot=(f,table)=>f.raw.prepare('SELECT * FROM '+table+' ORDER BY rowid').all();
const unchangedTables=['chat_messages','board_tasks','task_operations','external_task_progress','event_outbox','event_deliveries','event_subscriptions','external_request_sources','task_source_links'];
const ok=response=>{assert.equal(response.status,200);assert(!response.data.result?.isError,JSON.stringify(response));return response.data.result.structuredContent.data};
const error=(response,code,status)=>{assert.equal(response.status,200);assert.equal(response.data.result.isError,true);assert.equal(response.data.result.structuredContent.error,code);if(status)assert.equal(response.data.result.structuredContent.status,status)};

test('additive migration preserves pre-existing source/reply rows and creates indexed empty results',()=>{
 const raw=new DatabaseSync(':memory:'),migrations=readdirSync(root+'/drizzle').filter(x=>x.endsWith('.sql')).sort();
 const resultMigration=migrations.find(x=>x.startsWith('0011_'));assert(resultMigration);
 for(const name of migrations.filter(x=>x<resultMigration))raw.exec(readFileSync(root+'/drizzle/'+name,'utf8'));
 const insert=raw.prepare('INSERT INTO chat_messages(id,owner_id,project_id,client_id,author,text,reply_to,created_at) VALUES(?,?,?,?,?,?,?,?)');
 insert.run('existing_user_001','review_owner',project,'migration_user_001','user','Keep original request',null,'2026-10-08T00:00:00Z');
 insert.run('existing_reply_001','review_owner',project,'migration_reply_001','dot','Keep original report','existing_user_001','2026-10-08T00:10:00Z');
 const before=raw.prepare('SELECT rowid,* FROM chat_messages ORDER BY rowid').all();
 raw.exec(readFileSync(root+'/drizzle/'+resultMigration,'utf8'));
 assert.deepEqual(raw.prepare('SELECT rowid,* FROM chat_messages ORDER BY rowid').all(),before);
 assert.equal(raw.prepare('SELECT count(*) AS n FROM request_results').get().n,0);
 const indexes=raw.prepare("PRAGMA index_list('request_results')").all();
 assert(indexes.some(x=>x.name==='request_result_reply'&&x.unique===1));assert(indexes.some(x=>x.name==='request_results_source'));
 raw.close();
});

test('existing reply annotation is separate, immutable, owner-safe, and leaves verifying umbrella and Events unchanged',async()=>{
 const f=await harness(),p=await pair(f);
 const task=await f.service.createTask(project,{clientId:'review_result_umbrella',sourceMessageId:p.source.id,title:'Umbrella task',scope:'Synthetic ongoing umbrella',action:'proposed',priority:50,priorityReason:'Synthetic fixture',dependencies:[]});
 await f.service.recordExternal(task.id,{sourceMessageId:p.source.id,externalTaskRef:'external_synthetic_task',state:'verifying',observedAt:'2026-10-08T00:08:00Z',summary:'Umbrella still verifying',evidence:['Synthetic verification evidence'],expectedRevision:1,operationId:'review_result_external'});
 const before=new Map(unchangedTables.map(t=>[t,snapshot(f,t)])),beforeSource=await f.service.readMessage(p.source.id);
 assert.equal(beforeSource.requestResult,null);assert.equal(beforeSource.receipt.dotReplyId,p.reply.id);
 const record=await f.service.recordRequestResult(project,p.input);
 assert.equal(record.replayed,false);assert.equal(f.count('request_results'),1);
 assert.equal(record.result.replyMessageId,p.reply.id);assert.equal(record.result.sourceMessageId,p.source.id);
 assert.equal(record.result.replyText,p.reply.text);assert.equal(record.result.observedAt,'2026-10-08T00:05:00.000Z');
 for(const [table,rows]of before)assert.deepEqual(snapshot(f,table),rows,table+' changed');
 const source=await f.device.readMessage(p.source.id),reply=await f.device.readMessage(p.reply.id);
 assert.deepEqual(source.requestResult,reply.requestResult);assert.deepEqual(source.receipt,beforeSource.receipt);assert.equal(reply.receipt,null);
 assert.equal((await f.service.getTask(task.id)).state,'verifying');assert.equal(source.metadata.mode,'standard');
 assert(!('owner_id' in record.result));assert(!('fingerprint' in record.result));
 const replay=await f.device.recordRequestResult(project,{...p.input,observedAt:'2026-10-08T09:05:00+09:00'});
 assert.equal(replay.replayed,true);assert.deepEqual(replay.result,record.result);
 for(const mutation of [{summary:'Changed summary'},{status:'published'},{kind:'report'},{observedAt:'2026-10-08T00:06:00Z'},{evidence:['Changed evidence']}])await reject(()=>f.service.recordRequestResult(project,{...p.input,...mutation}),'result_reply_reused');
 assert.equal(f.count('request_results'),1);assert.equal(outbound,0);
});

test('published can advance via a new completed reply; late old annotation never downgrades it',async()=>{
 const f=await harness(),p=await pair(f);
 const newer=(await f.service.postDotReply(project,{clientId:'review_result_newer_reply',replyTo:p.source.id,text:'Newer corrected report'})).message;
 f.raw.prepare('UPDATE chat_messages SET created_at=? WHERE id=?').run('2026-10-08T00:20:00Z',newer.id);
 const current=await f.service.recordRequestResult(project,{...p.input,replyMessageId:newer.id,summary:'Newer outcome',observedAt:'2026-10-08T00:15:00Z'});
 const old=await f.service.recordRequestResult(project,{...p.input,status:'published',summary:'Older outcome recorded later'});
 assert.equal((await f.service.readMessage(p.source.id)).requestResult.id,current.result.id);
 assert.equal((await f.service.readMessage(p.reply.id)).requestResult.id,old.result.id);
 assert.equal((await f.service.readMessage(p.source.id)).receipt.dotReplyId,p.reply.id);
 const listed=await f.service.messages(project);assert.equal(listed.find(m=>m.id===p.source.id).requestResult.id,current.result.id);
 assert.equal(old.result.status,'published');assert.equal(current.result.status,'completed');assert.equal((await f.service.readMessage(p.reply.id)).requestResult.status,'published');
 assert.equal(f.count('request_results'),2);
});

test('concurrent identical calls yield one persisted result and exactly one creation receipt',async()=>{
 const f=await harness(),p=await pair(f);
 const results=await Promise.all([f.service.recordRequestResult(project,p.input),f.device.recordRequestResult(project,p.input)]);
 assert.equal(f.count('request_results'),1);assert.equal(results[0].result.id,results[1].result.id);
 assert.deepEqual(results.map(x=>x.replayed).sort(),[false,true]);
});

test('concurrent conflicting calls cannot replace or fork a result',async()=>{
 const f=await harness(),p=await pair(f);
 const results=await Promise.allSettled([f.service.recordRequestResult(project,p.input),f.device.recordRequestResult(project,{...p.input,summary:'Conflicting concurrent content'})]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'result_reply_reused');
 assert.equal(f.count('request_results'),1);
 assert.equal((await f.service.readMessage(p.source.id)).requestResult.summary,results.find(x=>x.status==='fulfilled').value.result.summary);
});

test('exact source, reply author, project, owner, and dashboard origin are mandatory',async()=>{
 const f=await harness(),p=await pair(f),wrong=await pair(f),cross=await pair(f,{pid:otherProject}),other=await pair(f,{service:f.other});
 await reject(()=>f.other.recordRequestResult(project,p.input),'message_not_found');
 await reject(()=>f.service.recordRequestResult(otherProject,p.input),'invalid_result_reply');
 await reject(()=>f.service.recordRequestResult('unknown',p.input),'unknown_project');
 for(const change of [{replyMessageId:wrong.reply.id},{sourceMessageId:wrong.source.id},{replyMessageId:p.source.id},{sourceMessageId:p.reply.id},{replyMessageId:cross.reply.id},{sourceMessageId:cross.source.id}])await reject(()=>f.service.recordRequestResult(project,{...p.input,...change}),'invalid_result_reply');
 for(const change of [{sourceMessageId:'missing_source_001'},{replyMessageId:'missing_reply_001'},{sourceMessageId:other.source.id},{replyMessageId:other.reply.id}])await reject(()=>f.service.recordRequestResult(project,{...p.input,...change}),'message_not_found');
 const imported=await f.service.importRequestSource(project,{roomId:'review_result_room',messageId:'review_result_main_message',createdAt:'2026-10-08T00:00:00Z',text:'Synthetic imported source',mode:'standard',context:[]});
 await reject(()=>f.service.recordRequestResult(project,{...p.input,sourceMessageId:imported.id}),'message_not_found');
 assert.equal(f.count('request_results'),0);assert.equal((await f.other.messages(project)).some(m=>m.id===p.source.id),false);
});

test('plan_only allows completed plan/report but never implemented or published work',async()=>{
 const f=await harness();
 for(const kind of ['plan','report']){const p=await pair(f,{mode:'plan_only'});const result=await f.service.recordRequestResult(project,{...p.input,kind});assert.equal(result.result.kind,kind);assert.equal((await f.service.readMessage(p.source.id)).metadata.mode,'plan_only');}
 const p=await pair(f,{mode:'plan_only'});
 for(const status of ['completed','published'])await reject(()=>f.service.recordRequestResult(project,{...p.input,status}),'plan_only_result_scope');
 for(const kind of ['plan','report'])await reject(()=>f.service.recordRequestResult(project,{...p.input,status:'published',kind}),'invalid_result_kind');
 const standard=await pair(f);assert.equal((await f.service.recordRequestResult(project,{...standard.input,status:'published'})).result.status,'published');
 assert.equal(f.count('request_results'),3);
});

test('date bounds, required fields, bounded evidence, enums and unknown fields fail closed',async()=>{
 const f=await harness(),p=await pair(f);
 for(const observedAt of [null,0,{},'', 'nonsense','2026-10-07T23:59:59Z','2026-10-08T00:10:00.001Z','2099-01-01T00:00:00Z'])await reject(()=>f.service.recordRequestResult(project,{...p.input,observedAt}),'invalid_result_time');
 for(const change of [{status:'succeeded'},{kind:'implementation'},{summary:''},{summary:' '.repeat(5)},{summary:'x'.repeat(601)},{evidence:[]},{evidence:Array(9).fill('x')},{evidence:['']},{evidence:['x'.repeat(1001)]},{evidence:'proof'},{owner_id:'review_other'},{taskId:'ignored_task_id'}])await reject(()=>f.service.recordRequestResult(project,{...p.input,...change}),'invalid_request_result');
 for(const key of Object.keys(p.input)){const input={...p.input};delete input[key];await reject(()=>f.service.recordRequestResult(project,input),key==='observedAt'?'invalid_result_time':'invalid_request_result');}
 assert.equal(f.count('request_results'),0);
 assert.equal((await f.service.recordRequestResult(project,{...p.input,observedAt:'2026-10-08T00:00:00Z'})).result.observedAt,'2026-10-08T00:00:00.000Z');
 const end=await pair(f);assert.equal((await f.service.recordRequestResult(project,{...end.input,observedAt:'2026-10-08T00:10:00Z'})).result.observedAt,'2026-10-08T00:10:00.000Z');
 const future=await pair(f,{replyAt:'2026-10-08T02:00:00Z'});await reject(()=>f.service.recordRequestResult(project,{...future.input,observedAt:'2026-10-08T01:05:00.001Z'}),'invalid_result_time');
});

test('MCP schema, authenticated call/readback, structured failures, no client spoofing or Events writes',async()=>{
 const f=await harness(),p=await pair(f),args={projectId:project,...p.input};
 const {tools}=await import(pathToFileURL(root+'/worker/chat-handler.mjs')),definition=tools.find(t=>t.name==='project_request_result_record');
 assert(definition);assert.equal(definition.inputSchema.additionalProperties,false);assert.equal(definition.annotations.readOnlyHint,false);
 assert.deepEqual([...definition.inputSchema.required].sort(),Object.keys(args).sort());
 assert.equal((await f.rpc('project_request_result_record',args,null)).status,401);
 assert.equal((await f.rpc('project_request_result_record',args,'review_owner',{origin:'https://dashboard.example'})).status,403);
 error(await f.rpc('project_request_result_record',args,'review_other'),'message_not_found',404);
 error(await f.rpc('project_request_result_record',{...args,owner_id:'review_other'}),'invalid_request_result',400);
 error(await f.rpc('project_request_result_record',{...args,projectId:otherProject}),'invalid_result_reply',400);
 error(await f.rpc('project_request_result_record',{...args,observedAt:'bad'}),'invalid_result_time',400);
 const before=new Map(unchangedTables.map(t=>[t,snapshot(f,t)]));
 const saved=ok(await f.rpc('project_request_result_record',args));assert.equal(saved.replayed,false);assert.equal(ok(await f.rpc('project_request_result_record',args)).replayed,true);
 error(await f.rpc('project_request_result_record',{...args,summary:'Different'}),'result_reply_reused',409);
 const read=ok(await f.rpc('project_message_get',{messageId:p.source.id}));assert.equal(read.requestResult.id,saved.result.id);assert.equal(read.receipt.dotReplyId,p.reply.id);assert(!('owner_id' in read));
 const listed=ok(await f.rpc('project_messages_list',{projectId:project}));assert.equal(listed.find(m=>m.id===p.reply.id).requestResult.id,saved.result.id);
 error(await f.rpc('project_dot_reply',{projectId:project,clientId:'review_spoofed_result',replyTo:p.source.id,text:'Forged result',requestResult:{status:'completed'}}),'invalid_message');
 for(const [table,rows]of before)assert.deepEqual(snapshot(f,table),rows,table+' changed');
 assert.equal(f.count('request_results'),1);assert.equal(outbound,0);
});
