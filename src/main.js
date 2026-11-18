import { getState, subscribe, createPage, updatePage, deletePage, movePage, touchPage, addDocument, removeDocument, toggleDark, saveBlob, readBlob, deleteBlob, updateChats } from './store.js';
import { mountEditor, plainText } from './editor.js';
import { answerWorkspaceQuery } from './assistant.js';

const $ = selector => document.querySelector(selector);
const state = getState();
let currentPageId = state.recentIds.find(id => state.pages.some(p => p.id === id)) || 'welcome';
let currentView = 'home';
let editor = null;
let titleTimer = null;
let toastTimer = null;
let searchItems = [];
let searchIndex = 0;
const collapsedPageIds = new Set();
let chat = [...state.chats];
const content = $('#workspace-content');

function escapeHTML(text) { return String(text ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch])); }
function formatDate(iso) { const date = new Date(iso); return Number.isNaN(+date) ? 'Recently' : date.toLocaleDateString(undefined,{month:'short',day:'numeric'}); }
function showToast(text) { const toast=$('#toast');toast.textContent=text;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),2200); }
function markSaving() { const badge=$('#save-status');badge.classList.add('saving');badge.innerHTML='<i></i>Saving'; }
function markSaved() { const badge=$('#save-status');badge.classList.remove('saving');badge.innerHTML='<i></i>Saved'; }
function currentPage() { return state.pages.find(page=>page.id===currentPageId); }
function pageExcerpt(page) { return (page.blocks||[]).map(b=>plainText(b.content||'')).find(Boolean)||'No content yet'; }

