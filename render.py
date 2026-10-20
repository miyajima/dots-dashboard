import json,html
from pathlib import Path
from datetime import datetime
root=Path(__file__).parent
(root/'dist').mkdir(parents=True,exist_ok=True)
data=json.loads((root/'projects.json').read_text());projects=data['projects'];e=html.escape
css=(root/'dashboard.css').read_text()+'\n'+(root/'project-workspace.css').read_text()+'\n'+(root/'app-shell.css').read_text()+'\n'+(root/'project-status.css').read_text()+'\n'+(root/'codex-inventory.css').read_text()
labels={'push':'変更をpush','review':'PRを確認','merge':'mainへmerge','deploy':'本番へdeploy','install':'Macへ反映・install','investigate':'調査して報告','fix':'修正・再検証して報告','release':'確認 → merge → deploy'}
def copy_button(p,a,label,cls=''):
 return f'<button type="button" class="{cls}" data-project="{p["id"]}" data-copy="{a}" aria-label="{e(p["name"]+"："+label+"。依頼文をコピー")}">{e(label)}</button>'
def actions(p):
 ids=list(labels) if p['id'] not in ['banyanbaby','study-abroad-pdf'] else ['investigate','fix']
 if p.get('manual_action'): ids=[a for a in ids if a not in ['merge','release']]
 return '<details class="actions"><summary>よく使う操作 · 依頼文をコピー</summary><div class="action-grid">'+''.join(copy_button(p,a,labels[a]) for a in ids)+'</div><p class="action-note">repository・branchは記録から確認する依頼文です。対象が曖昧な操作は、実行前にdotが確認します。</p></details>'
def badge(p):return f'<span class="badge status-unconfirmed" data-status-badge="{p["id"]}"><i class="dot" aria-hidden="true"></i>未確認</span>'
def nextbutton(p):
 label=p.get('next_button_label') or {'orgbrain':'マージ状況の確認依頼をコピー','consentside':'検証範囲の提案依頼をコピー'}.get(p['id'],'次の一手の依頼文をコピー')
 prefix=f'<p><a href="{e(p["manual_action"]["url"])}" target="_blank" rel="noopener noreferrer">{e(p["manual_action"]["label"])}</a></p>' if p.get('manual_action') else ''
 return prefix+copy_button(p,'next',label)
def row(label,text):return f'<div class="row"><span class="label">{label}</span><p>{e(text)}</p></div>'
def roadmap_summary(p):
 r=p.get('roadmap')
 if not r:return ''
 done=sum(x['status']=='completed' for x in r['steps']);active=[(i,x) for i,x in enumerate(r['steps'],1) if x['status'] in ['in_progress','partial']]
 current=('一部確認：' if any(x['status']=='partial' for _,x in active) else '進行中：')+ ' ／ '.join(str(i)+' '+x.get('status_label','進行中') for i,x in active) if active else '次の工程は詳細を確認'
 if r.get('state_note'):current=r['state_note']+' '+current
 return f'<div class="roadmap-mini"><p><strong>改善ロードマップ · 完了 {done}/{len(r["steps"])}</strong></p><p>{e(current)}</p><p>PR9のマージ対応とは別に進行</p></div>'
def roadmap_detail(p):
 r=p.get('roadmap')
 if not r:return ''
 done=sum(x['status']=='completed' for x in r['steps']);out=f'<section class="roadmap-panel"><div class="roadmap-title"><h2>{e(r["title"])}</h2><span class="roadmap-total">完了 {done}/{len(r["steps"])}</span></div><p>{e(r["note"])}</p><p class="meta">最終確認：{e(r["verified"])}</p><ol class="roadmap-steps">'
 states={'partial':('in-progress','一部確認・未完了'),'in_progress':('in-progress','進行中'),'not_started':('','未着手'),'completed':('is-complete','完了')}
 for i,x in enumerate(r['steps'],1):
  cls,label=states[x['status']]
  label=x.get('status_label',label)
  out+=f'<li class="roadmap-step {cls}" data-step="{e(x["id"])}" data-status="{x["status"]}"><div class="step-heading"><span class="step-number">{i}</span><h3>{e(x["title"])}</h3><span class="step-status">{label}</span></div><div class="step-meta"><p><strong>完了条件：</strong>{e(x["completion"])}</p><p><strong>確認できた証拠：</strong>{e(x["evidence"])}</p><p class="verified">最終確認：{e(x["verified"])}</p></div></li>'
 out+='</ol>'
 if r.get('state_note'):out+=f'<p class="meta">{e(r["state_note"])}</p>'
 if r.get('continuation'):out+=f'<p class="meta">{e(r["continuation"])}</p>'
 if r.get('candidate_evidence'):out+=f'<details><summary>候補・評価の証拠ID</summary><p>{e(r["candidate_evidence"])}</p></details>'
 return out+'</section>'
