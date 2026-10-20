import {ServiceError} from './chat-task-service.mjs';
import {trustedUser,response} from './preferences.mjs';
import {projectNameKey} from './codex-classification.mjs';
const clean=(s,max)=>typeof s==='string'&&s.trim().length>0&&s.length<=max&&!/[\u0000-\u001f\u007f]/.test(s);
export async function listProjects(db,owner){const r=await db.prepare('SELECT id,name,description,created_at,codex_project_id,environment_id,request_fingerprint FROM user_projects WHERE owner_id=? ORDER BY created_at,id').bind(owner).all();return (r.results||[]).map(p=>({id:p.id,name:p.name,description:p.description,createdAt:p.created_at,source:p.codex_project_id?'codex_catalog':'manual',codexProjectId:p.codex_project_id||null,environmentId:p.environment_id||null}))}
export async function projectsAPI(request,env,builtins=[]){
 const owner=trustedUser(request);if(!owner)return response({error:'sign_in_required'},401);
 if(!['GET','POST'].includes(request.method))return response({error:'method_not_allowed'},405);
 const url=new URL(request.url);
 if(request.method==='POST'){
  if(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')return response({error:'invalid_origin'},403);
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return response({error:'invalid_content_type'},415);
 }
 try{
  if(request.method==='GET')return response({projects:await listProjects(env.DB,owner),codexCatalog:await readCatalog(env.DB,owner)});
  const raw=await request.text();if(raw.length>4096)return response({error:'payload_too_large'},413);
  let b;try{b=JSON.parse(raw)}catch{return response({error:'invalid_json'},400)}
  const {status,...result}=await createProjectRecord(env.DB,owner,builtins,b);return response(result,status);
 }catch(e){return response({error:e instanceof ServiceError?e.code:'project_storage_unavailable'},e instanceof ServiceError?e.status:503)}
}
export async function createProjectRecord(db,owner,builtins,b,provenance=null){
  if(!b||Array.isArray(b)||!['clientId,description,name','catalogEnvironmentId,catalogObservedAt,clientId,codexProjectId,description,name'].includes(Object.keys(b).sort().join(','))||!/^project_[a-zA-Z0-9_-]{8,80}$/.test(b.clientId)||!clean(b.name,80)||typeof b.description!=='string'||b.description.length>500||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(b.description))throw new ServiceError(400,'invalid_project');
  let name=b.name.trim().normalize('NFC');const description=b.description.trim();let codexProjectId=null,environmentId=null;
  if(b.codexProjectId!==undefined&&(!clean(b.codexProjectId,256)||!clean(b.catalogEnvironmentId,256)||!clean(b.catalogObservedAt,80)))throw new ServiceError(400,'invalid_catalog_selection');
  const fingerprint=JSON.stringify([name,description,b.codexProjectId||null,b.catalogEnvironmentId||null,b.catalogObservedAt||null,...(provenance?[provenance]:[])]);
  const prior=async()=>{const r=await db.prepare('SELECT id,name,description,request_fingerprint FROM user_projects WHERE owner_id=? AND client_id=?').bind(owner,b.clientId).all();return r.results?.[0]};
  const existing=await prior();if(existing){if(existing.request_fingerprint!==fingerprint)throw new ServiceError(409,'client_id_reused');return {project:{id:existing.id,name:existing.name,description:existing.description},replayed:true,status:200}}
  if(b.codexProjectId!==undefined){const catalog=await readCatalog(db,owner),selected=catalog.projects?.find(p=>p.projectId===b.codexProjectId);if(!selected||catalog.environmentId!==b.catalogEnvironmentId||catalog.observedAt!==b.catalogObservedAt)throw new ServiceError(409,'catalog_selection_unavailable');name=selected.name;codexProjectId=selected.projectId;environmentId=catalog.environmentId}const key=projectNameKey(name);
  if(!key)throw new ServiceError(400,'invalid_project');
  const ledgerResult=await db.prepare('SELECT revision,state_json FROM codex_inventory_state WHERE owner_id=?').bind(owner).all(),ledger=ledgerResult.results?.[0],profiles=ledger?JSON.parse(ledger.state_json).projectProfiles??[]:[];
  if([...builtins,...(await listProjects(db,owner))].some(p=>[p.id,p.name,...(p.aliases||[]),...(profiles.find(x=>x.projectId===p.id)?.aliases??[])].some(alias=>projectNameKey(alias)===key)))throw new ServiceError(409,'project_name_exists');
  const id='project-'+crypto.randomUUID(),now=new Date().toISOString();
  await db.prepare('INSERT INTO user_projects(id,owner_id,client_id,name,name_key,description,created_at,codex_project_id,environment_id,request_fingerprint) SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM user_projects WHERE owner_id=?)<100 AND COALESCE((SELECT revision FROM codex_inventory_state WHERE owner_id=?),0)=? ON CONFLICT DO NOTHING').bind(id,owner,b.clientId,name,key,description,now,codexProjectId,environmentId,fingerprint,owner,owner,ledger?.revision??0).run();
  const saved=await prior();if(!saved){const current=await db.prepare('SELECT revision FROM codex_inventory_state WHERE owner_id=?').bind(owner).all();if((current.results?.[0]?.revision??0)!==(ledger?.revision??0))throw new ServiceError(409,'project_registry_revision_conflict');throw new ServiceError(409,(await listProjects(db,owner)).length>=100?'project_limit_reached':'project_name_exists')}
  if(saved.request_fingerprint!==fingerprint)throw new ServiceError(409,'client_id_reused');
  return {project:{id:saved.id,name:saved.name,description:saved.description},replayed:saved.id!==id,status:saved.id===id?201:200};
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const menu='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
const plus='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
export function renderUserProjects(page,projects){
 if(!projects.length)return page;
 const data=projects.map(p=>({...p,attention:'yellow',attention_label:'未確認',headline:p.description||'追加したプロジェクト',blocker:'状況はまだ確認していません',verified:'未確認',achievement:'記録はまだありません',detail:p.description,next:'会話からdotに依頼できます',next_request:'このプロジェクトの対象・環境と現在の状況を確認してください。'}));
 const badge=p=>`<span class="badge status-unconfirmed" data-status-badge="${esc(p.id)}">未確認</span>`;
 const live=p=>`<section class="live-status-panel" data-live-status="${esc(p.id)}" aria-label="現在の状況"><div class="live-status-heading"><h2>現在の状況</h2><button type="button" data-status-refresh="${esc(p.id)}">状況を更新</button></div><p class="live-status-sync" data-status-sync role="status" aria-live="polite">サーバーの状況を取得中…</p><p class="headline" data-status-headline>現在の状況を取得中…</p><dl class="live-status-facts"><div><dt>確認・課題</dt><dd data-status-blocker>最新のタスク・結果を確認しています</dd></div><div><dt>次の一手</dt><dd data-status-next>取得後に表示します</dd></div></dl><p class="verified" data-status-times></p><p class="live-status-counts" data-status-counts></p><div data-status-records></div></section>`;
 const nav=data.map(p=>`<li data-project-nav="${esc(p.id)}"><div class="project-nav-row"><a href="#project/${esc(p.id)}" data-nav-project="${esc(p.id)}"><i class="dot status-unconfirmed" data-status-dot="${esc(p.id)}" aria-hidden="true"></i><span>${esc(p.name)}</span></a><button type="button" class="session-add" data-add-session="${esc(p.id)}" aria-label="${esc(p.name)}に新しいスレッドを追加" title="新しいスレッド">${plus}</button></div><div data-session-navigation="${esc(p.id)}"></div></li>`).join('');
 const details=data.map(p=>`<div class="detail" data-detail="${esc(p.id)}" hidden><header class="detail-head"><button type="button" class="nav-toggle" data-open-nav aria-label="プロジェクト一覧を開く" aria-controls="project-sidebar" aria-expanded="false">${menu}</button><h1 tabindex="-1">${esc(p.name)}</h1>${badge(p)}<button type="button" data-open-codex-project="${esc(p.id)}" aria-haspopup="dialog">Codexタスク</button><details class="project-records" data-status-disclosure="${esc(p.id)}"><summary>状況・記録</summary><div class="record-popover">${live(p)}<details class="historical-records"><summary>登録時の記録 · ${esc(p.createdAt)}</summary><p class="history-notice">以下は登録時の情報です。現在の作業状況を示すものではありません。</p><p class="headline">${esc(p.description||'追加したプロジェクト')}</p><p class="verified">追加 ${esc(p.createdAt)}</p><p>この登録はダッシュボード内の整理用です。Codexのプロジェクト作成やフォルダ接続は行いません。</p></details></div></details></header><section class="workspace-panel" aria-label="${esc(p.name)}の作業"><div data-workspace="${esc(p.id)}"></div></section></div>`).join('');
 const cards=data.map(p=>`<article class="card status-unconfirmed" data-project-card="${esc(p.id)}" data-live-status="${esc(p.id)}" id="card-${esc(p.id)}"><div class="card-top"><h2><a href="#project/${esc(p.id)}">${esc(p.name)}</a></h2>${badge(p)}</div><p class="headline" data-status-headline>現在の状況を取得中…</p><div class="card-blocker"><span class="label">確認・課題</span><p data-status-blocker>最新のタスク・結果を確認しています</p></div><div class="card-footer"><a class="open-project" href="#project/${esc(p.id)}">開く →</a><button type="button" class="hide" data-hide="${esc(p.id)}" aria-label="${esc(p.name)}を一覧から隠す">隠す</button></div><p class="verified" data-status-sync>サーバーの状況は未確認</p></article>`).join('');
 return page.replace('<!--user-project-navigation-->',()=>nav).replace('<!--user-project-details-->',()=>details).replace('<!--user-project-cards-->',()=>cards).replace(/(<script id="project-data" type="application\/json">)([\s\S]*?)(<\/script>)/,(_,a,b,c)=>a+JSON.stringify([...JSON.parse(b),...data.map(({id,name})=>({id,name}))]).replace(/</g,'\\u003c')+c).replace(/(<p>)(\d+)( プロジェクト<\/p>)/,(_,a,b,c)=>a+(Number(b)+data.length)+c).replace(/(未確認 )(\d+)(<\/span>)/,(_,a,b,c)=>a+(Number(b)+data.length)+c);
}

export async function readCatalog(db,owner){const r=await db.prepare('SELECT environment_id,observed_at,projects_json FROM codex_project_catalog WHERE owner_id=?').bind(owner).all(),row=r.results?.[0];return row?{state:'cached',environmentId:row.environment_id,observedAt:row.observed_at,projects:JSON.parse(row.projects_json)}:{state:'unavailable',reason:'desktop_project_catalog_not_connected',projects:[]}}
export async function importCatalog(db,owner,input){
 const valid=input&&Object.keys(input).sort().join(',')==='environmentId,observedAt,projects'&&clean(input.environmentId,256)&&typeof input.observedAt==='string'&&Number.isFinite(Date.parse(input.observedAt))&&Date.parse(input.observedAt)<=Date.now()+300000&&Date.parse(input.observedAt)>=Date.now()-86400000&&Array.isArray(input.projects)&&input.projects.length<=200&&input.projects.every(p=>p&&Object.keys(p).sort().join(',')==='name,projectId'&&clean(p.projectId,256)&&clean(p.name,80))&&new Set(input.projects.map(p=>p.projectId)).size===input.projects.length;
 if(!valid)throw new ServiceError(400,'invalid_verified_catalog');
 const observedAt=new Date(input.observedAt).toISOString(),projects=input.projects.map(p=>({projectId:p.projectId,name:p.name.trim().normalize('NFC')}));
 const out=await db.prepare('INSERT INTO codex_project_catalog(owner_id,environment_id,observed_at,projects_json) VALUES(?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET environment_id=excluded.environment_id,observed_at=excluded.observed_at,projects_json=excluded.projects_json WHERE excluded.observed_at>codex_project_catalog.observed_at').bind(owner,input.environmentId,observedAt,JSON.stringify(projects)).run();
 if(!Number(out.meta?.changes)){const prior=await readCatalog(db,owner);if(prior.environmentId!==input.environmentId||prior.observedAt!==observedAt||JSON.stringify(prior.projects)!==JSON.stringify(projects))throw new ServiceError(409,'catalog_snapshot_conflict')}
 return readCatalog(db,owner);
}
