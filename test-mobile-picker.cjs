// Independent, offline-only DOM contract tests. Never sends requests to a deployed Site.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto').webcrypto;
const path = require('node:path');
const sourcePath = process.argv[2] || path.join(__dirname,'project-workspace.js');
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
  return response({data:[]});
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


const editing=el=>el&&(el.tag==='input'||el.tag==='textarea'||el.isContentEditable);
async function openManual(f){await f.byClass('compose-plus').click();await f.menuButton('スキルを指定').click();}
test('mobile manual opening is visible without activating a keyboard',async()=>{const f=fixture();await tick();f.input.focus();await openManual(f);assert(!f.panel.hidden);assert(!editing(f.document.activeElement),'opening manual list must not focus a text-editing field');assert.equal(f.byClass('compose-skill-list').children.filter(n=>n.tag==='button').length,5);f.workspace.destroy();});
test('manual close returns focus to visible non-input control',async()=>{const f=fixture();await tick();await openManual(f);await f.byClass('skill-close').click();assert(f.panel.hidden);assert(!editing(f.document.activeElement),'closing manual list should not re-open keyboard');assert.equal(f.document.activeElement,f.byClass('compose-plus'));f.workspace.destroy();});
test('manual selection adds reference and leaves keyboard closed',async()=>{const f=fixture();await tick();await f.text('Keep this draft');await openManual(f);await f.find(n=>n.className==='compose-skill-option'&&n.children.some(c=>c.textContent==='Sites')).click();assert(f.panel.hidden);assert.equal(f.input.value,'Keep this draft');assert(f.find(n=>n.getAttribute('aria-label')==='Sitesを外す'));assert(!editing(f.document.activeElement),'manual choice should not focus composer');assert.equal(f.posts.length,0);f.workspace.destroy();});
test('manual search field accepts deliberate focus and filters candidates',async()=>{const f=fixture();await tick();await openManual(f);assert(!f.skillInput.hidden);assert.notEqual(f.document.activeElement,f.skillInput);f.skillInput.focus();assert.equal(f.document.activeElement,f.skillInput);f.skillInput.value='Figma';await f.skillInput.emit('input');assert.equal(f.byClass('compose-skill-list').children.filter(n=>n.tag==='button').length,1);f.workspace.destroy();});
test('inline token selection returns composer focus and preserves text around token',async()=>{const f=fixture();await tick();await f.text('Before /Si after',10);assert(!f.panel.hidden);await f.key('Enter');assert(f.panel.hidden);assert.equal(f.input.value,'Before  after');assert.equal(f.document.activeElement,f.input);assert.equal(f.posts.length,0);f.workspace.destroy();});
test('IME Escape and Enter do not accidentally choose or dismiss active composition',async()=>{const f=fixture();await tick();await f.text('/Fi');await f.key('Enter',{isComposing:true});assert(!f.panel.hidden);assert.equal(f.byClass('compose-context-chips').children.length,0);await f.key('Escape',{isComposing:true});assert(!f.panel.hidden);f.workspace.destroy();});
test('manual references stay static and availability promise remains qualified',async()=>{assert(/static|curated/i.test(source));assert(!/installed skill|runtime inventory/i.test(source));const f=fixture();await tick();await openManual(f);const text=f.all().map(n=>n.textContent||'').join(' ');assert(/参照/.test(text));assert(/利用|確認/.test(text));assert(/Mac/.test(text),'Impeccable source must be identified as Mac reference material');f.workspace.destroy();});

test('Escape from initial Close focus dismisses manual picker without keyboard',async()=>{const f=fixture();await tick();await openManual(f);assert.equal(f.document.activeElement,f.byClass('skill-close'));await f.document.activeElement.emit('keydown',{key:'Escape'});assert(f.panel.hidden,'Escape must work from the non-input initial focus');assert.equal(f.document.activeElement,f.byClass('compose-plus'));f.workspace.destroy();});
test('desktop manual opening retains search focus',async()=>{const f=fixture({width:1200});await tick();await openManual(f);assert.equal(f.document.activeElement,f.skillInput);await f.skillInput.emit('keydown',{key:'Escape'});assert(f.panel.hidden);assert.equal(f.document.activeElement,f.input);f.workspace.destroy();});
test('visual viewport resize and pan update bounds and destroy removes listeners',async()=>{const f=fixture();await tick();f.window.visualViewport.height=360;f.window.visualViewport.emit('resize');assert.equal(f.panel.style['--skill-viewport-height'],'360px');f.window.visualViewport.offsetTop=45;f.window.visualViewport.emit('scroll');assert.equal(f.panel.style['--skill-viewport-top'],'45px');f.workspace.destroy();assert.equal(f.window.visualViewport.events.scroll.length,0);assert.equal(f.window.visualViewport.events.resize.length,0);});

test('late manual-search compositionend cannot reopen dismissed picker',async()=>{const f=fixture();await tick();await openManual(f);f.skillInput.focus();await f.skillInput.emit('compositionstart');f.skillInput.value='仮';await f.byClass('skill-close').click();assert(f.panel.hidden);await f.skillInput.emit('compositionend');assert(f.panel.hidden,'compositionend after dismissal must not reopen picker');assert.equal(f.document.activeElement,f.byClass('compose-plus'));assert.equal(f.byClass('compose-context-chips').children.length,0);f.workspace.destroy();});
