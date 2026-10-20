// Secrets stay in this backend adapter; status methods return explicit safe fields.
export function createSubscriptionStore(db){
 const stmt=(s,a=[])=>db.prepare(s).bind(...a),one=async(s,a)=>(await stmt(s,a).all()).results[0]||null;
 const convert=r=>r?{id:r.subscription_id,owner:r.owner_id,projectId:r.project_id,url:r.callback_url,secret:r.signing_secret,previousSecret:r.previous_secret,rotationUntil:r.rotation_until,expiresAt:r.expires_at,verifiedAt:r.verified_at,revision:r.revision}:null;
 const purge=async(o,t)=>{await stmt('DELETE FROM event_subscriptions WHERE owner_id=? AND expires_at<=?',[o,t]).run()};
 return {
  async get(o,id){return convert(await one('SELECT * FROM event_subscriptions WHERE owner_id=? AND subscription_id=?',[o,id]))},
  async list(o,p){await purge(o,Date.now());return (await stmt('SELECT * FROM event_subscriptions WHERE owner_id=? AND project_id=?',[o,p]).all()).results.map(convert)},
  async remove(o,id){await db.batch([stmt('INSERT INTO event_subscription_stops(owner_id,subscription_id,stopped_at) VALUES(?,?,?) ON CONFLICT(owner_id,subscription_id) DO UPDATE SET stopped_at=MAX(stopped_at,excluded.stopped_at)',[o,id,Date.now()]),stmt('DELETE FROM event_subscriptions WHERE owner_id=? AND subscription_id=?',[o,id])])},
  async putExclusive(o,id,v,t){
   await purge(o,t);
   if(v.expectedRevision){const r=await stmt('UPDATE event_subscriptions SET callback_url=?,signing_secret=?,previous_secret=?,rotation_until=?,expires_at=?,verified_at=?,revision=revision+1 WHERE owner_id=? AND project_id=? AND subscription_id=? AND revision=?',[v.url,v.secret,v.previousSecret||null,v.rotationUntil||null,v.expiresAt,v.verifiedAt,o,v.projectId,id,v.expectedRevision]).run();return Number(r.meta?.changes)===1}
   const r=await stmt(`INSERT INTO event_subscriptions(owner_id,project_id,subscription_id,callback_url,signing_secret,previous_secret,rotation_until,expires_at,verified_at,revision) SELECT ?,?,?,?,?,?,?,?,?,1 WHERE NOT EXISTS(SELECT 1 FROM event_subscription_stops WHERE owner_id=? AND subscription_id=? AND stopped_at>=?) ON CONFLICT(owner_id,project_id) DO NOTHING`,[o,v.projectId,id,v.url,v.secret,v.previousSecret||null,v.rotationUntil||null,v.expiresAt,v.verifiedAt,o,id,v.startedAt||t]).run();return Number(r.meta?.changes)===1;
  },
  async prepareEvent(o,id,messageId,t){
   await stmt('INSERT INTO event_deliveries(owner_id,subscription_id,message_id,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM event_subscriptions WHERE owner_id=? AND subscription_id=? AND expires_at>?) ON CONFLICT(owner_id,subscription_id,message_id) DO NOTHING',[o,id,messageId,t,o,id,t]).run();
   const old=await one('SELECT accepted_at,attempts,terminal_reason FROM event_deliveries WHERE owner_id=? AND subscription_id=? AND message_id=?',[o,id,messageId]);if(!old)return 'subscription_changed';if(old.accepted_at)return 'already_accepted';if(old.terminal_reason)return old.terminal_reason;if(old.attempts>=3)return 'attempt_limit_reached';
   const r=await stmt('UPDATE event_deliveries SET lease_until=? WHERE owner_id=? AND subscription_id=? AND message_id=? AND accepted_at IS NULL AND attempts<3 AND lease_until<=? AND EXISTS(SELECT 1 FROM event_subscriptions WHERE owner_id=? AND subscription_id=? AND expires_at>?)',[t+15000,o,id,messageId,t,o,id,t]).run();return Number(r.meta?.changes)===1?'claimed':'delivery_in_progress';
  },
  async recordAttempt(o,id,messageId,t){const r=await stmt('UPDATE event_deliveries SET attempts=attempts+1 WHERE owner_id=? AND subscription_id=? AND message_id=? AND accepted_at IS NULL AND attempts<3 AND EXISTS(SELECT 1 FROM event_subscriptions WHERE owner_id=? AND subscription_id=? AND expires_at>?)',[o,id,messageId,o,id,t]).run();return Number(r.meta?.changes)===1},
  async finishDelivery(o,id,messageId,accepted,t,terminalReason=null){await stmt('UPDATE event_deliveries SET accepted_at=CASE WHEN ? THEN ? ELSE accepted_at END,terminal_reason=?,lease_until=0 WHERE owner_id=? AND subscription_id=? AND message_id=?',[accepted?1:0,t,terminalReason,o,id,messageId]).run();await stmt('UPDATE event_outbox SET state=? WHERE owner_id=? AND message_id=?',[accepted?'accepted':'failed',o,messageId]).run()},
  async status(o,p){await purge(o,Date.now());const r=await one('SELECT subscription_id,expires_at FROM event_subscriptions WHERE owner_id=? AND project_id=?',[o,p]);return {state:r?'ready':'not_subscribed',expiresAt:r?new Date(r.expires_at).toISOString():null}},
 };
}
