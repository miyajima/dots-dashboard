// Offline acceptance runner only. Never opens the live Site or fetches Codex.
// Input: {provenance:{sourceMessageId,projectId,sessionId}, pages:[v1 page,...]}.
// Output contains private IDs: retain in the cloud workspace, never publish.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createService} from './worker/chat-task-service.mjs';
import {createCodexInventory} from './worker/codex-inventory.mjs';
export async function stageInventory(manifest,output){
 const root=dirname(fileURLToPath(import.meta.url)),p=manifest.provenance,owner='offline_inventory_fixture';
 if(!p||typeof p.sourceMessageId!=='string'||typeof p.projectId!=='string'||typeof p.sessionId!=='string'||!Array.isArray(manifest.pages)||!manifest.pages.length)throw Error('invalid_staging_manifest');
 mkdirSync(output,{recursive:true});const path=resolve(output,'offline-inventory.sqlite');if(existsSync(path))throw Error('staging_output_already_exists');
 const raw=new DatabaseSync(path);for(const file of readdirSync(root+'/drizzle').filter(x=>x.endsWith('.sql')).sort())raw.exec(readFileSync(root+'/drizzle/'+file,'utf8'));
 // This is explicitly a local fixture for server boundary testing. It is not
 // an authenticated owner post, copied conversation, or a live request record.
 raw.prepare('INSERT INTO chat_messages(id,owner_id,project_id,session_id,client_id,author,text,created_at,mode) VALUES(?,?,?,?,?,?,?,?,?)').run(p.sourceMessageId,owner,p.projectId,p.sessionId==='general'?null:p.sessionId,'offline_fixture_source','user','Offline provenance fixture. Not a live authenticated Dashboard post.',new Date().toISOString(),'standard');
 const db={prepare(sql){return {bind(...args){return {async all(){return {results:raw.prepare(sql).all(...args)}},async run(){return {meta:{changes:raw.prepare(sql).run(...args).changes}}}}}}},async batch(ops){raw.exec('BEGIN');try{const out=[];for(const op of ops)out.push(await op.run());raw.exec('COMMIT');return out}catch(e){raw.exec('ROLLBACK');throw e}}};
 const service=createService({db,owner,projects:[p.projectId]}),ledger=createCodexInventory({db,owner,service});let last;const receipts=[];let maxEnvelopeCharacters=0;
 try{for(const page of manifest.pages){if(page.sourceMessageId!==p.sourceMessageId)throw Error('staging_source_mismatch');const length=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'project_codex_inventory_import_page',arguments:page}}).length;maxEnvelopeCharacters=Math.max(maxEnvelopeCharacters,length);if(length>20000)throw Error('mcp_envelope_too_large');last=await ledger.importPage(page);receipts.push(last)}
  const finish=await ledger.finish({version:1,sourceMessageId:p.sourceMessageId,syncId:last.sync.syncId,operationId:'offline_finish_'+last.sync.syncId.slice(0,180),expectedRevision:last.sync.revision,outcome:'complete',reason:null});receipts.push(finish);
  const observations=[];let cursor=null,revision;do{const page=await ledger.list({limit:50,...(cursor?{cursor,expectedLedgerRevision:revision}:{})});observations.push(...page.tasks);cursor=page.nextCursor;revision=page.ledgerRevision}while(cursor);
  const receiptCountBefore=raw.prepare('SELECT count(*) AS n FROM codex_inventory_operations').get().n;let replayedPages=0;for(const page of manifest.pages){const replay=await ledger.importPage(page);if(!replay.replayed)throw Error('offline_replay_not_idempotent');replayedPages++}const receiptCountAfter=raw.prepare('SELECT count(*) AS n FROM codex_inventory_operations').get().n;if(receiptCountBefore!==receiptCountAfter)throw Error('offline_replay_created_receipt');
  const counts={listed:observations.length,active:observations.filter(t=>!t.archived).length,archived:observations.filter(t=>t.archived).length,emptyReads:observations.filter(t=>t.messageState==='empty').length,readSucceeded:observations.filter(t=>t.readState==='succeeded').length,unmapped:observations.filter(t=>t.mappingState==='unmapped').length};
  const report={kind:'offline_staging_acceptance_only',liveSync:false,liveMappingsChecked:false,sourceAuthority:'parent_reported_metadata_exercised_as_offline_fixture',provenance:p,coverage:finish.sync,counts,idempotency:{replayedPages,receiptCountBefore,receiptCountAfter},maxEnvelopeCharacters,workCompletion:'unconfirmed',observations};writeFileSync(resolve(output,'acceptance.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});writeFileSync(resolve(output,'receipts.json'),JSON.stringify(receipts,null,2)+'\n',{mode:0o600});return report;
 }finally{raw.close()}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node stage-codex-inventory.mjs manifest.json NEW_OUTPUT_DIRECTORY');const report=await stageInventory(JSON.parse(readFileSync(input,'utf8')),resolve(output));console.log(JSON.stringify({kind:report.kind,liveSync:report.liveSync,counts:report.counts,maxEnvelopeCharacters:report.maxEnvelopeCharacters}));
}
