import { makeBlock, replaceBlocks, readBlob } from './store.js';

const blockTypes = [
  ['paragraph', 'T', 'Text', 'Plain text for your thoughts'], ['heading1', 'H1', 'Heading 1', 'A large section heading'],
  ['heading2', 'H2', 'Heading 2', 'A medium section heading'], ['heading3', 'H3', 'Heading 3', 'A small section heading'],
  ['bullet', '•', 'Bulleted list', 'A simple list'], ['task', '☑', 'To-do list', 'Track something you need to do'],
  ['quote', '“', 'Quote', 'Capture a useful line'], ['callout', '✳', 'Callout', 'Highlight a useful thought'], ['code', '</>', 'Code', 'Add a code snippet'], ['table', '▦', 'Simple table', 'A small editable grid'], ['image', '▧', 'Image', 'Add an image from your device']
];
const escapeHTML = text => String(text).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
export function plainText(html) { const doc = new DOMParser().parseFromString(String(html || ''), 'text/html'); return doc.body.textContent || ''; }
function safeHTML(html) {
  const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const allowed = new Set(['B','STRONG','I','EM','U','S','CODE','BR','A','P','DIV','SPAN']);
  const walk = node => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1) {
        if (!allowed.has(child.tagName)) { child.replaceWith(...child.childNodes); continue; }
        for (const attr of [...child.attributes]) if (!(child.tagName === 'A' && attr.name === 'href' && /^(https?:|mailto:)/i.test(attr.value))) child.removeAttribute(attr.name);
        walk(child);
      } else if (child.nodeType !== 3) child.remove();
    }
  };
  walk(parsed.body); return parsed.body.innerHTML;
}

