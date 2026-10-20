// Non-secret namespace, derived only from Sites' authenticated subject.
export async function cacheOwnerKey(owner){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('dot-project-dashboard/session-cache/v1/'+owner));
 return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function stampCacheOwner(page,owner){return page.replace('<head>','<head><meta name="dashboard-cache-owner" content="'+await cacheOwnerKey(owner)+'">')}
