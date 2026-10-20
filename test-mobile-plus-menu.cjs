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
  constructor(tag) { this.tag=tag; this.children=[]; this.events={}; this.attrs={}; this.dataset={}; this.value=''; this.hidden=false; this.disabled=false; this.scrollHeight=240; this.clientHeight=160; this.scrollTop=80; this.style={values:{},setProperty(k,v){this.values[k]=v},removeProperty(k){delete this.values[k]}}; this.focusCalls=[]; this.scrollCalls=[]; }
  append(...nodes) { for(const node of nodes) { if(node.parent)node.parent.children=node.parent.children.filter(n=>n!==node);node.parent=this;this.children.push(node); } }
  replaceChildren(...nodes) { for(const child of this.children)child.parent=null;this.children=[];this.append(...nodes); }
  setAttribute(k,v) { this.attrs[k]=String(v); if(k==='tabindex')this.tabIndex=Number(v); }
  getAttribute(k) { return this.attrs[k]??null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(k,fn) { (this.events[k]??=[]).push(fn); }
  removeEventListener(k,fn) { this.events[k]=(this.events[k]||[]).filter(f=>f!==fn); }
  async emit(k,props={}) { const e={target:this,currentTarget:this,key:'',prevented:false,preventDefault(){this.prevented=true},stopPropagation(){},...props};for(const fn of this.events[k]||[])await fn(e);return e; }
  click() { if(!this.disabled)return this.emit('click'); }
  focus(o) { document.activeElement=this; this.focusCalls.push(o); }
  blur() { if(document.activeElement===this)document.activeElement=null; this.blurCalls=(this.blurCalls||0)+1; }
  getBoundingClientRect() { return this._rect?this._rect():{top:0,bottom:0,height:0}; }
  closest() { return null; }
  contains(node) { return flat(this).includes(node); }
  querySelector() { return null; }
  querySelectorAll(selector) { return selector==='button'?flat(this).filter(n=>n.tag==='button'):[]; }
  setSelectionRange(a,b) { this.selectionStart=a;this.selectionEnd=b; }
  scrollIntoView(o) {this.scrollCalls.push(o);}
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
 const emitter=()=>({events:{},addEventListener(k,f){(this.events[k]??=[]).push(f)},removeEventListener(k,f){this.events[k]=(this.events[k]||[]).filter(x=>x!==f)},emit(k){for(const f of this.events[k]||[])f()}});
 const viewport=Object.assign(emitter(),{height:options.height||844,offsetTop:0});
 const win=Object.assign(emitter(),{innerHeight:844,innerWidth:options.width||390,visualViewport:viewport});
 const ctx={document,window:win,fetch:request,AbortController,crypto,console,Date,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},URL:{createObjectURL(file){const url='blob:offline-fixture-'+created.length;created.push({url,file});return url;},revokeObjectURL(url){revoked.push(url);}}};
 vm.runInNewContext(source.replace('export function','function')+'\nthis.mount=mountProjectWorkspace;',ctx);
 const workspace=ctx.mount(root,'orgbrain',{connected:options.connected??true,request});
 const all=()=>flat(root),find=fn=>all().find(fn),byClass=name=>find(n=>n.className===name);
 const input=find(n=>n.id==='compose-orgbrain'),panel=byClass('compose-skill-panel'),skillInput=find(n=>n.getAttribute('aria-label')==='参照するスキル名'),files=find(n=>n.type==='file'),form=input.parent;
 const text=async(value,at=value.length)=>{input.value=value;input.setSelectionRange(at,at);await input.emit('input');};
 const key=(key,props={})=>input.emit('keydown',{key,...props});
 const paste=async(images,{withText='',fallbackImages=images}={})=>input.emit('paste',{clipboardData:{items:images.map(file=>({kind:'file',type:file.type,getAsFile:()=>file})),files:fallbackImages,getData:()=>withText}});
 const img=(name='shot.png',size=25,type='image/png')=>({name,size,type});
 const menuButton=label=>find(n=>n.tag==='button'&&n.children.some(c=>c.textContent===label));
 return {root,workspace,document,win,viewport,find,all,byClass,input,panel,skillInput,files,form,uploads,posts,created,revoked,text,key,paste,img,menuButton,response};
}


