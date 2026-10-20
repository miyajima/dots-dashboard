// Independent offline UI contracts; never contacts the deployed Site.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test'),crypto=require('node:crypto').webcrypto;
const source=fs.readFileSync(process.argv[2]||require('node:path').join(__dirname,'project-workspace.js'),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
const defer=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject}};
const flat=n=>[n,...n.children.flatMap(flat)];
const stamp='2026-10-08T01:00:00Z';
const message=(id,author='user',text='Fixture '+id)=>({id,author,text,created_at:stamp});
const history=()=>Array.from({length:10},(_,i)=>message('m'+i,i%2?'dot':'user'));
const result=(overrides={})=>({id:'r1',status:'published',kind:'work',summary:'Verified bounded change',sourceMessageId:'m0',replyMessageId:'m8',replyText:'Actual full reply',observedAt:'2026-10-08T01:20:00Z',evidence:['Read-only synthetic verification'],...overrides});
function fixture(options={}){
 let document;
 const eventBase=()=>({events:{},addEventListener(k,f){(this.events[k]??=[]).push(f)},removeEventListener(k,f){this.events[k]=(this.events[k]||[]).filter(x=>x!==f)},emit(k,event={}){return Promise.all((this.events[k]||[]).map(f=>f({target:this,preventDefault(){},stopPropagation(){},...event})))}});
 class E{
  constructor(tag){Object.assign(this,eventBase());this.tag=tag;this.children=[];this.attrs={};this.dataset={};this.value='';this._top=0;this.hidden=false;this.disabled=false;this.style={setProperty(k,v){this[k]=v},removeProperty(k){delete this[k]}};this.scrollEvents=[]}
  append(...nodes){for(const n of nodes){if(n.parent)n.parent.children=n.parent.children.filter(x=>x!==n);n.parent=this;this.children.push(n)}}
  replaceChildren(...nodes){for(const n of this.children)n.parent=null;this.children=[];this.append(...nodes)}
  setAttribute(k,v){this.attrs[k]=String(v);if(k==='tabindex')this.tabIndex=Number(v)}
  getAttribute(k){return this.attrs[k]??null}
  removeAttribute(k){delete this.attrs[k]}
  closest(selector){let n=this;while(n){if(selector==='[hidden]'&&n.hidden)return n;n=n.parent}return null}
  contains(n){return flat(this).includes(n)}
  querySelector(){return null}
  querySelectorAll(s){return s==='button'?flat(this).filter(n=>n.tag==='button'):[]}
  focus(options){document.activeElement=this;this.focusOptions=options}
  scrollIntoView(options){this.scrollEvents.push(options)}
  click(){return this.disabled?undefined:this.emit('click')}
  get hiddenAncestor(){let n=this;while(n){if(n.hidden)return true;n=n.parent}return false}
  get scrollHeight(){return this.hiddenAncestor?0:this.className==='chat-messages'?this.children.length*100:240}
  get clientHeight(){return this.hiddenAncestor?0:160}
  get scrollTop(){return this._top}
  set scrollTop(v){this._top=Math.max(0,Math.min(v,Math.max(0,this.scrollHeight-this.clientHeight)))}
  getBoundingClientRect(){if(this.className==='chat-messages')return{top:0,bottom:160,left:0,right:600,width:600,height:160};if(this.parent?.className==='chat-messages'){const i=this.parent.children.indexOf(this);return{top:i*100-this.parent.scrollTop,bottom:(i+1)*100-this.parent.scrollTop,left:0,right:500,width:500,height:100}}return{top:600,bottom:720,left:12,right:378,width:366,height:120}}
  setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b}
  requestSubmit(){return this.emit('submit')}
 }
 document={...eventBase(),createElement:t=>new E(t),activeElement:null,hidden:false};
 const root=new E('root'),calls=[],pendingTimers=new Map(),clearedIntervals=[];let timerId=0;
 const response=(data,status=200)=>({ok:status===200,status,json:async()=>structuredClone(data)});
 const request=async(path,o={})=>{const resource=path.split('/').at(-1);calls.push({resource,method:o.method});if(o.method!=='GET')throw Error('Unexpected external mutation');const index=calls.filter(x=>x.resource===resource).length;if(options.onRequest){const r=options.onRequest(resource,index);if(r!==undefined)return r}return response(resource==='composer-config'?{files:{available:true,maxBytes:8388608,maxAttachments:5}}:resource==='notification-status'?{notification:{state:'ready'}}:{data:resource==='messages'?(options.messages||[]):resource==='tasks'?(options.tasks||[]):[]})};
 const window={...eventBase(),innerHeight:844,innerWidth:390,visualViewport:{...eventBase(),height:844,offsetTop:0,offsetLeft:0,width:390}};
 const ctx={document,window,fetch:request,AbortController,crypto,console,Date,setTimeout,clearTimeout,setInterval:f=>{const id=++timerId;pendingTimers.set(id,f);return id},clearInterval:id=>{pendingTimers.delete(id);clearedIntervals.push(id)},URL:{createObjectURL(){throw Error('No uploads expected')},revokeObjectURL(){}}};
 vm.runInNewContext(source.replace('export function','function')+'\nthis.mount=mountProjectWorkspace;',ctx);
 const workspace=ctx.mount(root,'orgbrain',{connected:options.connected??true,request});
 const all=()=>flat(root),find=fn=>all().find(fn),byClass=name=>find(n=>n.className===name),byMessage=id=>find(n=>n.dataset.messageId===id),texts=n=>flat(n||root).map(x=>x.textContent||'').join('\n');
 return{root,window,document,workspace,calls,response,pendingTimers,clearedIntervals,all,find,byClass,byMessage,texts,options};
}
const use=async(t,options)=>{const f=fixture(options);t.after(()=>f.workspace.destroy());await tick();return f};

