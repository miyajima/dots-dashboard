import assert from 'node:assert/strict';
import {harness,reject} from './harness.mjs';

let outbound=0;
globalThis.fetch=async()=>{outbound++;throw Error('Offline review must not send requests')};
const pid='astraharness';
const sourceInput=(suffix='01',mode='standard')=>({roomId:'room_review_001',messageId:'message_review_'+suffix,createdAt:'2026-10-08T00:30:00Z',text:'Register the requested plan. Synthetic offline provenance.',mode,context:[{messageId:'context_review_'+suffix,author:'assistant',createdAt:'2026-10-08T00:29:00Z',text:'Synthetic earlier clarification.'}]});
const taskInput=(sourceId,suffix='01')=>({clientId:'review_task_'+suffix,sourceMessageId:sourceId,title:'Synthetic plan',scope:'Offline registration only',action:'proposed',priority:50,priorityReason:'Synthetic review',dependencies:[]});
const linkInput=(sourceId,revision=1,suffix='01')=>({sourceId,note:'Later instruction concerns the existing task',expectedRevision:revision,operationId:'review_link_'+suffix});
const externalInput=(sourceId,revision=1,suffix='01')=>({sourceMessageId:sourceId,externalTaskRef:'synthetic-external-reference',observedAt:'2026-10-08T00:45:00Z',state:'running',summary:'Synthetic observed status only',evidence:['synthetic:external-status'],expectedRevision:revision,operationId:'review_external_'+suffix});
const tests=[];
const test=(name,run)=>tests.push({name,run});

test('Imported source is immutable, owner scoped, project scoped, and never a dashboard post',async()=>{
 const {service,device,other,count}=await harness();
 const input=sourceInput(),source=await service.importRequestSource(pid,input);
 assert.match(source.id,/^src_/);assert.equal(source.kind,'main_chat');assert.equal(source.verification,'dot_observed_not_independently_verified');assert.equal(source.executionAuthorization,'none');assert.equal(source.metadata.mode,'standard');
 assert.equal((await device.importRequestSource(pid,input)).id,source.id);
 for(const mutation of [{text:'Changed quotation'},{mode:'plan_only'},{createdAt:'2026-10-08T00:31:00Z'},{context:[]},{context:[{...input.context[0],text:'Changed context'}]}])await reject(()=>service.importRequestSource(pid,{...input,...mutation}),'source_reference_conflict');
 await reject(()=>service.importRequestSource('orgbrain',input),'source_reference_conflict');
 await reject(()=>other.requestSource(source.id),'source_not_found');
 const otherSource=await other.importRequestSource(pid,input);assert.notEqual(source.id,otherSource.id);
 assert.equal(count('external_request_sources'),2);assert.equal(count('chat_messages'),0);assert.equal(count('event_outbox'),0);assert.equal((await service.pendingMessages()).messages.length,0);
 await reject(()=>service.readMessage(source.id),'message_not_found');
 await reject(()=>service.postDotReply(pid,{clientId:'review_false_reply',replyTo:source.id,text:'This must fail'}),'message_not_found');
 assert.equal(count('chat_messages'),0);assert.equal(count('event_outbox'),0);
});

test('Equivalent context JSON key order replays safely',async()=>{
 const {service}=await harness();const input=sourceInput();const saved=await service.importRequestSource(pid,input);
 const c=input.context[0];const retry={...input,context:[{text:c.text,createdAt:c.createdAt,author:c.author,messageId:c.messageId}]};
 assert.equal((await service.importRequestSource(pid,retry)).id,saved.id);
});

test('Untrusted source/context validation is bounded and cannot override origin or owner',async()=>{
 const {service,count}=await harness();const input=sourceInput();
 for(const mutation of [{owner_id:'review_other'},{origin:'dashboard'},{author:'user'},{executionAuthorization:'native'},{text:'x'.repeat(8001)},{context:Array(4).fill(input.context[0])},{mode:'execute'},{createdAt:'2026-10-08T01:10:00Z'}])await reject(()=>service.importRequestSource(pid,{...input,...mutation}),'invalid_external_source');
 for(const c of [{...input.context[0],author:'system'},{...input.context[0],text:'x'.repeat(6001)},{...input.context[0],createdAt:'2026-10-08T00:31:00Z'},{...input.context[0],origin:'dashboard'}])await reject(()=>service.importRequestSource(pid,{...input,context:[c]}),'invalid_source_context');
 await reject(()=>service.importRequestSource(pid,{...input,text:'x'.repeat(8000),context:[{...input.context[0],text:'x'.repeat(4001)}]}),'source_context_too_large');
 assert.equal(count('external_request_sources'),0);
 const saved=await service.importRequestSource(pid,{...input,text:'<img src=x onerror=alert(1)>',context:[{...input.context[0],text:'javascript:alert(1)'}]});
 assert.equal(saved.text,'<img src=x onerror=alert(1)>');assert.equal(saved.context[0].text,'javascript:alert(1)');
});

