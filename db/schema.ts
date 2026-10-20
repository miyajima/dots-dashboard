import { integer, primaryKey, sqliteTable, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
export const codexInventoryState=sqliteTable('codex_inventory_state',{
 ownerId:text('owner_id').primaryKey(),revision:integer('revision').notNull(),stateJson:text('state_json').notNull()
});
export const codexInventoryOperations=sqliteTable('codex_inventory_operations',{
 ownerId:text('owner_id').notNull(),operationId:text('operation_id').notNull(),nonce:text('nonce').notNull(),fingerprint:text('fingerprint').notNull(),requestJson:text('request_json').notNull(),receiptJson:text('receipt_json').notNull()
},t=>[primaryKey({columns:[t.ownerId,t.operationId]})]);
export const projectVisibility = sqliteTable('project_visibility', {
  userId: text('user_id').notNull(),
  projectId: text('project_id').notNull(),
  hidden: integer('hidden', { mode: 'boolean' }).notNull(),
  revision: integer('revision').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.projectId] })]);

export const chatMessages = sqliteTable('chat_messages', {
 sessionId:text('session_id'),
 id: text('id').primaryKey(), ownerId:text('owner_id').notNull(),projectId:text('project_id').notNull(),clientId:text('client_id').notNull(),author:text('author').notNull(),body:text('text').notNull(),replyTo:text('reply_to'),taskId:text('task_id'),createdAt:text('created_at').notNull(),mode:text('mode').notNull().default('standard'),skillReferencesJson:text('skill_references_json').notNull().default('[]'),attachmentIdsJson:text('attachment_ids_json').notNull().default('[]')
},table=>[uniqueIndex('chat_client_unique').on(table.ownerId,table.projectId,table.clientId),index('chat_by_project').on(table.ownerId,table.projectId,table.createdAt,table.id),index('chat_reply_receipt').on(table.ownerId,table.projectId,table.replyTo,table.author,table.createdAt)]);
export const eventOutbox=sqliteTable('event_outbox',{
 eventId:text('event_id').primaryKey(),ownerId:text('owner_id').notNull(),projectId:text('project_id').notNull(),messageId:text('message_id').notNull().unique(),eventName:text('event_name').notNull(),state:text('state').notNull(),createdAt:text('created_at').notNull()
});
export const boardTasks=sqliteTable('board_tasks',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),projectId:text('project_id').notNull(),sourceMessageId:text('source_message_id').notNull(),clientId:text('client_id').notNull(),title:text('title').notNull(),scope:text('scope').notNull(),action:text('action').notNull(),parentTaskId:text('parent_task_id'),position:integer('position').notNull().default(0),completionCriteria:text('completion_criteria'),progressMark:text('progress_mark').notNull().default('not_started'),progressEvidenceJson:text('progress_evidence_json'),progressVerifiedAt:text('progress_verified_at'),state:text('state').notNull(),priority:integer('priority').notNull(),priorityReason:text('priority_reason').notNull(),dependenciesJson:text('dependencies_json').notNull(),requestFingerprint:text('request_fingerprint').notNull().default(''),revision:integer('revision').notNull(),fence:integer('fence').notNull(),boundTaskRef:text('bound_task_ref'),resultJson:text('result_json'),lastOperationId:text('last_operation_id'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()
},table=>[uniqueIndex('task_client_unique').on(table.ownerId,table.projectId,table.clientId),index('tasks_by_project').on(table.ownerId,table.projectId,table.priority,table.createdAt)]);
export const taskOperations=sqliteTable('task_operations',{
 ownerId:text('owner_id').notNull(),operationId:text('operation_id').notNull(),taskId:text('task_id').notNull(),fingerprint:text('fingerprint').notNull(),snapshotJson:text('snapshot_json').notNull(),createdAt:text('created_at').notNull()
},table=>[primaryKey({columns:[table.ownerId,table.operationId]})]);
// Short-lived, owner-scoped MCP Events trial subscription. Never exposed in UI/MCP data tools.
export const eventSubscriptions=sqliteTable('event_subscriptions',{
 ownerId:text('owner_id').notNull(),projectId:text('project_id').notNull(),subscriptionId:text('subscription_id').notNull(),callbackUrl:text('callback_url').notNull(),signingSecret:text('signing_secret').notNull(),previousSecret:text('previous_secret'),rotationUntil:integer('rotation_until'),expiresAt:integer('expires_at').notNull(),verifiedAt:integer('verified_at').notNull(),revision:integer('revision').notNull().default(1),trialMessageId:text('trial_message_id'),attempts:integer('attempts').notNull().default(0),leaseUntil:integer('lease_until').notNull().default(0),acceptedAt:integer('accepted_at')
},t=>[primaryKey({columns:[t.ownerId,t.projectId]}),uniqueIndex('event_subscription_id_owner').on(t.ownerId,t.subscriptionId)]);
export const eventDeliveries=sqliteTable('event_deliveries',{
 ownerId:text('owner_id').notNull(),subscriptionId:text('subscription_id').notNull(),messageId:text('message_id').notNull(),terminalReason:text('terminal_reason'),attempts:integer('attempts').notNull().default(0),leaseUntil:integer('lease_until').notNull().default(0),acceptedAt:integer('accepted_at'),createdAt:integer('created_at').notNull()
},t=>[primaryKey({columns:[t.ownerId,t.subscriptionId,t.messageId]})]);