test('successful messages render even when tasks fail, preserving partial-failure status',async t=>{
 const options={messages:history(),onRequest:(r)=>r==='tasks'?Promise.reject(Error('Synthetic task failure')):undefined};const f=await use(t,options);
 assert.equal(f.byClass('chat-messages').children.length,10);assert.match(f.byClass('workspace-status').textContent,/会話は更新済み.*タスクの更新に失敗/);
 options.messages.push(message('fresh','dot'));await f.workspace.refresh();assert(f.byMessage('fresh'));assert.equal(f.calls.filter(x=>x.method!=='GET').length,0);
});

test('refreshes during an inflight request collapse into a trailing refresh with newer rows',async t=>{
 const blocked=defer();const options={messages:history(),onRequest:(r,n)=>r==='messages'&&n===2?blocked.promise:undefined};const f=await use(t,options);
 const first=f.workspace.refresh();await tick();await f.workspace.refresh();await f.workspace.refresh();assert.equal(f.calls.filter(x=>x.resource==='messages').length,2);
 options.messages.push(message('after-request','dot'));blocked.resolve(f.response({data:history()}));await first;await tick();
 assert.equal(f.calls.filter(x=>x.resource==='messages').length,3);assert(f.byMessage('after-request'));assert(!f.find(n=>n.tag==='button'&&n.textContent==='更新').disabled);
});

test('new-reply cue retains reading position and original DOM; latest button explicitly follows tail',async t=>{
 const options={messages:history()};const f=await use(t,options),messages=f.byClass('chat-messages'),cue=f.byClass('chat-new-replies');
 assert.equal(messages.scrollTop,840);messages.scrollTop=200;await messages.emit('scroll');const old=f.byMessage('m2');assert.equal(cue.textContent,'最新へ');
 options.messages.push(message('fresh','dot'));await f.workspace.refresh();assert.equal(messages.scrollTop,200);assert.equal(f.byMessage('m2'),old);assert.equal(cue.hidden,false);assert.match(cue.textContent,/新しい返信・結果 1件を見る/);assert.equal(f.document.activeElement,null);
 await cue.click();assert.equal(messages.scrollTop,940);assert.equal(cue.hidden,true);assert.equal(f.document.activeElement,f.byMessage('fresh'));assert.equal(f.byMessage('fresh').focusOptions.preventScroll,true);messages.scrollTop=200;await messages.emit('scroll');assert.equal(cue.textContent,'最新へ');await cue.click();assert.equal(messages.scrollTop,940);assert.equal(f.document.activeElement,messages);
});

test('explicit report link selects and focuses the exact reply with no unrelated navigation',async t=>{
 const rows=history();rows[0].requestResult=result();rows[8]={...message('m8','dot','Actual full reply'),requestResult:result()};const f=await use(t,{messages:rows});
 const messages=f.byClass('chat-messages');messages.scrollTop=100;await messages.emit('scroll');const target=f.byMessage('m8');assert.equal(target.getAttribute('data-result-selected'),null);
 const link=flat(f.byMessage('m0')).find(n=>n.tag==='button'&&n.textContent==='報告を見る');await link.click();assert.equal(messages.scrollTop,788);assert.equal(target.getAttribute('data-result-selected'),'true');assert.equal(f.document.activeElement,target);assert.equal(target.focusOptions.preventScroll,true);assert.equal(f.byClass('project-chat').hidden,false);
});