function tableMarkup(content) {
  let rows; try { rows = JSON.parse(content); } catch { rows = [['Column 1','Column 2'],['','']]; }
  if (!Array.isArray(rows) || !rows.length) rows = [['Column 1','Column 2'],['','']];
  return `<table class="table-block"><tbody>${rows.map((row, i) => `<tr>${row.map(cell => `<${i === 0 ? 'th' : 'td'} contenteditable="true">${escapeHTML(cell)}</${i === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</tbody></table>`;
}

export function mountEditor(root, page, { onChange, onChooseImage }) {
  let blocks = page.blocks || [];
  if (!blocks.length) blocks = [makeBlock('paragraph', '')];
  root.innerHTML = `<div class="editor-toolbar" role="toolbar" aria-label="Formatting"><button class="toolbar-btn" data-command="bold" title="Bold"><b>B</b></button><button class="toolbar-btn" data-command="italic" title="Italic"><i>I</i></button><button class="toolbar-btn" data-command="underline" title="Underline"><u>U</u></button><span class="toolbar-divider"></span><button class="toolbar-btn" data-insert="heading2" title="Heading">H₂</button><button class="toolbar-btn" data-insert="bullet" title="Bulleted list">•</button><button class="toolbar-btn" data-insert="task" title="To-do">☑</button><button class="toolbar-btn" data-insert="code" title="Code">&lt;/&gt;</button><span class="toolbar-divider"></span><button class="toolbar-btn" data-insert="table" title="Table">▦</button><button class="toolbar-btn" data-upload-image title="Insert image">▧</button></div><div class="editor-blocks" role="textbox" aria-label="Page editor"></div><div class="inline-hint">Type <kbd>/</kbd> for blocks · Drag the ⠿ handle to reorder</div>`;
  const list = root.querySelector('.editor-blocks');
  let dragId = null;
  let slashIndex = -1;
  const currentBlocks = () => blocks;
  const emit = () => { replaceBlocks(page.id, blocks); onChange?.(); };
  const focusBlock = id => { const el = list.querySelector(`[data-id="${CSS.escape(id)}"] .editable-block`); if (el) { el.focus(); const range = document.createRange(); range.selectNodeContents(el); range.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); } };
  const render = (focusId = null) => {
    list.innerHTML = '';
    for (const item of blocks) {
      const row = document.createElement('div'); row.className = 'block-row'; row.dataset.id = item.id; row.draggable = true;
      const grip = document.createElement('span'); grip.className = 'block-grip'; grip.textContent = '⠿'; grip.title = 'Drag to reorder'; row.append(grip);
      const content = document.createElement('div'); content.className = 'block-content';
      if (item.type === 'image') {
        content.classList.add('image-content'); content.innerHTML = item.blobId ? `<div class="empty-editor">Loading image…</div>` : `<div class="empty-editor">Image block · choose an image from the toolbar</div>`;
        row.append(content); list.append(row);
        if (item.blobId) readBlob(item.blobId).then(blob => { if (!blob || !row.isConnected) return; const img = document.createElement('img'); img.className='block-image'; img.alt=item.alt || 'Workspace image'; img.src=URL.createObjectURL(blob); content.replaceChildren(img); });
        continue;
      }
      if (item.type === 'table') {
        content.innerHTML = tableMarkup(item.content); row.append(content); list.append(row); continue;
      }
      if (item.type === 'task') { const check = document.createElement('input'); check.type='checkbox'; check.className='block-check'; check.checked=!!item.checked; check.setAttribute('aria-label','Mark task complete'); check.addEventListener('change',()=>{item.checked=check.checked; emit();}); row.append(check); }
      if (item.type === 'bullet') { const marker=document.createElement('span'); marker.className='block-list-marker'; marker.textContent='•'; row.append(marker); }
      const edit = document.createElement('div'); edit.className=`editable-block type-${item.type}`; edit.dataset.type=item.type; edit.dataset.placeholder=item.type==='task'?'To-do':item.type==='code'?'Write code…':'Type something…'; edit.contentEditable='true'; edit.spellcheck=item.type!=='code'; edit.innerHTML=safeHTML(item.content || ''); content.append(edit); row.append(content); list.append(row);
    }
    if (focusId) requestAnimationFrame(() => focusBlock(focusId));
  };
  const insertAfter = (index, type, focus = true) => { const next=makeBlock(type, type==='table'?JSON.stringify([['Column 1','Column 2'],['','']]):''); blocks.splice(index+1,0,next); emit(); render(focus?next.id:null); };
  const closeSlash = () => { list.querySelector('.slash-menu')?.remove(); slashIndex=-1; };
  const showSlash = row => {
    closeSlash(); const menu=document.createElement('div'); menu.className='slash-menu'; menu.innerHTML=`<div class="slash-menu-label">Add a block</div>${blockTypes.map(([type,icon,label,desc])=>`<button class="slash-option" data-type="${type}"><span>${icon}</span><span>${label}</span><small>${desc}</small></button>`).join('')}`; row.append(menu);
    menu.addEventListener('mousedown', e => { e.preventDefault(); const button=e.target.closest('[data-type]'); if(!button)return; const rowNow=button.closest('.block-row'); const at=blocks.findIndex(b=>b.id===rowNow.dataset.id); const edit=rowNow.querySelector('.editable-block'); edit.innerHTML=edit.innerHTML.replace(/\/$/,''); const b=blocks[at]; b.content=safeHTML(edit.innerHTML); closeSlash(); insertAfter(at,button.dataset.type); });
  };
  root.addEventListener('click', e => {
    const command=e.target.closest('[data-command]'); if(command){ document.execCommand(command.dataset.command,false); list.querySelector('.editable-block:focus')?.focus(); return; }
    const insert=e.target.closest('[data-insert]'); if(insert){ const active=list.querySelector('.editable-block:focus'); const row=active?.closest('.block-row'); const index=row?blocks.findIndex(b=>b.id===row.dataset.id):blocks.length-1; insertAfter(index,insert.dataset.insert); return; }
    if(e.target.closest('[data-upload-image]')) onChooseImage?.();
  });
  root.addEventListener('mousedown',e=>{if(e.target.closest('[data-command],[data-insert],[data-upload-image]'))e.preventDefault();});
  list.addEventListener('input', e => {
    const edit=e.target.closest('.editable-block');
    if(edit){ const row=edit.closest('.block-row'); const item=blocks.find(b=>b.id===row.dataset.id); if(item) item.content=safeHTML(edit.innerHTML); emit();
      const text=plainText(edit.innerHTML); if(text.endsWith('/') && !text.includes('\n')) showSlash(row); else closeSlash();
      if(text === '/' && item) { item.content=''; edit.innerHTML=''; emit(); }
    }
    const cell=e.target.closest('td,th'); if(cell){const row=cell.closest('.block-row');const item=blocks.find(b=>b.id===row.dataset.id);const table=row.querySelector('table');item.content=JSON.stringify([...table.rows].map(tr=>[...tr.cells].map(td=>td.innerText)));emit();}
  });
  list.addEventListener('keydown', e => {
    if(e.key==='Escape' && list.querySelector('.slash-menu')){closeSlash();e.preventDefault();return;}
    const menu=list.querySelector('.slash-menu'); if(menu && ['ArrowDown','ArrowUp'].includes(e.key)){const opts=[...menu.querySelectorAll('.slash-option')];slashIndex=(slashIndex+(e.key==='ArrowDown'?1:-1)+opts.length)%opts.length;opts.forEach((o,i)=>o.classList.toggle('active',i===slashIndex));e.preventDefault();return;}
    if(menu && e.key==='Enter' && slashIndex>=0){menu.querySelectorAll('.slash-option')[slashIndex]?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));e.preventDefault();return;}
    const edit=e.target.closest('.editable-block'); if(!edit)return;
    const row=edit.closest('.block-row'); const item=blocks.find(b=>b.id===row.dataset.id); if(!item)return;
    if(e.key==='Backspace'&&!plainText(edit.innerHTML).trim()&&blocks.length>1){e.preventDefault();const index=blocks.indexOf(item);blocks.splice(index,1);emit();render();focusBlock(blocks[Math.max(0,index-1)].id);return;}
    if(e.key!=='Enter'||e.shiftKey)return;
    if(item.type==='code')return;
    e.preventDefault(); item.content=safeHTML(edit.innerHTML); const index=blocks.indexOf(item); const newType=['bullet','task'].includes(item.type)?item.type:'paragraph'; insertAfter(index,newType);
  });
  list.addEventListener('dragstart',e=>{const row=e.target.closest('.block-row');if(!row)return;dragId=row.dataset.id;row.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragId);});
  list.addEventListener('dragend',e=>{e.target.closest('.block-row')?.classList.remove('dragging');list.querySelectorAll('.drop-above').forEach(x=>x.classList.remove('drop-above'));dragId=null;});
  list.addEventListener('dragover',e=>{const row=e.target.closest('.block-row');if(!row||!dragId||row.dataset.id===dragId)return;e.preventDefault();row.classList.add('drop-above');});
  list.addEventListener('dragleave',e=>e.target.closest('.block-row')?.classList.remove('drop-above'));
  list.addEventListener('drop',e=>{const row=e.target.closest('.block-row');if(!row||!dragId)return;e.preventDefault();const from=blocks.findIndex(b=>b.id===dragId),to=blocks.findIndex(b=>b.id===row.dataset.id);if(from<0||to<0)return;const [moved]=blocks.splice(from,1);blocks.splice(to,0,moved);emit();render();});
  render();
  return { insert: (type, metadata = {}) => { const before=blocks.length; insertAfter(before-1,type); Object.assign(blocks[before],metadata); emit(); render(); }, focusBlock, getBlocks: currentBlocks };
}

