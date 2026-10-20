import {ServiceError} from './chat-task-service.mjs';
import {listProjects,createProjectRecord} from './projects.mjs';
import {classificationCatalog,classifyCodexTask,normalizeClassificationContext,repositoryKey,projectNameKey} from './codex-classification.mjs';
const check=(ok,status,code)=>{if(!ok)throw new ServiceError(status,code)};
const object=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{8,200}$/.test(v);
const required=(v,keys)=>keys.every(k=>Object.hasOwn(v,k));
const bounded=(v,n)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
const scopes=['active','archived'];
const empty=()=>({version:1,tasks:[],runs:[]});
const hash=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v))))).map(x=>x.toString(16).padStart(2,'0')).join('');
export function createCodexInventory({db,owner,service,projectDefinitions=[],clock=()=>new Date().toISOString(),uuid=()=>crypto.randomUUID()}){
 check(owner,401,'sign_in_required');check(db?.prepare&&db.batch,503,'storage_unavailable');
 const stmt=(sql,args=[])=>db.prepare(sql).bind(...args);
 const all=async(sql,args)=>(await stmt(sql,args).all()).results;
 const one=async(sql,args)=>(await all(sql,args))[0]||null;
 const read=async()=>{const row=await one('SELECT revision,state_json FROM codex_inventory_state WHERE owner_id=?',[owner]);return row?{revision:row.revision,state:JSON.parse(row.state_json)}:{revision:0,state:empty()}};
 const iso=value=>{check(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=Date.parse(clock())+300000,400,'invalid_observed_at');const normalized=new Date(value).toISOString();check(normalized.slice(0,19)===value.slice(0,19),400,'invalid_observed_at');return normalized};
 async function source(sourceMessageId){check(id(sourceMessageId),400,'invalid_source');const s=await service.requestSource(sourceMessageId);check(s.kind==='dashboard'&&s.author==='user'&&s.metadata?.mode==='standard',409,'standard_native_source_required');return {sourceMessageId:s.id,projectId:s.project_id,sessionId:s.sessionId||'general'}}
 const normalizeTask=t=>{
  const keys=['taskId','recordedTurnState','readState','messageState','title','environmentId','environmentKind','responsible','requestId','completionCriteria','sourceUpdatedAt','originalMode','requestedModel','requestedEffort','observedModel','observedEffort'];
  check(object(t,keys)&&required(t,['taskId','recordedTurnState','readState','messageState'])&&id(t.taskId),400,'invalid_inventory_task');
  check(t.recordedTurnState===null||bounded(t.recordedTurnState,80),400,'invalid_turn_state');
  check(['succeeded','failed','not_requested'].includes(t.readState)&&['nonempty','empty','unavailable','not_requested'].includes(t.messageState),400,'invalid_read_coverage');
  check(t.readState==='succeeded'?['nonempty','empty','unavailable'].includes(t.messageState):t.messageState=== (t.readState==='failed'?'unavailable':'not_requested'),400,'invalid_read_coverage');
  const out={taskId:t.taskId,recordedTurnState:t.recordedTurnState,readState:t.readState,messageState:t.messageState};
  for(const [key,max] of [['title',300],['environmentId',200],['responsible',200],['requestId',200],['completionCriteria',1000],['requestedModel',100],['requestedEffort',100],['observedModel',100],['observedEffort',100]]){const value=t[key]??null;check(value===null||bounded(value,max),400,'invalid_inventory_metadata');out[key]=value}
  out.sourceUpdatedAt=t.sourceUpdatedAt==null?null:iso(t.sourceUpdatedAt);out.environmentKind=t.environmentKind??'unknown';out.originalMode=t.originalMode??'unknown';
  check(['cloud','desktop','unknown'].includes(out.environmentKind)&&['standard','plan_only','unknown'].includes(out.originalMode),400,'invalid_inventory_metadata');return out;
 };
 const runView=r=>r?{...r,scopes:Object.fromEntries(scopes.map(s=>[s,{...r.scopes[s],taskIds:undefined}]))}:null;
 const newest=state=>state.runs.at(-1)||null;
 const freshness=at=>{const age=at===null?null:Math.max(0,Date.parse(clock())-Date.parse(at));return {ageMs:age,state:age===null?'unknown':age>=1200000?'report_recovery_due':age>=600000?'reobserve_due':'recent',workStall:'unknown',nextStep:age===null?'公式一覧の観測をdotへ依頼':age>=1200000?'再観測と状況報告・回復判断をdotへ依頼':age>=600000?'公式一覧の再観測をdotへ依頼':'実作業の進捗は別途証拠を確認'}};
 async function receipt(operationId){check(id(operationId),400,'invalid_operation_id');return one('SELECT nonce,fingerprint,receipt_json FROM codex_inventory_operations WHERE owner_id=? AND operation_id=?',[owner,operationId])}
 async function replay(operationId,fingerprint){const prior=await receipt(operationId);if(!prior)return null;check(prior.fingerprint===fingerprint,409,'operation_id_reused');const current=await read();const value=JSON.parse(prior.receipt_json);return {...value,replayed:true,currentRevision:current.revision,snapshotIsCurrent:value.ledgerRevision===current.revision}}
 async function commit(snapshot,input,result,fingerprint){
  const revision=snapshot.revision+1,nonce=uuid(),stateJSON=JSON.stringify(snapshot.state);
  // Stay below D1's 2,000,000-byte row/string limit. Page writes reserve 10 KB
  // so an interrupted sweep can always be closed as partial without truncation.
  check(snapshot.state.tasks.length<=10000&&snapshot.state.runs.length<=1000&&new TextEncoder().encode(stateJSON).length<=(input.outcome?1800000:1790000),409,'inventory_capacity_exceeded');
  const value={...result,operationId:input.operationId,ledgerRevision:revision},requestJSON=JSON.stringify(input);
  // A receipt and the whole derived state share one SQLite/D1 transaction. Only
  // this freshly generated nonce can authorize the CAS write; old receipts cannot.
  try{await db.batch([
   stmt('INSERT INTO codex_inventory_operations(owner_id,operation_id,nonce,fingerprint,request_json,receipt_json) SELECT ?,?,?,?,?,? WHERE COALESCE((SELECT revision FROM codex_inventory_state WHERE owner_id=?),0)=? AND (? IS NULL OR (SELECT COUNT(*) FROM user_projects WHERE owner_id=?)=?) ON CONFLICT(owner_id,operation_id) DO NOTHING',[owner,input.operationId,nonce,fingerprint,requestJSON,JSON.stringify(value),owner,snapshot.revision,snapshot.registryCount??null,owner,snapshot.registryCount??null]),
   stmt('INSERT INTO codex_inventory_state(owner_id,revision,state_json) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM codex_inventory_operations WHERE owner_id=? AND operation_id=? AND nonce=?) AND COALESCE((SELECT revision FROM codex_inventory_state WHERE owner_id=?),0)=? ON CONFLICT(owner_id) DO UPDATE SET revision=excluded.revision,state_json=excluded.state_json WHERE codex_inventory_state.revision=?',[owner,revision,stateJSON,owner,input.operationId,nonce,owner,snapshot.revision,snapshot.revision])
  ])}catch{throw new ServiceError(503,'inventory_write_outcome_unknown_read_receipt')}
  const saved=await replay(input.operationId,fingerprint);check(saved,409,'inventory_revision_conflict');const winner=await receipt(input.operationId);return {...saved,replayed:winner.nonce!==nonce};
 }
 async function importPage(raw){
  check(object(raw,['version','sourceMessageId','syncId','operationId','scope','pageIndex','hasMore','observedAt','tasks'])&&raw.version===1&&id(raw.syncId)&&id(raw.operationId)&&scopes.includes(raw.scope)&&Number.isInteger(raw.pageIndex)&&raw.pageIndex>=0&&raw.pageIndex<1000&&typeof raw.hasMore==='boolean'&&Array.isArray(raw.tasks)&&raw.tasks.length<=50,400,'invalid_inventory_page');
  const tasks=raw.tasks.map(normalizeTask);check(new Set(tasks.map(t=>t.taskId)).size===tasks.length&&(!raw.hasMore||tasks.length>0),400,'invalid_inventory_page');
  const input={version:1,sourceMessageId:raw.sourceMessageId,syncId:raw.syncId,operationId:raw.operationId,scope:raw.scope,pageIndex:raw.pageIndex,hasMore:raw.hasMore,observedAt:iso(raw.observedAt),tasks};
  const provenance=await source(input.sourceMessageId),fingerprint=await hash(input),prior=await replay(input.operationId,fingerprint);if(prior)return prior;
  const snapshot=await read();let run=snapshot.state.runs.find(r=>r.syncId===input.syncId);
  if(!run){check(input.pageIndex===0,409,'page_gap');check(!snapshot.state.runs.some(r=>r.state==='running'),409,'inventory_sync_in_progress');run={syncId:input.syncId,...provenance,state:'running',revision:0,startedAt:clock(),lastObservedAt:null,finishedAt:null,reason:null,verification:'agent_observed_not_independently_verified',coverageBoundary:'accessible_account_listing',paginationVerification:'caller_reported_ordinals_and_exhaustion_not_upstream_cursor_verified',scopes:Object.fromEntries(scopes.map(s=>[s,{nextPageIndex:0,exhausted:false,pageCount:0,itemCount:0,readSucceeded:0,readFailed:0,readNotRequested:0,emptyReads:0,lastObservedAt:null,taskIds:[]}]))};snapshot.state.runs.push(run)}
  check(run.sourceMessageId===provenance.sourceMessageId&&run.projectId===provenance.projectId&&run.sessionId===provenance.sessionId,409,'inventory_source_mismatch');check(run.state==='running',409,'inventory_sync_closed');
  const scope=run.scopes[input.scope];check(!scope.exhausted&&scope.nextPageIndex===input.pageIndex,409,'page_gap_or_closed');check(scope.lastObservedAt===null||input.observedAt>=scope.lastObservedAt,409,'stale_page');
  const seen=new Set(scopes.flatMap(s=>run.scopes[s].taskIds));check(tasks.every(t=>!seen.has(t.taskId)),409,'duplicate_task_in_sweep');
  const map=new Map(snapshot.state.tasks.map(t=>[t.taskId,t]));
  for(const t of tasks){const value={...t,archived:input.scope==='archived',observedAt:input.observedAt},old=map.get(t.taskId);if(old&&old.observedAt===value.observedAt){const {observationSyncId,lastSeenSyncId,firstObservedAt,recordedAt,...oldValue}=old;check(JSON.stringify(oldValue)===JSON.stringify(value),409,'equal_time_observation_conflict')}
   if(!old||value.observedAt>old.observedAt)map.set(t.taskId,{...value,observationSyncId:input.syncId,lastSeenSyncId:input.syncId,firstObservedAt:old?.firstObservedAt??input.observedAt,recordedAt:clock()});else old.lastSeenSyncId=input.syncId;
   scope.taskIds.push(t.taskId);scope.itemCount++;scope[t.readState==='succeeded'?'readSucceeded':t.readState==='failed'?'readFailed':'readNotRequested']++;if(t.messageState==='empty')scope.emptyReads++;
  }
  snapshot.state.tasks=[...map.values()];scope.pageCount++;scope.nextPageIndex++;scope.exhausted=!input.hasMore;scope.lastObservedAt=input.observedAt;run.lastObservedAt=run.lastObservedAt===null?input.observedAt:[run.lastObservedAt,input.observedAt].sort().at(-1);run.revision++;
  return commit(snapshot,input,{sync:runView(run),workCompletion:'unconfirmed'},fingerprint);
 }
 async function finish(raw){
  check(object(raw,['version','sourceMessageId','syncId','operationId','expectedRevision','outcome','reason'])&&raw.version===1&&id(raw.syncId)&&id(raw.operationId)&&Number.isInteger(raw.expectedRevision)&&raw.expectedRevision>0&&['complete','partial'].includes(raw.outcome),400,'invalid_inventory_finish');
  check(raw.outcome==='complete'?raw.reason==null:bounded(raw.reason,1000),400,'partial_reason_required');
  const input={version:1,sourceMessageId:raw.sourceMessageId,syncId:raw.syncId,operationId:raw.operationId,expectedRevision:raw.expectedRevision,outcome:raw.outcome,reason:raw.reason??null},provenance=await source(raw.sourceMessageId),fingerprint=await hash(input),prior=await replay(input.operationId,fingerprint);if(prior)return prior;
  const snapshot=await read(),run=snapshot.state.runs.find(r=>r.syncId===input.syncId);check(run,404,'inventory_sync_not_found');check(run.sourceMessageId===provenance.sourceMessageId&&run.projectId===provenance.projectId&&run.sessionId===provenance.sessionId,409,'inventory_source_mismatch');check(run.state==='running'&&run.revision===input.expectedRevision,409,'inventory_revision_conflict');
  if(input.outcome==='complete')check(scopes.every(s=>run.scopes[s].exhausted&&run.scopes[s].readFailed===0&&run.scopes[s].readNotRequested===0),409,'inventory_coverage_incomplete');
  run.state=input.outcome;run.reason=input.reason;run.finishedAt=clock();run.revision++;return commit(snapshot,input,{sync:runView(run),workCompletion:'unconfirmed'},fingerprint);
 }
 async function get(input={}){
  check(object(input,['syncId','operationId'])&&!(input.syncId&&input.operationId),400,'invalid_inventory_query');
  const snapshot=await read();if(input.operationId){const r=await receipt(input.operationId);return {found:!!r,receipt:r?JSON.parse(r.receipt_json):null,currentRevision:snapshot.revision,reconciliation:r?'recorded':'not_recorded_at_read_time',nextStep:r?'既存receiptを使用。新しい操作を開始しない':'応答不明の場合は同じIDで再照会し、未記録を確定するまで再実行しない'}}
  if(input.syncId)check(id(input.syncId),400,'invalid_sync_id');const run=input.syncId?snapshot.state.runs.find(r=>r.syncId===input.syncId):newest(snapshot.state);if(input.syncId)check(run,404,'inventory_sync_not_found');
  return {version:1,ledgerRevision:snapshot.revision,taskCount:snapshot.state.tasks.length,sync:runView(run),freshness:freshness(run?.lastObservedAt??null),capabilities:{upstreamEnumeration:false,automaticDispatch:false,observationImport:true,executionAuthorization:'none'},workCompletion:'unconfirmed'};
 }
 async function mappings(ids){
  if(!ids.length)return new Map();const matches=new Map(ids.map(id=>[id,[]])),wanted=new Set(ids),add=(native,b,kind,details={})=>{if(!wanted.has(native))return;const value={kind,taskId:b.id,projectId:b.project_id,title:b.title,state:b.state,revision:b.revision,sourceMessageId:b.source_message_id,completionCriteria:b.completion_criteria??null,url:'#project/'+b.project_id+'/task/'+b.id,...details},list=matches.get(native);if(!list.some(x=>JSON.stringify(x)===JSON.stringify(value)))list.push(value)};
  for(const r of await all('SELECT b.id,b.project_id,b.title,b.state,b.revision,b.source_message_id,b.completion_criteria,b.bound_task_ref FROM board_tasks b WHERE b.owner_id=? AND b.bound_task_ref IN (SELECT value FROM json_each(?))',[owner,JSON.stringify(ids)]))add(r.bound_task_ref,r,'execution_binding');
  // recordExternal preserves opaque references. Recognize only the exact bare
  // ID or its explicit cloud-thread namespace, without rewriting stored data.
  const externalRefs=new Map(ids.flatMap(native=>[[native,native],['cloud-thread:'+native,native]]));
  for(const r of await all('SELECT b.id,b.project_id,b.title,b.state,b.revision,b.source_message_id,b.completion_criteria,e.external_task_ref FROM external_task_progress e JOIN board_tasks b ON b.owner_id=e.owner_id AND b.id=e.task_id WHERE e.owner_id=? AND e.external_task_ref IN (SELECT value FROM json_each(?))',[owner,JSON.stringify([...externalRefs.keys()])]))add(externalRefs.get(r.external_task_ref),r,'external_progress',{externalTaskRef:r.external_task_ref});
  // Do not use the UI team list (limited to 30). Read every owner's persisted
  // explicit binding, including leads and all steps; never infer from a title.
  for(const r of await all('SELECT b.id,b.project_id,b.title,b.state,b.revision,b.source_message_id,b.completion_criteria,a.id AS team_id,a.snapshot_json FROM agent_teams a JOIN board_tasks b ON b.owner_id=a.owner_id AND b.id=a.task_id WHERE a.owner_id=?',[owner])){const team=JSON.parse(r.snapshot_json);add(team.lead?.taskId,r,'team_lead',{teamId:r.team_id});for(const step of team.steps||[])add(step.binding?.taskId,r,'team_step',{teamId:r.team_id,stepId:step.id})}
  return matches;
 }
 const catalog=async state=>classificationCatalog(projectDefinitions,await listProjects(db,owner),state.projectProfiles??[]);
 async function organization(snapshot){
  const projects=await catalog(snapshot.state),matches=await mappings(snapshot.state.tasks.map(t=>t.taskId)),contexts=new Map((snapshot.state.classificationContexts??[]).map(c=>[c.taskId,c])),manuals=new Map((snapshot.state.classificationManuals??[]).map(c=>[c.taskId,c]));
  const tasks=snapshot.state.tasks.map(t=>({...t,mappings:matches.get(t.taskId),classification:classifyCodexTask(t,matches.get(t.taskId),projects,contexts.get(t.taskId),manuals.get(t.taskId))}));
  const version=await hash([snapshot.revision,projects,tasks.map(t=>[t.taskId,t.classification])]);
  const counts={total:tasks.length,assigned:0,inferred:0,needsReview:0,outOfScope:0};for(const t of tasks)counts[({needs_review:'needsReview',out_of_scope:'outOfScope'})[t.classification.status]??t.classification.status]++;
  return {tasks,projects,classificationVersion:version,classificationCounts:counts,projectCounts:projects.map(p=>({id:p.id,name:p.name,count:tasks.filter(t=>t.classification.projectId===p.id).length})),classificationRevision:snapshot.revision};
 }
 async function classifyWrite(raw,kind,browser=false){
  const keys={context:['version','sourceMessageId','operationId','expectedRevision','records'],profile:['version','sourceMessageId','operationId','expectedRevision','projectId','aliases','repositories','environmentIds','evidenceRefs'],manual:['version','sourceMessageId','operationId','expectedRevision','taskId','projectId','reason','exclude']}[kind];
  check(object(raw,keys)&&raw.version===1&&id(raw.operationId)&&Number.isInteger(raw.expectedRevision)&&raw.expectedRevision>=0,400,'invalid_classification_write');
  if(browser)check(raw.sourceMessageId===undefined,400,'invalid_browser_classification_source');
  const provenance=browser?{origin:'authenticated_browser_selection'}:{...await source(raw.sourceMessageId),origin:'authenticated_agent_observation'};let values;
  if(kind==='context'){check(Array.isArray(raw.records)&&raw.records.length>0&&raw.records.length<=40,400,'invalid_classification_context');values=raw.records.map(r=>normalizeClassificationContext(r,iso));check(new Set(values.map(v=>v.taskId)).size===values.length,400,'duplicate_classification_context')}
  else if(kind==='profile'){check(typeof raw.projectId==='string',400,'invalid_classification_profile');values={projectId:raw.projectId};for(const key of ['aliases','repositories','environmentIds','evidenceRefs']){const items=raw[key]??[];check(Array.isArray(items)&&items.length<=10&&items.every(v=>bounded(v,300)&&!/[\u0000-\u001f\u007f]/.test(v)),400,'invalid_classification_profile');values[key]=[...new Set(items)]}check(values.evidenceRefs.length>0&&values.aliases.every(projectNameKey)&&values.repositories.every(repositoryKey),400,'classification_evidence_required')}
  else{check(id(raw.taskId)&&(raw.projectId===null||typeof raw.projectId==='string')&&bounded(raw.reason,600)&&(raw.exclude===undefined||typeof raw.exclude==='boolean')&&(!raw.exclude||raw.projectId===null),400,'invalid_classification_manual');values={taskId:raw.taskId,projectId:raw.projectId,reason:raw.reason,...(raw.exclude?{exclude:true}:{})}}
  const input={version:1,kind,sourceMessageId:raw.sourceMessageId??null,operationId:raw.operationId,expectedRevision:raw.expectedRevision,values,provenance},fingerprint=await hash(input),prior=await replay(input.operationId,fingerprint);if(prior)return prior;
  const snapshot=await read();check(snapshot.revision===raw.expectedRevision,409,'inventory_revision_conflict');const projects=await catalog(snapshot.state),projectIds=new Set(projects.map(p=>p.id));
  if(kind==='context'){const known=new Set(snapshot.state.tasks.map(t=>t.taskId)),current=new Map((snapshot.state.classificationContexts??[]).map(c=>[c.taskId,c]));for(const value of values){check(known.has(value.taskId),404,'inventory_task_not_found');const previous=current.get(value.taskId);check(!previous||value.observedAt>=previous.observedAt,409,'stale_classification_context');if(previous&&previous.observedAt===value.observedAt){const {provenance:oldSource,recordedAt,...old}=previous;check(JSON.stringify(old)===JSON.stringify(value),409,'classification_context_conflict')}current.set(value.taskId,{...value,provenance,recordedAt:clock()})}snapshot.state.classificationContexts=[...current.values()]}
  else if(kind==='profile'){snapshot.registryCount=(await one('SELECT COUNT(*) AS n FROM user_projects WHERE owner_id=?',[owner])).n;const currentProjects=await catalog(snapshot.state);check(projectIds.has(values.projectId),404,'unknown_project');const profiles=snapshot.state.projectProfiles??[],keys=values.aliases.map(projectNameKey);check(!currentProjects.some(p=>p.id!==values.projectId&&p.aliases.some(a=>keys.includes(projectNameKey(a)))),409,'project_alias_conflict');check(!currentProjects.some(p=>p.id!==values.projectId&&p.repositories.some(repo=>values.repositories.map(repositoryKey).includes(repo))),409,'project_repository_conflict');snapshot.state.projectProfiles=[...profiles.filter(p=>p.projectId!==values.projectId),{...values,provenance,recordedAt:clock()}]}
  else{check(snapshot.state.tasks.some(t=>t.taskId===values.taskId),404,'inventory_task_not_found');check(values.projectId===null||projectIds.has(values.projectId),404,'unknown_project');snapshot.state.classificationManuals=[...(snapshot.state.classificationManuals??[]).filter(t=>t.taskId!==values.taskId),{...values,provenance,recordedAt:clock()}]}
  return commit(snapshot,input,{kind,classificationRevision:snapshot.revision+1,updatedCount:kind==='context'?values.length:1,executionAuthorization:'none'},fingerprint);
 }
 async function createClassificationProject(raw){
  check(object(raw,['sourceMessageId','clientId','name','description'])&&id(raw.sourceMessageId),400,'invalid_project_request');const provenance=await source(raw.sourceMessageId),snapshot=await read(),projects=await catalog(snapshot.state),{sourceMessageId,...input}=raw;try{return await createProjectRecord(db,owner,projects,input,provenance)}catch(e){if(e instanceof ServiceError)throw e;throw new ServiceError(503,'project_write_outcome_unknown_read_client_id')}
 }
 async function projectReceipt(input){check(object(input,['clientId'])&&typeof input.clientId==='string'&&/^project_[a-zA-Z0-9_-]{8,80}$/.test(input.clientId),400,'invalid_project_request');const row=await one('SELECT id,name,description,created_at,request_fingerprint FROM user_projects WHERE owner_id=? AND client_id=?',[owner,input.clientId]);if(!row)return {found:false,project:null,executionAuthorization:'none'};const {request_fingerprint,...project}=row;let provenance=null;try{const fingerprint=JSON.parse(request_fingerprint||'[]');if(Array.isArray(fingerprint)&&fingerprint[5]&&typeof fingerprint[5]==='object'&&!Array.isArray(fingerprint[5])&&id(fingerprint[5].sourceMessageId))provenance=fingerprint[5]}catch{}return {found:true,project,provenance,executionAuthorization:'none'}}
 async function list(input={}){
  check(object(input,['cursor','limit','scope','expectedLedgerRevision','projectId','expectedClassificationVersion'])&&(input.cursor===undefined||id(input.cursor)),400,'invalid_inventory_query');const limit=input.limit??50,scope=input.scope??'all';check(Number.isInteger(limit)&&limit>=1&&limit<=50&&['all',...scopes].includes(scope)&&(input.expectedLedgerRevision===undefined||Number.isInteger(input.expectedLedgerRevision)&&input.expectedLedgerRevision>=0)&&(!input.cursor||input.expectedLedgerRevision!==undefined),400,'invalid_inventory_query');
  const snapshot=await read();check(input.expectedLedgerRevision===undefined||snapshot.revision===input.expectedLedgerRevision,409,'inventory_page_revision_changed');const org=await organization(snapshot);if(input.projectId!==undefined)check(['review','excluded'].includes(input.projectId)||org.projects.some(p=>p.id===input.projectId),404,'unknown_project');check(!input.cursor||!input.projectId||typeof input.expectedClassificationVersion==='string',400,'classification_version_required');check(input.expectedClassificationVersion===undefined||input.expectedClassificationVersion===org.classificationVersion,409,'inventory_classification_changed');
  const filtered=org.tasks.filter(t=>(scope==='all'||t.archived===(scope==='archived'))&&(!input.projectId||(input.projectId==='review'?t.classification.status==='needs_review':input.projectId==='excluded'?t.classification.status==='out_of_scope':t.classification.projectId===input.projectId))).sort((a,b)=>a.taskId<b.taskId?-1:a.taskId>b.taskId?1:0),rows=filtered.filter(t=>!input.cursor||t.taskId>input.cursor).slice(0,limit+1),more=rows.length>limit,page=rows.slice(0,limit),latest=newest(snapshot.state);
  return {version:1,ledgerRevision:snapshot.revision,total:snapshot.state.tasks.length,filteredTotal:filtered.length,nextCursor:more?page.at(-1).taskId:null,sync:runView(latest),freshness:freshness(latest?.lastObservedAt??null),classificationVersion:org.classificationVersion,classificationCounts:org.classificationCounts,projectCounts:org.projectCounts,projects:org.projects.map(p=>({id:p.id,name:p.name})),tasks:page.map(t=>({...t,mappingState:t.mappings.length?'matched':'unmapped',seenInLatestSweep:t.lastSeenSyncId===latest?.syncId,freshness:freshness(t.observedAt),workCompletion:'unconfirmed',implementation:'unconfirmed',merge:'unconfirmed',publication:'unconfirmed',executionAuthorization:'none'}))};
 }
 return {importPage,finish,get,list,contextImport:input=>classifyWrite(input,'context'),profileRecord:input=>classifyWrite(input,'profile'),manualRecord:(input,{browser=false}={})=>classifyWrite(input,'manual',browser),createProject:createClassificationProject,projectReceipt};
}
