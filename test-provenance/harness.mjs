import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

export const root=new URL('../',import.meta.url).pathname.replace(/\/$/,'');
export async function harness(){
 const raw=new DatabaseSync(':memory:');
 for(const file of readdirSync(root+'/drizzle').filter(x=>x.endsWith('.sql')).sort())raw.exec(readFileSync(root+'/drizzle/'+file,'utf8'));
 let transactionTail=Promise.resolve();
 const db={
  prepare(sql){return {bind(...args){return {
   async all(){return {results:raw.prepare(sql).all(...args)}},
   async run(){return {meta:{changes:raw.prepare(sql).run(...args).changes}}}
  }}}},
  batch(ops){
   const action=transactionTail.then(async()=>{raw.exec('BEGIN');try{const r=[];for(const op of ops)r.push(await op.run());raw.exec('COMMIT');return r}catch(e){raw.exec('ROLLBACK');throw e}});
   transactionTail=action.catch(()=>{});return action;
  }
 };
 const projects=JSON.parse(readFileSync(root+'/projects.json','utf8')).projects.map(p=>p.id);
 const {createService}=await import(pathToFileURL(root+'/worker/chat-task-service.mjs'));
 const {handleRequest}=await import(pathToFileURL(root+'/worker/chat-handler.mjs'));
 const base={db,projects,clock:()=>new Date('2026-10-08T01:00:00Z').toISOString()};
 const service=createService({...base,owner:'review_owner'}),device=createService({...base,owner:'review_owner'}),other=createService({...base,owner:'review_other'});
 const endpoint='https://dashboard.example';
 async function rpc(name,args={},owner='review_owner',headers={}){
  const response=await handleRequest(new Request(endpoint+'/mcp',{method:'POST',headers:{'content-type':'application/json',...(owner?{'oai-authenticated-user-id':owner}:{}),...headers},body:JSON.stringify({jsonrpc:'2.0',id:42,method:'tools/call',params:{name,arguments:args}})}),{DB:db},{projects});
  return {status:response.status,data:await response.json()};
 }
 const count=table=>raw.prepare('SELECT count(*) AS n FROM '+table).get().n;
 return {raw,db,projects,service,device,other,rpc,count,handleRequest};
}
export async function reject(fn,...codes){await assert.rejects(fn,e=>{assert(codes.includes(e.code),'Expected '+codes.join('/')+', got '+e.code+' ('+e.message+')');return true})}
