const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const workspaceRoot=require('node:path').resolve(__dirname,'..');
let focused=null;
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.events={};this.dataset={};this.value='';this.scrollTop=0;this.scrollLeft=0;this.offsetHeight=40;this.clientHeight=500;this.scrollHeight=1000}
 append(...items){this.children.push(...items)}
 replaceChildren(...items){this.children=[...items]}
 setAttribute(k,v){this[k]=v}
 removeAttribute(k){delete this[k]}
 addEventListener(k,handler){(this.events[k]??=[]).push(handler)}
 closest(){return null}
 querySelector(){return null}
 focus(){focused=this}
 scrollIntoView(options){this.scrolled=options}
 getBoundingClientRect(){return {left:0,top:0,width:300,bottom:50,height:50}}
 async emit(type,event={}){for(const handler of this.events[type]||[])await handler(event)}
}
const flat=n=>[n,...n.children.flatMap(flat)];
const root=new Element('root'),posts=[],windowEvents=new Map();
const source={id:'src_original',kind:'main_chat',text:'<img src=x onerror=alert(1)>',createdAt:'2026-10-08T00:00:00Z',messageRef:'main_message_001',roomId:'main_room_001',metadata:{mode:'plan_only'},context:[{messageId:'prior_assistant_001',author:'assistant',createdAt:'2026-10-07T23:59:00Z',text:'<script>fake</script>'}]};
const native={id:'msg_followup',kind:'dashboard',author:'user',text:'Actual dashboard followup',createdAt:'2026-10-08T00:01:00Z',metadata:{mode:'plan_only'}};
let tasks=[{id:'task_parent',title:'Synthetic existing plan',source_message_id:source.id,requestSource:source,linkedSources:[],state:'queued',action:'proposed',scope:'Scope',updated_at:'2026-10-08T00:00:00Z',priority:50,dependencies:[],revision:1},{id:'task_child',title:'Synthetic next step',source_message_id:source.id,requestSource:source,linkedSources:[],parent_task_id:'task_parent',state:'queued',action:'proposed',scope:'Child scope',updated_at:'2026-10-08T00:00:00Z',priority:50,dependencies:[],revision:1}];
let messages=[{id:native.id,author:'user',text:native.text,created_at:native.createdAt,metadata:native.metadata,receipt:null}];
const location={hash:'#project/astraharness/task/task_parent'};
const window={scrollY:0,addEventListener(k,v){const set=windowEvents.get(k)||new Set();set.add(v);windowEvents.set(k,set)},removeEventListener(k,v){windowEvents.get(k)?.delete(v)},scrollTo(x,y){this.scrollY=y}};
const request=async(path,options)=>{if(options.method==='POST'){posts.push({path,body:options.body});throw Error('UI review must not post')}
 return {ok:true,json:async()=>path.endsWith('/notification-status')?{notification:{state:'ready'}}:path.endsWith('/composer-config')?{files:{available:false}}:{data:structuredClone(path.endsWith('/tasks')?tasks:messages)}}};
const context={document:{createElement:t=>new Element(t),hidden:false},window,location,fetch:request,AbortController,crypto,console,Date,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){}};
vm.runInNewContext(fs.readFileSync(workspaceRoot+'/project-workspace.js','utf8').replace('export function','function')+'\nthis.mount=mountProjectWorkspace;',context);
const mounted=context.mount(root,'astraharness',{connected:true,request});
const find=fn=>flat(root).find(fn),card=id=>find(n=>n.dataset.taskId===id),message=id=>find(n=>n.dataset.messageId===id),button=(within,label)=>flat(within).find(n=>n.tag==='button'&&n.textContent===label);
const tick=()=>new Promise(r=>setImmediate(r));
const hashchange=async hash=>{location.hash=hash;for(const fn of windowEvents.get('hashchange')||[])fn();await tick()};

