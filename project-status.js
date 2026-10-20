/* Live project summaries are independent of the dated, immutable history below them. */
(function(){
'use strict';
const STATES={attention:'要確認',running:'開始準備・作業・検証',queued:'実行待ち',recorded:'記録あり',unconfirmed:'未確認'};
const TASK_STATES={queued:'実行待ち',claimed:'開始準備',running:'作業中',verifying:'検証中',waiting_input:'確認待ち',failed:'停止・失敗'};
const STALE_MS=90000;
const plain=(value,fallback='')=>typeof value==='string'&&value.trim()?value:fallback;
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
function formatTime(value){return timestamp(value)===null?'未確認':new Date(value).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})+' JST'}
function safeTaskHash(projectId,taskId){const safe=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(x);return safe(projectId)&&safe(taskId)?'#project/'+projectId+'/task/'+taskId:null}
function taskLabel(task){
 if(task.state!=='succeeded')return TASK_STATES[task.state]||'未確認';
 if(task.completionKind==='plan')return '計画の記録（実作業の完了ではありません）';
 if(task.completionKind==='report')return '報告の記録（実作業の完了ではありません）';
 if(task.effectiveComplete===true&&task.completionVerified===true&&task.completionKind==='work')return 'このタスクは完了確認済み';
 if(task.completionVerified===true)return '成功記録あり・完了範囲と子タスクを確認';
 return '完了状態の記録・根拠は未確認';
}
function validateSnapshot(snapshot,id){
 if(!snapshot||snapshot.projectId!==id||!Object.hasOwn(STATES,snapshot.state)||timestamp(snapshot.checkedAt)===null||!Array.isArray(snapshot.tasks)||!Array.isArray(snapshot.outcomes)||!snapshot.counts)throw Error('invalid_status');
 for(const key of ['total','queued','active','waiting','failed','succeeded','unfinished','verifiedCompleted','unverified'])if(!Number.isSafeInteger(snapshot.counts[key])||snapshot.counts[key]<0)throw Error('invalid_status');
 for(const task of snapshot.tasks)if(!task||typeof task.id!=='string'||typeof task.title!=='string'||typeof task.state!=='string')throw Error('invalid_status');
 for(const outcome of snapshot.outcomes)if(!outcome||typeof outcome.id!=='string'||!['work','plan','report'].includes(outcome.kind))throw Error('invalid_status');
 if(snapshot.curated!==null&&snapshot.curated!==undefined&&(typeof snapshot.curated!=='object'||Array.isArray(snapshot.curated)))throw Error('invalid_status');
 if(snapshot.agentTeams!==undefined){const teams=snapshot.agentTeams;if(!teams||!Array.isArray(teams.teams)||teams.teams.length>30)throw Error('invalid_status');for(const t of teams.teams)if(!t||!t.lead||typeof t.lead.taskId!=='string'||(t.version===2?typeof t.lead.environmentConfigId!=='string':typeof t.lead.environmentId!=='string')||!Array.isArray(t.steps)||t.steps.length>8||t.steps.some(s=>!s||typeof s.title!=='string'||!Array.isArray(s.dependencies)||!Array.isArray(s.evidence)||s.dependencies.some(d=>typeof d!=='string')))throw Error('invalid_status');}
 return snapshot;
}
function isStale(entry,now){return !entry?.snapshot||!!entry.error||now-timestamp(entry.snapshot.checkedAt)>STALE_MS}
function countStates(entries,ids,now){const counts=Object.fromEntries(Object.keys(STATES).map(s=>[s,0]));for(const id of ids){const e=entries.get(id);counts[isStale(e,now)?'unconfirmed':e.snapshot.state]++}return counts}
function mount({document:doc,window:win,request=fetch,now=Date.now,setTimeout:later=setTimeout,clearTimeout:cancel=clearTimeout,setInterval:repeat=setInterval,clearInterval:stop=clearInterval}={}){
 const data=doc.getElementById('project-data');if(!data)return null;
 let projects;try{projects=JSON.parse(data.textContent)}catch{return null}
 const ids=[...new Set(projects.map(p=>p.id))],known=new Set(ids),entries=new Map(ids.map(id=>[id,{snapshot:null,error:null,loading:false,version:0}]));
 const roots=[...doc.querySelectorAll('[data-live-status]')],badges=[...doc.querySelectorAll('[data-status-badge]')],dots=[...doc.querySelectorAll('[data-status-dot]')],buttons=[...doc.querySelectorAll('[data-status-refresh]')];
 const legend=doc.getElementById('project-status-legend'),sync=doc.getElementById('project-status-sync'),controllers=new Set(),listeners=[],recordSignatures=new WeakMap();let disposed=false,changeTimer=null,legendSignature='';const changedProjects=new Set();
 const node=(tag,text,cls)=>{const el=doc.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el};
 const setText=(root,selector,text)=>{const el=root.querySelector(selector);if(el&&el.textContent!==text)el.textContent=text};
 function evidence(rows){const items=Array.isArray(rows)?rows.filter(x=>typeof x==='string'&&x.trim()):[];if(!items.length)return node('p','確認できる根拠の記録はありません','status-evidence-empty');const detail=node('details',undefined,'status-evidence'),list=node('ul');detail.append(node('summary','根拠 '+items.length+'件'));for(const item of items)list.append(node('li',item));detail.append(list);return detail}
 function drawRecords(root,snapshot){
  const area=root.querySelector('[data-status-records]');if(!area)return;
  const teamSignature=snapshot.agentTeams?{...snapshot.agentTeams,teams:snapshot.agentTeams.teams.map(({checkedAt,...t})=>t)}:null;
  const signature=JSON.stringify([snapshot.tasks,snapshot.tasksTruncated,snapshot.outcomes,snapshot.curated,teamSignature]);if(recordSignatures.get(area)===signature)return;
  const opened=new Set([...area.querySelectorAll('details[data-status-key]')].filter(el=>el.open).map(el=>el.dataset.statusKey));
  const focusKey=doc.activeElement&&area.contains?.(doc.activeElement)?doc.activeElement.dataset.statusFocus:null;
  const section=node('div',undefined,'status-record-content');
  if(snapshot.agentTeams){
   const teams=node('section',undefined,'status-team-section');teams.append(node('h3','クラウド・エージェントチーム'),node('p','自動起動は未接続。実際のクラウド実行を担当者が確認して記録します。','status-caution'));
   const labels={queued:'実行待ち',claimed:'担当確保・起動未確認',launch_unknown:'起動結果不明・照合待ち',running:'作業中の観測',verifying:'検証中の観測',waiting_approval:'承認待ち',blocked:'停止',failed:'失敗の観測',succeeded:'完了根拠あり'},health={approval_wait:'承認待ち（停滞と別）',check_no_result:'10分無結果・確認が必要',report_recovery:'20分無結果・報告と回復判断が必要',reconcile_required:'再試行せず実際のタスクを照合',check_reconcile:'10分無結果・起動を照合',report_reconcile:'20分無結果・報告して照合'};
   if(snapshot.agentTeams.cloudConfigurationPolicy?.ready===false)teams.append(node('p','公式クラウド環境構成IDの確認待ち。v2の新規登録は停止しています。','status-caution'));
   if(!snapshot.agentTeams.teams.length)teams.append(node('p','登録チームはありません。既存タスクは自動起動しません。','status-empty'));
   for(const team of snapshot.agentTeams.teams){
    const card=node('article',undefined,'status-team');card.append(node('h4','責任者の実行 '+plain(team.lead.taskId)),node('p',team.version===2?'実行方式 '+plain(team.lead.executorType)+' / 環境構成ID '+plain(team.lead.environmentConfigId):'旧v1環境ID '+plain(team.lead.environmentId)+'（クラウド種別・tree未確認）'),node('p',team.completion==='reviewed_commit_tree'?'対象コミット・treeの独立レビュー記録あり':team.version===2?(team.cloudConfigurationVerified===false?'クラウド環境構成が未確認・完了未確認':'独立レビューを含め未完了'):'旧v1記録・クラウド実行と完了は未確認'),node('p','担当者の観測記録。Siteによる外部実行の独立認証はありません。','status-caution'));
    for(const run of team.steps){const item=node('div',undefined,'status-team-run');item.append(node('h4',plain(run.title)+' · '+plain(labels[run.state],run.state)),node('p','完了条件：'+plain(run.completionCriteria)),node('p','依存：'+(run.dependencies.join('、')||'なし')),node('p','担当実行：'+(run.binding?plain(run.binding.taskId)+' / '+plain(run.binding.environmentConfigId||run.binding.environmentId):'未確定')),node('p','課題：'+plain(run.blocker,health[run.health]||'記録なし')),node('p','次：'+plain(run.next)),node('p','観測 '+formatTime(run.observedAt),'verified'));
     if(health[run.health])item.append(node('p',health[run.health],'status-caution'));if(run.exactCommit||run.commit)item.append(node('p','対象コミット '+plain(run.exactCommit||run.commit),'status-team-commit'));const runProof=evidence(run.evidence);runProof.dataset.statusKey='team-proof:'+team.id+':'+run.id;const proofSummary=runProof.querySelector('summary');if(proofSummary)proofSummary.dataset.statusFocus=runProof.dataset.statusKey;item.append(runProof);if(run.dispatchIntent)item.append(node('p','dispatch '+plain(run.dispatchIntent.dispatchId)+' / generation '+String(run.generation)+' / attempt '+plain(run.dispatchIntent.attemptId)),node('p','起動前head '+plain(run.dispatchIntent.exactCommit)),node('p','起動前tree '+plain(run.dispatchIntent.exactTree)));if(run.verificationTargets)for(const target of run.verificationTargets)item.append(node('p','検証対象 '+plain(target.stepId)+' / dispatch '+plain(target.dispatchId)+' / attempt '+plain(target.attemptId)+' / generation '+String(target.generation)));if(run.exactTree)item.append(node('p','検証tree '+plain(run.exactTree),'status-team-commit'));if(run.binding?.environmentInstanceId)item.append(node('p','実instance ID '+plain(run.binding.environmentInstanceId)));if(run.decisionHistory?.length){const history=node('details',undefined,'status-decision-history');history.dataset.statusKey='team-decision-history:'+team.id+':'+run.id;const summary=node('summary','判断履歴 '+run.decisionHistory.length+'件');summary.dataset.statusFocus=history.dataset.statusKey;history.append(summary);for(const d of run.decisionHistory)history.append(node('p',plain(d.provider)+' / '+plain(d.route)+' / '+plain(d.outcome)+' / request '+plain(d.requestId,'未利用')+' / dispatch '+plain(d.dispatchId)+' / attempt '+plain(d.attemptId)+' / generation '+String(d.generation)),node('p','根拠：'+plain(d.rationale)+' / 未利用理由：'+plain(d.unusedReason)+' / fallback：'+plain(d.fallback)),node('p','予算 '+String(d.budget)+' / timeout '+String(d.timeoutMs)+'ms / 観測 '+formatTime(d.observedAt)),evidence(d.evidence));item.append(history)}
     if(run.approval){const approvalProof=evidence(run.approval.evidence);approvalProof.dataset.statusKey='team-approval:'+team.id+':'+run.id;const summary=approvalProof.querySelector('summary');if(summary)summary.dataset.statusFocus=approvalProof.dataset.statusKey;item.append(node('p','承認の観測：'+plain(run.approval.outcome)+' / request '+plain(run.approval.approvalRequestId)+' / wait '+String(run.approval.waitGeneration||0),'status-caution'),approvalProof)}
     if(run.decision){const d=run.decision,decisionProof=evidence(d.evidence);decisionProof.dataset.statusKey='team-decision:'+team.id+':'+run.id;const summary=decisionProof.querySelector('summary');if(summary)summary.dataset.statusFocus=decisionProof.dataset.statusKey;item.append(node('h4','判断サービスの利用記録'),node('p',plain(d.provider)+' / '+plain(d.route,'旧経路未確認')+' · '+plain(d.outcome)+(d.requestId?' · '+plain(d.requestId):'')),node('p','予算 '+String(d.budget)+' / timeout '+String(d.timeoutMs)+'ms'),node('p','判断根拠：'+plain(d.rationale)),node('p','fallback：'+plain(d.fallback)),node('p','未利用理由：'+plain(d.unusedReason,'利用結果あり')),node('p','判断結果は実行承認を代替しません。','status-caution'),decisionProof)}card.append(item)
    }teams.append(card)
   }if(snapshot.agentTeams.truncated)teams.append(node('p','チームは最大30件を表示。','status-caution'));section.append(teams)
  }
  const taskSection=node('section',undefined,'status-task-section');taskSection.append(node('h3','タスクの現在地'));if(snapshot.tasksTruncated)taskSection.append(node('p','先頭30件を表示しています。全件はタスク欄で確認できます。','status-caution'));
  if(!snapshot.tasks.length)taskSection.append(node('p','登録されたタスクはありません。作業開始・完了は未確認です。','status-empty'));
  const list=node('ul',undefined,'status-task-list'),order={waiting_input:0,failed:1,running:2,verifying:2,claimed:3,queued:4,succeeded:5};
  for(const task of [...snapshot.tasks].sort((a,b)=>(order[a.state]??6)-(order[b.state]??6))){
   const item=node('li',undefined,'status-task-item'),head=node('div',undefined,'status-task-heading'),href=safeTaskHash(snapshot.projectId,task.id),title=node(href?'a':'span',plain(task.title,'タスク'));
   if(href){title.href=href;title.dataset.statusFocus='task:'+task.id;title.addEventListener('click',()=>{const disclosure=root.closest?.('.project-records');if(disclosure)disclosure.open=false})}
   head.append(title,node('span',taskLabel(task),'status-task-state'));item.append(head);
   if(task.parentTaskId){const parent=snapshot.tasks.find(t=>t.id===task.parentTaskId),link=safeTaskHash(snapshot.projectId,task.parentTaskId),line=node('p',undefined,'status-parent'),a=node(link?'a':'span','親：'+plain(parent?.title,'親タスク'));if(link)a.href=link;line.append(a);item.append(line)}
   if(task.summary)item.append(node('p',plain(task.summary),'status-record-summary'));
   item.append(node('p','根拠の観測 '+formatTime(task.observedAt),'verified'));
   const proof=evidence(task.evidence);proof.dataset.statusKey='task-proof:'+task.id;item.append(proof);list.append(item);
  }
  taskSection.append(list);section.append(taskSection);
  const outcomes=node('section',undefined,'status-outcome-section');outcomes.append(node('h3','確認された結果・報告（最大12件）'));
  if(!snapshot.outcomes.length)outcomes.append(node('p','結果・報告の記録はまだありません。','status-empty'));
  for(const outcome of snapshot.outcomes){const item=node('article',undefined,'status-outcome');item.append(node('h4',({work:'作業結果',plan:'計画の記録',report:'報告の記録'}[outcome.kind]||'結果の記録')+(outcome.status==='published'?' · 反映済み':'')),node('p',plain(outcome.summary,'内容は未確認'),'status-record-summary'),node('p','観測 '+formatTime(outcome.observedAt),'verified'));if(outcome.kind==='plan')item.append(node('p','計画の提出を示す記録です。実作業の完了は示しません。','status-caution'));if(outcome.kind==='report')item.append(node('p','報告・回答を示す記録です。実作業の完了は示しません。','status-caution'));const proof=evidence(outcome.evidence);proof.dataset.statusKey='outcome-proof:'+outcome.id;item.append(proof);outcomes.append(item)}
  section.append(outcomes);
  if(snapshot.curated){const c=snapshot.curated,details=node('details',undefined,'status-curated'+(c.stale?' is-stale':''));details.dataset.statusKey='curated';details.append(node('summary',c.stale?'以前の状況記録（新しい活動あり）':'状況の補足記録'));if(c.stale)details.append(node('p','この記録の後に活動があります。現在の状況は上のタスク・結果で確認してください。','status-caution'));for(const [key,label]of [['summary','要約'],['achievement','確認できたこと'],['blocker','課題'],['next','次の一手']])if(c[key]){details.append(node('h4',label),node('p',plain(c[key])))}details.append(node('p','状況の確認 '+formatTime(c.observedAt)+' · 保存 '+formatTime(c.recordedAt)+' · 記録版 '+String(c.revision),'verified'),evidence(c.evidence));section.append(details)}
  section.append(node('p','個別タスク・結果の記録から表示しています。プロジェクト全体の完了を意味するものではありません。','status-scope-note'));
  area.replaceChildren(section);recordSignatures.set(area,signature);
  for(const el of area.querySelectorAll('details[data-status-key]'))el.open=opened.has(el.dataset.statusKey);
  if(focusKey)for(const el of area.querySelectorAll('[data-status-focus]'))if(el.dataset.statusFocus===focusKey)el.focus({preventScroll:true});
 }
 function syncText(entry){
  if(!entry.snapshot)return entry.error==='sign_in_required'?'サインイン状態を確認できません。ページを開き直してください。':entry.error?'最新状況を取得できません。「状況を更新」で再確認してください。':'サーバーの状況を取得中…';
  const checked='取得確認 '+formatTime(entry.snapshot.checkedAt);
  if(entry.error)return '更新に失敗しました。前回取得した情報です · '+checked;
  if(isStale(entry,now()))return '再確認が必要です。前回取得した情報です · '+checked;
  return checked+(entry.loading?' · 更新中…':'');
 }
 function draw(){
  if(disposed)return;
  for(const root of roots){const entry=entries.get(root.dataset.liveStatus);if(!entry)continue;const snapshot=entry.snapshot,stale=isStale(entry,now());root.dataset.statusFreshness=stale?'unconfirmed':'current';if(root.dataset.projectCard){root.className='card status-'+(stale?'unconfirmed':snapshot.state)}root.setAttribute('aria-busy',String(entry.loading));setText(root,'[data-status-sync]',syncText(entry));
   setText(root,'[data-status-headline]',snapshot?plain(snapshot.headline,'現在の状況は未確認です'):entry.error?'最新状況を取得できません':'現在の状況を取得中…');
   setText(root,'[data-status-blocker]',snapshot?plain(snapshot.blocker,'課題の記録はありません'):entry.error?'取得を再試行して、現在の課題を確認してください':'最新のタスク・結果を確認しています');
   setText(root,'[data-status-next]',snapshot?plain(snapshot.next,'会話から次に確認する内容を依頼できます'):'状況の取得後に表示します');
   if(snapshot){setText(root,'[data-status-times]','最新の活動 '+formatTime(snapshot.activityUpdatedAt)+' · 最新の根拠 '+formatTime(snapshot.latestEvidenceAt));const c=snapshot.counts;setText(root,'[data-status-counts]','タスク・サブタスク 全 '+c.total+'件 · 実行待ち '+c.queued+' · 開始準備・作業・検証 '+c.active+' · 確認待ち '+c.waiting+' · 停止・失敗 '+c.failed+' · 実作業の完了未確認 '+c.unfinished+' · 実作業の完了確認 '+c.verifiedCompleted+' · 根拠未確認 '+c.unverified);drawRecords(root,snapshot)}else{setText(root,'[data-status-times]','');setText(root,'[data-status-counts]','');const area=root.querySelector('[data-status-records]');if(area&&area.children.length)area.replaceChildren()}
  }
  for(const el of badges){const entry=entries.get(el.dataset.statusBadge);if(!entry)continue;const stale=isStale(entry,now()),state=stale?'unconfirmed':entry.snapshot.state;el.className='badge status-'+state;el.textContent=stale?(entry.snapshot?'要再確認':'未確認'):plain(entry.snapshot.label,STATES[state]);el.title=syncText(entry)}
  for(const el of dots){const entry=entries.get(el.dataset.statusDot);if(!entry)continue;el.className='dot status-'+(isStale(entry,now())?'unconfirmed':entry.snapshot.state)}
  for(const button of buttons)button.disabled=button.dataset.statusRefresh?!!entries.get(button.dataset.statusRefresh)?.loading:ids.some(id=>entries.get(id).loading);
  if(legend){const counts=countStates(entries,ids,now()),signature=JSON.stringify(counts);if(signature!==legendSignature){legendSignature=signature;legend.replaceChildren();for(const [state,label]of Object.entries(STATES)){const item=node('span'),dot=node('i',undefined,'dot status-'+state);dot.setAttribute('aria-hidden','true');item.append(dot,node('span',label+' '+counts[state]));legend.append(item)}}}
  if(sync){const fresh=ids.filter(id=>!isStale(entries.get(id),now())).length,loading=ids.some(id=>entries.get(id).loading),times=ids.map(id=>timestamp(entries.get(id).snapshot?.checkedAt)).filter(x=>x!==null);sync.textContent=(loading?'状況を更新中… · ':'')+fresh+'/'+ids.length+' プロジェクトを取得確認'+(fresh<ids.length?' · '+(ids.length-fresh)+'件は未確認・要再確認':'')+(times.length?' · 最終取得 '+formatTime(new Date(Math.max(...times)).toISOString()):'')}
 }
 async function refresh(projectId){
  if(disposed||doc.hidden)return;
  const selected=projectId&&known.has(projectId)?[projectId]:ids;if(projectId&&!known.has(projectId))return;
  const versions=new Map();for(const id of selected){const entry=entries.get(id);entry.version++;versions.set(id,entry.version);entry.loading=true}draw();
  const controller=new AbortController();controllers.add(controller);const timeout=later(()=>controller.abort(),12000);
  try{
   const response=await request(projectId?'/api/projects/'+encodeURIComponent(projectId)+'/status':'/api/project-status',{method:'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal});
   if(!response.ok)throw Error(response.status===401?'sign_in_required':'status_unavailable');
   const payload=await response.json(),snapshots=projectId?[payload]:payload?.projects;if(!Array.isArray(snapshots))throw Error('invalid_status');const received=new Map();for(const snapshot of snapshots){if(selected.includes(snapshot?.projectId)){if(received.has(snapshot.projectId))throw Error('invalid_status');received.set(snapshot.projectId,snapshot)}}
   for(const id of selected){const entry=entries.get(id);if(disposed||entry.version!==versions.get(id))continue;try{const snapshot=validateSnapshot(received.get(id),id);if(entry.snapshot&&timestamp(snapshot.checkedAt)<timestamp(entry.snapshot.checkedAt))throw Error('outdated_status');entry.snapshot=snapshot;entry.error=null}catch(error){entry.error=error.message}}
  }catch(error){for(const id of selected){const entry=entries.get(id);if(!disposed&&entry.version===versions.get(id))entry.error=error.message||'status_unavailable'}}
  finally{cancel(timeout);controllers.delete(controller);for(const id of selected){const entry=entries.get(id);if(entry.version===versions.get(id))entry.loading=false}draw()}
 }
 function listen(target,type,handler){target.addEventListener(type,handler);listeners.push([target,type,handler])}
 function visibleRefresh(){if(!doc.hidden){draw();refresh()}}
 for(const button of buttons)listen(button,'click',()=>refresh(button.dataset.statusRefresh||undefined));
 for(const disclosure of doc.querySelectorAll('[data-status-disclosure]'))listen(disclosure,'toggle',()=>{if(disclosure.open)refresh(disclosure.dataset.statusDisclosure)});
 listen(win,'focus',visibleRefresh);listen(win,'pageshow',visibleRefresh);listen(doc,'visibilitychange',visibleRefresh);
 listen(win,'project-data-updated',event=>{const id=event.detail?.projectId;if(!known.has(id))return;changedProjects.add(id);cancel(changeTimer);changeTimer=later(()=>{changeTimer=null;for(const project of changedProjects)refresh(project);changedProjects.clear()},250)});
 const timer=repeat(visibleRefresh,30000);refresh();
 return {refresh,entries,draw,destroy(){disposed=true;cancel(changeTimer);stop(timer);for(const controller of controllers)controller.abort();for(const [target,type,handler]of listeners)target.removeEventListener?.(type,handler)}};
}
if(typeof module!=='undefined'&&module.exports)module.exports={STATES,STALE_MS,taskLabel,safeTaskHash,validateSnapshot,isStale,countStates,formatTime,mount};
if(typeof document!=='undefined'&&typeof window!=='undefined')mount({document,window});
})();