function renderNav() {
  const favorites=state.pages.filter(page=>page.favorite);
  $('#favorites-list').innerHTML=favorites.length?favorites.map(page=>pageRow(page,0,false)).join(''):`<div class="nav-empty">No favorites yet</div>`;
  const renderBranch=(parentId,depth)=>state.pages.filter(page=>page.parentId===parentId).map(page=>{const hasChildren=state.pages.some(child=>child.parentId===page.id);return `${pageRow(page,depth,true,hasChildren)}${hasChildren&&!collapsedPageIds.has(page.id)?renderBranch(page.id,depth+1):''}`;}).join('');
  $('#page-tree').innerHTML=renderBranch(null,0)||`<div class="nav-empty">Create your first page</div>`;
  document.querySelectorAll('.nav-item[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===currentView));
}
function pageRow(page,depth,tree,hasChildren=false) {
  return `<div class="page-row ${page.id===currentPageId&&currentView==='page'?'selected':''}" data-page-row="${page.id}" data-depth="${depth}" style="--depth:${depth}" draggable="${tree}">${tree?`<button class="page-disclosure" data-toggle-page="${page.id}" aria-label="${collapsedPageIds.has(page.id)?'Expand':'Collapse'} ${escapeHTML(page.title)}">${hasChildren?(collapsedPageIds.has(page.id)?'›':'⌄'):''}</button>`:''}<button class="page-open" data-open-page="${page.id}" title="${escapeHTML(page.title)}"><span class="page-emoji">${escapeHTML(page.emoji||'📄')}</span><span>${escapeHTML(page.title||'Untitled')}</span></button><span class="row-actions"><button class="row-action" data-favorite-page="${page.id}" title="${page.favorite?'Remove from':'Add to'} favorites">${page.favorite?'★':'☆'}</button><button class="row-action" data-row-menu="${page.id}" title="Page options">···</button></span></div>`;
}

function renderHome() {
  const recent=state.recentIds.map(id=>state.pages.find(p=>p.id===id)).filter(Boolean).slice(0,5);
  const favorites=state.pages.filter(page=>page.favorite);
  const privatePages=state.pages.filter(page=>!page.parentId);
  const docs=state.documents.slice(0,4);
  const rows=pages=>pages.map(page=>`<button class="recent-item" data-open-page="${page.id}"><span class="recent-icon">${escapeHTML(page.emoji||'📄')}</span><span class="recent-copy"><strong>${escapeHTML(page.title)}</strong><small>${escapeHTML(pageExcerpt(page).slice(0,90))}</small></span><small class="home-date">${formatDate(page.updatedAt)}</small></button>`).join('')||'<div class="doc-empty">Nothing here yet.</div>';
  content.innerHTML=`<div class="home-view notion-home"><div class="home-title-row"><h1 class="home-title">Home</h1><button class="home-new-page" id="quick-create">＋ New page</button></div><div class="home-section"><div class="home-section-title"><span>RECENTLY VISITED</span><button id="home-all-pages">Search pages</button></div><div class="recent-list">${rows(recent)}</div></div><div class="home-section"><div class="home-section-title"><span>FAVORITES</span></div><div class="recent-list">${rows(favorites)}</div></div><div class="home-section"><div class="home-section-title"><span>PRIVATE</span><button id="new-private-page">＋ New</button></div><div class="recent-list">${rows(privatePages)}</div></div><div class="home-section home-library"><div class="home-section-title"><span>FILES</span><button id="upload-docs" title="Upload text or PDF documents">＋ Add file</button></div>${docs.length?docs.map(doc=>`<div class="doc-item"><span>${doc.type==='application/pdf'?'▤':'≡'}</span><button class="doc-open" data-open-doc="${doc.id}">${escapeHTML(doc.name)}</button><small>${formatBytes(doc.size)}</small><button data-remove-doc="${doc.id}" title="Remove file">×</button></div>`).join(''):'<div class="doc-empty">Uploaded text and PDFs appear here.</div>'}<div class="doc-empty" style="margin-top:8px">Text files can be searched. PDFs are stored locally and open in your browser.</div></div><button class="home-ask-link" id="home-ask"><span>✳</span>Ask Spaced about your workspace</button></div>`;
  $('#breadcrumb-current').textContent='Home';
}
function formatBytes(bytes=0) { if(bytes<1024)return `${bytes} B`;if(bytes<1048576)return `${(bytes/1024).toFixed(0)} KB`;return `${(bytes/1048576).toFixed(1)} MB`; }

function renderPage() {
  const page=currentPage();if(!page){currentPageId=state.pages[0]?.id||null; if(!currentPageId){renderHome();return;} }
  const active=currentPage();
  if(!active){renderHome();return;}
  currentView='page';touchPage(active.id);
  content.innerHTML=`<div class="page-header"><button class="page-icon" id="page-emoji" title="Change page icon">${escapeHTML(active.emoji||'📄')}</button><textarea class="page-title" id="page-title" rows="1" placeholder="Untitled">${escapeHTML(active.title)}</textarea><div class="page-meta"><span>Updated ${formatDate(active.updatedAt)}</span><span class="meta-separator">·</span><button id="page-favorite" class="meta-link">${active.favorite?'★ In favorites':'☆ Add to favorites'}</button></div></div><div id="editor-mount"></div><div class="upload-zone"><span>＋</span><span>Bring a source into this page</span><button id="page-upload">Upload text or PDF</button></div>`;
  $('#breadcrumb-current').textContent=active.title;
  const title=$('#page-title');title.addEventListener('input',()=>{markSaving();title.style.height='auto';title.style.height=`${title.scrollHeight}px`;clearTimeout(titleTimer);titleTimer=setTimeout(()=>{updatePage(active.id,{title:title.value.trim()||'Untitled'});$('#breadcrumb-current').textContent=title.value.trim()||'Untitled';renderNav();},230);});requestAnimationFrame(()=>{title.style.height='auto';title.style.height=`${title.scrollHeight}px`;});
  $('#page-emoji').addEventListener('click',()=>{const emoji=prompt('Choose an emoji for this page',active.emoji||'📄');if(emoji!==null){updatePage(active.id,{emoji:emoji.trim().slice(0,4)||'📄'});renderPage();renderNav();}});
  $('#page-favorite').addEventListener('click',()=>{updatePage(active.id,{favorite:!active.favorite});$('#page-favorite').textContent=active.favorite?'★ In favorites':'☆ Add to favorites';renderNav();});
  editor=mountEditor($('#editor-mount'),active,{onChange:markSaving,onChooseImage:()=>$('#image-input').click()});
  const linkedFiles=state.documents.filter(doc=>doc.sourcePageId===active.id);
  if(linkedFiles.length){const list=document.createElement('div');list.className='page-file-list';list.innerHTML=`<div class="home-section-title">SOURCES IN THIS PAGE</div>${linkedFiles.map(doc=>`<div class="doc-item"><span>${doc.type==='application/pdf'?'▤':'≡'}</span><button class="doc-open" data-open-doc="${doc.id}">${escapeHTML(doc.name)}</button><small>${formatBytes(doc.size)}</small><button data-remove-doc="${doc.id}" title="Remove file">×</button></div>`).join('')}`;$('#editor-mount').after(list);}
}

function renderSettings() {
  const dark=state.settings.dark;
  content.innerHTML=`<div class="settings-view"><div class="greeting">WORKSPACE</div><h1>Settings</h1><p class="home-subtitle">Make Spaced feel like yours.</p><div style="margin-top:28px"><div class="settings-row"><div><strong>Appearance</strong><small>Choose a light or dark workspace.</small></div><button class="toggle-switch" id="settings-theme" aria-label="Toggle dark mode" aria-pressed="${dark}"></button></div><div class="settings-row"><div><strong>Workspace storage</strong><small>Saved in this browser · ${state.pages.length} pages · ${state.documents.length} files</small></div><button id="export-workspace">Export backup</button></div><div class="settings-row"><div><strong>Assistant</strong><small>Local search is active. No model provider is connected.</small></div><button id="settings-assistant">Open assistant</button></div><div class="settings-row"><div><strong>Start fresh</strong><small>Remove pages, files, and workspace data from this browser.</small></div><button id="clear-workspace" class="danger-button">Clear workspace</button></div></div></div>`;
  $('#breadcrumb-current').textContent='Settings';
  $('#settings-theme').addEventListener('click',setTheme);
  $('#export-workspace').addEventListener('click',exportWorkspace);
  $('#settings-assistant').addEventListener('click',openAssistant);
  $('#clear-workspace').addEventListener('click',clearWorkspace);
}
function renderUpdates() {
  const sorted=[...state.pages].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  content.innerHTML=`<div class="home-view"><div class="greeting">RECENT ACTIVITY</div><h1 class="home-title">Recently updated</h1><p class="home-subtitle">Your latest notes and ideas.</p><div class="recent-list" style="margin-top:25px">${sorted.map(p=>`<button class="recent-item" data-open-page="${p.id}"><span class="recent-icon">${escapeHTML(p.emoji||'📄')}</span><span class="recent-copy"><strong>${escapeHTML(p.title)}</strong><small>${escapeHTML(pageExcerpt(p).slice(0,90))}</small></span><small>${formatDate(p.updatedAt)}</small></button>`).join('')}</div></div>`;
  $('#breadcrumb-current').textContent='Updates';
}
function render() {
  document.body.classList.toggle('dark',state.settings.dark);
  $('#theme-toggle').setAttribute('aria-pressed',String(state.settings.dark));
  $('#theme-toggle').title=state.settings.dark?'Switch to light mode':'Switch to dark mode';
  renderNav();
  if(currentView==='page')renderPage();else if(currentView==='settings')renderSettings();else if(currentView==='updates')renderUpdates();else renderHome();
  renderChat();
}

function openPage(id) { const page=state.pages.find(p=>p.id===id);if(!page)return;let parent=page.parentId;while(parent){collapsedPageIds.delete(parent);parent=state.pages.find(p=>p.id===parent)?.parentId;}currentPageId=id;currentView='page';touchPage(id);render();closeSidebar(); }
function newPage(parentId=null) { if(parentId)collapsedPageIds.delete(parentId);const page=createPage({parentId,title:'Untitled'});currentPageId=page.id;currentView='page';render();closeSidebar();setTimeout(()=>$('#page-title')?.focus(),50); }
function openView(view) { currentView=view==='home'?'home':view;render();closeSidebar(); }
function closeSidebar() { $('#sidebar').classList.remove('open'); }
function setTheme() { const dark=toggleDark();document.body.classList.toggle('dark',dark);render(); }

function openMenu(anchor, items) {
  document.querySelector('.context-menu')?.remove();const menu=document.createElement('div');menu.className='context-menu';menu.innerHTML=items.map(item=>`<button class="${item.danger?'danger':''}" data-action="${item.id}">${item.label}</button>`).join('');document.body.append(menu);
  const rect=anchor.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(rect.right-menu.offsetWidth,innerWidth-menu.offsetWidth-8))}px`;menu.style.top=`${Math.min(rect.bottom+4,innerHeight-menu.offsetHeight-8)}px`;
  menu.addEventListener('click',e=>{const button=e.target.closest('[data-action]');if(!button)return;const action=items.find(i=>i.id===button.dataset.action);menu.remove();action?.run();});
  const dismiss=e=>{if(!menu.contains(e.target)&&e.target!==anchor){menu.remove();document.removeEventListener('pointerdown',dismiss);}};setTimeout(()=>document.addEventListener('pointerdown',dismiss),0);
}
function pageMenu(pageId,anchor) {
  const page=state.pages.find(p=>p.id===pageId);if(!page)return;
  openMenu(anchor,[
    {id:'rename',label:'Rename page',run:()=>{const title=prompt('Page name',page.title);if(title?.trim())updatePage(pageId,{title:title.trim()});render();}},
    {id:'favorite',label:page.favorite?'Remove from favorites':'Add to favorites',run:()=>{updatePage(pageId,{favorite:!page.favorite});renderNav();}},
    {id:'new-child',label:'Add subpage',run:()=>newPage(pageId)},
    {id:'duplicate',label:'Duplicate page',run:()=>{const copy=createPage({title:`${page.title} copy`,parentId:page.parentId,emoji:page.emoji});updatePage(copy.id,{blocks:JSON.parse(JSON.stringify(page.blocks))});currentPageId=copy.id;currentView='page';render();}},
    {id:'delete',label:'Delete page',danger:true,run:()=>{if(!confirm(`Delete “${page.title}” and its subpages?`))return;deletePage(pageId);if(currentPageId===pageId||!state.pages.some(p=>p.id===currentPageId))currentView='home';render();}}
  ]);
}

function beginSearch(query='') { $('#search-overlay').hidden=false;$('#global-search').value=query;runSearch(query);setTimeout(()=>$('#global-search').focus(),0); }
function runSearch(query) {
  const q=query.trim().toLowerCase();const pages=state.pages.filter(page=>!q||page.title.toLowerCase().includes(q)||(page.blocks||[]).some(b=>plainText(b.content||'').toLowerCase().includes(q))).map(page=>({kind:'page',id:page.id,title:page.title,icon:page.emoji||'📄',detail:pageExcerpt(page)}));
  const docs=state.documents.filter(doc=>!q||doc.name.toLowerCase().includes(q)||(doc.content||'').toLowerCase().includes(q)).map(doc=>({kind:'document',id:doc.id,title:doc.name,icon:doc.type==='application/pdf'?'▤':'≡',detail:doc.content?doc.content.slice(0,90):'PDF · saved in this browser'}));
  searchItems=[...pages,...docs].slice(0,12);searchIndex=0;
  $('#search-results').innerHTML=searchItems.length?`<div class="search-group-label">${q?'SEARCH RESULTS':'QUICK OPEN'}</div>${searchItems.map((item,i)=>`<button class="search-result ${i===0?'active':''}" data-search-index="${i}"><span class="search-result-icon">${escapeHTML(item.icon)}</span><span class="search-result-copy"><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.detail)}</small></span><span style="color:#a0a499;font-size:10px">${item.kind==='page'?'Page':'File'}</span></button>`).join('')}`:`<div class="search-empty">No pages or files match “${escapeHTML(query)}”.</div>`;
}
function chooseSearch(index) { const item=searchItems[index];if(!item)return;$('#search-overlay').hidden=true;if(item.kind==='page')openPage(item.id);else openDocument(item.id); }

async function uploadFiles(files) {
  for(const file of [...files]){
    const id=crypto.randomUUID();const textFile=/\.(txt|md|markdown)$/i.test(file.name)||/^text\//.test(file.type);const type=file.type||(/\.pdf$/i.test(file.name)?'application/pdf':'text/plain');
    try{await saveBlob(id,file);const content=textFile?await file.text():'';addDocument({id,name:file.name,type,size:file.size,content,sourcePageId:currentView==='page'?currentPageId:null,createdAt:new Date().toISOString()});}
    catch(error){showToast(`Could not save ${file.name}`);console.warn(error);}
  }
  $('#file-input').value='';render();showToast(`${files.length} file${files.length===1?'':'s'} added to your library`);
}
async function openDocument(id) {
  const doc=state.documents.find(item=>item.id===id);if(!doc)return;
  if(doc.content){const w=window.open('','_blank');if(!w){showToast('Allow pop-ups to preview this file');return;}w.document.write(`<title>${escapeHTML(doc.name)}</title><pre style="white-space:pre-wrap;font:15px/1.7 system-ui;max-width:760px;margin:50px auto;padding:0 20px">${escapeHTML(doc.content)}</pre>`);w.document.close();}
  else {const preview=window.open('about:blank','_blank');if(!preview){showToast('Allow pop-ups to preview this file');return;}const blob=await readBlob(id);if(!blob){preview.close();showToast('This file is no longer available in this browser');return;}preview.location.href=URL.createObjectURL(blob);}
}
async function removeDoc(id) { const doc=state.documents.find(d=>d.id===id);if(!doc)return;if(!confirm(`Remove “${doc.name}” from your library?`))return;removeDocument(id);await deleteBlob(id);render(); }

function exportWorkspace() { const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`spaced-workspace-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);showToast('Workspace backup downloaded'); }
function clearWorkspace() { if(!confirm('This removes all pages and workspace data from this browser. Download a backup first if you want to keep it.'))return;localStorage.removeItem('spaced.workspace.v1');location.reload(); }
function openAssistant() { $('#assistant-panel').hidden=false;setTimeout(()=>$('#chat-input').focus(),30); }
function closeAssistant() { $('#assistant-panel').hidden=true; }

