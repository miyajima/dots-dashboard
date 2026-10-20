// Standalone, local-only regression harness. Never calls a deployed Site.
// Run: node ./test-message-extensions.mjs /path/to/site
// When copied into the Site checkout, it also runs without a path argument.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = [process.argv[2], process.env.DASHBOARD_SITE_ROOT, here, join(here, 'dot-project-dashboard')]
  .filter(Boolean).map(p => resolve(p)).find(p => existsSync(join(p, 'worker/chat-task-service.mjs')));
assert(root, 'Pass the Site checkout directory as the first argument');
const { createService } = await import(pathToFileURL(join(root, 'worker/chat-task-service.mjs')));
const { createAttachments, boundedBytes, MAX_ATTACHMENT_CHUNK } = await import(pathToFileURL(join(root, 'worker/attachments.mjs')));
const { handleRequest } = await import(pathToFileURL(join(root, 'worker/chat-handler.mjs')));
const PROJECT = 'astraharness', OTHER_PROJECT = 'otherproj', HOST = 'https://dashboard.example';
const code = expected => error => error?.code === expected;

function fixture(t, serviceOptions = {}) {
  const raw = new DatabaseSync(':memory:');
  t.after(() => raw.close());
  for (const file of readdirSync(join(root, 'drizzle')).filter(x => x.endsWith('.sql')).sort()) {
    raw.exec(readFileSync(join(root, 'drizzle', file), 'utf8'));
  }
  const fault = { readyUpdate: 0, put: 0, get: 0 };
  const count = { queries: 0, puts: 0, gets: 0, heads: 0 };
  function prepared(sql, args = []) {
    const run = () => {
      count.queries++;
      if (fault.readyUpdate && /UPDATE\s+chat_attachments\s+SET[\s\S]*state/i.test(sql)) {
        fault.readyUpdate--;
        throw Error('Injected D1 finalization failure');
      }
      return { meta: { changes: raw.prepare(sql).run(...args).changes } };
    };
    return {
      bind: (...values) => prepared(sql, values),
      async all() { count.queries++; return { results: raw.prepare(sql).all(...args) }; },
      async run() { return run(); },
      executeRun: run,
    };
  }
  const db = {
    prepare: sql => prepared(sql),
    async batch(operations) {
      // Execute synchronously within the transaction, matching D1 batch atomicity.
      raw.exec('BEGIN');
      try { const results = operations.map(op => op.executeRun()); raw.exec('COMMIT'); return results; }
      catch (error) { raw.exec('ROLLBACK'); throw error; }
    },
  };
  const objects = new Map();
  const storage = {
    async put(key, bytes) {
      count.puts++;
      if (fault.put) { fault.put--; throw Error('Injected R2 write failure'); }
      const copy = new Uint8Array(bytes);
      objects.set(key, copy);
      return { size: copy.byteLength };
    },
    async get(key, { range } = {}) {
      count.gets++;
      if (fault.get) { fault.get--; throw Error('Injected R2 read failure'); }
      const bytes = objects.get(key);
      if (!bytes) return null;
      const copy = range ? bytes.slice(range.offset, range.offset + range.length) : bytes.slice();
      return { size: bytes.byteLength, body: copy, arrayBuffer: async () => copy.buffer };
    },
    async head(key) {
      count.heads++;
      const bytes = objects.get(key);
      return bytes ? { size: bytes.byteLength } : null;
    },
  };
  const config = { db, owner: 'owner', projects: [PROJECT, OTHER_PROJECT] };
  const service = createService({ ...config, ...serviceOptions });
  const attachments = createAttachments({ ...config, storage });
  const upload = (clientId, body = 'abc', extra = {}) => attachments.upload(extra.projectId || PROJECT,
    new Request(`${HOST}/api/projects/${extra.projectId || PROJECT}/files`, {
      method: 'POST', body,
      headers: { 'x-upload-id': clientId, 'x-file-name': encodeURIComponent(extra.filename || 'fixture.txt'), 'content-type': extra.mediaType || 'text/plain' },
    }));
  const attachmentRow = id => raw.prepare('SELECT * FROM chat_attachments WHERE id=?').get(id);
  const uploadRow = clientId => raw.prepare('SELECT * FROM chat_attachments WHERE client_id=?').get(clientId);
  const post = (clientId, attachmentIds = [], metadata = {}) => service.postUserMessage(PROJECT,
    { clientId, text: 'Local-only synthetic fixture', metadata: { ...metadata, attachmentIds } });
  const download = (id, owner = 'owner', env = { DB: db, UPLOADS: storage }, projectId = PROJECT) =>
    handleRequest(new Request(`${HOST}/api/projects/${projectId}/files/${id}`, {
      headers: { 'oai-authenticated-user-id': owner },
    }), env, { projects: config.projects });
  return { raw, db, fault, count, storage, objects, config, service, attachments, upload, attachmentRow, uploadRow, post, download };
}

