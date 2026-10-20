import {ServiceError} from './chat-task-service.mjs';
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const string={type:'string',minLength:1,maxLength:200},nullableString={anyOf:[string,{type:'null'}]};
const legacyBinding=object({taskId:string,environmentId:string,execution:{const:'cloud'}});
const states=['queued','claimed','running','verifying','launch_unknown','waiting_approval','blocked','failed','succeeded','awaiting_verification','done','dispatch_unknown'];
export const astraV1EnvelopeSchema=object({version:{const:1},record:object({teamId:string,operationId:string,expectedRevision:{type:'integer',minimum:1},stepId:string,fence:{type:'integer',minimum:0},state:{enum:states},observedAt:{anyOf:[{type:'integer',minimum:0},{type:'string',maxLength:100}]},summary:{type:'string',minLength:1,maxLength:1000},blocker:{anyOf:[{type:'null'},{type:'string',maxLength:1000}]},evidence:{type:'array',maxItems:8,items:{type:'string',minLength:1,maxLength:1000}}}),cloudRun:object({runId:string,specSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},generation:{type:'integer',minimum:1},dispatchId:string,attemptId:string,executionId:nullableString,targetDispatchId:nullableString,targetAttemptId:nullableString,implementationExecutionId:nullableString,executionIdentityStatus:string,exactCommit:{anyOf:[{type:'null'},{type:'string',pattern:'^[a-f0-9]{40}$'}]},exactTree:{anyOf:[{type:'null'},{type:'string',pattern:'^[a-f0-9]{40}$'}]},hostRevision:{type:'integer',minimum:0},gate:{type:'null'},binding:legacyBinding,lead:legacyBinding,executionMode:{const:'cloud'},unitComplete:{type:'boolean'},judgments:{type:'array',maxItems:0}})});
export const astraSchemaSource=Object.freeze({format:'astra-envelope',version:2,provenance:'bundled-schema'});
const identity={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$'},nullableIdentity={anyOf:[identity,{type:'null'}]},hash40={type:'string',pattern:'^[a-f0-9]{40}$'},hash64={type:'string',pattern:'^[a-f0-9]{64}$'},nullableHash={anyOf:[hash40,{type:'null'}]},epoch={type:'number',minimum:0,exclusiveMaximum:253402300800};
const iso={type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{6}Z$'};
const v2Binding=object({taskId:identity,executorType:{const:'cloud'},environmentConfigId:{type:'string',maxLength:128,pattern:'^[A-Za-z0-9_-]+~asenvcfg_[0-9a-f]{32}$'}});
const instance={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.:/~\\-]{0,255}$'};
const evidenceItem={anyOf:[object({kind:{const:'artifact'},commit:hash40,tree:hash40}),object({kind:{enum:['check','independent_verdict','verifier_host_observation']},sha256:hash64,actor:identity})]};
const blocker={anyOf:[{type:'null'},object({kind:{enum:['permission_denied','failed','approval_wait']},relaunchAllowed:{const:false}})]};
const gate={anyOf:[{type:'null'},object({gate_id:identity,event_id:identity,host_revision:{type:'integer',minimum:1},observed_at:epoch})]};
// cloud_runs.record_judgment validates these advisory fields only. Preserve
// bounded optional audit fields from cloud_decisions; do not map them to a paid
// provider success, approval or the Site's narrower decision record.
const judgment={...object({decision_id:identity,grants_authorization:{const:false},completes_task:{const:false}}),additionalProperties:true,maxBytes:20000};
const v2Record=object({teamId:identity,operationId:identity,expectedRevision:{type:'integer',minimum:0},stepId:identity,fence:{type:'integer',minimum:1},state:{enum:states},observedAt:iso,summary:{type:'string',minLength:1,maxLength:1000},blocker,evidence:{type:'array',maxItems:64,items:evidenceItem}});
const v2Run=object({runId:identity,specSha256:hash64,generation:{type:'integer',minimum:1},dispatchId:nullableIdentity,attemptId:nullableIdentity,executionId:nullableIdentity,targetDispatchId:nullableIdentity,targetAttemptId:nullableIdentity,implementationExecutionId:nullableIdentity,executionIdentityStatus:{enum:['observed','not_observed','verifier_execution_unobserved','verifier_execution_observed']},exactCommit:nullableHash,exactTree:nullableHash,hostRevision:{type:'integer',minimum:0},gate,binding:v2Binding,lead:v2Binding,executionMode:{enum:['cloud','plan_only']},unitComplete:{type:'boolean'},observedAtEpochSeconds:epoch,timestampUnit:{const:'epoch_seconds'},judgments:{type:'array',maxItems:16,items:judgment},environmentInstanceId:instance,leadEnvironmentInstanceId:instance},['runId','specSha256','generation','dispatchId','attemptId','executionId','targetDispatchId','targetAttemptId','implementationExecutionId','executionIdentityStatus','exactCommit','exactTree','hostRevision','gate','binding','lead','executionMode','unitComplete','observedAtEpochSeconds','timestampUnit','judgments']);
export const astraV2EnvelopeSchema={anyOf:[object({version:{const:2},record:v2Record,cloudRun:v2Run,transport:{const:'Prepared contract, not a dashboard tool invocation; receiver validates its exact schema'}}),object({version:{const:2},record:{type:'null'},reason:{const:'independent_verifier_result_not_observed'}}),object({version:{const:2},record:{type:'null'},reason:{const:'independent_verifier_result_not_observed'},cloudRun:v2Run,transport:{const:'Prepared contract, not a dashboard tool invocation; receiver validates its exact schema'}})]};
export const astraEnvelopeSchema={type:'object',anyOf:[astraV1EnvelopeSchema,...astraV2EnvelopeSchema.anyOf]};
function conforms(schema,value){
 if(schema.anyOf)return schema.anyOf.some(s=>conforms(s,value));
 if(schema.const!==undefined&&value!==schema.const)return false;
 if(schema.enum&&!schema.enum.includes(value))return false;
 if(schema.type==='null')return value===null;
 if(schema.type==='string')return typeof value==='string'&&(schema.minLength===undefined||value.length>=schema.minLength)&&(schema.maxLength===undefined||value.length<=schema.maxLength)&&(!schema.pattern||new RegExp(schema.pattern).test(value));
 if(schema.type==='number'||schema.type==='integer')return typeof value==='number'&&Number.isFinite(value)&&(schema.type!=='integer'||Number.isSafeInteger(value))&&(schema.minimum===undefined||value>=schema.minimum)&&(schema.exclusiveMaximum===undefined||value<schema.exclusiveMaximum);
 if(schema.type==='boolean')return typeof value==='boolean';
 if(schema.type==='array')return Array.isArray(value)&&(schema.maxItems===undefined||value.length<=schema.maxItems)&&(!schema.items||value.every(v=>conforms(schema.items,v)));
 if(schema.type==='object')return value!==null&&typeof value==='object'&&!Array.isArray(value)&&schema.required.every(k=>Object.hasOwn(value,k))&&Object.keys(value).every(k=>Object.hasOwn(schema.properties,k)?conforms(schema.properties[k],value[k]):schema.additionalProperties===true)&&(schema.maxBytes===undefined||new TextEncoder().encode(JSON.stringify(value)).length<=schema.maxBytes);
 return schema.const!==undefined||schema.enum!==undefined;
}
function matchingTimestamp(isoValue,seconds){
 const [base,fraction]=isoValue.slice(0,-1).split('.'),millis=Date.parse(base+'Z');
 if(!Number.isFinite(millis)||new Date(millis).toISOString().slice(0,19)!==base)return false;
 const parsed=millis/1000+Number('0.'+fraction);
 return Math.abs(parsed-seconds)<=Math.max(0.0000005,Number.EPSILON*Math.abs(seconds));
}
export function inspectAstraEnvelope(envelope){
 if(envelope?.version===1)return inspectAstraV1Envelope(envelope);
 if(!conforms(astraV2EnvelopeSchema,envelope))throw new ServiceError(400,'invalid_astra_v2_envelope');
 if(envelope.record===null){
  const c=envelope.cloudRun;
  if(c&&(c.executionIdentityStatus!=='verifier_execution_unobserved'||c.dispatchId!==null||c.attemptId!==null||c.executionId!==null||c.hostRevision!==0||c.gate!==null||c.unitComplete||c.binding.taskId===c.lead.taskId))throw new ServiceError(400,'astra_unstarted_verifier_mismatch');
  return {envelopeVersion:2,status:'unobserved',acceptedForInspection:true,acceptedForRecording:false,unitComplete:false,automaticDispatch:false,mutations:false,reason:envelope.reason,record:null,schemaDerivedFrom:astraSchemaSource,...(c?{cloudRun:structuredClone(c),issues:['native_task_config_readback_not_exported','site_prelaunch_intent_not_exported','site_task_source_revision_fence_not_reconciled','verifier_dispatch_attempt_execution_not_observed']}: {})};
 }
 const {record:r,cloudRun:c}=envelope,fail=code=>{throw new ServiceError(400,code)};
 if(!matchingTimestamp(r.observedAt,c.observedAtEpochSeconds))fail('astra_timestamp_mismatch');
 if(r.fence!==c.generation)fail('astra_fence_generation_mismatch');
 if(c.executionMode==='plan_only'&&r.state!=='queued')fail('astra_plan_only_execution_forbidden');
 const verifier=c.executionIdentityStatus.startsWith('verifier_execution_'),verifierObserved=c.executionIdentityStatus==='verifier_execution_observed';
 if(verifierObserved){
  if(!c.dispatchId||!c.attemptId||!c.executionId||!c.targetDispatchId||!c.targetAttemptId||!c.implementationExecutionId||c.dispatchId===c.targetDispatchId||c.attemptId===c.targetAttemptId||c.executionId===c.implementationExecutionId||c.hostRevision<1||!c.exactCommit||!c.exactTree||!['running','verifying','waiting_approval','blocked','launch_unknown','succeeded'].includes(r.state))fail('astra_verifier_identity_mismatch');
  if(!r.evidence.some(e=>e.kind==='verifier_host_observation'&&e.actor===c.binding.taskId))fail('astra_verifier_host_evidence_required');
 }else if(verifier){
  if(c.executionId!==null||(c.dispatchId===null)!==(c.attemptId===null)||c.dispatchId!==null&&(c.dispatchId===c.targetDispatchId||c.attemptId===c.targetAttemptId)||c.dispatchId===null&&(r.state!=='succeeded'||!c.unitComplete)||c.dispatchId!==null&&(c.unitComplete||!['claimed','launch_unknown','blocked'].includes(r.state)))fail('astra_verifier_identity_mismatch');
 }
 else if(c.dispatchId!==c.targetDispatchId||c.attemptId!==c.targetAttemptId||c.executionId!==c.implementationExecutionId||((c.executionId===null)!==(c.executionIdentityStatus==='not_observed')))fail('astra_execution_identity_mismatch');
 if(r.evidence.some(e=>e.kind==='verifier_host_observation'&&(!verifier||e.actor!==c.binding.taskId||c.hostRevision<1)))fail('astra_verifier_host_evidence_mismatch');
 if(c.binding.taskId===c.lead.taskId)fail('astra_independent_binding_required');
 if(r.evidence.some(e=>e.kind==='artifact'&&(e.commit!==c.exactCommit||e.tree!==c.exactTree)))fail('astra_artifact_target_mismatch');
 if(r.state==='waiting_approval'&&(r.blocker?.kind!=='approval_wait'||c.gate===null))fail('astra_approval_gate_required');
 if(r.state==='blocked'&&!['permission_denied','failed'].includes(r.blocker?.kind))fail('astra_blocker_mismatch');
 if(!['blocked','waiting_approval'].includes(r.state)&&r.blocker!==null)fail('astra_blocker_mismatch');
 if(c.unitComplete&&(r.state!=='succeeded'||!r.evidence.some(e=>e.kind==='independent_verdict')))fail('astra_completion_evidence_required');
 if(verifier&&c.unitComplete&&!r.evidence.some(e=>e.kind==='independent_verdict'&&e.actor===c.binding.taskId))fail('astra_verifier_actor_mismatch');
 const issues=['native_task_config_readback_not_exported','site_prelaunch_intent_not_exported','site_task_source_revision_fence_not_reconciled'];
 if(c.executionMode==='plan_only')issues.push('plan_only_not_execution_authority');
 if(c.executionId===null)issues.push(verifier?'verifier_dispatch_attempt_execution_not_observed':'execution_identity_not_observed');
 if(c.exactCommit===null)issues.push('exact_commit_not_observed');
 if(c.exactTree===null)issues.push('exact_tree_not_observed');
 if(!r.evidence.length)issues.push('record_evidence_missing');
 if(verifierObserved)issues.push('verifier_host_observation_digest_not_runtime_verified');
 if(c.gate!==null)issues.push('site_approval_request_wait_generation_not_exported');
 if(c.judgments.length)issues.push('advisory_judgments_not_site_decisions_or_authorization');
 const normalize=(b,observedInstance)=>({...b,executorType:'codex_cloud',...(observedInstance===undefined?{}:{environmentInstanceId:observedInstance})});
 return {envelopeVersion:2,status:'unverified',acceptedForInspection:true,acceptedForRecording:false,unitComplete:false,automaticDispatch:false,mutations:false,schemaDerivedFrom:astraSchemaSource,issues,record:structuredClone(r),cloudRun:structuredClone(c),normalizedObservation:{state:r.state,observedAt:r.observedAt,binding:normalize(c.binding,c.environmentInstanceId),lead:normalize(c.lead,c.leadEnvironmentInstanceId),dispatchId:c.dispatchId,attemptId:c.attemptId,executionId:c.executionId,generation:c.generation,implementationTarget:{dispatchId:c.targetDispatchId,attemptId:c.targetAttemptId,executionId:c.implementationExecutionId},exactCommit:c.exactCommit,exactTree:c.exactTree,reportedUnitComplete:c.unitComplete,blocker:structuredClone(r.blocker),gate:structuredClone(c.gate),evidence:structuredClone(r.evidence),judgments:structuredClone(c.judgments)}};
}
export function inspectAstraV1Envelope(envelope){
 if(!conforms(astraV1EnvelopeSchema,envelope))throw new ServiceError(400,'invalid_astra_v1_envelope');
 const {record,cloudRun}=envelope;
 const issues=['legacy_envelope_version','binding_configuration_and_executor_unverified','lead_configuration_and_executor_unverified','prelaunch_intent_not_supplied','original_task_authority_not_checked'];
 if(cloudRun.executionId===null||cloudRun.executionIdentityStatus!=='observed')issues.push('execution_identity_not_observed');
 if(cloudRun.exactCommit===null)issues.push('exact_commit_not_observed');
 if(cloudRun.exactTree===null)issues.push('exact_tree_not_observed');
 if(typeof record.observedAt!=='string'||!/^\d{4}-\d\d-\d\dT/.test(record.observedAt)||!Number.isFinite(Date.parse(record.observedAt)))issues.push('observation_time_not_v2_iso');
 if(!record.evidence.length)issues.push('record_evidence_missing');
 if(cloudRun.unitComplete)issues.push('completion_claim_unverified');
 // Pure inspection. No config lookup, ID/time conversion, evidence generation,
 // storage, dispatch, approval, notification, or permission promotion.
 return {envelopeVersion:1,status:'unverified',acceptedForInspection:true,acceptedForRecording:false,unitComplete:false,automaticDispatch:false,mutations:false,issues,record:structuredClone(record),cloudRun:structuredClone(cloudRun)};
}