export const eventSubscriptionStops=sqliteTable('event_subscription_stops',{ownerId:text('owner_id').notNull(),subscriptionId:text('subscription_id').notNull(),stoppedAt:integer('stopped_at').notNull()},t=>[primaryKey({columns:[t.ownerId,t.subscriptionId]})]);
export const externalTaskProgress=sqliteTable('external_task_progress',{
 ownerId:text('owner_id').notNull(),taskId:text('task_id').notNull(),sourceMessageId:text('source_message_id').notNull(),externalTaskRef:text('external_task_ref').notNull(),observedAt:text('observed_at').notNull(),state:text('state').notNull(),summary:text('summary').notNull(),evidenceJson:text('evidence_json').notNull()
},t=>[primaryKey({columns:[t.ownerId,t.taskId]})]);

export const taskPlanImports=sqliteTable('task_plan_imports',{ownerId:text('owner_id').notNull(),parentTaskId:text('parent_task_id').notNull(),planId:text('plan_id').notNull(),fingerprint:text('fingerprint').notNull()},t=>[primaryKey({columns:[t.ownerId,t.parentTaskId,t.planId]})]);

export const chatAttachments=sqliteTable('chat_attachments',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),projectId:text('project_id').notNull(),clientId:text('client_id').notNull(),objectKey:text('object_key').notNull(),filename:text('filename').notNull(),mediaType:text('media_type').notNull(),sizeBytes:integer('size_bytes').notNull(),sha256:text('sha256').notNull(),state:text('state').notNull().default('uploading'),createdAt:text('created_at').notNull(),readyAt:text('ready_at')
},t=>[uniqueIndex('attachment_upload_client').on(t.ownerId,t.projectId,t.clientId),index('attachments_by_owner_project').on(t.ownerId,t.projectId,t.createdAt)]);

// dot-observed main-chat provenance; never a dashboard user message or execution grant.
export const externalRequestSources=sqliteTable('external_request_sources',{
 sessionId:text('session_id'),
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),projectId:text('project_id').notNull(),origin:text('origin').notNull(),roomId:text('room_id').notNull(),messageRef:text('message_ref').notNull(),originalCreatedAt:text('original_created_at').notNull(),body:text('text').notNull(),mode:text('mode').notNull(),contextJson:text('context_json').notNull(),contentSha256:text('content_sha256').notNull(),fingerprint:text('fingerprint').notNull(),recordedAt:text('recorded_at').notNull()
},t=>[uniqueIndex('external_source_origin').on(t.ownerId,t.origin,t.roomId,t.messageRef),index('external_source_project').on(t.ownerId,t.projectId)]);
export const taskSourceLinks=sqliteTable('task_source_links',{
 ownerId:text('owner_id').notNull(),taskId:text('task_id').notNull(),sourceId:text('source_id').notNull(),relation:text('relation').notNull(),note:text('note').notNull(),createdAt:text('created_at').notNull()
},t=>[primaryKey({columns:[t.ownerId,t.taskId,t.sourceId]})]);

