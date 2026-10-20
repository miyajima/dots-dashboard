// Server-owned, task/source/owner-scoped policy; never accepted from request data.
// Configuration verification is not permission to launch or bypass approval.
export const trustedCloudConfigs = Object.freeze([]);
const fields=['environmentConfigId','executorType','ownerId','projectId','taskId','sourceMessageId'];
const id=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(x);
const configId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{8,100}(?:~asenvcfg_[a-zA-Z0-9_-]{8,100})?$/.test(x);
export function resolveTrustedCloudConfigs(env){
 const raw=env?.CLOUD_EXECUTION_CONFIGS_JSON;
 if(typeof raw!=='string'||raw.length>32768)return trustedCloudConfigs;
 try{
  const rows=JSON.parse(raw);
  if(!Array.isArray(rows)||rows.length>16||!rows.every(c=>c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).length===fields.length&&fields.every(k=>Object.hasOwn(c,k))&&c.executorType==='codex_cloud'&&configId(c.environmentConfigId)&&['ownerId','projectId','taskId','sourceMessageId'].every(k=>id(c[k]))))return trustedCloudConfigs;
  const keys=rows.map(c=>JSON.stringify(fields.map(k=>c[k])));
  if(new Set(keys).size!==keys.length)return trustedCloudConfigs;
  return Object.freeze(rows.map(c=>Object.freeze({...c})));
 }catch{return trustedCloudConfigs}
}