test('new result re-renders its older source, dated completion stays separate from verifying umbrella and receipt',async t=>{
 const rows=history(),task={id:'task1',title:'Umbrella',scope:'ongoing',source_message_id:'m0',state:'verifying',action:'proposed',priority:50,dependencies:[],created_at:stamp,updated_at:'2026-10-08T01:20:00Z',externalProgress:{state:'verifying',observedAt:'2026-10-08T01:20:00Z',summary:'Still checking',evidence:['fixture'],externalTaskRef:'offline'}};
 rows[0].receipt={dotReplyId:'m1',dotRepliedAt:'2026-10-08T01:01:00Z'};const options={messages:rows,tasks:[task]},f=await use(t,options),messages=f.byClass('chat-messages');messages.scrollTop=200;await messages.emit('scroll');const prior=f.byMessage('m0');
 options.messages=structuredClone(rows);options.messages[0].requestResult=result();options.messages[8]={...message('m8','dot'),requestResult:result()};await f.workspace.refresh();const current=f.byMessage('m0');
 assert.notEqual(current,prior);assert.equal(messages.scrollTop,200);const resultLink=flat(current).find(n=>n.className==='message-result-link');assert.equal(resultLink.textContent,'報告を見る');assert.match(resultLink.title,/反映済み/);assert(!f.texts(current).includes('この依頼：'));assert.match(f.texts(current),/関連タスク：検証中/);assert.match(f.texts(current),/dot受信済み/);assert.match(resultLink.title,/10:20/);assert.equal(options.messages[0].requestResult.observedAt,result().observedAt);assert.equal(options.tasks[0].state,'verifying');assert.match(f.byClass('chat-new-replies').textContent,/新しい返信・結果 1件を見る/);
});

test('prose completion and acknowledged receipt never invent per-request result',async t=>{
 const rows=[{...message('request'),receipt:{dotReplyId:'ack',dotRepliedAt:stamp}},message('ack','dot','受け取りました。対応完了、公開済み、検証完了という文字列が本文にあるだけです。')];const f=await use(t,{messages:rows});assert(!f.byClass('message-result-link'));assert(!f.byClass('message-result-label'));assert.match(f.texts(),/dot受信済み/);
});

test('plan completion and report completion labels are scoped without claiming implementation',async t=>{
 const plan=result({id:'plan',status:'completed',kind:'plan',sourceMessageId:'p',replyMessageId:'plan-reply'}),report=result({id:'report',status:'completed',kind:'report',sourceMessageId:'q',replyMessageId:'report-reply'});
 const rows=[{...message('p'),metadata:{mode:'plan_only'},requestResult:plan},{...message('plan-reply','dot'),requestResult:plan},{...message('q'),requestResult:report},{...message('report-reply','dot'),requestResult:report}];const f=await use(t,{messages:rows});const planLink=flat(f.byMessage('p')).find(n=>n.className==='message-result-link');assert.match(planLink.title,/計画完了/);assert.equal(planLink.textContent,'報告を見る');assert.match(f.texts(f.byMessage('p')),/計画のみ・実行しない/);assert(!f.byClass('message-result-label'));const reportLink=flat(f.byMessage('q')).find(n=>n.className==='message-result-link');assert.equal(reportLink.textContent,'回答を見る');assert.match(reportLink.title,/回答完了/);assert(!/反映済み|対応完了/.test(f.texts()));
});

test('off-window reply remains readable as full-text fallback and evidence',async t=>{
 const f=await use(t,{messages:[{...message('m0'),requestResult:result({replyMessageId:'outside-200',replyText:'Full archived response outside the loaded window'})}]});assert.match(f.texts(),/報告を見る/);assert.match(f.texts(),/Full archived response outside the loaded window/);assert(!f.byClass('message-result'));assert(!f.byClass('message-result-label'));assert(!f.find(n=>n.tag==='button'&&n.textContent==='報告を見る'));
});

test('pageshow and visible return refresh; hidden visibility skips; destroy removes observers and polling',async t=>{
 const f=await use(t,{messages:history()});const count=()=>f.calls.filter(x=>x.resource==='messages').length;assert.equal(count(),1);await f.window.emit('pageshow');await tick();assert.equal(count(),2);f.document.hidden=true;await f.document.emit('visibilitychange');await tick();assert.equal(count(),2);f.document.hidden=false;await f.document.emit('visibilitychange');await tick();assert.equal(count(),3);
 f.workspace.destroy();for(const key of ['focus','hashchange','pageshow','resize'])assert.equal(f.window.events[key]?.length||0,0);for(const key of ['pointerdown','visibilitychange'])assert.equal(f.document.events[key]?.length||0,0);for(const key of ['resize','scroll'])assert.equal(f.window.visualViewport.events[key]?.length||0,0);assert.equal(f.pendingTimers.size,0);await f.window.emit('pageshow');await f.document.emit('visibilitychange');await tick();assert.equal(count(),3);
});

