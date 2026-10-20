// Independent offline-only session regression review; no network and no checkout writes.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test'),crypto=require('node:crypto').webcrypto;
const sourcePath=require('node:path').resolve(process.env.DASHBOARD_REVIEW_ROOT||require('node:path').join(__dirname,'..'),'project-workspace.js');
const source=fs.readFileSync(sourcePath,'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
const settle=async()=>{await tick();await tick();await tick()};
const defer=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject}};
const flat=n=>[n,...n.children.flatMap(flat)],stamp='2026-10-08T01:00:00Z';
const msg=(id,author='user')=>({id,author,text:'Fixture '+id,created_at:stamp});
const history=s=>Array.from({length:10},(_,i)=>msg(s+'_'+i,i%2?'dot':'user'));
const task=(id,sessionId)=>({id,sessionId,sessionTitle:sessionId,title:'Task '+id,state:'queued',scope:'Read-only fixture',created_at:stamp,updated_at:stamp,priority:1,priority_reason:'Fixture',revision:1});
const sessions=[{id:'general',title:'一般',purpose:'conversation'},{id:'session_A',title:'Topic A',purpose:'conversation'},{id:'session_B',title:'Topic B',purpose:'conversation'},{id:'session_H',title:'History H',purpose:'history'}];
function fixture(options={}){
 let document;
 const base=()=>({events:{},addEventListener(k,f){(this.events[k]??=[]).push(f)},removeEventListener(k,f){this.events[k]=(this.events[k]||[]).filter(x=>x!==f)},async emit(k,event={}){const e={type:k,target:this,currentTarget:this,prevented:false,preventDefault(){this.prevented=true},stopPropagation(){},...event};await Promise.all((this.events[k]||[]).map(f=>f(e)));return e}});
 class E{
  constructor(tag){Object.assign(this,base());this.tag=tag;this.children=[];this.attrs={};this.dataset={};this.value='';this._top=0;this.hidden=false;this.disabled=false;this.style={setProperty(k,v){this[k]=v},removeProperty(k){delete this[k]}};this.scrollEvents=[]}
  append(...nodes){for(const n of nodes){if(n.parent)n.parent.children=n.parent.children.filter(x=>x!==n);n.parent=this;this.children.push(n)}}
  replaceChildren(...nodes){if(this.children.some(n=>n.contains(document.activeElement)))document.activeElement=null;for(const n of this.children)n.parent=null;this.children=[];this.append(...nodes)}
  get disabled(){return this._disabled||false}set disabled(value){this._disabled=!!value;if(value&&document?.activeElement===this)document.activeElement=null}
  get hidden(){return this._hidden||false}set hidden(value){this._hidden=!!value;if(value&&this.contains(document?.activeElement))document.activeElement=null}
  setAttribute(k,v){this.attrs[k]=String(v);if(k==='tabindex')this.tabIndex=Number(v)}
  getAttribute(k){return this.attrs[k]??null}removeAttribute(k){delete this.attrs[k]}
  closest(s){let n=this;while(n){if(s==='[hidden]'&&n.hidden)return n;n=n.parent}return null}
  contains(n){return flat(this).includes(n)}querySelector(){return null}querySelectorAll(s){return s==='button'?flat(this).filter(n=>n.tag==='button'):[]}
  focus(options){if(this.disabled||this.hiddenAncestor)return;document.activeElement=this;this.focusOptions=options}blur(){document.activeElement=null}scrollIntoView(options){this.scrollEvents.push(options)}
  click(){return this.disabled?undefined:this.emit('click')}
  get hiddenAncestor(){let n=this;while(n){if(n.hidden||n.inert||(n.tag==='details'&&!n.open&&n!==this&&this.tag!=='summary'))return true;n=n.parent}return false}
  get scrollHeight(){return this.hiddenAncestor?0:this.className==='chat-messages'?this.children.length*100:240}
  get clientHeight(){return this.hiddenAncestor?0:160}
  get scrollTop(){return this._top}set scrollTop(v){this._top=Math.max(0,Math.min(v,Math.max(0,this.scrollHeight-this.clientHeight)))}
  getBoundingClientRect(){if(this.hiddenAncestor)return{top:0,bottom:0,left:0,right:0,width:0,height:0};if(this.className==='chat-messages')return{top:0,bottom:160,left:0,right:600,width:600,height:160};if(this.parent?.className==='chat-messages'){const i=this.parent.children.indexOf(this);return{top:i*100-this.parent.scrollTop,bottom:(i+1)*100-this.parent.scrollTop,left:0,right:500,width:500,height:100}}return{top:600,bottom:720,left:12,right:378,width:366,height:120}}
  setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b}requestSubmit(){return this.emit('submit')}
 }
 document={...base(),createElement:t=>new E(t),activeElement:null,hidden:false};
 const root=new E('root'),navRoot=new E('div'),navAdd=new E('button'),appRoot=new E('root');appRoot.append(navAdd,navRoot,root);const serverSessions=structuredClone(options.sessions||sessions).map(s=>({...s,visibility:s.visibility||{hidden:false,revision:0,updatedAt:null}}));const calls=[],timers=new Map(),created=[],revoked=[];let timerId=0;
 const response=(data,status=200)=>({ok:status<400,status,headers:{get:()=>options.responseOwner||options.cacheOwner||null},json:async()=>structuredClone(data)});
 const request=async(path,o={})=>{const parsed=new URL(path,'https://fixture.test'),resource=parsed.pathname.split('/').at(-1),sessionId=parsed.searchParams.get('sessionId')||'general',body=o.method==='POST'&&resource!=='files'?JSON.parse(o.body):o.body,call={path,resource,sessionId,method:o.method||'GET',body,signal:o.signal,headers:o.headers};calls.push(call);if(options.onRequest){const r=options.onRequest(call,calls);if(r!==undefined)return r}if(resource==='session-cache-context')return response({ownerKey:options.responseOwner||options.cacheOwner});if(resource==='session-visibility'){const s=serverSessions.find(s=>s.id===body.sessionId);if(body.expectedRevision!==s.visibility.revision)return response({error:'revision_conflict',data:serverSessions},409);s.visibility={hidden:body.hidden,revision:s.visibility.revision+1,updatedAt:stamp};return response({data:serverSessions})}if(resource==='sessions'){if(call.method==='GET')return response({data:serverSessions});const session={id:'session_new_'+serverSessions.length,title:body.title,purpose:'conversation',visibility:{hidden:false,revision:0,updatedAt:null}};serverSessions.push(session);return response({data:session})}if(resource==='files')return response({attachment:{id:'file_'+calls.filter(c=>c.resource==='files').length}});if(call.method==='POST')return response(resource==='messages'?{message:{id:'saved_'+calls.length},notification:{state:'accepted'}}:{task:{id:'task_saved'},notification:{state:'accepted'}});return response(resource==='composer-config'?{files:{available:true,maxBytes:8388608,maxAttachments:5}}:resource==='notification-status'?{notification:{state:'ready'}}:{data:resource==='messages'?(options.messages?.[sessionId]||history(sessionId)):resource==='tasks'?(options.tasks||[]):[]})};
 const customEvents=[];const window={...base(),innerHeight:844,innerWidth:390,scrollTo(){},visualViewport:{...base(),height:844,offsetTop:0,offsetLeft:0,width:390}},location={hash:options.hash||'#project/orgbrain'},routeHistory=[];
 window.dispatchEvent=event=>{customEvents.push(event);window.emit(event.type,event);return true};const ctx={CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail}},document,window,location,history:{pushState(a,b,hash){location.hash=hash;routeHistory.push(hash)}},fetch:request,AbortController,crypto,console,Date:options.Date||Date,setTimeout,clearTimeout,setInterval:f=>{const id=++timerId;timers.set(id,f);return id},clearInterval:id=>timers.delete(id),URL:{createObjectURL(f){const url='blob:fixture-'+created.length;created.push(url);return url},revokeObjectURL(url){revoked.push(url)}}};
 vm.runInNewContext(source.replace('export function','function')+'\nthis.mount=mountProjectWorkspace;',ctx);const workspace=ctx.mount(root,'orgbrain',{connected:true,request,cacheOwner:options.cacheOwner,storage:options.storage,navigationRoot:navRoot,addSessionButton:navAdd,onRouteChange:options.onRouteChange,onSessionNavigate:options.onSessionNavigate});
 const find=(fn,n=appRoot)=>flat(n).find(fn),byClass=(c,n=appRoot)=>find(x=>x.className===c,n),pane=id=>find(n=>n.className==='session-workspace'&&n.dataset.sessionId===id),input=id=>find(n=>n.id==='compose-orgbrain'+(id==='general'?'':'--'+id)),selector=find(n=>n.getAttribute('aria-label')==='会話のセッション');
 const change=async id=>{selector.value=id;await selector.emit('change');await settle()},text=async(id,value)=>{const n=input(id);n.value=value;n.setSelectionRange(value.length,value.length);await n.emit('input')},menuButton=(id,label)=>find(n=>n.tag==='button'&&n.children.some(c=>c.textContent===label),pane(id)),paste=async(id,name='a.png')=>{const f={name,size:20,type:'image/png'};await input(id).emit('paste',{clipboardData:{items:[{kind:'file',type:f.type,getAsFile:()=>f}],getData:()=>''}});await settle()};
 return{root,appRoot,navRoot,navAdd,serverSessions,window,document,location,routeHistory,workspace,calls,response,timers,customEvents,created,revoked,find,byClass,pane,input,selector,change,text,menuButton,paste};
}

module.exports={fixture,flat,settle,tick,defer,msg,history,task,sessions};