def card(p):
 return f'''<article class="card status-unconfirmed" data-project-card="{p["id"]}" data-live-status="{p["id"]}" id="card-{p["id"]}"><div class="card-top"><h2><a href="#project/{p["id"]}">{e(p["name"])}</a></h2>{badge(p)}</div><p class="headline" data-status-headline>現在の状況を取得中…</p><div class="card-blocker"><span class="label">確認・課題</span><p data-status-blocker>最新のタスク・結果を確認しています</p></div><div class="card-footer"><a class="open-project" href="#project/{p["id"]}">開く <span aria-hidden="true">→</span></a><button type="button" class="hide" data-hide="{p["id"]}" aria-label="{e(p["name"])}を一覧から隠す">隠す</button></div><p class="verified" data-status-sync>サーバーの状況は未確認</p></article>'''
def live_records(p):
 return f'''<section class="live-status-panel" data-live-status="{p["id"]}" aria-label="現在の状況"><div class="live-status-heading"><h2>現在の状況</h2><button type="button" data-status-refresh="{p["id"]}">状況を更新</button></div><p class="live-status-sync" data-status-sync role="status" aria-live="polite">サーバーの状況を取得中…</p><p class="headline" data-status-headline>現在の状況を取得中…</p><dl class="live-status-facts"><div><dt>確認・課題</dt><dd data-status-blocker>最新のタスク・結果を確認しています</dd></div><div><dt>次の一手</dt><dd data-status-next>取得後に表示します</dd></div></dl><p class="verified" data-status-times></p><p class="live-status-counts" data-status-counts></p><div data-status-records></div></section>'''
def icon(name):
 paths={'plus':'<path d="M12 5v14M5 12h14"/>','menu':'<path d="M4 6h16M4 12h16M4 18h16"/>','close':'<path d="m6 6 12 12M18 6 6 18"/>','grid':'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'}
 return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[name]+'</svg>'
def detail(p):
 records=f'<details class="project-records" data-status-disclosure="{p["id"]}"><summary>状況・記録</summary><div class="record-popover">{live_records(p)}<details class="historical-records"><summary>過去の記録 · {e(p["verified"])}</summary><p class="history-notice">以下は {e(p["verified"])} 時点の記録です。現在の状況を示すものではありません。</p><p class="headline">{e(p["headline"])}</p><p class="verified">記録の確認日時 {e(p["verified"])}</p><div class="record-grid"><section><h2>当時確認できたこと</h2><p>{e(p["achievement"])}</p>'
 if p.get('confirmed_errors'):records+='<ul>'+''.join('<li>'+e(item)+'</li>' for item in p['confirmed_errors'])+'</ul>'
 records+=f'<p>{e(p["detail"])}</p></section><section><h2>残る課題</h2><p>{e(p["blocker"])}</p>'
 if p.get('unknowns'):records+=f'<p>{e(p["unknowns"])}</p>'
 if p.get('fact'):records+=f'<p>{e(p["fact"])}</p>'
 records+=f'<h2>次の一手</h2><p>{e(p["next"])}</p>'
 if p.get('manual_action'):records+=f'<p><a href="{e(p["manual_action"]["url"])}" target="_blank" rel="noopener noreferrer">{e(p["manual_action"]["label"])}</a></p>'
 records+='</section></div></details></div></details>'
 return f'<div class="detail" data-detail="{p["id"]}" hidden><header class="detail-head"><button type="button" class="nav-toggle" data-open-nav aria-label="プロジェクト一覧を開く" aria-controls="project-sidebar" aria-expanded="false">{icon("menu")}</button><h1 tabindex="-1">{e(p["name"])}</h1>{badge(p)}<button type="button" data-open-codex-project="{p["id"]}" aria-haspopup="dialog">Codexタスク</button>{records}</header><section class="workspace-panel" aria-label="{e(p["name"])}の作業"><div data-workspace="{p["id"]}"></div></section></div>'