// Immutable, explicit outcomes of individual dashboard requests, separate from task progress.
export const requestResults=sqliteTable('request_results',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),projectId:text('project_id').notNull(),sourceMessageId:text('source_message_id').notNull(),replyMessageId:text('reply_message_id').notNull(),status:text('status').notNull(),kind:text('kind').notNull(),summary:text('summary').notNull(),observedAt:text('observed_at').notNull(),evidenceJson:text('evidence_json').notNull(),fingerprint:text('fingerprint').notNull(),recordedAt:text('recorded_at').notNull()
},t=>[uniqueIndex('request_result_reply').on(t.ownerId,t.replyMessageId),index('request_results_source').on(t.ownerId,t.projectId,t.sourceMessageId)]);

export const projectSessions=sqliteTable('project_sessions',{
 sourceRoomId:text('source_room_id'),
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),projectId:text('project_id').notNull(),clientId:text('client_id').notNull(),title:text('title').notNull(),purpose:text('purpose').notNull(),createdAt:text('created_at').notNull()
},t=>[uniqueIndex('session_client').on(t.ownerId,t.projectId,t.clientId),index('session_project').on(t.ownerId,t.projectId,t.createdAt)]);
export const sessionThreads=sqliteTable('session_threads',{
 mirrorRevision:integer('mirror_revision').notNull().default(0),lastImportId:text('last_import_id'),
 ownerId:text('owner_id').notNull(),sessionId:text('session_id').notNull(),projectId:text('project_id').notNull(),roomId:text('room_id').notNull(),rootRef:text('root_ref').notNull(),rootMessageId:text('root_message_id').notNull(),sourceMessageId:text('source_message_id').notNull(),createdAt:text('created_at').notNull(),fingerprint:text('fingerprint').notNull()
},t=>[primaryKey({columns:[t.ownerId,t.sessionId]}),uniqueIndex('session_thread_root').on(t.ownerId,t.roomId,t.rootRef)]);
export const sessionMirrorMessages=sqliteTable('session_mirror_messages',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),projectId:text('project_id').notNull(),sessionId:text('session_id').notNull(),roomId:text('room_id').notNull(),messageId:text('message_id').notNull(),canonicalRef:text('canonical_ref'),replyToRef:text('reply_to_ref'),rootRef:text('root_ref').notNull(),author:text('author').notNull(),body:text('text').notNull(),mode:text('mode').notNull(),originalAt:text('original_at').notNull(),recordedAt:text('recorded_at').notNull(),unresolvedParent:integer('unresolved_parent').notNull(),fingerprint:text('fingerprint').notNull()
},t=>[uniqueIndex('mirror_original_message').on(t.ownerId,t.roomId,t.messageId),uniqueIndex('mirror_canonical_ref').on(t.ownerId,t.roomId,t.canonicalRef),index('mirror_session').on(t.ownerId,t.projectId,t.sessionId,t.originalAt)]);
export const sessionDeliveries=sqliteTable('session_deliveries',{
 ownerId:text('owner_id').notNull(),messageId:text('message_id').notNull(),sessionId:text('session_id').notNull(),roomId:text('room_id').notNull(),rootRef:text('root_ref').notNull(),externalMessageId:text('external_message_id').notNull(),sentAt:text('sent_at').notNull(),recordedAt:text('recorded_at').notNull(),fingerprint:text('fingerprint').notNull()
},t=>[primaryKey({columns:[t.ownerId,t.messageId]}),uniqueIndex('delivery_external_message').on(t.ownerId,t.roomId,t.externalMessageId)]);
export const sessionExternalClaims=sqliteTable('session_external_claims',{
 ownerId:text('owner_id').notNull(),roomId:text('room_id').notNull(),claimKey:text('claim_key').notNull(),direction:text('direction').notNull(),fingerprint:text('fingerprint').notNull()
},t=>[primaryKey({columns:[t.ownerId,t.roomId,t.claimKey]})]);