function geometry(f, {chrome=150, content=350, areaTop=90, header=0}={}) {
 const menu=f.byClass('compose-menu'), block=f.byClass('message-composer'), chat=f.byClass('project-chat');
 const cssHeight=()=>Number.parseFloat(menu.style.values['--compose-menu-height'])||Math.min(280,f.viewport.height*.42);
 const menuHeight=()=>menu.hidden?0:Math.min(content,cssHeight());
 const area=()=>({top:areaTop,bottom:f.viewport.height+header,height:f.viewport.height+header-areaTop});
 const blockHeight=()=>Math.min(chrome+menuHeight(),area().height);
 chat._rect=area;
 block._rect=()=>({top:area().bottom-blockHeight(),bottom:area().bottom,height:blockHeight()});
 Object.defineProperty(block,'scrollHeight',{get:()=>chrome+menuHeight()});
 menu._rect=()=>{const top=block._rect().top+chrome-44-block.scrollTop;return {top,bottom:top+menuHeight(),height:menuHeight()}};
 for(const [i,b] of menu.querySelectorAll('button').entries())b._rect=()=>{const top=menu._rect().top+8+i*52-menu.scrollTop;return {top,bottom:top+46,height:46}};
 block.scrollTop=0;menu.scrollTop=0;
 return {menu,block,chat,cssHeight,menuHeight};
}
async function mounted(opts,layout){const f=fixture(opts);await tick();const g=geometry(f,layout);return Object.assign(f,g,{plus:f.byClass('compose-plus')});}
test('menu is after form and below mode hint in DOM; opening preserves draft and plan',async()=>{const f=await mounted();await f.menuButton('計画のみ').click();f.input.value='未送信の長い日本語の下書き';const children=f.block.children;assert(children.indexOf(f.menu)>children.indexOf(f.form));assert(children.indexOf(f.menu)>children.indexOf(f.byClass('compose-mode-hint')));await f.plus.click();assert.equal(f.input.value,'未送信の長い日本語の下書き');assert(!f.byClass('compose-mode-hint').hidden);assert.equal(f.menuButton('計画のみ').getAttribute('aria-checked'),'true');assert.equal(f.posts.length,0);f.workspace.destroy()});
test('open and Escape transfer focus with preventScroll and preserve expansion state',async()=>{const f=await mounted();f.input.focus();await f.plus.click();assert.equal(f.input.blurCalls,1);assert(!f.menu.hidden);assert.equal(f.block.dataset.menuOpen,'true');assert.equal(f.plus.getAttribute('aria-expanded'),'true');assert.equal(f.document.activeElement,f.menuButton('ファイルを添付'));assert.equal(f.document.activeElement.focusCalls.at(-1).preventScroll,true);await f.menu.emit('keydown',{key:'Escape'});assert(f.menu.hidden);assert.equal(f.block.dataset.menuOpen,'false');assert.equal(f.document.activeElement,f.plus);assert.equal(f.plus.focusCalls.at(-1).preventScroll,true);f.workspace.destroy()});
test('first disabled choice is skipped',async()=>{const f=await mounted({available:false});await f.plus.click();assert.equal(f.document.activeElement,f.menuButton('計画のみ'));f.workspace.destroy()});
test('keyboard End/Home scrolls only menu and focus never requests native scrolling',async()=>{const f=await mounted({height:420});await f.plus.click();f.block.scrollTop=0;const prior=f.block.scrollTop;await f.menu.emit('keydown',{key:'End'});assert(f.menu.scrollTop>0);const last=f.menu.querySelectorAll('button').at(-1);assert.equal(f.document.activeElement,last);assert.equal(last.focusCalls.at(-1).preventScroll,true);assert.equal(f.block.scrollTop,prior);assert.equal(last.scrollCalls.length,0);await f.menu.emit('keydown',{key:'Home'});assert.equal(f.document.activeElement,f.menuButton('ファイルを添付'));assert(f.menu.scrollTop<=8);f.workspace.destroy()});
test('viewport shrink, pan and expansion update cap without cumulative size drift',async()=>{const f=await mounted();await f.plus.click();assert.equal(f.cssHeight(),280);f.viewport.height=400;f.viewport.emit('resize');const shrunk=f.cssHeight();assert.equal(shrunk,113.5);for(let i=0;i<20;i++)f.viewport.emit('resize');assert.equal(f.cssHeight(),shrunk);f.viewport.offsetTop=150;f.viewport.emit('scroll');assert.equal(f.cssHeight(),62.5);f.viewport.offsetTop=0;f.viewport.height=844;f.viewport.emit('resize');assert.equal(f.cssHeight(),280);f.workspace.destroy()});
test('breakpoint removes mobile inline cap and restores it on return',async()=>{const f=await mounted();await f.plus.click();assert(f.menu.style.values['--compose-menu-height']);f.win.innerWidth=1100;f.win.emit('resize');assert.equal(f.menu.style.values['--compose-menu-height'],undefined);f.win.innerWidth=390;f.win.emit('resize');assert.equal(f.cssHeight(),280);f.workspace.destroy()});
test('viewport resize never scrolls composer while plus menu is open',async()=>{const f=await mounted();await f.plus.click();f.document.activeElement=f.input;f.viewport.emit('resize');f.viewport.emit('scroll');assert.equal(f.block.scrollCalls.length,0);await f.plus.click();f.document.activeElement=f.input;f.viewport.emit('resize');assert.equal(f.block.scrollCalls.length,1);f.workspace.destroy()});
test('repeat opening resets menu scroll and recalculates changed geometry',async()=>{const f=await mounted();await f.plus.click();await f.menu.emit('keydown',{key:'End'});assert(f.menu.scrollTop>0);await f.plus.click();assert(f.menu.hidden);await f.plus.click();assert.equal(f.menu.scrollTop,0);assert.equal(f.document.activeElement,f.menuButton('ファイルを添付'));f.workspace.destroy()});
test('desktop opening does not blur textarea or set mobile cap',async()=>{const f=await mounted({width:1440});f.input.focus();await f.plus.click();assert.equal(f.input.blurCalls,undefined);assert.equal(f.menu.style.values['--compose-menu-height'],undefined);assert.equal(f.input.value,'');f.workspace.destroy()});
test('short viewport size remains stable and within composer fallback',async()=>{const f=await mounted({height:240},{chrome:165});await f.plus.click();assert.equal(f.cssHeight(),52);assert(f.block.scrollHeight>f.block.getBoundingClientRect().height);for(let i=0;i<20;i++)f.viewport.emit('resize');assert.equal(f.cssHeight(),52);f.workspace.destroy()});
test('short viewport focus should be visible in composer scrollport',async()=>{const f=await mounted({height:260},{chrome:200});await f.plus.click();const focus=f.document.activeElement.getBoundingClientRect(),clip=f.block.getBoundingClientRect();assert(focus.top>=clip.top&&focus.bottom<=clip.bottom,`Focused item ${focus.top}..${focus.bottom} lies outside composer ${clip.top}..${clip.bottom}; outer scrollTop=${f.block.scrollTop}`);f.workspace.destroy()});
test('focused menu option remains visible after viewport height shrinks',async()=>{const f=await mounted();await f.plus.click();await f.menu.emit('keydown',{key:'End'});f.viewport.height=400;f.viewport.emit('resize');const focus=f.document.activeElement.getBoundingClientRect(),box=f.menu.getBoundingClientRect();assert(focus.top>=box.top&&focus.bottom<=box.bottom,`Focused item ${focus.top}..${focus.bottom} lies outside menu ${box.top}..${box.bottom} after shrink`);f.workspace.destroy()});
