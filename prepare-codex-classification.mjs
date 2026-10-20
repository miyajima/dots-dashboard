// Offline adapter for minimum evidence collected by the accountable parent.
// Produces reviewable requests only. It never contacts a service or invents IDs.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {classificationCatalog,projectNameKey,repositoryKey} from './worker/codex-classification.mjs';
import {stageClassification} from './stage-codex-classification.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const validId=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{8,200}$/.test(s);
export function prepareClassification(snapshot,evidence,builtins,customProjects=[],sourceMessageId){
 if(!validId(sourceMessageId)||!Array.isArray(evidence?.records)||evidence.records.length!==evidence.total)throw Error('invalid_evidence_manifest');
 const ids=new Set(snapshot.tasks.map(t=>t.taskId)),seen=new Set(),contexts=[],unreadable=[],initial=classificationCatalog(builtins,customProjects),profiles=new Map(),newProjects=new Map(),counts={};
 for(const raw of evidence.records){
  if(!ids.has(raw.taskId)||seen.has(raw.taskId)||!['project','ambiguous','non-project','excluded','unreadable'].includes(raw.classification))throw Error('invalid_evidence_task');seen.add(raw.taskId);counts[raw.classification]=(counts[raw.classification]??0)+1;
  if(raw.classification==='unreadable'){if(raw.evidenceRefs?.length)throw Error('unreadable_evidence_conflict');unreadable.push({taskId:raw.taskId,readAttemptAt:raw.observedAt,reason:'分類の根拠未取得'});continue}
  const c={taskId:raw.taskId,observedAt:raw.observedAt,summary:raw.summary,repositories:raw.repositories??[],projectHints:raw.projectHints??[],evidenceRefs:raw.evidenceRefs};
  if(['non-project','excluded'].includes(raw.classification)){
   // Do not persist personal/general-conversation details or candidate names.
   c.summary='プロジェクト分類の対象外です。';c.repositories=[];c.projectHints=[];c.organizationScope=raw.classification==='excluded'?'internal_management':'general_conversation';c.scopeReason='プロジェクトの作業に該当しないため対象外です。';
  }else if(raw.classification==='ambiguous'){c.requiresReview=true;c.reviewReason=typeof raw.summary==='string'?raw.summary.slice(0,300):'取得した根拠では所属を一つに決められません。'}
  else{
   if(typeof raw.candidateProject!=='string'||raw.candidateProject.length>80||/[\u0000-\u001f\u007f]/.test(raw.candidateProject)||!projectNameKey(raw.candidateProject))throw Error('project_candidate_required');c.primaryProjectHint=raw.candidateProject;c.organizationScope='project';
   let match=initial.filter(p=>p.aliases.some(a=>projectNameKey(a)===projectNameKey(raw.candidateProject)));
   if(raw.candidateProjectId){const explicit=initial.find(p=>p.id===raw.candidateProjectId);if(!explicit||match.some(p=>p.id!==explicit.id))throw Error('candidate_registry_conflict');match=[explicit]}
   if(match.length>1)throw Error('candidate_registry_conflict');
   if(match.length){const p=match[0],profile=profiles.get(p.id)??{projectId:p.id,aliases:[],repositories:[],environmentIds:[],evidenceRefs:[]};
    if(!p.aliases.some(a=>projectNameKey(a)===projectNameKey(raw.candidateProject)))profile.aliases.push(raw.candidateProject);
    // A multi-repository read must not attach a background repo to the target.
    const repos=c.repositories.filter(repo=>repositoryKey(repo)&&[p.id,p.name,...p.aliases,raw.candidateProject].some(a=>projectNameKey(a)===projectNameKey(repo.split('/').at(-1).replace(/\.git$/,''))));
    for(const repo of repos)if(!p.repositories.includes(repositoryKey(repo)))profile.repositories.push(repo);
    if(profile.aliases.length||profile.repositories.length){profile.evidenceRefs.push(...c.evidenceRefs);profiles.set(p.id,profile)}
   }else{
    const key=projectNameKey(raw.candidateProject),planned=newProjects.get(key)??{name:raw.candidateProject,taskIds:[],evidenceRefs:[],repositories:[]};planned.taskIds.push(raw.taskId);planned.evidenceRefs.push(...c.evidenceRefs);planned.repositories.push(...c.repositories.filter(repo=>repositoryKey(repo)&&projectNameKey(repo.split('/').at(-1).replace(/\.git$/,''))===key));newProjects.set(key,planned);
   }
  }contexts.push(c);
 }
 if(evidence.counts&&Object.keys(evidence.counts).some(k=>counts[k]!==evidence.counts[k]))throw Error('evidence_count_mismatch');
 const profileInputs=[...profiles.values()].map(p=>({...p,aliases:[...new Set(p.aliases)],repositories:[...new Set(p.repositories)],evidenceRefs:[...new Set(p.evidenceRefs)].slice(0,10)}));
 const preview=stageClassification(snapshot,builtins,{contexts,profiles:profileInputs,customProjects});
 const creations=[...newProjects.values()].map(p=>({taskIds:p.taskIds,evidenceRefs:[...new Set(p.evidenceRefs)],request:{sourceMessageId,clientId:'project_codex_'+hash([sourceMessageId,projectNameKey(p.name)]).slice(0,32),name:p.name,description:'Codexで観測した開発作業を整理するためのプロジェクト'},profileAfterConfirmedCreation:{aliases:[],repositories:[...new Set(p.repositories)],evidenceRefs:[...new Set(p.evidenceRefs)].slice(0,10)},projectId:null,requiresConfirmedRegistryReceipt:true}));
 let revision=snapshot.ledgerRevision;const profileRequests=profileInputs.map(p=>({version:1,sourceMessageId,operationId:'classification_profile_'+hash([sourceMessageId,p,revision]).slice(0,32),expectedRevision:revision++,...p}));
 const contextRequests=preview.contextImportBatches.map(records=>({version:1,sourceMessageId,operationId:'classification_context_'+hash([sourceMessageId,records,revision]).slice(0,32),expectedRevision:revision++,records}));
 return {kind:'offline_classification_preparation',liveApplied:false,sourceMessageId,evidenceCollectedAt:evidence.collectedAt,evidenceSHA256:hash(evidence),sourceRecordCount:evidence.records.length,contexts,unreadableReadAttempts:unreadable,profiles:profileInputs,proposedProjectCreations:creations,preview,requests:{profileRequests,contextRequests},nextStep:creations.length?'公開が別途許可された後、既存レジストリを再確認。新規作成は同じclientIdのreceiptで確認し、実IDを受領してからこの準備を再実行。':'公開が別途許可された後、現在のledgerRevisionを再確認し、各操作のreceiptを順に確認。',executionAuthorization:'none'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [snapshotPath,evidencePath,outPath,sourceMessageId,registryPath]=process.argv.slice(2);if(!snapshotPath||!evidencePath||!outPath)throw Error('usage: node prepare-codex-classification.mjs SNAPSHOT EVIDENCE OUTPUT SOURCE_MESSAGE [REGISTRY]');
 const read=p=>JSON.parse(readFileSync(p,'utf8')),defs=read(new URL('./projects.json',import.meta.url)).projects,out=prepareClassification(read(snapshotPath),read(evidencePath),defs,registryPath?read(registryPath):[],sourceMessageId);writeFileSync(outPath,JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({liveApplied:false,received:out.sourceRecordCount,contexts:out.contexts.length,counts:out.preview.counts,newProjectNames:out.proposedProjectCreations.map(p=>p.request.name),requestBatches:out.requests.contextRequests.length}));
}
