import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './test-provenance/harness.mjs';
import {projectsAPI,importCatalog,listProjects} from './worker/projects.mjs';
import {createSubscriptionStore} from './worker/events-store.mjs';
import {createEventsConfig} from './worker/events-config.mjs';
const owner='review_owner',origin='https://dashboard.example';
async function create(h,body){const response=await projectsAPI(new Request(origin+'/api/project-registry',{method:'POST',headers:{'oai-authenticated-user-id':owner,origin,'content-type':'application/json'},body:JSON.stringify(body)}),{DB:h.db});return {status:response.status,data:await response.json()}}
function snapshot(offset=0,environmentId='desktop-A',name='Original'){return {environmentId,observedAt:new Date(Date.now()-60000+offset).toISOString(),projects:[{projectId:'same-opaque-ID',name}]}}
function selection(s,clientId='project_review_0001'){return {clientId,name:s.projects[0].name,description:'Description',codexProjectId:s.projects[0].projectId,catalogEnvironmentId:s.environmentId,catalogObservedAt:s.observedAt}}
test('lost creation receipt remains recoverable after catalog rename, removal and environment replacement',async()=>{
 const h=await harness(),s=snapshot(),body=selection(s);await importCatalog(h.db,owner,s);const first=await create(h,body);assert.equal(first.status,201);
 for(const next of [{...s,observedAt:new Date(Date.parse(s.observedAt)+1000).toISOString(),projects:[{projectId:'same-opaque-ID',name:'Renamed'}]},{...s,observedAt:new Date(Date.parse(s.observedAt)+2000).toISOString(),projects:[]},{...s,environmentId:'desktop-B',observedAt:new Date(Date.parse(s.observedAt)+3000).toISOString()}]){
  await importCatalog(h.db,owner,next);const retry=await create(h,body);assert.equal(retry.status,200);assert.equal(retry.data.replayed,true);assert.deepEqual(retry.data.project,first.data.project);
 }
 assert.equal((await listProjects(h.db,owner)).length,1);assert.equal((await create(h,{...body,description:'Changed'})).data.error,'client_id_reused');
});
test('catalog choices cannot silently rebind across environment or snapshot races',async()=>{
 const h=await harness(),s=snapshot();await importCatalog(h.db,owner,s);const body=selection(s),newer={...s,environmentId:'desktop-B',observedAt:new Date(Date.parse(s.observedAt)+1000).toISOString()};await importCatalog(h.db,owner,newer);
 const stale=await create(h,body);assert.equal(stale.status,409);assert.equal(stale.data.error,'catalog_selection_unavailable');assert.equal(h.count('user_projects'),0);
 const wrongTime=await create(h,{...body,catalogEnvironmentId:'desktop-B'});assert.equal(wrongTime.status,409);assert.equal(h.count('user_projects'),0);
 const current=await create(h,selection(newer));assert.equal(current.status,201);assert.equal((await listProjects(h.db,owner))[0].environmentId,'desktop-B');
});
test('normal Events handler preserves explicit authorization veto before any callback',async()=>{
 const h=await harness();let calls=0;const eventsConfig={approved:true,normalOperation:true,store:createSubscriptionStore(h.db),authorize:async()=>false,transport:{assurance:'trusted-openai-origin-test-v1',async post(){calls++;throw Error('Must never send')}}};
 const response=await h.handleRequest(new Request(origin+'/mcp',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':owner},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'events/subscribe',params:{name:'project.message_created',arguments:{projectId:h.projects[0]},delivery:{mode:'webhook',url:'https://connectors.api.openai.com/synthetic-review',secret:'whsec_'+btoa('synthetic-normal-32-byte-key-00000')}}})}),{DB:h.db},{projects:h.projects,eventsConfig});
 const result=await response.json();assert.equal(result.error.data.reason,'access_revoked');assert.equal(calls,0);assert.equal(h.count('event_subscriptions'),0);
});
test('production Events authorization includes own dynamic projects and rejects another owner',async()=>{
 const h=await harness();const saved=await create(h,{clientId:'project_review_manual',name:'Manual',description:''});assert.equal(saved.status,201);const config=createEventsConfig({DB:h.db},h.projects);assert.ok(config);assert.equal(await config.authorize(owner,saved.data.project.id),true);assert.equal(await config.authorize('review_other',saved.data.project.id),false);assert.equal(await config.authorize(owner,'project-does-not-exist'),false);
});
