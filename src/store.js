const STORAGE_KEY = 'spaced.workspace.v1';
const DB_NAME = 'spaced-files';
const DB_STORE = 'blobs';

const now = () => new Date().toISOString();
const block = (type, content = '') => ({ id: crypto.randomUUID(), type, content, checked: false });
const starter = () => {
  const welcome = { id: 'welcome', parentId: null, title: 'Welcome to Spaced', emoji: '✳', favorite: true, createdAt: now(), updatedAt: now(), blocks: [
    block('paragraph', 'Your mind has a little more room now.'),
    block('paragraph', 'Spaced is a home for the notes, plans, and passing thoughts you want to keep. Make a page, write something down, and let your ideas find their place.'),
    block('heading2', 'Make yourself at home'),
    block('bullet', 'Create pages for projects, classes, and everything in between.'),
    block('bullet', 'Type / anywhere in the editor to add a block.'),
    block('bullet', 'Use Ask Spaced to find information across your saved workspace.'),
    block('callout', 'A good second brain should feel like a quiet room, not another inbox.'),
    block('heading2', 'A few places to start'),
    block('paragraph', 'Your pages are private to this browser and save automatically. Try editing this page or create a new one from the sidebar.')
  ]};
  const roadmap = { id: 'roadmap', parentId: null, title: 'SPACED · Product roadmap', emoji: '🪴', favorite: true, createdAt: now(), updatedAt: now(), blocks: [
    block('paragraph', 'A living outline for what we are building and why.'),
    block('heading2', 'North star'), block('paragraph', 'Give curious people a calm, connected place to think, make, and remember.'),
    block('heading2', 'Now · Foundation'), block('task', 'Build a fast, reliable block editor'), block('task', 'Make pages easy to find and organize'), block('task', 'Keep everything saved locally by default'),
    block('heading2', 'Next · Knowledge'), block('task', 'Import and organize source documents'), block('task', 'Search across notes with useful citations'),
    block('heading2', 'Later · Intelligence'), block('task', 'Connect a workspace-aware language model'), block('task', 'Add semantic retrieval and durable conversation context')
  ]};
  const meeting = { id: 'meeting', parentId: null, title: 'Studio sync · 18 Nov', emoji: '🗒️', favorite: false, createdAt: now(), updatedAt: now(), blocks: [
    block('paragraph', 'Weekly product check-in · Tuesday afternoon'), block('heading2', 'What we covered'),
    block('bullet', 'Keep the first-run experience focused on writing, not setup.'), block('bullet', 'Try a softer green accent and warm paper-like surfaces.'),
    block('heading2', 'Action items'), block('task', 'Sketch a workspace landing page'), block('task', 'Ask a few friends to test page search'), block('task', 'Write down what should stay local versus synced'),
    block('heading2', 'Open questions'), block('paragraph', 'What is the smallest useful AI feature that earns a place in the writing flow?')
  ]};
  const research = { id: 'research', parentId: null, title: 'Research library', emoji: '📚', favorite: false, createdAt: now(), updatedAt: now(), blocks: [
    block('paragraph', 'Clips, reading notes, and useful references.'), block('heading2', 'Reading list'), block('bullet', 'The extended mind · Andy Clark and David Chalmers'), block('bullet', 'How to take smart notes · Sönke Ahrens'), block('bullet', 'A pattern language for personal knowledge systems'), block('heading2', 'Notes to explore'), block('paragraph', 'Capture a useful excerpt or upload a text document and it will be searchable from Ask Spaced.')
  ]};
  return { version: 1, pages: [welcome, roadmap, meeting, research], documents: [], recentIds: ['welcome'], chats: [], settings: { dark: false } };
};

function normalize(value) {
  if (!value || !Array.isArray(value.pages)) return starter();
  return { version: 1, pages: value.pages, documents: Array.isArray(value.documents) ? value.documents : [], recentIds: Array.isArray(value.recentIds) ? value.recentIds : [], chats: Array.isArray(value.chats) ? value.chats : [], settings: { dark: !!value.settings?.dark } };
}

let data;
try { data = normalize(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch { data = starter(); }
const listeners = new Set();
let persistTimer;

export function getState() { return data; }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function persist({ immediate = false } = {}) {
  clearTimeout(persistTimer);
  const write = () => { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); listeners.forEach(fn => fn(data)); };
  if (immediate) write(); else persistTimer = setTimeout(write, 180);
}
export function pageById(id) { return data.pages.find(page => page.id === id); }
export function createPage({ title = 'Untitled', parentId = null, emoji = '📄' } = {}) {
  const page = { id: crypto.randomUUID(), parentId, title, emoji, favorite: false, createdAt: now(), updatedAt: now(), blocks: [block('paragraph', '')] };
  data.pages.push(page); persist({ immediate: true }); return page;
}
export function updatePage(id, changes) { const page = pageById(id); if (!page) return; Object.assign(page, changes, { updatedAt: now() }); persist(); }
export function deletePage(id) {
  const ids = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const p of data.pages) if (ids.has(p.parentId) && !ids.has(p.id)) { ids.add(p.id); grew = true; } }
  data.pages = data.pages.filter(p => !ids.has(p.id));
  data.recentIds = data.recentIds.filter(pid => !ids.has(pid));
  persist({ immediate: true });
}
export function movePage(id, parentId) { if (id === parentId) return; let ancestor = parentId && pageById(parentId); while (ancestor) { if (ancestor.id === id) return; ancestor = pageById(ancestor.parentId); } updatePage(id, { parentId }); }
export function touchPage(id) { data.recentIds = [id, ...data.recentIds.filter(pid => pid !== id)].slice(0, 12); persist(); }
export function addDocument(doc) { data.documents.unshift(doc); persist({ immediate: true }); }
export function removeDocument(id) { data.documents = data.documents.filter(doc => doc.id !== id); persist({ immediate: true }); }
export function updateChats(chats) { data.chats = chats; persist(); }
export function toggleDark() { data.settings.dark = !data.settings.dark; persist({ immediate: true }); return data.settings.dark; }
export function makeBlock(type, content = '') { return block(type, content); }
export function replaceBlocks(id, blocks) { const page = pageById(id); if (!page) return; page.blocks = blocks; page.updatedAt = now(); persist(); }

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function saveBlob(id, blob) {
  const database = await db();
  return new Promise((resolve, reject) => { const tx = database.transaction(DB_STORE, 'readwrite'); tx.objectStore(DB_STORE).put(blob, id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}
export async function readBlob(id) {
  const database = await db();
  return new Promise((resolve, reject) => { const req = database.transaction(DB_STORE).objectStore(DB_STORE).get(id); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
export async function deleteBlob(id) { const database = await db(); return new Promise(resolve => { const tx = database.transaction(DB_STORE, 'readwrite'); tx.objectStore(DB_STORE).delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); }); }