export const sessionVisibility=sqliteTable('session_visibility',{
 ownerId:text('owner_id').notNull(),projectId:text('project_id').notNull(),sessionId:text('session_id').notNull(),hidden:integer('hidden',{mode:'boolean'}).notNull(),revision:integer('revision').notNull().default(1),updatedAt:text('updated_at').notNull()
},t=>[primaryKey({columns:[t.ownerId,t.projectId,t.sessionId]})]);

// Owner-scoped dashboard organization only; no local Codex folder or access grant.
export const userProjects=sqliteTable('user_projects',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),clientId:text('client_id').notNull(),name:text('name').notNull(),nameKey:text('name_key').notNull(),requestFingerprint:text('request_fingerprint').notNull().default(''),codexProjectId:text('codex_project_id'),environmentId:text('environment_id'),description:text('description').notNull().default(''),createdAt:text('created_at').notNull()
},t=>[uniqueIndex('user_project_client').on(t.ownerId,t.clientId),uniqueIndex('user_project_name').on(t.ownerId,t.nameKey),index('user_projects_owner').on(t.ownerId,t.createdAt)]);
export const codexProjectCatalog=sqliteTable('codex_project_catalog',{
 ownerId:text('owner_id').primaryKey(),environmentId:text('environment_id').notNull(),observedAt:text('observed_at').notNull(),projectsJson:text('projects_json').notNull()
});

// Evidence-bound, append-only curated status; never changes execution or task completion.
export const projectStatusRecords=sqliteTable('project_status_records',{
 ownerId:text('owner_id').notNull(),projectId:text('project_id').notNull(),revision:integer('revision').notNull(),operationId:text('operation_id').notNull(),sourceMessageId:text('source_message_id').notNull(),summary:text('summary').notNull(),achievement:text('achievement').notNull(),blocker:text('blocker').notNull(),nextStep:text('next_step').notNull(),observedAt:text('observed_at').notNull(),recordedAt:text('recorded_at').notNull(),evidenceJson:text('evidence_json').notNull(),fingerprint:text('fingerprint').notNull()
},t=>[primaryKey({columns:[t.ownerId,t.projectId,t.revision]}),uniqueIndex('project_status_operation').on(t.ownerId,t.operationId)]);

// External cloud observations only. No runtime dispatch or notification side effects.
export const agentTeams=sqliteTable('agent_teams',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),projectId:text('project_id').notNull(),taskId:text('task_id').notNull(),revision:integer('revision').notNull(),snapshotJson:text('snapshot_json').notNull(),lastOperationId:text('last_operation_id').notNull()
},t=>[uniqueIndex('agent_team_task').on(t.ownerId,t.taskId),index('agent_team_project').on(t.ownerId,t.projectId)]);
export const agentTeamOperations=sqliteTable('agent_team_operations',{
 ownerId:text('owner_id').notNull(),operationId:text('operation_id').notNull(),teamId:text('team_id').notNull(),fingerprint:text('fingerprint').notNull(),snapshotJson:text('snapshot_json').notNull()
},t=>[primaryKey({columns:[t.ownerId,t.operationId]})]);
export const agentTeamDispatches=sqliteTable('agent_team_dispatches',{
 ownerId:text('owner_id').notNull(),dispatchId:text('dispatch_id').notNull(),attemptId:text('attempt_id').notNull(),teamId:text('team_id').notNull(),stepId:text('step_id').notNull(),generation:integer('generation').notNull(),intentJson:text('intent_json').notNull()
},t=>[primaryKey({columns:[t.ownerId,t.dispatchId]}),uniqueIndex('team_dispatch_attempt').on(t.ownerId,t.attemptId),uniqueIndex('team_dispatch_generation').on(t.ownerId,t.teamId,t.stepId,t.generation)]);
export const agentTeamApprovalWaits=sqliteTable('agent_team_approval_waits',{
 ownerId:text('owner_id').notNull(),approvalRequestId:text('approval_request_id').notNull(),teamId:text('team_id').notNull(),stepId:text('step_id').notNull(),waitGeneration:integer('wait_generation').notNull(),dispatchId:text('dispatch_id').notNull(),attemptId:text('attempt_id').notNull(),generation:integer('generation').notNull()
},t=>[primaryKey({columns:[t.ownerId,t.approvalRequestId]})]);
