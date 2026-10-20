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
  constructor(tag) { this.tag=tag; this.children=[]; this.events={}; this.attrs={}; this.dataset={}; this.value=''; this.hidden=false; this.disabled=false; this.scrollHeight=240; this.clientHeight=160; this.scrollTop=80; this.style={setProperty(){}}; }
  append(...nodes) { for(const node of nodes) { if(node.parent)node.parent.children=node.parent.children.filter(n=>n!==node);node.parent=this;this.children.push(node); } }
  replaceChildren(...nodes) { for(const child of this.children)child.parent=null;this.children=[];this.append(...nodes); }
  setAttribute(k,v) { this.attrs[k]=String(v); if(k==='tabindex')this.tabIndex=Number(v); }
  getAttribute(k) { return this.attrs[k]??null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(k,fn) { (this.events[k]??=[]).push(fn); }
  removeEventListener(k,fn) { this.events[k]=(this.events[k]||[]).filter(f=>f!==fn); }
  async emit(k,props={}) { const e={target:this,currentTarget:this,key:'',prevented:false,preventDefault(){this.prevented=true},stopPropagation(){},...props};for(const fn of this.events[k]||[])await fn(e);return e; }
  click() { if(!this.disabled)return this.emit('click'); }
  focus() { document.activeElement=this; }
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
 const ctx={document,window:{addEventListener(){},removeEventListener(){},innerHeight:800},fetch:request,AbortController,crypto,console,Date,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},URL:{createObjectURL(file){const url='blob:offline-fixture-'+created.length;created.push({url,file});return url;},revokeObjectURL(url){revoked.push(url);}}};
 vm.runInNewContext(source.replace('export function','function')+'\nthis.mount=mountProjectWorkspace;',ctx);
 const workspace=ctx.mount(root,'orgbrain',{connected:options.connected??true,request});
 const all=()=>flat(root),find=fn=>all().find(fn),byClass=name=>find(n=>n.className===name);
 const input=find(n=>n.id==='compose-orgbrain'),panel=byClass('compose-skill-panel'),skillInput=find(n=>n.getAttribute('aria-label')==='参照するスキル名'),files=find(n=>n.type==='file'),form=input.parent;
 const text=async(value,at=value.length)=>{input.value=value;input.setSelectionRange(at,at);await input.emit('input');};
 const key=(key,props={})=>input.emit('keydown',{key,...props});
 const paste=async(images,{withText='',fallbackImages=images}={})=>input.emit('paste',{clipboardData:{items:images.map(file=>({kind:'file',type:file.type,getAsFile:()=>file})),files:fallbackImages,getData:()=>withText}});
 const img=(name='shot.png',size=25,type='image/png')=>({name,size,type});
 const menuButton=label=>find(n=>n.tag==='button'&&n.children.some(c=>c.textContent===label));
 return {root,workspace,document,find,all,byClass,input,panel,skillInput,files,form,uploads,posts,created,revoked,text,key,paste,img,menuButton,response};
}