function renderChat() {
  const host=$('#chat-messages');if(!host)return;
  host.innerHTML=chat.length?chat.map(message=>`<div class="chat-message ${message.role}"><div class="role">${message.role==='user'?'YOU':'SPACED · WORKSPACE LOOKUP'}</div><div class="bubble">${escapeHTML(message.text)}</div>${message.citations?.length?`<div class="citation-list">${message.citations.map(c=>`<button class="citation" data-citation="${c.id}" data-kind="${c.type}">↗ ${escapeHTML(c.title)}</button>`).join('')}</div>`:''}</div>`).join(''):`<div class="chat-empty"><span>✳</span>Your notes are close at hand. Ask about a project, a meeting, or an idea you saved.</div>`;
  host.scrollTop=host.scrollHeight;
}
function ask(query) {
  if(!query.trim())return;chat.push({role:'user',text:query.trim()});const result=answerWorkspaceQuery(query.trim(),state,currentPageId);chat.push({role:'assistant',text:result.text,citations:result.citations});chat=chat.slice(-30);updateChats(chat);renderChat();$('#chat-input').value='';
}

// Workspace controls
$('#brand-home').addEventListener('click',()=>openView('home'));
$('#breadcrumb-home').addEventListener('click',()=>openView('home'));
document.querySelectorAll('.nav-item[data-view]').forEach(button=>button.addEventListener('click',()=>openView(button.dataset.view)));
$('#new-page').addEventListener('click',()=>newPage());
$('#home-all-pages')?.addEventListener('click',()=>beginSearch());
$('#favorite-add').addEventListener('click',()=>{const page=currentPage();if(!page){showToast('Open a page to add it to favorites');return;}updatePage(page.id,{favorite:true});renderNav();showToast('Added to favorites');});
$('#theme-toggle').addEventListener('click',setTheme);
$('#open-sidebar').addEventListener('click',()=>$('#sidebar').classList.add('open'));$('#close-sidebar').addEventListener('click',closeSidebar);
$('#open-assistant').addEventListener('click',openAssistant);$('#home-ask')?.addEventListener('click',openAssistant);$('#close-assistant').addEventListener('click',closeAssistant);
$('#workspace-switcher').addEventListener('click',e=>openMenu(e.currentTarget,[{id:'settings',label:'Workspace settings',run:()=>openView('settings')},{id:'export',label:'Export workspace',run:exportWorkspace},{id:'upload',label:'Import text or PDF',run:()=>$('#file-input').click()}]));
$('#workspace-menu').addEventListener('click',e=>openMenu(e.currentTarget,[{id:'settings',label:'Workspace settings',run:()=>openView('settings')},{id:'export',label:'Export workspace',run:exportWorkspace},{id:'upload',label:'Import text or PDF',run:()=>$('#file-input').click()}]));
$('#page-menu').addEventListener('click',e=>{const page=currentPage();if(page)pageMenu(page.id,e.currentTarget);else showToast('Open a page to see its options');});
$('#share-page').addEventListener('click',async()=>{const page=currentPage();if(!page){showToast('Open a page to copy its link');return;}const link=`${location.origin}${location.pathname}#page=${encodeURIComponent(page.id)}`;try{await navigator.clipboard.writeText(link);showToast('Page link copied');}catch{showToast('Clipboard access is unavailable in this browser');}});
$('#file-input').addEventListener('change',e=>{if(e.target.files?.length)uploadFiles(e.target.files);});
$('#image-input').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file||!editor)return;const blobId=crypto.randomUUID();try{await saveBlob(blobId,file);editor.insert('image',{blobId,alt:file.name});showToast('Image added');}catch{showToast('Could not save this image');}e.target.value='';});
$('#sidebar-search').addEventListener('focus',()=>beginSearch($('#sidebar-search').value));
$('#sidebar-search').addEventListener('input',e=>{if(!$('#search-overlay').hidden){$('#global-search').value=e.target.value;runSearch(e.target.value);}});
$('#global-search').addEventListener('input',e=>runSearch(e.target.value));
$('#search-overlay').addEventListener('click',e=>{if(e.target===$('#search-overlay'))$('#search-overlay').hidden=true;});
$('#search-results').addEventListener('click',e=>{const result=e.target.closest('[data-search-index]');if(result)chooseSearch(Number(result.dataset.searchIndex));});
$('#search-results').addEventListener('mousemove',e=>{const result=e.target.closest('[data-search-index]');if(!result)return;searchIndex=Number(result.dataset.searchIndex);document.querySelectorAll('.search-result').forEach((item,i)=>item.classList.toggle('active',i===searchIndex));});
$('#chat-form').addEventListener('submit',e=>{e.preventDefault();ask($('#chat-input').value);});
$('#chat-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#chat-form').requestSubmit();}});
document.querySelectorAll('.assistant-suggestions button').forEach(button=>button.addEventListener('click',()=>ask(button.dataset.prompt)));
$('#chat-messages').addEventListener('click',e=>{const citation=e.target.closest('[data-citation]');if(!citation)return;if(citation.dataset.kind==='page')openPage(citation.dataset.citation);else{closeAssistant();openDocument(citation.dataset.citation);}});
content.addEventListener('click',e=>{const open=e.target.closest('[data-open-page]');if(open){openPage(open.dataset.openPage);return;}const doc=e.target.closest('[data-open-doc]');if(doc){openDocument(doc.dataset.openDoc);return;}const del=e.target.closest('[data-remove-doc]');if(del)removeDoc(del.dataset.removeDoc);if(e.target.closest('#upload-docs')||e.target.closest('#page-upload'))$('#file-input').click();if(e.target.closest('#home-ask'))openAssistant();if(e.target.closest('#home-all-pages'))beginSearch();if(e.target.closest('#quick-create')||e.target.closest('#new-private-page'))newPage();});
document.querySelectorAll('.page-list').forEach(list=>{
  list.addEventListener('click',e=>{const toggle=e.target.closest('[data-toggle-page]');if(toggle){const id=toggle.dataset.togglePage;collapsedPageIds.has(id)?collapsedPageIds.delete(id):collapsedPageIds.add(id);renderNav();return;}const open=e.target.closest('[data-open-page]');if(open){openPage(open.dataset.openPage);return;}const fav=e.target.closest('[data-favorite-page]');if(fav){const page=state.pages.find(p=>p.id===fav.dataset.favoritePage);if(page){updatePage(page.id,{favorite:!page.favorite});renderNav();}return;}const menu=e.target.closest('[data-row-menu]');if(menu)pageMenu(menu.dataset.rowMenu,menu);});
  list.addEventListener('dragstart',e=>{const row=e.target.closest('[data-page-row][draggable="true"]');if(!row)return;e.dataTransfer.setData('text/spaced-page',row.dataset.pageRow);e.dataTransfer.effectAllowed='move';row.classList.add('dragging');});
  list.addEventListener('dragend',e=>{e.target.closest('.page-row')?.classList.remove('dragging');list.querySelectorAll('.drop-target').forEach(row=>row.classList.remove('drop-target'));});
  list.addEventListener('dragover',e=>{const row=e.target.closest('[data-page-row]');if(!row)return;e.preventDefault();row.classList.add('drop-target');});
  list.addEventListener('dragleave',e=>e.target.closest('.page-row')?.classList.remove('drop-target'));
  list.addEventListener('drop',e=>{const row=e.target.closest('[data-page-row]');if(!row)return;e.preventDefault();const id=e.dataTransfer.getData('text/spaced-page');if(!id||id===row.dataset.pageRow)return;movePage(id,row.dataset.pageRow);renderNav();showToast('Page moved inside folder');});
});
$('#page-tree').addEventListener('dragover',e=>{if(e.target===$('#page-tree'))e.preventDefault();});
$('#page-tree').addEventListener('drop',e=>{if(e.target.closest('[data-page-row]'))return;e.preventDefault();const id=e.dataTransfer.getData('text/spaced-page');if(id){movePage(id,null);renderNav();showToast('Page moved to Private');}});
document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();beginSearch();return;}
  if(e.key==='Escape'){if(!$('#search-overlay').hidden){$('#search-overlay').hidden=true;return;}if(!$('#assistant-panel').hidden){closeAssistant();return;}document.querySelector('.context-menu')?.remove();}
  if(!$('#search-overlay').hidden){if(e.key==='ArrowDown'||e.key==='ArrowUp'){if(searchItems.length){searchIndex=(searchIndex+(e.key==='ArrowDown'?1:-1)+searchItems.length)%searchItems.length;document.querySelectorAll('.search-result').forEach((item,i)=>item.classList.toggle('active',i===searchIndex));}e.preventDefault();}if(e.key==='Enter')chooseSearch(searchIndex);}
});

subscribe(()=>{renderNav();if(currentView==='page'){$('#breadcrumb-current').textContent=currentPage()?.title||'Untitled';}markSaved();});
window.addEventListener('hashchange',()=>{const match=location.hash.match(/page=([^&]+)/);if(match)openPage(decodeURIComponent(match[1]));});
const initialHash=location.hash.match(/page=([^&]+)/);if(initialHash&&state.pages.some(p=>p.id===decodeURIComponent(initialHash[1])))currentPageId=decodeURIComponent(initialHash[1]);
render();
