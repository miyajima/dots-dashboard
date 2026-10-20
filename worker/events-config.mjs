import {listProjects} from './projects.mjs';
import {createSubscriptionStore} from './events-store.mjs';
import {APPROVED_CALLBACK_ORIGIN,createTrustedOriginTransport} from './events-transport.mjs';
export function createEventsConfig(env,projects){
 if(!APPROVED_CALLBACK_ORIGIN||!env?.DB)return null;
 return {approved:true,trialOnly:false,normalOperation:true,transport:createTrustedOriginTransport(APPROVED_CALLBACK_ORIGIN),store:createSubscriptionStore(env.DB),authorize:async(owner,projectId)=>!!owner&&(projects.includes(projectId)||(await listProjects(env.DB,owner)).some(p=>p.id===projectId))};
}