// Happy paths and race/lock boundaries should pass independently of visual QA.
test('paste uses project-bound upload once and native plain text remains untouched',async()=>{const f=fixture();await tick();const image=f.img();const e=await f.paste([image]);await tick();assert(e.prevented);assert.equal(f.uploads.length,1);assert.equal(f.uploads[0].path,'/api/projects/orgbrain/files');assert.equal(f.uploads[0].credentials,'same-origin');assert.equal(f.uploads[0].body,image);assert.equal(f.created.length,1);assert.equal(f.find(n=>n.tag==='img').src,f.created[0].url);const text=await f.paste([],{withText:'normal text'});assert(!text.prevented);const mixed=await f.paste([f.img('mixed.png')],{withText:'caption'});assert(!mixed.prevented);await tick();assert.equal(f.uploads.length,2);f.workspace.destroy();});
test('size limit is inclusive and count limit never sends overflow',async()=>{const f=fixture();await tick();await f.paste([f.img('boundary.png',8388608),f.img('oversize.png',8388609),...Array.from({length:6},(_,i)=>f.img('image'+i+'.png'))]);await tick();assert.equal(f.uploads.length,5);assert(f.uploads.some(x=>x.body.size===8388608));assert(!f.uploads.some(x=>x.body.size===8388609));f.workspace.destroy();});
test('removed in-flight image cannot resurrect and preview is revoked once',async()=>{const gate=defer();const f=fixture({upload:()=>gate.promise});await tick();await f.paste([f.img()]);const removal=f.find(n=>n.getAttribute('aria-label')==='shot.pngを添付から外す');await removal.click();assert(f.uploads[0].signal.aborted);assert.equal(f.byClass('draft-files').children.length,0);assert.equal(f.revoked.length,1);gate.resolve(f.response({attachment:{id:'file_late'}}));await tick();assert.equal(f.byClass('draft-files').children.length,0);assert.equal(f.revoked.length,1);f.workspace.destroy();});
test('destroy aborts uploads and late response cannot restore preview',async()=>{const gate=defer();const f=fixture({upload:()=>gate.promise});await tick();await f.paste([f.img()]);f.workspace.destroy();assert(f.uploads[0].signal.aborted);assert.equal(f.revoked.length,1);gate.resolve(f.response({attachment:{id:'file_after_destroy'}}));await tick();assert.equal(f.revoked.length,1);});
test('failed upload retries same id and retains preview until removal',async()=>{const f=fixture({upload:(x,n)=>n===1?Promise.reject(Error('injected failure')):Promise.resolve({ok:true,json:async()=>({attachment:{id:'file_retried'}})})});await tick();await f.paste([f.img()]);await tick();assert(f.find(n=>n.textContent==='再試行'));await f.find(n=>n.textContent==='再試行').click();await tick();assert.equal(f.uploads.length,2);assert.equal(f.uploads[0].headers['X-Upload-Id'],f.uploads[1].headers['X-Upload-Id']);assert.equal(f.created.length,1);assert.equal(f.revoked.length,0);f.workspace.destroy();});
test('unknown save keeps plan/skills/attachments immutable across retry',async()=>{const f=fixture({post:(x,n)=>n===1?Promise.reject(Error('unknown timeout')):Promise.resolve({ok:true,json:async()=>({message:{id:'message_saved'},notification:{state:'accepted'}})})});await tick();await f.menuButton('計画のみ').click();await f.text('/si');await f.key('Enter');await f.text('please make a plan');await f.paste([f.img()]);await tick();await f.form.emit('submit');assert(f.input.disabled);const chip=f.find(n=>n.getAttribute('aria-label')==='計画のみを外す');assert(chip.disabled);await chip.emit('click');await f.menuButton('計画のみ').emit('click');await f.paste([f.img('second.png')]);assert.equal(f.uploads.length,1);await f.form.emit('submit');assert.deepEqual(f.posts[1],f.posts[0]);assert.equal(f.posts[0].metadata.mode,'plan_only');assert.deepEqual(f.posts[0].metadata.skillReferences,['Sites']);assert.deepEqual(f.posts[0].metadata.attachmentIds,['file_local_1']);assert.equal(f.revoked.length,1);f.workspace.destroy();});
test('triggers require safe token boundaries and selected caret position',async()=>{const f=fixture();await tick();for(const value of ['https://example.com/Sites','path/to/Sites','$123','$1,000','$HOME','a$Si','email@example.com/$Si']){await f.text(value);assert(f.panel.hidden,value);}await f.text('Please use /Si');assert(!f.panel.hidden);await f.key('Enter');assert.equal(f.input.value,'Please use ');assert(f.find(n=>n.getAttribute('aria-label')==='Sitesを外す'));await f.text('$Fi');assert(!f.panel.hidden);await f.key('Enter');assert(f.find(n=>n.getAttribute('aria-label')==='Figmaを外す'));await f.text('/Impeccable');f.input.setSelectionRange(0,5);await f.input.emit('click');assert(f.panel.hidden);f.workspace.destroy();});
test('Escape stays dismissed for same token and changed token reopens',async()=>{const f=fixture();await tick();await f.text('/S');assert(!f.panel.hidden);await f.key('Escape');assert(f.panel.hidden);await f.input.emit('click');assert(f.panel.hidden);await f.text('/Si');assert(!f.panel.hidden);f.workspace.destroy();});
test('IME enter never selects, and completion can reopen suggestions',async()=>{const f=fixture();await tick();await f.text('/Fi');await f.input.emit('compositionstart');assert(f.panel.hidden);await f.key('Enter',{isComposing:true});assert.equal(f.byClass('compose-context-chips').children.length,0);await f.input.emit('compositionend');assert(!f.panel.hidden);await f.key('Enter',{keyCode:229});assert.equal(f.byClass('compose-context-chips').children.length,0);await f.key('Enter');assert.equal(f.byClass('compose-context-chips').children.length,1);f.workspace.destroy();});
test('keyboard filtering and selection consume Enter without message submit',async()=>{const f=fixture();await tick();await f.text('/');const before=f.input.getAttribute('aria-activedescendant');await f.key('ArrowDown');assert.notEqual(f.input.getAttribute('aria-activedescendant'),before);await f.key('Enter');assert.equal(f.byClass('compose-context-chips').children.length,1);assert.equal(f.posts.length,0);f.workspace.destroy();});
test('image upload failure prevents sending until removal',async()=>{const f=fixture({upload:()=>Promise.reject(Error('fixture fail'))});await tick();await f.text('text');await f.paste([f.img()]);await tick();await f.form.emit('submit');assert.equal(f.posts.length,0);await f.find(n=>n.getAttribute('aria-label')==='shot.pngを添付から外す').click();await f.form.emit('submit');assert.equal(f.posts.length,1);f.workspace.destroy();});
test('no clipboard read permission API exists',()=>{assert(!/navigator\.clipboard|clipboard\.read\(/.test(source));});
// UX correctness probes: parent can fix these independently of the harness.
test('Shift+Enter retains multiline behavior instead of selecting a skill',async()=>{const f=fixture();await tick();await f.text('/Si');const e=await f.key('Enter',{shiftKey:true});assert(!e.prevented,'Shift+Enter should not select suggestion');assert.equal(f.byClass('compose-context-chips').children.length,0);f.workspace.destroy();});
test('Shift+Tab preserves backward focus navigation',async()=>{const f=fixture();await tick();await f.text('/Si');const e=await f.key('Tab',{shiftKey:true});assert(!e.prevented,'Shift+Tab should not select suggestion');assert.equal(f.byClass('compose-context-chips').children.length,0);f.workspace.destroy();});
test('returning from manual picker to ordinary text restores ordinary Enter',async()=>{const f=fixture();await tick();await f.menuButton('スキルを指定').click();assert(!f.panel.hidden);await f.text('普通の文章');await f.input.emit('click');const e=await f.key('Enter');assert(!e.prevented,'Ordinary message Enter should not select manual candidate');assert.equal(f.byClass('compose-context-chips').children.length,0);f.workspace.destroy();});
test('partial size rejection remains visible after accepted upload finishes',async()=>{const f=fixture();await tick();await f.paste([f.img('good.png'),f.img('too-big.png',8388609)]);await tick();const notice=f.byClass('compose-file-notice');assert(notice&&!notice.hidden&&notice.textContent?.includes('too-big.png'),'rejected image error must remain visible after sibling succeeds');assert.equal(notice.getAttribute('role'),'alert');f.workspace.destroy();});

test('returning from plus menu to ordinary textarea dismisses popover',async()=>{const f=fixture();await tick();await f.byClass('compose-plus').click();assert(!f.byClass('compose-menu').hidden);await f.input.emit('focus');await f.input.emit('click');assert(f.byClass('compose-menu').hidden,'composer controls must not remain over the conversation while typing');f.workspace.destroy();});
test('pasted files fallback works and non-image clipboard files stay native',async()=>{const f=fixture();await tick();const e=await f.paste([],{fallbackImages:[f.img()]});await tick();assert(e.prevented);assert.equal(f.uploads.length,1);const nonimage=await f.paste([],{fallbackImages:[f.img('text.txt',3,'text/plain')]});assert(!nonimage.prevented);assert.equal(f.uploads.length,1);f.workspace.destroy();});
test('server unavailable rejects upload with explicit alert and no request',async()=>{const f=fixture({available:false});await tick();await f.paste([f.img()]);assert.equal(f.uploads.length,0);const alert=f.byClass('compose-file-notice');assert(alert&&!alert.hidden);assert.equal(alert.getAttribute('role'),'alert');f.workspace.destroy();});
test('custom reference limits and chip removal preserve visible plan intent',async()=>{const f=fixture();await tick();await f.menuButton('計画のみ').click();for(let i=0;i<9;i++){await f.menuButton('スキルを指定').click();f.skillInput.value='Custom '+i;await f.skillInput.emit('input');await f.byClass('custom-skill').click();}assert.equal(f.byClass('compose-context-chips').children.length,9,'8 refs plus plan');await f.find(n=>n.getAttribute('aria-label')==='Custom 0を外す').click();assert.equal(f.byClass('compose-context-chips').children.length,8);assert(!f.byClass('compose-mode-hint').hidden);await f.text('read only plan');await f.form.emit('submit');assert.equal(f.posts[0].metadata.mode,'plan_only');assert.equal(f.posts[0].metadata.skillReferences.length,7);f.workspace.destroy();});
test('SVG attachments receive no executable local preview',async()=>{const f=fixture();await tick();await f.paste([f.img('graphic.svg',10,'image/svg+xml')]);await tick();assert.equal(f.uploads.length,1);assert.equal(f.created.length,0);assert(!f.find(n=>n.tag==='img'));f.workspace.destroy();});
