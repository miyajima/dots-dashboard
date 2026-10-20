const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {fixture,settle,defer,msg,flat,task}=require('./test-thread-sidebar/sidebar-ui-fixture.cjs');
const code=fs.readFileSync(__dirname+'/project-workspace.js','utf8'),owner='a'.repeat(64),other='b'.repeat(64),prefix='dot-session-display:v1:';
function storage(){const values=new Map();return {get length(){return values.size},key:i=>[...values.keys()][i]??null,getItem:k=>values.get(k)??null,setItem(k,v){values.set(k,String(v))},removeItem:k=>values.delete(k),values}}
function factories(){const context={document:{},AbortController,setTimeout,clearTimeout,Date,console};vm.runInNewContext(code.replace('export function','function')+';this.makeCache=createSessionDisplayCache;this.makeRuntime=workspaceRuntime;',context);return context}
const scoped=(id,session='general')=>({...msg(id),project_id:'orgbrain',sessionId:session,metadata:{mode:'standard'}});
const setup=async(t,options={})=>{const f=fixture(options);t.after(()=>f.workspace.destroy());await settle();return f};

test('optional display cache isolates exact owner/project/session and strips authority/links/uploads',()=>{
 const store=storage(),cache=factories().makeCache(owner,store),row={...scoped('message_001','session_A'),receipt:{dotReplyId:'receipt_1'},requestResult:{status:'completed'},attachments:[{downloadUrl:'javascript:alert(1)'}]};
 cache.write('orgbrain','session_A',[row]);const saved=cache.read('orgbrain','session_A');assert.equal(saved.messages[0].text,row.text);assert.equal(saved.messages[0].receipt,undefined);assert.equal(saved.messages[0].requestResult,undefined);assert.equal(saved.messages[0].attachments,undefined);
 assert.equal(cache.read('orgbrain','session_B'),null);assert.equal(cache.read('astraharness','session_A'),null);assert.equal(factories().makeCache(other,store).read('orgbrain','session_A'),null);
 cache.write('orgbrain','session_B',[row]);assert.equal(cache.read('orgbrain','session_B'),null,'foreign-session rows cannot be restamped');
 cache.write('orgbrain','session_A',[{...row,project_id:'other-project'}]);assert.equal(cache.read('other-project','session_A'),null);
});
test('cache rejects expiry, future time, version mismatch, corruption and injected fields',()=>{
 const store=storage();let clock=10000000;const cache=factories().makeCache(owner,store,()=>clock),save=()=>cache.write('orgbrain','session_A',[scoped('message_001','session_A')]);
 for(const change of [x=>x.version=2,x=>x.owner=other,x=>x.session='session_B',x=>x.messages[0].attachments=[{downloadUrl:'javascript:evil'}],x=>x.messages[0].metadata.grantsAuthorization=true,x=>x.savedAt=clock+1001]){save();const k=store.key(0),x=JSON.parse(store.getItem(k));change(x);store.setItem(k,JSON.stringify(x));assert.equal(cache.read('orgbrain','session_A'),null);assert.equal(store.length,0)}
 save();clock+=300000;assert.equal(cache.read('orgbrain','session_A'),null);store.setItem(prefix+owner+':'+JSON.stringify(['orgbrain','session_A']),'{corrupt');assert.equal(cache.read('orgbrain','session_A'),null);
});
test('cache unavailable/quota/miss never throws; bounded eviction preserves unrelated storage',()=>{
 const broken={get length(){throw Error('blocked')},getItem(){throw Error('blocked')},setItem(){throw Error('quota')},removeItem(){throw Error('blocked')}};
 const disabled=factories().makeCache(owner,broken);assert.doesNotThrow(()=>disabled.write('orgbrain',null,[scoped('message_001')]));assert.equal(disabled.read('orgbrain',null),null);
 const store=storage();store.setItem('unrelated','keep');let clock=10000000;const cache=factories().makeCache(owner,store,()=>clock++);
 for(let n=0;n<25;n++)cache.write('orgbrain','session_'+n,[scoped('message_'+n,'session_'+n)]);
 assert(store.length<=11);assert.equal(store.getItem('unrelated'),'keep');assert([...store.values].reduce((n,[k,v])=>n+2*(k.length+v.length),0)<=1048576);
 cache.write('orgbrain','session_large',Array.from({length:200},(_,n)=>({...scoped('message_'+n,'session_large'),text:'x'.repeat(8000)})));assert.equal(cache.read('orgbrain','session_large'),null);
 cache.clear();assert.equal(store.getItem('unrelated'),'keep');assert.equal(store.length,1);
});
test('warm conversation paints while revalidation is pending, labelled stale, then server replaces it',async t=>{
 const store=storage(),cache=factories().makeCache(owner,store),gate=defer();cache.write('orgbrain','session_A',[scoped('cached_message','session_A')]);
 const f=await setup(t,{cacheOwner:owner,storage:store,hash:'#project/orgbrain/session/session_A',onRequest:c=>c.resource==='messages'?gate.promise:undefined});
 assert(flat(f.pane('session_A')).some(n=>n.dataset.messageId==='cached_message'));assert.match(f.byClass('workspace-status',f.pane('session_A')).textContent,/保存済み.*サーバーで確認/);
 gate.resolve(f.response({data:[scoped('server_message','session_A')]}));await settle();assert(!flat(f.pane('session_A')).some(n=>n.dataset.messageId==='cached_message'));assert(flat(f.pane('session_A')).some(n=>n.dataset.messageId==='server_message'));assert.match(f.byClass('workspace-status',f.pane('session_A')).textContent,/同期済み/);
});
test('cached receipt is unknown until same-shaped server data revalidates it',async t=>{
 const store=storage(),cache=factories().makeCache(owner,store),gate=defer(),row=scoped('cached_receipt','session_A');cache.write('orgbrain','session_A',[row]);
 const f=await setup(t,{cacheOwner:owner,storage:store,hash:'#project/orgbrain/session/session_A',onRequest:c=>c.resource==='messages'?gate.promise:undefined});
 assert.equal(f.byClass('receipt pending',f.pane('session_A')).children.at(-1).textContent,'受信状態はサーバー確認中');
 gate.resolve(f.response({data:[row]}));await settle();assert.equal(f.byClass('receipt pending',f.pane('session_A')).children.at(-1).textContent,'保存済み・受信待ち');
});
test('cold/no-storage path stays functional and named route avoids unused General requests',async t=>{
 const f=await setup(t,{cacheOwner:owner,storage:{getItem(){throw Error('blocked')},setItem(){throw Error('quota')}},hash:'#project/orgbrain/session/session_A',messages:{session_A:[scoped('server_message','session_A')]}});
 assert(flat(f.pane('session_A')).some(n=>n.dataset.messageId==='server_message'));assert.equal(f.pane('general'),undefined);assert.equal(f.calls.filter(c=>c.resource==='messages').length,1);assert.equal(f.calls.filter(c=>c.method==='GET').length,5);
});
test('late A response cannot populate B display or cache; returning A revalidates',async t=>{
 const store=storage(),gate=defer();let first=true;const f=await setup(t,{cacheOwner:owner,storage:store,messages:{session_A:[scoped('real_A','session_A')],session_B:[scoped('real_B','session_B')]},onRequest:c=>{if(c.resource==='messages'&&c.sessionId==='session_A'&&first){first=false;return gate.promise}}});
 await f.change('session_A');await f.change('session_B');gate.resolve(f.response({data:[scoped('late_A','session_A')]}));await settle();
 assert(!flat(f.pane('session_B')).some(n=>n.dataset.messageId==='late_A'));const cache=factories().makeCache(owner,store);assert.equal(cache.read('orgbrain','session_A').messages[0].id,'late_A');assert.equal(cache.read('orgbrain','session_B').messages[0].id,'real_B');
 await f.change('session_A');assert(flat(f.pane('session_A')).some(n=>n.dataset.messageId==='real_A'));assert(!flat(f.pane('session_A')).some(n=>n.dataset.messageId==='real_B'));
});
for(const status of [401,403])test('auth '+status+' clears all retained conversations/cache and blocks late responses/posts',async t=>{
 const options={cacheOwner:owner,storage:storage(),messages:{general:[scoped('initial_message')],session_A:[scoped('private_A','session_A')],session_B:[scoped('private_B','session_B')]}};const f=await setup(t,options);await f.change('session_A');await f.change('session_B');assert(options.storage.length>0);
 options.onRequest=c=>c.resource==='messages'?f.response({error:'signed_out'},status):undefined;await f.workspace.refresh();await settle();
 assert.equal(options.storage.length,0);for(const pane of flat(f.root).filter(n=>n.className==='session-workspace')){assert.equal(f.byClass('chat-messages',pane).children.length,0);assert(f.byClass('chat-messages',pane).hidden)}
 const before=f.calls.filter(c=>c.method==='POST').length;await f.input('session_B').parent.emit('submit');assert.equal(f.calls.filter(c=>c.method==='POST').length,before);assert(f.input('session_B').disabled);
});
test('account switch is detected with one shared identity check before cached content resumes',async t=>{
 const options={cacheOwner:owner,storage:storage(),messages:{general:[scoped('owner_A_message')]}};const f=await setup(t,options);options.responseOwner=other;await f.window.emit('focus');await settle();
 assert.equal(f.calls.filter(c=>c.resource==='session-cache-context').length,1);assert.equal(options.storage.length,0);assert.equal(f.byClass('chat-messages',f.pane('general')).children.length,0);assert(f.input('general').disabled);
});
test('failed identity recheck hides private content; manual refresh can recover without storage',async t=>{
 const options={cacheOwner:owner,messages:{general:[scoped('server_message')]}};const f=await setup(t,options);options.onRequest=c=>c.resource==='session-cache-context'?Promise.reject(Error('offline')):undefined;await f.window.emit('focus');await settle();assert(f.byClass('chat-messages',f.pane('general')).hidden);assert(f.input('general').disabled);
 options.onRequest=undefined;await f.find(n=>n.tag==='button'&&n.textContent==='更新').click();await settle();assert(!f.byClass('chat-messages',f.pane('general')).hidden);assert(flat(f.pane('general')).some(n=>n.dataset.messageId==='server_message'));
});
test('shared GETs coalesce; capability TTL cannot bypass explicit identity revalidation',async()=>{
 const gate=defer(),calls=[];const request=async url=>{calls.push(url);return gate.promise},runtime=factories().makeRuntime(request,{cacheOwner:owner});
 const a=runtime.api('/api/projects/orgbrain/tasks'),b=runtime.api('/api/projects/orgbrain/tasks');assert.equal(calls.length,1);gate.resolve({status:200,ok:true,headers:{get:()=>owner},json:async()=>({data:[]})});await Promise.all([a,b]);
 await runtime.api('/api/projects/orgbrain/composer-config');await runtime.api('/api/projects/orgbrain/composer-config');assert.equal(calls.filter(x=>x.endsWith('composer-config')).length,1);
});
test('unchanged navigation/data keep message nodes and focus stable on server refresh',async t=>{
 const f=await setup(t);await f.change('session_A');const pane=f.pane('session_A'),first=f.byClass('chat-messages',pane).children[0],selection=f.selector.children[0];f.input('session_A').focus();await f.workspace.refresh();assert.equal(f.byClass('chat-messages',pane).children[0],first);assert.equal(f.selector.children[0],selection);assert.equal(f.document.activeElement,f.input('session_A'));
});
test('hidden project defers heavy session UI until it becomes visible',async t=>{
 const f=await setup(t);f.workspace.destroy();f.root.replaceChildren();f.root.hidden=true;
 // Reuse the actual fixture VM through a second source evaluation, keeping the
 // same document/DOM and real request behavior.
 const context={document:f.document,window:f.window,location:f.location,history:{pushState(){}},fetch:async()=>f.response({data:[{id:'general',title:'一般',purpose:'conversation'}]}),AbortController,crypto:require('node:crypto').webcrypto,console,Date,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){}};
 vm.runInNewContext(code.replace('export function','function')+';this.mount=mountProjectWorkspace;',context);const view=context.mount(f.root,'orgbrain',{connected:true,request:context.fetch});t.after(()=>view.destroy());await settle();assert(!flat(f.root).some(n=>n.className==='session-workspace'));f.root.hidden=false;await f.window.emit('hashchange',{type:'hashchange'});await settle();assert(flat(f.root).some(n=>n.className==='session-workspace'));
});
test('auth failure during a send cannot unlock composer or preserve private draft',async t=>{
 const options={cacheOwner:owner,storage:storage(),messages:{general:[scoped('server_message')]}};const f=await setup(t,options);options.onRequest=c=>c.method==='POST'?f.response({error:'signed_out'},401):undefined;await f.text('general','private draft');await f.input('general').parent.emit('submit');await settle();assert(f.input('general').disabled);assert.equal(f.input('general').value,'');assert.equal(options.storage.length,0);assert(f.byClass('chat-messages',f.pane('general')).hidden);
});
test('checking/denied identity hides and then clears task breadcrumbs, options and private titles',async t=>{
 const options={cacheOwner:owner,tasks:[{...task('private_task_123','general'),title:'PRIVATE OWNER A TASK'}],hash:'#project/orgbrain/task/private_task_123'};const f=await setup(t,options);assert(flat(f.root).some(n=>n.textContent==='PRIVATE OWNER A TASK'&&!n.hiddenAncestor));
 const gate=defer();options.onRequest=c=>c.resource==='session-cache-context'?gate.promise:undefined;await f.window.emit('blur');const check=f.window.emit('focus');await settle();assert(!flat(f.root).some(n=>String(n.textContent||'').includes('PRIVATE OWNER A TASK')&&!n.hiddenAncestor));gate.resolve(f.response({error:'signed_out'},401));await check;await settle();assert(!flat(f.root).some(n=>String(n.textContent||'').includes('PRIVATE OWNER A TASK')));
});
test('pending/failed identity confirmation cannot mount or paint a previously unmounted cached session',async t=>{
 const store=storage(),cache=factories().makeCache(owner,store);cache.write('orgbrain','session_B',[scoped('cached_private_B','session_B')]);const options={cacheOwner:owner,storage:store};const f=await setup(t,options),gate=defer();options.onRequest=c=>c.resource==='session-cache-context'?gate.promise:undefined;
 await f.window.emit('blur');const check=f.window.emit('focus');await settle();const link=f.find(n=>n.tag==='a'&&n.href==='#project/orgbrain/session/session_B');await link.emit('click');await settle();assert.equal(f.pane('session_B'),undefined);gate.reject(Error('offline'));await check;await link.emit('click');await settle();assert.equal(f.pane('session_B'),undefined);assert(!flat(f.root).some(n=>n.dataset.messageId==='cached_private_B'&&!n.hiddenAncestor));
});
test('authenticated new owner immediately purges foreign/old-version storage, even when reads fail',async t=>{
 const store=storage();factories().makeCache(owner,store).write('orgbrain','session_A',[scoped('private_A','session_A')]);store.setItem('dot-session-display:v0:'+owner+':legacy','old private');store.setItem('unrelated','keep');assert(store.length>1);
 await setup(t,{cacheOwner:other,storage:store,onRequest:c=>c.resource==='messages'?Promise.reject(Error('offline')):undefined});assert.equal(store.length,1);assert.equal(store.getItem('unrelated'),'keep');
});
test('JSON mutations and binary uploads carry expected owner as a precondition',async t=>{
 const f=await setup(t,{cacheOwner:owner});await f.paste('general');await f.text('general','Owned message');await f.input('general').parent.emit('submit');const writes=f.calls.filter(c=>c.method==='POST');assert(writes.some(c=>c.resource==='files'));assert(writes.some(c=>c.resource==='messages'));assert(writes.every(c=>c.headers['X-Dashboard-Expected-Owner']===owner));
});
test('identity revalidation preserves immutable uncertain task retry fields',async t=>{
 const options={cacheOwner:owner,onRequest:c=>c.resource==='task-requests'?Promise.reject(Error('unknown save result')):undefined};const f=await setup(t,options),form=f.byClass('task-request-form',f.pane('general')),title=form.children.find(n=>n.placeholder==='タスク名'),scope=form.children.find(n=>n.placeholder==='依頼内容・期待する結果');title.value='Immutable task';scope.value='Original scope';await form.emit('submit');assert(title.disabled&&scope.disabled);await f.window.emit('focus');await settle();assert(title.disabled&&scope.disabled);assert.equal(f.calls.filter(c=>c.resource==='task-requests').length,1);
});