test('Concurrent source retries deduplicate and conflicting bodies cannot overwrite provenance',async()=>{
 const {service,device,count}=await harness();const input=sourceInput();
 const same=await Promise.all([service.importRequestSource(pid,input),device.importRequestSource(pid,input)]);assert.equal(same[0].id,same[1].id);assert.equal(count('external_request_sources'),1);
 const candidate=sourceInput('race'),race=await Promise.allSettled([service.importRequestSource(pid,candidate),device.importRequestSource(pid,{...candidate,text:'Different body'})]);
 assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.equal(race.filter(x=>x.status==='rejected'&&x.reason.code==='source_reference_conflict').length,1);assert.equal(count('external_request_sources'),2);
});

test('Imported originals register parent/children only and cannot native-execute',async()=>{
 const {service,other,count}=await harness();const source=await service.importRequestSource(pid,sourceInput());const parent=await service.createTask(pid,taskInput(source.id));
 assert.equal(parent.source_message_id,source.id);assert.equal(parent.requestSource.id,source.id);assert.deepEqual(parent.linkedSources,[]);assert.equal(parent.state,'queued');assert.equal(parent.fence,0);assert.equal(parent.action,'proposed');
 await reject(()=>service.createTask(pid,{...taskInput(source.id,'execute'),action:'investigate_report'}),'imported_source_registration_only');
 await reject(()=>service.createTask('orgbrain',taskInput(source.id,'cross_project')),'invalid_task_source');
 await reject(()=>other.createTask(pid,taskInput(source.id,'cross_owner')),'source_not_found');
 const plan={planId:'review_plan_001',steps:[1,2,3,4].map(n=>({id:'review_step_'+n,title:'Step '+n,scope:'Synthetic scope',completionCriteria:'Verified condition',progressMark:'not_started',progressEvidence:[],progressVerifiedAt:'2026-10-08T00:40:00Z'}))};
 const imported=await service.importPlan(parent.id,plan);assert.equal(imported.children.length,4);assert.equal(imported.complete,0);
 for(const task of [parent,...imported.children]){assert.equal(task.source_message_id,source.id);assert.equal(task.requestSource.id,source.id);assert.equal(task.action,'proposed');for(const state of ['claimed','running','succeeded'])await reject(()=>service.advanceTask(task.id,{operationId:'review_adv_'+state+'_'+task.id.slice(5),expectedRevision:1,fence:0,state,boundTaskRef:'synthetic-only',summary:'Synthetic',evidence:['synthetic']}),'imported_source_registration_only','execution_not_authorized')}
 assert.deepEqual((await service.importPlan(parent.id,plan)).children.map(t=>t.id),imported.children.map(t=>t.id));
 assert.deepEqual(new Set((await service.requestSource(source.id)).relatedTaskIds),new Set([parent.id,...imported.children.map(t=>t.id)]));
 assert.equal(count('chat_messages'),0);assert.equal(count('event_outbox'),0);
});

test('Later native/main-chat sources link to same task without replacement, receipt, or rights',async()=>{
 const {service,other,count}=await harness();const source=await service.importRequestSource(pid,sourceInput());const task=await service.createTask(pid,taskInput(source.id));
 const next=await service.importRequestSource(pid,sourceInput('next','plan_only'));const native=(await service.postUserMessage(pid,{clientId:'review_native_followup',text:'Plan only, same task',metadata:{mode:'plan_only'}})).message;
 const linked=await service.linkTaskSource(task.id,linkInput(next.id));assert.equal(linked.task.revision,2);assert.equal(linked.task.source_message_id,source.id);assert.equal(linked.task.linkedSources[0].id,next.id);
 const twice=await service.linkTaskSource(task.id,linkInput(native.id,2,'02'));assert.equal(twice.task.revision,3);assert.equal(twice.task.source_message_id,source.id);assert.equal(twice.task.linkedSources.length,2);assert.equal(twice.task.action,'proposed');assert.equal(twice.task.fence,0);assert.equal(twice.task.state,'queued');
 assert.deepEqual((await service.requestSource(next.id)).relatedTaskIds,[task.id]);assert.deepEqual((await service.requestSource(native.id)).relatedTaskIds,[task.id]);
 assert.equal((await service.readMessage(native.id)).receipt,null);assert.equal(count('chat_messages'),1);assert.equal(count('event_outbox'),1);assert.equal(count('board_tasks'),1);
 await reject(()=>service.advanceTask(task.id,{operationId:'review_plan_link_claim',expectedRevision:3,fence:0,state:'claimed'}),'imported_source_registration_only','execution_not_authorized');
 await reject(()=>service.linkTaskSource(task.id,linkInput(source.id,3,'original')),'source_is_original');
 await reject(()=>other.linkTaskSource(task.id,linkInput(next.id,3,'other')),'task_not_found');
 const cross=await service.importRequestSource('orgbrain',sourceInput('cross'));await reject(()=>service.linkTaskSource(task.id,linkInput(cross.id,3,'cross')),'source_project_mismatch');
 assert.equal((await service.linkTaskSource(task.id,linkInput(next.id))).replayed,true);assert.equal((await service.getTask(task.id)).revision,3);
 await reject(()=>service.linkTaskSource(task.id,{...linkInput(next.id),note:'Changed link note'}),'operation_id_reused');
 await reject(()=>service.linkTaskSource(task.id,{...linkInput(next.id,3,'changed_note'),note:'Changed link note'}),'source_link_conflict');
 await service.postDotReply(pid,{clientId:'review_actual_reply',replyTo:native.id,taskId:task.id,text:'Acknowledged the existing plan'});
 assert((await service.readMessage(native.id)).receipt?.dotReplyId);assert.equal(count('event_outbox'),1);assert.equal(count('chat_messages'),2);assert.equal((await service.pendingMessages()).messages.length,0);
});