test('upload retry and fingerprint conflicts never overwrite a ready object', async t => {
  const f = fixture(t);
  const first = await f.upload('upload_retry_001');
  assert.equal((await f.upload('upload_retry_001')).id, first.id);
  assert.equal(f.count.puts, 1);
  for (const change of [
    () => f.upload('upload_retry_001', 'changed'),
    () => f.upload('upload_retry_001', 'abc', { filename: 'changed.txt' }),
    () => f.upload('upload_retry_001', 'abc', { mediaType: 'application/octet-stream' }),
  ]) await assert.rejects(change, code('upload_id_reused'));
  assert.equal(f.count.puts, 1);
  assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM chat_attachments').get().n, 1);
  assert.equal(Buffer.from(f.objects.get(f.attachmentRow(first.id).object_key)).toString(), 'abc');
});

test('concurrent identical uploads converge; conflicting concurrent bytes have one winner', async t => {
  const f = fixture(t);
  const same = await Promise.all([f.upload('upload_race_same'), f.upload('upload_race_same')]);
  assert.equal(same[0].id, same[1].id);
  assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM chat_attachments').get().n, 1);
  const competing = await Promise.allSettled([f.upload('upload_race_diff', 'first'), f.upload('upload_race_diff', 'other')]);
  assert.equal(competing.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(competing.find(x => x.status === 'rejected').reason.code, 'upload_id_reused');
  const row = f.uploadRow('upload_race_diff');
  assert.equal(createHash('sha256').update(f.objects.get(row.object_key)).digest('hex'), row.sha256);
});

test('R2 failure and D1 finalization failure keep uploading records recoverable', async t => {
  const f = fixture(t);
  for (const [clientId, failure] of [['upload_fail_r2', 'put'], ['upload_fail_d1', 'readyUpdate']]) {
    f.fault[failure] = 1;
    await assert.rejects(() => f.upload(clientId));
    const pending = f.uploadRow(clientId);
    assert.equal(pending.state, 'uploading');
    await assert.rejects(() => f.post('message_pending_' + failure, [pending.id]), code('attachment_not_ready'));
    const retried = await f.upload(clientId);
    assert.equal(retried.id, pending.id);
    assert.equal(f.attachmentRow(pending.id).state, 'ready');
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM chat_attachments WHERE client_id=?').get(clientId).n, 1);
  }
});

test('binary chunk roundtrip verifies SHA-256 and enforces exact message/owner/project binding', async t => {
  const f = fixture(t);
  const bytes = Uint8Array.from({ length: MAX_ATTACHMENT_CHUNK * 2 + 731 }, (_, i) => i % 251);
  const file = await f.upload('upload_binary_01', bytes, { mediaType: 'application/octet-stream' });
  const message = await f.post('message_binary_01', [file.id]);
  const otherMessage = await f.post('message_other_001');
  const args = { projectId: PROJECT, messageId: message.message.id, attachmentId: file.id };
  const chunks = []; let offset = 0;
  do {
    const part = await f.attachments.readForMessage({ ...args, offset }, f.service);
    assert.equal(part.offset, offset);
    assert(part.byteLength <= MAX_ATTACHMENT_CHUNK);
    const decoded = Buffer.from(part.dataBase64, 'base64');
    assert.equal(decoded.length, part.byteLength);
    chunks.push(decoded); offset = part.nextOffset;
  } while (offset !== null);
  const combined = Buffer.concat(chunks);
  assert.deepEqual(combined, Buffer.from(bytes));
  assert.equal(createHash('sha256').update(combined).digest('hex'), file.sha256);
  await assert.rejects(() => f.attachments.readForMessage({ ...args, messageId: otherMessage.message.id }, f.service), code('message_attachment_not_found'));
  await assert.rejects(() => f.attachments.readForMessage({ ...args, projectId: OTHER_PROJECT }, f.service), code('message_attachment_not_found'));
  const stranger = createService({ ...f.config, owner: 'another-owner' });
  const strangerFiles = createAttachments({ ...f.config, owner: 'another-owner', storage: f.storage });
  await assert.rejects(() => strangerFiles.readForMessage(args, stranger), code('message_not_found'));
  await assert.rejects(() => f.service.postUserMessage(OTHER_PROJECT, { clientId: 'cross_project_001', text: 'fixture', metadata: { attachmentIds: [file.id] } }), code('attachment_not_found'));
  assert.equal((await f.service.readMessage(message.message.id)).receipt, null);
});

test('old message retries accept explicit defaults but reject changed metadata', async t => {
  const f = fixture(t);
  const input = { clientId: 'legacy_client_001', text: 'Local-only legacy fixture' };
  const old = await f.service.postUserMessage(PROJECT, input);
  const again = await f.service.postUserMessage(PROJECT, { ...input, metadata: { mode: 'standard', skillReferences: [], attachmentIds: [] } });
  assert.equal(old.message.id, again.message.id);
  await assert.rejects(() => f.service.postUserMessage(PROJECT, { ...input, metadata: { mode: 'plan_only' } }), code('client_id_reused'));
  await assert.rejects(() => f.service.postUserMessage(PROJECT, { ...input, metadata: { skillReferences: ['local-fixture-skill'] } }), code('client_id_reused'));
  assert.equal((await f.service.outbox()).length, 1);
});

test('plan-only permits proposed planning and blocks native/external execution paths', async t => {
  const f = fixture(t);
  const message = await f.post('message_plan_001', [], { mode: 'plan_only' });
  const input = { clientId: 'task_plan_001', sourceMessageId: message.message.id, title: 'Plan fixture', scope: 'Plan only', action: 'investigate_report', priority: 50, priorityReason: 'Local fixture', dependencies: [] };
  await assert.rejects(() => f.service.createTask(PROJECT, input), code('plan_only_source'));
  const proposed = await f.service.createTask(PROJECT, { ...input, action: 'proposed' });
  await f.service.planTask(proposed.id, { operationId: 'plan_operation_001', expectedRevision: 1, priority: 40, priorityReason: 'Local plan fixture', dependencies: [] });
  await assert.rejects(() => f.service.recordExternal(proposed.id, {
    operationId: 'external_operation_001', expectedRevision: 2, sourceMessageId: message.message.id,
    externalTaskRef: 'local-synthetic-reference', observedAt: new Date().toISOString(), state: 'running', summary: 'Local fixture', evidence: ['Local-only assertion'],
  }), code('plan_only_source'));
  // Seed an inconsistent historical row to prove advanceTask has its own guard.
  f.raw.prepare("UPDATE board_tasks SET action='investigate_report' WHERE id=?").run(proposed.id);
  await assert.rejects(() => f.service.advanceTask(proposed.id, { operationId: 'claim_operation_001', expectedRevision: 2, fence: 0, state: 'claimed' }), code('plan_only_source'));
  const unchanged = await f.service.getTask(proposed.id);
  assert.equal(unchanged.state, 'queued'); assert.equal(unchanged.fence, 0); assert.equal(unchanged.revision, 2);
});

test('receipt belongs to first stored reply even with timestamp/ID ties and later clock skew', async t => {
  let stamp = '2026-10-07T09:00:00.000Z';
  const ids = ['user_fixture_001', 'zz_first_reply', 'aa_second_reply', 'bb_third_reply'];
  const f = fixture(t, { clock: () => stamp, uuid: () => ids.shift() || crypto.randomUUID() });
  const source = await f.service.postUserMessage(PROJECT, { clientId: 'receipt_source_01', text: 'Local-only receipt fixture' });
  for (let i = 0; i < 3; i++) {
    assert.equal((await f.service.readMessage(source.message.id)).receipt, null);
    assert.equal((await f.service.messages(PROJECT))[0].receipt, null);
  }
  const firstInput = { clientId: 'receipt_reply_01', replyTo: source.message.id, text: 'First local reply fixture' };
  const first = await f.service.postDotReply(PROJECT, firstInput);
  const expected = { dotReplyId: first.message.id, dotRepliedAt: stamp };
  await f.service.postDotReply(PROJECT, { ...firstInput, clientId: 'receipt_reply_02', text: 'Second same-timestamp reply fixture' });
  assert.deepEqual((await f.service.readMessage(source.message.id)).receipt, expected);
  stamp = '2026-10-07T08:59:59.000Z';
  await f.service.postDotReply(PROJECT, { ...firstInput, clientId: 'receipt_reply_03', text: 'Later insertion with older clock fixture' });
  assert.deepEqual((await f.service.readMessage(source.message.id)).receipt, expected);
  assert.equal((await f.service.postDotReply(PROJECT, firstInput)).message.id, first.message.id);
  assert.equal((await f.service.outbox()).length, 1, 'Replies must not emit user-message events');
});

test('download failures return structured HTTP responses instead of escaping the handler', async t => {
  const f = fixture(t);
  const missing = await f.download('file_missing_001');
  assert.equal(missing.status, 404); assert.equal((await missing.json()).error, 'attachment_not_found');
  const file = await f.upload('download_fixture_01');
  const denied = await f.download(file.id, 'another-owner');
  assert.equal(denied.status, 404);
  const wrongProject = await f.download(file.id, 'owner', { DB: f.db, UPLOADS: f.storage }, OTHER_PROJECT);
  assert.equal(wrongProject.status, 404);
  const absentBinding = await f.download(file.id, 'owner', { DB: f.db });
  assert.equal(absentBinding.status, 503); assert.equal((await absentBinding.json()).error, 'attachment_storage_unavailable');
  f.fault.get = 1;
  const unavailable = await f.download(file.id);
  assert.equal(unavailable.status, 503); assert.equal((await unavailable.json()).error, 'attachment_storage_unavailable');
  const valid = await f.download(file.id);
  assert.equal(valid.status, 200); assert.equal(await valid.text(), 'abc');
  assert.equal(valid.headers.get('content-type'), 'application/octet-stream');
  assert.equal(valid.headers.get('x-content-type-options'), 'nosniff');
  assert.match(valid.headers.get('content-disposition'), /^attachment;/);
  f.objects.delete(f.attachmentRow(file.id).object_key);
  const absentObject = await f.download(file.id);
  assert.equal(absentObject.status, 503); assert.equal((await absentObject.json()).error, 'attachment_object_missing');
});

test('empty files and EOF reads verify that the object still exists', async t => {
  const f = fixture(t);
  for (const [clientId, content] of [['empty_upload_001', ''], ['eof_upload_0001', 'abc']]) {
    const file = await f.upload(clientId, content);
    const message = await f.post('message_' + clientId, [file.id]);
    const args = { projectId: PROJECT, messageId: message.message.id, attachmentId: file.id, offset: file.sizeBytes };
    const end = await f.attachments.readForMessage(args, f.service);
    assert.equal(end.byteLength, 0); assert.equal(end.dataBase64, ''); assert.equal(end.nextOffset, null);
    f.objects.delete(f.attachmentRow(file.id).object_key);
    await assert.rejects(() => f.attachments.readForMessage(args, f.service), code('attachment_object_missing'));
  }
});

test('200 messages with five attachments stay inside a small D1 query budget', async t => {
  const f = fixture(t);
  const attachmentInsert = f.raw.prepare("INSERT INTO chat_attachments(id,owner_id,project_id,client_id,object_key,filename,media_type,size_bytes,sha256,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,'ready',?)");
  const messageInsert = f.raw.prepare('INSERT INTO chat_messages(id,owner_id,project_id,client_id,author,text,created_at,attachment_ids_json) VALUES(?,?,?,?,?,?,?,?)');
  const at = '2026-10-07T00:00:00.000Z';
  // Use 1,000 unique attachments, catching fixes that only cache repeated IDs.
  for (let m = 0; m < 200; m++) {
    const ids = [];
    for (let a = 0; a < 5; a++) {
      const id = `file_budget_${m}_${a}`; ids.push(id);
      attachmentInsert.run(id, 'owner', PROJECT, `upload_budget_${m}_${a}`, `budget/${id}`, 'fixture.txt', 'text/plain', 3, 'local-fixture-hash', at);
    }
    messageInsert.run(`message_budget_${m}`, 'owner', PROJECT, `client_budget_${m}`, 'user', 'Local-only query fixture', at, JSON.stringify(ids));
  }
  f.count.queries = 0;
  const result = await f.service.messages(PROJECT);
  assert.equal(result.length, 200); assert(result.every(row => row.attachments.length === 5));
  assert(f.count.queries <= 12, `Expected batched hydration; observed ${f.count.queries} D1 queries`);
  t.diagnostic(`200 × 5 unique attachments hydrated in ${f.count.queries} D1 queries`);
});

test('streamed bytes are bounded even without Content-Length', async () => {
  const source = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); controller.enqueue(new Uint8Array(5)); controller.close(); } });
  const request = new Request(HOST + '/files', { method: 'POST', body: source, duplex: 'half' });
  await assert.rejects(() => boundedBytes(request, 8), code('attachment_too_large'));
});