stamp=datetime.fromisoformat(data['updated_at']).strftime('%Y/%m/%d %H:%M')
counts={c:sum(p['attention']==c for p in projects) for c in ['red','yellow','green']}
# Archives are already rendered above. Browser routing/status needs only these
# fields; do not ship the entire historical data set a second time as JSON.
serialized=json.dumps([{'id':p['id'],'name':p['name']} for p in projects],ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
nav=''.join(f'<li data-project-nav="{p["id"]}"><div class="project-nav-row"><a href="#project/{p["id"]}" data-nav-project="{p["id"]}"><i class="dot status-unconfirmed" data-status-dot="{p["id"]}" aria-hidden="true"></i><span>{e(p["name"])}</span></a><button type="button" class="session-add" data-add-session="{p["id"]}" aria-label="{e(p["name"])}に新しいスレッドを追加" title="新しいスレッド">{icon("plus")}</button></div><div data-session-navigation="{p["id"]}"></div></li>' for p in projects)
overview=f'''<dialog id="overview-dialog" aria-labelledby="overview-title"><div id="overview"><header class="overview-header"><div><h2 id="overview-title">全体の進捗</h2><p class="meta" id="project-status-sync" role="status" aria-live="polite">現在の状況をサーバーから確認中…</p><button type="button" data-status-refresh="">状況を更新</button></div><button type="button" id="close-overview" aria-label="全体の進捗を閉じる">{icon('close')}</button></header><div class="intro"><p>{len(projects)} プロジェクト</p><div class="legend" id="project-status-legend"><span><i class="dot status-unconfirmed"></i>未確認 {len(projects)}</span></div></div><div class="grid">{''.join(card(p) for p in projects)}<!--user-project-cards--></div><p class="empty" id="empty-overview" hidden>表示中のプロジェクトはありません。下から再表示できます。</p><details class="hidden-panel"><summary id="hidden-summary">隠したプロジェクト <span id="hidden-count">0</span></summary><p id="hide-storage">表示設定を読み込み中…</p><button type="button" id="refresh-preferences">再同期</button><ul id="hidden-list"></ul></details><p class="notice" id="notice" role="status" aria-live="polite"></p><footer><p>現在の状況はタスクと結果の記録から集計し、表示中は約30秒ごとに更新します。過去の記録は「状況・記録」で開けます。</p><button type="button" id="download">HTMLを保存</button></footer></div></dialog>'''
page='''<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#f1f4ee"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="apple-mobile-web-app-title" content="dot プロジェクト"><link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials"><link rel="apple-touch-icon" sizes="180x180" href="/app-icon-180.png"><link rel="icon" type="image/png" sizes="192x192" href="/app-icon-192.png"><meta name="description" content="プロジェクトの状況、会話とタスクを一か所で。"><title>プロジェクト｜dot</title><style>'''+css+'''</style></head><body><div class="app-shell"><aside id="project-sidebar" aria-label="プロジェクト一覧"><div class="sidebar-brand"><span class="sidebar-dot">dot</span><span>プロジェクト</span><button type="button" id="close-sidebar" aria-label="一覧を閉じる">'''+icon('close')+'''</button></div><button type="button" id="open-overview">'''+icon('grid')+'''<span>全体の進捗</span></button><button type="button" id="open-codex-inventory" aria-haspopup="dialog">Codexプロジェクト分類</button><button type="button" id="create-project" aria-haspopup="dialog">＋ プロジェクトを追加</button><nav aria-label="プロジェクト"><ul>'''+nav+'''<!--user-project-navigation--></ul></nav><p class="sidebar-private">あなた専用</p></aside><button type="button" id="sidebar-backdrop" aria-label="プロジェクト一覧を閉じる" hidden></button><main class="app-main" id="app-main">'''+''.join(detail(p)for p in projects)+'''<!--user-project-details--></main></div>'''+overview+'''<dialog id="codex-inventory-dialog"></dialog><dialog id="create-project-dialog" aria-labelledby="create-project-title"><h2 id="create-project-title">プロジェクトを追加</h2><p class="catalog-note" id="project-catalog-note"><strong>既存のCodexプロジェクト</strong><br>現在、一覧を取得できません。デスクトップの更新・再接続後、dotに一覧の取得を依頼してください。いまは名前を入力して追加できます。</p><form id="create-project-form"><div id="project-catalog-picker" hidden><label for="codex-project-choice">Codexプロジェクトを選ぶ</label><select id="codex-project-choice"><option value="">手入力で追加</option></select><p>取得時点の一覧です。最新一覧が必要な場合はdotに再取得を依頼してください。</p></div><label for="new-project-name">プロジェクト名</label><input id="new-project-name" name="name" maxlength="80" required autocomplete="off"><label for="new-project-description">説明（任意）</label><textarea id="new-project-description" name="description" maxlength="500"></textarea><p>あなた専用のダッシュボードに保存します。Codexのフォルダや接続先は変更しません。</p><p id="create-project-status" role="status" aria-live="polite"></p><div class="project-form-actions"><button type="button" id="cancel-project">キャンセル</button><button type="submit" id="save-project">追加する</button></div></form></dialog><script>'''+(root/'project-create.js').read_text()+'''</script><script id="project-data" type="application/json">'''+serialized+'''</script><script>'''+(root/'dashboard.js').read_text()+'''</script><script>'''+(root/'project-status.js').read_text()+'''</script><script type="module">'''+(root/'project-workspace.js').read_text()+'\n'+(root/'codex-inventory.js').read_text()+'''\nmountCodexInventory(document.getElementById('codex-inventory-dialog'),document.getElementById('open-codex-inventory'),{runtime:workspaceRuntime(fetch)});\nfor(const el of document.querySelectorAll('[data-workspace]')){const id=el.dataset.workspace;mountProjectWorkspace(el,id,{connected:true,navigationRoot:document.querySelector('[data-session-navigation=\"'+id+'\"]'),addSessionButton:document.querySelector('[data-add-session=\"'+id+'\"]'),onRouteChange:()=>window.dispatchEvent(new Event('hashchange')),onSessionNavigate:()=>document.querySelector('[data-detail=\"'+id+'\"] h1')?.focus({preventScroll:true})});}</script></body></html>'''
(root/'dist/index.html').write_text(page)
print(f'Rendered {len(projects)} project workspaces, sidebar and overview dialog')