test('destroy during inflight refresh ignores fetched message rows and queued trailing work',async t=>{
 const block=defer();const options={messages:history(),onRequest:(r,n)=>r==='messages'&&n===2?block.promise:undefined};const f=await use(t,options);const running=f.workspace.refresh();await tick();await f.workspace.refresh();f.workspace.destroy();block.resolve(f.response({data:[message('never-render','dot')]}));await running;await tick();assert(!f.byMessage('never-render'));assert.equal(f.calls.filter(x=>x.resource==='messages').length,2);
});


test('late annotation cue jumps to the older stored reply instead of skipping to latest',async t=>{
 const options={messages:history()};const f=await use(t,options),messages=f.byClass('chat-messages');messages.scrollTop=500;await messages.emit('scroll');
 const r=result({sourceMessageId:'m0',replyMessageId:'m1'});options.messages=structuredClone(options.messages);options.messages[0].requestResult=r;options.messages[1].requestResult=r;
 await f.workspace.refresh();assert.equal(messages.scrollTop,500);const cue=f.byClass('chat-new-replies');assert.match(cue.textContent,/新しい返信・結果 1件を見る/);await cue.click();assert.equal(messages.scrollTop,88);assert.equal(f.document.activeElement,f.byMessage('m1'));assert.equal(f.byMessage('m1').getAttribute('data-result-selected'),'true');assert.equal(cue.hidden,false);assert.equal(cue.textContent,'最新へ');await cue.click();assert.equal(messages.scrollTop,840);assert.equal(cue.hidden,true);
});

test('several pending replies are offered chronologically without double counting result annotations',async t=>{
 const options={messages:history()};const f=await use(t,options),messages=f.byClass('chat-messages');messages.scrollTop=300;await messages.emit('scroll');
 const r=result({sourceMessageId:'m0',replyMessageId:'m1'});options.messages=structuredClone(options.messages);options.messages[0].requestResult=r;options.messages[1].requestResult=r;options.messages.push(message('fresh','dot'));
 await f.workspace.refresh();const cue=f.byClass('chat-new-replies');assert.match(cue.textContent,/2件/);await cue.click();assert.equal(f.document.activeElement,f.byMessage('m1'));assert.match(cue.textContent,/1件/);await cue.click();assert.equal(f.document.activeElement,f.byMessage('fresh'));assert.equal(cue.hidden,true);
});

test('late result on an older stored reply stays discoverable when already reading latest',async t=>{
 const options={messages:history()};const f=await use(t,options),messages=f.byClass('chat-messages');assert.equal(messages.scrollTop,840);
 const r=result({sourceMessageId:'m0',replyMessageId:'m1'});options.messages=structuredClone(options.messages);options.messages[0].requestResult=r;options.messages[1].requestResult=r;
 await f.workspace.refresh();assert.equal(messages.scrollTop,840);assert.equal(f.byClass('chat-new-replies').hidden,false,'A late result on an offscreen older report needs a cue even though reader is at tail');
});

test('late result on a visible reply heading does not add a redundant cue at latest',async t=>{
 const options={messages:history()};const f=await use(t,options),messages=f.byClass('chat-messages');const r=result({sourceMessageId:'m0',replyMessageId:'m9'});options.messages=structuredClone(options.messages);options.messages[0].requestResult=r;options.messages[9].requestResult=r;
 await f.workspace.refresh();assert.equal(messages.scrollTop,840);assert.equal(f.byClass('chat-new-replies').hidden,true);
});

test('pre-existing offscreen results do not count as unread on first load',async t=>{
 const rows=history(),r=result({sourceMessageId:'m0',replyMessageId:'m1'});rows[0].requestResult=r;rows[1].requestResult=r;const f=await use(t,{messages:rows});assert.equal(f.byClass('chat-new-replies').hidden,true);
});

test('late older result survives a tail scroll event and refresh until explicitly read',async t=>{
 const options={messages:history()};const f=await use(t,options),messages=f.byClass('chat-messages');const r=result({sourceMessageId:'m0',replyMessageId:'m1'});options.messages=structuredClone(options.messages);options.messages[0].requestResult=r;options.messages[1].requestResult=r;
 await f.workspace.refresh();await messages.emit('scroll');await f.workspace.refresh();const cue=f.byClass('chat-new-replies');assert.equal(cue.hidden,false);assert.match(cue.textContent,/1件/);await cue.click();assert.equal(f.document.activeElement,f.byMessage('m1'));assert.equal(messages.scrollTop,88);assert.equal(cue.textContent,'最新へ');
});