(async()=>{
 await tick();
 assert.equal(card('task_parent').dataset.selected,'true');assert.equal(focused,card('task_parent'));assert.equal(find(n=>n.className==='project-kanban').hidden,false);
 const sourceDetails=flat(card('task_parent')).find(n=>n.className==='task-source-details');assert(sourceDetails);assert(!sourceDetails.open);
 sourceDetails.open=true;const contextDetails=sourceDetails.children.find(n=>n.tag==='details');assert(contextDetails);contextDetails.open=true;
 assert(flat(sourceDetails).some(n=>n.textContent===source.text));assert(flat(sourceDetails).some(n=>n.textContent===source.context[0].text));
 assert(!flat(sourceDetails).some(n=>n.tag==='img'||n.tag==='script'||n.innerHTML));assert(flat(sourceDetails).some(n=>n.textContent?.includes('計画のみ')));
 assert.equal(flat(find(n=>n.className==='chat-messages')).filter(n=>n.tag==='article').length,1);assert(!flat(find(n=>n.className==='chat-messages')).some(n=>n.textContent===source.text));
 assert(!button(message(native.id),'関連タスクを見る'));
 const before=JSON.stringify({tasks,messages});
 const input=find(n=>n.id==='compose-astraharness');input.value='Existing unsent text';
 await button(card('task_parent'),'このタスクについて指示').emit('click');
 assert.equal(find(n=>n.className==='project-chat').hidden,false);assert(input.value.startsWith('Existing unsent text\n'));assert(input.value.includes('task_parent'));assert.equal(focused,input);assert.equal(posts.length,0);assert.equal(JSON.stringify({tasks,messages}),before);
 await hashchange('#project/astraharness/task/task_child');assert.equal(card('task_child').dataset.selected,'true');assert.equal(focused,card('task_child'));
 await hashchange('#project/astraharness');await hashchange('#project/astraharness/task/task_parent');assert.equal(card('task_parent').dataset.selected,'true');
 tasks[0]={...tasks[0],revision:2,linkedSources:[{...native,note:'Followup of the same existing task',relation:'follow_up'}]};
 await mounted.refresh();
 const related=button(message(native.id),'関連タスクを見る');assert(related,'Adding a source link must refresh the old message row');
 await related.emit('click');assert.equal(card('task_parent').dataset.selected,'true');assert.equal(focused,card('task_parent'));
 const updated=flat(card('task_parent')).find(n=>n.className==='task-source-details');assert(flat(updated).some(n=>n.textContent===native.text));assert(flat(updated).some(n=>n.textContent==='Followup of the same existing task'));
 assert.equal(updated.open,true,'Refresh must preserve an open provenance section');assert.equal(updated.children.find(n=>n.tag==='details').open,true,'Refresh must preserve an open context quote');assert(flat(updated).some(n=>n.textContent?.startsWith('後続の指示 · このページ')));
 assert(flat(message(native.id)).some(n=>n.className==='receipt pending'));assert(!flat(message(native.id)).some(n=>n.className==='receipt received'));
 tasks[1]={...tasks[1],revision:2,linkedSources:[{...native,relation:'follow_up',note:'Also references child'}]};await mounted.refresh();assert(button(message(native.id),'Synthetic existing plan'));assert(button(message(native.id),'Synthetic next step'));
 await button(message(native.id),'Synthetic next step').emit('click');assert.equal(card('task_child').dataset.selected,'true');assert.equal(find(n=>n.className==='project-kanban').hidden,false);
 input.disabled=true;const oldDraft=input.value;await button(card('task_child'),'このタスクについて指示').emit('click');assert.equal(input.value,oldDraft);assert.equal(posts.length,0);
 const link=flat(card('task_child')).find(n=>n.tag==='a'&&n.textContent==='タスクへのリンク');assert.equal(link.href,'#project/astraharness/task/task_child');
 await hashchange('#project/astraharness/task/task_missing');assert.equal(posts.length,0);assert(!find(n=>n.className==='workspace-status').textContent.includes('最新状態を取得できません'));
 mounted.destroy();assert.equal(windowEvents.get('hashchange').size,0);assert.equal(posts.length,0);
 console.log('PASS: deep link selects parent/child, hash back/forward, safe collapsible provenance text, no main-chat mirroring, draft-only discussion with preserved input, pending-send protection, delayed/multiple linked-source navigation, unchanged receipts, zero POSTs, event cleanup');
})().catch(e=>{console.error(e);process.exitCode=1});
