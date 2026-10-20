import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './test-provenance/harness.mjs';
import {createService} from './worker/chat-task-service.mjs';

const roomId='room_source_session_1234',rootMessageId='source_session_root',canonicalRootRef='room_source_session_1234~root~source_session_root';
const input=(extra={})=>({roomId,messageId:'source_assignment_1234',createdAt:'2026-10-08T00:01:00.123456Z',text:'Assign this instruction to the new conversation',mode:'standard',context:[],...extra});
async function setup(){const f=await harness(),p=f.projects[0],session=await f.service.sessions.create(p,{clientId:'source_new_session_1234',title:'Assigned conversation',purpose:'conversation'});return {...f,p,session,binding:sourceId=>({sessionId:session.id,roomId,canonicalRootRef,rootMessageId,sourceMessageId:sourceId})}}
const reject=(fn,...codes)=>assert.rejects(fn,e=>!codes.length||codes.includes(e.code));
const taskInput=source=>({clientId:'source_task_1234',sourceMessageId:source.id,title:'Task from main chat',scope:'Registration only',action:'proposed',priority:50,priorityReason:'Explicit request',dependencies:[]});
async function bindAndQuote(f,quoteInput=input(),quoteAuthor='user'){
 const bindingSource=await f.service.importRequestSource(f.p,input({messageId:'binding_only_source_1234'}));await f.service.sessions.bind(f.p,f.binding(bindingSource.id));
 const quotes=[{messageId:rootMessageId,canonicalRef:canonicalRootRef,replyToRef:null,replyRootRef:null,author:'dot',text:'Original root',createdAt:'2026-10-08T00:00:00.000000Z',mode:'unknown'},{messageId:quoteInput.messageId,canonicalRef:null,replyToRef:canonicalRootRef,replyRootRef:canonicalRootRef,author:quoteAuthor,text:quoteInput.text,createdAt:quoteInput.createdAt,mode:quoteInput.mode}];
 await f.service.sessions.import(f.p,{sessionId:f.session.id,roomId,canonicalRootRef,messages:quotes});return bindingSource;
}
test('main chat workflow creates session, imports assigned source, binds, and derives task session',async()=>{
 const f=await setup(),beforeMessages=f.count('chat_messages'),beforeEvents=f.count('event_outbox'),source=await f.service.importRequestSource(f.p,input({sessionId:f.session.id}));assert.equal(source.sessionId,f.session.id);assert.equal(source.executionAuthorization,'none');
 const bound=await f.service.sessions.bind(f.p,f.binding(source.id));assert.equal(bound.thread.roomId,roomId);const task=await f.service.createTask(f.p,taskInput(source));assert.equal(task.sessionId,f.session.id);assert.equal(task.requestSource.sessionId,f.session.id);assert.equal(task.action,'proposed');assert.equal(task.state,'queued');assert.equal(f.count('chat_messages'),beforeMessages);assert.equal(f.count('event_outbox'),beforeEvents);
 await reject(()=>f.service.advanceTask(task.id,{operationId:'mainchat_claim_1234',expectedRevision:1,fence:0,state:'claimed'}),'imported_source_registration_only');
});
test('legacy omitted-session source fingerprint remains unchanged and General can authorize binding',async()=>{
 const f=await setup(),x=input(),source=await f.service.importRequestSource(f.p,x),raw=f.raw.prepare('SELECT fingerprint,session_id FROM external_request_sources WHERE id=?').get(source.id);
 assert.equal(raw.fingerprint,JSON.stringify([f.p,x.roomId,x.messageId,x.createdAt,x.text,x.mode,x.context]));assert.equal(raw.session_id,null);assert.equal(source.sessionId,'general');assert.equal((await f.service.importRequestSource(f.p,{...x,sessionId:'general'})).id,source.id);await f.service.sessions.bind(f.p,f.binding(source.id));
});
test('assigned source rejects different owner, project, and session reassignment',async()=>{
 const f=await setup(),x=input({sessionId:f.session.id}),source=await f.service.importRequestSource(f.p,x);await reject(()=>f.other.importRequestSource(f.p,x),'session_not_found');await reject(()=>f.service.importRequestSource(f.projects[1],x),'session_not_found');await reject(()=>f.other.requestSource(source.id),'source_not_found');
 const second=await f.service.sessions.create(f.p,{clientId:'second_source_session_1234',title:'Second',purpose:'conversation'});await reject(()=>f.service.importRequestSource(f.p,{...x,sessionId:second.id}),'source_reference_conflict');await reject(()=>f.service.importRequestSource(f.p,{...x,sessionId:'general'}),'source_reference_conflict');
});
test('binding rejects imported source from another owner/project/room/assigned session',async()=>{
 const f=await setup(),source=await f.service.importRequestSource(f.p,input({sessionId:f.session.id}));await reject(()=>f.service.sessions.bind(f.p,{...f.binding(source.id),roomId:'different_room_1234'}),'binding_source_mismatch');
 const second=await f.service.sessions.create(f.p,{clientId:'binding_second_session_1234',title:'Second',purpose:'conversation'});await reject(()=>f.service.sessions.bind(f.p,{...f.binding(source.id),sessionId:second.id}),'binding_source_mismatch');
 const otherOwner=await f.other.importRequestSource(f.p,input({messageId:'other_owner_source_1234'}));await reject(()=>f.service.sessions.bind(f.p,f.binding(otherOwner.id)),'binding_requires_user_source');
 const otherProject=await f.service.importRequestSource(f.projects[1],input({messageId:'other_project_source_1234'}));await reject(()=>f.service.sessions.bind(f.p,f.binding(otherProject.id)),'binding_requires_user_source');
});
test('bound source import requires an exact previously mirrored user quote',async()=>{
 const f=await setup(),x=input();await bindAndQuote(f,x);
 for(const changed of [{text:x.text+' altered'},{mode:'plan_only'},{createdAt:'2026-10-08T00:01:01Z'},{messageId:'unmirrored_source_1234'},{roomId:'different_room_1234'}])await reject(()=>f.service.importRequestSource(f.p,{...x,sessionId:f.session.id,...changed}),'source_quote_mismatch','source_session_mismatch');
 const source=await f.service.importRequestSource(f.p,{...x,sessionId:f.session.id});assert.equal(source.sessionId,f.session.id);assert.equal((await f.service.importRequestSource(f.p,{...x,sessionId:f.session.id})).id,source.id);
});
test('bound dot-authored quote cannot become an imported user instruction',async()=>{
 const f=await setup();await bindAndQuote(f,input(),'dot');await reject(()=>f.service.importRequestSource(f.p,input({sessionId:f.session.id})),'source_quote_mismatch');
});
test('bound quote original timestamp cannot change within the same millisecond',async()=>{
 const f=await setup(),x=input();await bindAndQuote(f,x);await reject(()=>f.service.importRequestSource(f.p,{...x,sessionId:f.session.id,createdAt:'2026-10-08T00:01:00.123999Z'}),'source_quote_mismatch');
});
test('plan-only source keeps mode and cannot bind or authorize external progress',async()=>{
 const f=await setup(),x=input({sessionId:f.session.id,mode:'plan_only'}),source=await f.service.importRequestSource(f.p,x);assert.equal(source.metadata.mode,'plan_only');await reject(()=>f.service.importRequestSource(f.p,{...x,mode:'standard'}),'source_reference_conflict');await reject(()=>f.service.sessions.bind(f.p,f.binding(source.id)),'binding_requires_user_source');
 const task=await f.service.createTask(f.p,taskInput(source));assert.equal(task.requestSource.metadata.mode,'plan_only');await reject(()=>f.service.recordExternal(task.id,{sourceMessageId:source.id,externalTaskRef:'a-real-external-ref',state:'running',observedAt:'2026-10-08T00:02:00Z',summary:'Not allowed from plan',evidence:['Should remain plan'],expectedRevision:1,operationId:'plan_external_progress_1234'}),'plan_only_source');assert.equal((await f.service.getTask(task.id)).state,'queued');
});
test('historical sessions reject source registration and malformed session IDs fail before writes',async()=>{
 const f=await setup(),history=await f.service.sessions.create(f.p,{clientId:'source_history_1234',title:'History',purpose:'history'}),before=f.count('external_request_sources');for(const sessionId of [history.id,'',0,false])await reject(()=>f.service.importRequestSource(f.p,input({sessionId})),'source_session_mismatch','invalid_session');assert.equal(f.count('external_request_sources'),before);
});
test('import retry after binding still replays original assigned source before any mirror exists',async()=>{
 const f=await setup(),x=input({sessionId:f.session.id}),source=await f.service.importRequestSource(f.p,x);await f.service.sessions.bind(f.p,f.binding(source.id));assert.equal((await f.service.importRequestSource(f.p,x)).id,source.id);
});
test('binding cannot strand existing session-assigned sources from another room',async()=>{
 const f=await setup(),sourceA=await f.service.importRequestSource(f.p,input({sessionId:f.session.id}));await reject(()=>f.service.importRequestSource(f.p,input({sessionId:f.session.id,roomId:'other_assigned_room_1234',messageId:'other_room_source_1234'})),'source_session_mismatch');await f.service.sessions.bind(f.p,f.binding(sourceA.id));assert.equal(f.count('external_request_sources'),1);assert.equal((await f.service.sessions.get(f.p,f.session.id)).thread.roomId,roomId);
});
test('MCP source assignment exposes immutable session and errors with no native post',async()=>{
 const f=await setup(),before=f.count('chat_messages'),r=await f.rpc('project_request_source_import',{projectId:f.p,...input({sessionId:f.session.id})});assert.equal(r.data.result.isError,undefined);assert.equal(r.data.result.structuredContent.data.sessionId,f.session.id);assert.equal(f.count('chat_messages'),before);
 const other=await f.rpc('project_request_source_import',{projectId:f.p,...input({sessionId:f.session.id})},'review_other');assert.equal(other.data.result.structuredContent.error,'session_not_found');
});
test('import sees a concurrent new room binding before persisting its assigned source',async()=>{
 const f=await setup(),bindSource=await f.service.importRequestSource(f.p,input({messageId:'race_bind_source_1234',roomId:'race_other_room_1234'}));let paused,release;const reached=new Promise(r=>paused=r),gate=new Promise(r=>release=r);
 const db={prepare:sql=>f.db.prepare(sql),async batch(ops){paused();await gate;return f.db.batch(ops)}};
 const service=createService({db,owner:'review_owner',projects:f.projects,clock:()=>new Date('2026-10-08T01:00:00Z').toISOString()}),pending=service.importRequestSource(f.p,input({sessionId:f.session.id,messageId:'race_new_assignment_1234'}));await reached;
 await f.service.sessions.bind(f.p,{...f.binding(bindSource.id),roomId:'race_other_room_1234'});release();await reject(()=>pending,'source_session_mismatch','source_quote_mismatch');assert.equal(f.count('external_request_sources'),1);
});
