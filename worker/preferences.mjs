export function preferenceStore(db) {
 if (!db || typeof db.prepare !== 'function') throw new Error('Storage binding unavailable');
 return {
  async read(userId) {const r=await db.prepare('SELECT project_id, hidden, revision, updated_at FROM project_visibility WHERE user_id = ? ORDER BY project_id').bind(userId).all();return r.results||[]},
  async patch(userId,projectId,hidden,revision,updatedAt) {
   const result=await db.prepare(`INSERT INTO project_visibility (user_id,project_id,hidden,revision,updated_at)
SELECT ?,?,?,1,? WHERE ?=0 OR EXISTS (SELECT 1 FROM project_visibility WHERE user_id=? AND project_id=? AND revision=?)
ON CONFLICT(user_id,project_id) DO UPDATE SET hidden=excluded.hidden, revision=project_visibility.revision+1, updated_at=excluded.updated_at
WHERE project_visibility.revision=?`).bind(userId,projectId,hidden?1:0,updatedAt,revision,userId,projectId,revision,revision).run();
   return Number(result.meta?.changes||0)===1;
  }
 };
}
export function response(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie'}})}
export function trustedUser(request){const id=request.headers.get('oai-authenticated-user-id');return id&&id.trim()&&id.length<=256?id:null}
export async function preferencesAPI(request,env,projectIds){
 const userId=trustedUser(request);if(!userId)return response({error:'sign_in_required'},401);
 const url=new URL(request.url);if(url.pathname!=='/api/project-visibility')return response({error:'not_found'},404);
 if(!['GET','POST'].includes(request.method))return response({error:'method_not_allowed'},405);
 if(request.method==='POST'){
  if(request.headers.get('origin')!==url.origin)return response({error:'invalid_origin'},403);
  if(request.headers.get('sec-fetch-site')==='cross-site')return response({error:'invalid_origin'},403);
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return response({error:'invalid_content_type'},415);
 }
 try{
  const db=preferenceStore(env?.DB);
  const snapshot=async()=>{const rows=await db.read(userId);return {items:rows.filter(x=>projectIds.includes(x.project_id)).map(x=>({projectId:x.project_id,hidden:!!x.hidden,revision:x.revision,updatedAt:x.updated_at})),serverTime:new Date().toISOString()}};
  if(request.method==='GET')return response(await snapshot());
  const raw=await request.text();if(raw.length>2048)return response({error:'payload_too_large'},413);
  let body;try{body=JSON.parse(raw)}catch{return response({error:'invalid_json'},400)}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='expectedRevision,hidden,projectId'||!projectIds.includes(body.projectId)||typeof body.hidden!=='boolean'||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)return response({error:'invalid_request'},400);
  const changed=await db.patch(userId,body.projectId,body.hidden,body.expectedRevision,new Date().toISOString());
  return response({...await snapshot(),...(changed?{}:{error:'revision_conflict'})},changed?200:409);
 }catch(error){console.error('project_visibility_storage_unavailable');return response({error:'storage_unavailable'},503)}
}
