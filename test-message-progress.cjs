// Independent, offline-only DOM contract tests. Never sends requests to a deployed Site.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto').webcrypto;
const path = require('node:path');
const sourcePath = process.argv[2] || [path.join(__dirname, 'project-workspace.js'), path.join(__dirname, 'dot-project-dashboard/project-workspace.js')].find(fs.existsSync);
assert(sourcePath, 'Pass project-workspace.js path as the first argument');
const source = fs.readFileSync(sourcePath, 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function fixture(options={}) {
 let document;
 class E {
  constructor(tag) { this.tag=tag; this.children=[]; this.events={}; this.attrs={}; this.dataset={}; this.value=''; this.hidden=false; this.disabled=false; this.scrollHeight=240; this.clientHeight=160; this.scrollTop=80; this.style={setProperty(k,v){this[k]=v},removeProperty(k){delete this[k]}}; }
  append(...nodes) { for(const node of nodes) { if(node.parent)node.parent.children=node.parent.children.filter(n=>n!==node);node.parent=this;this.children.push(node); } }
  replaceChildren(...nodes) { for(const child of this.children)child.parent=null;this.children=[];this.append(...nodes); }
  setAttribute(k,v) { this.attrs[k]=String(v); if(k==='tabindex')this.tabIndex=Number(v); }
  getAttribute(k) { return this.attrs[k]??null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(k,fn) { (this.events[k]??=[]).push(fn); }
  removeEventListener(k,fn) { this.events[k]=(this.events[k]||[]).filter(f=>f!==fn); }
  async emit(k,props={}) { const e={target:this,currentTarget:this,key:'',prevented:false,preventDefault(){this.prevented=true},stopPropagation(){this.stopped=true},...props};let current=this;while(current){e.currentTarget=current;for(const fn of current.events[k]||[])await fn(e);if(e.stopped)break;current=current.parent}return e; }
  click() { if(!this.disabled)return this.emit('click'); }
  focus() { document.activeElement=this; }
  blur() { if(document.activeElement===this)document.activeElement=null; }
  getBoundingClientRect() { return {top:this.className==='message-composer'?600:80,bottom:720,left:12,right:378,width:366,height:120}; }
  closest() { return null; }
  contains(node) { return flat(this).includes(node); }
  querySelector() { return null; }
  querySelectorAll(selector) { return selector==='button'?flat(this).filter(n=>n.tag==='button'):[]; }
  setSelectionRange(a,b) { this.selectionStart=a;this.selectionEnd=b; }
  scrollIntoView() {}
  requestSubmit() { return this.emit('submit'); }
 }
 const flat=node=>[node,...node.children.flatMap(flat)];
 document={createElement:tag=>new E(tag),activeElement:null,hidden:false,events:{},addEventListener(k,fn){(this.events[k]??=[]).push(fn)},removeEventListener(k,fn){this.events[k]=(this.events[k]||[]).filter(f=>f!==fn)}};
 const root=new E('root'),uploads=[],posts=[],created=[],revoked=[];
 const response=data=>({ok:true,status:200,json:async()=>data});
 const request=async(path,o={})=>{
  if(path.endsWith('/files')) { const record={path,...o};uploads.push(record);return options.upload?options.upload(record,uploads.length):response({attachment:{id:'file_local_'+uploads.length}}); }
  if(path.endsWith('/composer-config'))return response({files:{available:options.available??true,maxBytes:options.maxBytes??8388608,maxAttachments:options.maxFiles??5}});
  if(path.endsWith('/notification-status'))return response({notification:{state:'ready'}});
  if(path.endsWith('/messages')&&o.method==='POST'){const body=JSON.parse(o.body);posts.push(body);return options.post?options.post(body,posts.length):response({message:{id:'message_local_'+posts.length},notification:{state:'accepted'}});}
  return response({data:path.endsWith('/tasks')?(options.tasks||[]):path.endsWith('/messages')?(options.messages||[]):[]});
 };
 const makeEvents=()=>({events:{},addEventListener(k,f){(this.events[k]??=[]).push(f)},removeEventListener(k,f){this.events[k]=(this.events[k]||[]).filter(x=>x!==f)},emit(k){for(const f of this.events[k]||[])f()}});const window={...makeEvents(),innerHeight:844,innerWidth:options.width||390,visualViewport:{...makeEvents(),height:844,offsetTop:0,offsetLeft:0,width:390}};
 const ctx={document,window,fetch:request,AbortController,crypto,console,Date,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},URL:{createObjectURL(file){const url='blob:offline-fixture-'+created.length;created.push({url,file});return url;},revokeObjectURL(url){revoked.push(url);}}};
 vm.runInNewContext(source.replace('export function','function')+'\nthis.mount=mountProjectWorkspace;',ctx);
 const workspace=ctx.mount(root,'orgbrain',{connected:options.connected??true,request});
 const all=()=>flat(root),find=fn=>all().find(fn),byClass=name=>find(n=>n.className===name);
 const input=find(n=>n.id==='compose-orgbrain'),panel=byClass('compose-skill-panel'),skillInput=find(n=>n.getAttribute('aria-label')==='参照するスキル名'),files=find(n=>n.type==='file'),form=input.parent;
 const text=async(value,at=value.length)=>{input.value=value;input.setSelectionRange(at,at);await input.emit('input');};
 const key=(key,props={})=>input.emit('keydown',{key,...props});
 const paste=async(images,{withText='',fallbackImages=images}={})=>input.emit('paste',{clipboardData:{items:images.map(file=>({kind:'file',type:file.type,getAsFile:()=>file})),files:fallbackImages,getData:()=>withText}});
 const img=(name='shot.png',size=25,type='image/png')=>({name,size,type});
 const menuButton=label=>find(n=>n.tag==='button'&&n.children.some(c=>c.textContent===label));
 return {window,root,workspace,document,find,all,byClass,input,panel,skillInput,files,form,uploads,posts,created,revoked,text,key,paste,img,menuButton,response};
}



const helperContext={Date};vm.runInNewContext(source.replace('export function','function')+'\nthis.describe=describeMessageWork;',helperContext);const describe=(m,t)=>JSON.parse(JSON.stringify(helperContext.describe(m,t)));
const posted='2026-10-08T01:00:00Z',linked='2026-10-08T01:10:00Z',later='2026-10-08T01:20:00Z';
const message={id:'m1',author:'user',text:'Please continue',created_at:posted};
const task=(overrides={})=>({id:'t1',title:'Offline task',scope:'Read-only fixture',source_message_id:'m1',state:'running',action:'proposed',priority:50,dependencies:[],revision:1,created_at:posted,updated_at:later,externalProgress:{state:'running',observedAt:later,summary:'Offline evidence',evidence:['fixture'],externalTaskRef:'offline'},...overrides});
const unknown=result=>assert(result&&result.unconfirmed>0&&!/関連作業完了|作業中/.test(result.label));
test('no task, other source, dot replies and invalid message time do not invent progress',()=>{assert.equal(describe(message,[]),null);assert.equal(describe(message,[task({source_message_id:'other'})]),null);assert.equal(describe({...message,author:'dot'},[task()]),null);assert.equal(describe({...message,created_at:'broken'},[task()]),null);});
test('original external state requires observation at or after posting',()=>{unknown(describe(message,[task({externalProgress:{state:'running',observedAt:'2026-10-08T00:59:59Z'}})]));const exact=describe(message,[task({externalProgress:{state:'running',observedAt:posted}})]);assert.equal(exact.unconfirmed,0);assert.match(exact.label,/作業中/);});
test('linked work requires observation at or after both posting and linking',()=>{const linkTask=task({source_message_id:'old',linkedSources:[{id:'m1',linkedAt:linked}],externalProgress:{state:'running',observedAt:'2026-10-08T01:09:59Z'}});unknown(describe(message,[linkTask]));linkTask.externalProgress.observedAt=linked;assert.equal(describe(message,[linkTask]).unconfirmed,0);linkTask.linkedSources[0].linkedAt='2026-10-08T00:50:00Z';linkTask.externalProgress.observedAt='2026-10-08T00:59:59Z';unknown(describe(message,[linkTask]));});
test('missing and invalid link/observation timestamps remain unconfirmed',()=>{for(const stamp of [undefined,'invalid']){unknown(describe(message,[task({source_message_id:'old',linkedSources:[{id:'m1',linkedAt:stamp}]})]));unknown(describe(message,[task({externalProgress:{state:'running',observedAt:stamp}})]));}});
test('native followup and mismatched external states remain unconfirmed',()=>{unknown(describe(message,[task({source_message_id:'old',linkedSources:[{id:'m1',linkedAt:linked}],externalProgress:null,action:'investigate_report'})]));unknown(describe(message,[task({externalProgress:{state:'succeeded',observedAt:later}})]));});
test('original native investigation may report verified updated state; registration is separate',()=>{assert.match(describe(message,[task({externalProgress:null,action:'investigate_report'})]).label,/作業中/);assert.match(describe(message,[task({externalProgress:null,state:'queued',action:'proposed'})]).label,/登録済み.*待機/);});
test('mixed independent tasks retain done/running/unconfirmed distinctions',()=>{const result=describe(message,[task({id:'done',state:'succeeded',externalProgress:{state:'succeeded',observedAt:later}}),task({id:'running'}),task({id:'unknown',externalProgress:null})]);assert.match(result.label,/関連作業完了 1件/);assert.match(result.label,/作業中 1件/);assert.equal(result.unconfirmed,1);});
test('parent and child do not count identical running hierarchy twice',()=>{const result=describe(message,[task({id:'parent'}),task({id:'child',parent_task_id:'parent'})]);assert.equal(result.taskIds.length,1);assert.match(result.label,/作業中/);});
test('completed parent cannot conceal unfinished related child',()=>{const result=describe(message,[task({id:'parent',state:'succeeded',externalProgress:{state:'succeeded',observedAt:later}}),task({id:'child',parent_task_id:'parent'})]);assert(/作業中|未確認|未完了|残/.test(result.label),'completed parent alone must not imply the still-running related child is complete: '+result.label);});
test('task-only refresh updates old message state without manufacturing receipt',async()=>{const options={messages:[message],tasks:[task()]},f=fixture(options);await tick();let progress=f.byClass('message-work-state');assert(progress);assert.match(progress.textContent,/作業中/);assert(f.all().some(n=>n.className==='receipt pending'));assert(!f.all().some(n=>n.className==='receipt received'));options.tasks=[task({state:'succeeded',externalProgress:{state:'succeeded',observedAt:'2026-10-08T01:21:00Z'}})];await f.workspace.refresh();progress=f.byClass('message-work-state');assert.match(progress.textContent,/関連作業完了/);assert(f.all().some(n=>n.className==='receipt pending'));options.messages=[{...message,receipt:{dotReplyId:'reply1',dotRepliedAt:later}}];await f.workspace.refresh();assert(f.all().some(n=>n.className==='receipt received'));assert.equal(f.posts.length,0);f.workspace.destroy();});
test('no-task message shows saved/awaiting receipt without fake work status',async()=>{const f=fixture({messages:[message]});await tick();assert(!f.byClass('message-work-state'));assert(f.all().some(n=>n.textContent==='保存済み・受信待ち'));assert.equal(f.posts.length,0);f.workspace.destroy();});
test('changed link time alone invalidates an old message progress observation',async()=>{const options={messages:[message],tasks:[task({source_message_id:'old',linkedSources:[{id:'m1',linkedAt:linked}]})]},f=fixture(options);await tick();assert.match(f.byClass('message-work-state').textContent,/作業中/);options.tasks=[task({source_message_id:'old',linkedSources:[{id:'m1',linkedAt:'2026-10-08T01:30:00Z'}]})];await f.workspace.refresh();assert.match(f.byClass('message-work-state').textContent,/未確認/);assert(!/作業中/.test(f.byClass('message-work-state').textContent));assert.equal(f.posts.length,0);f.workspace.destroy();});