test('Original plan_only survives later standard sources and refuses external progress',async()=>{
 const {service}=await harness();const source=await service.importRequestSource(pid,sourceInput('plan','plan_only'));const task=await service.createTask(pid,taskInput(source.id));
 const later=(await service.postUserMessage(pid,{clientId:'review_standard_later',text:'Later separate instruction',metadata:{mode:'standard'}})).message;
 await service.linkTaskSource(task.id,linkInput(later.id));
 await reject(()=>service.recordExternal(task.id,externalInput(source.id,2)),'plan_only_source');
 await reject(()=>service.recordExternal(task.id,externalInput(later.id,2,'mismatched')),'task_source_mismatch');
 const current=await service.getTask(task.id);assert.equal(current.requestSource.metadata.mode,'plan_only');assert.equal(current.action,'proposed');assert.equal(current.state,'queued');assert.equal(current.revision,2);assert.equal(current.externalProgress,null);
});

test('External status records preserve imported original, action and execution fence',async()=>{
 const {service,count}=await harness();const source=await service.importRequestSource(pid,sourceInput());const task=await service.createTask(pid,taskInput(source.id));const later=await service.importRequestSource(pid,sourceInput('later'));
 const record=externalInput(source.id);const observed=await service.recordExternal(task.id,record);assert.equal(observed.task.state,'running');assert.equal(observed.task.action,'proposed');assert.equal(observed.task.bound_task_ref,null);assert.equal(observed.task.fence,0);assert.equal(observed.task.source_message_id,source.id);
 const linked=await service.linkTaskSource(task.id,linkInput(later.id,2));assert.equal(linked.task.revision,3);assert.equal(linked.task.externalProgress.externalTaskRef,record.externalTaskRef);
 assert.equal((await service.recordExternal(task.id,record)).replayed,true);
 await reject(()=>service.recordExternal(task.id,{...externalInput(source.id,3,'changed_ref'),externalTaskRef:'changed-reference'}),'external_binding_immutable');
 assert.equal(count('chat_messages'),0);assert.equal(count('event_outbox'),0);
});

test('Concurrent different source links have one revision winner and safe stale retry',async()=>{
 const {service,device,count}=await harness();const original=await service.importRequestSource(pid,sourceInput());const task=await service.createTask(pid,taskInput(original.id));const a=await service.importRequestSource(pid,sourceInput('link_a'));const b=await service.importRequestSource(pid,sourceInput('link_b'));
 const commands=[linkInput(a.id,1,'race_a'),linkInput(b.id,1,'race_b')];const results=await Promise.allSettled([service.linkTaskSource(task.id,commands[0]),device.linkTaskSource(task.id,commands[1])]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.code==='stale_revision').length,1);
 const after=await service.getTask(task.id);assert.equal(after.revision,2);assert.equal(after.linkedSources.length,1);assert.equal(count('task_source_links'),1);
 const loser=results.findIndex(x=>x.status==='rejected');await service.linkTaskSource(task.id,{...commands[loser],expectedRevision:2});const final=await service.getTask(task.id);assert.equal(final.revision,3);assert.equal(final.linkedSources.length,2);assert.equal(count('task_source_links'),2);
});

test('Concurrent source-link and plan writes preserve revision consistency',async()=>{
 const {service,device}=await harness();const original=await service.importRequestSource(pid,sourceInput());const task=await service.createTask(pid,taskInput(original.id));const later=await service.importRequestSource(pid,sourceInput('later'));
 const results=await Promise.allSettled([service.linkTaskSource(task.id,linkInput(later.id)),device.planTask(task.id,{operationId:'review_plan_race',expectedRevision:1,priority:20,priorityReason:'Reprioritize',dependencies:[]})]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected'&&['stale_revision','task_not_replannable'].includes(x.reason.code)).length,1);assert.equal((await service.getTask(task.id)).revision,2);
});

let failures=0;
for(const {name,run} of tests){try{await run();console.log('PASS: '+name)}catch(error){failures++;console.error('FAIL: '+name+'\n'+error.stack)}}
assert.equal(outbound,0,'Offline review made network calls');
console.log(`${tests.length-failures}/${tests.length} independent provenance regressions passed; ${outbound} outbound requests`);
if(failures)process.exitCode=1;
