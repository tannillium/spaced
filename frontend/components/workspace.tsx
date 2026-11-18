"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  ArrowDownToLine, ArrowLeft, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronRight, Clock3,
  FileText, Home, Menu, MoreHorizontal, Plus, Search, Settings, Share2, Sparkles, Star, Sun, Moon,
  Trash2, Upload, X,
} from "lucide-react";
import BlockEditor from "@/components/editor";
import { api, type ChatMessage, type DocumentFile, type Page, type SearchHit, type TiptapDoc } from "@/components/api";
import { Button } from "@/components/ui/button";

type View = "home" | "page" | "updates" | "settings";
type Theme = "light" | "dark";
type PagePatch = Partial<Pick<Page, "title" | "parent_id" | "icon" | "favorite" | "blocks">>;
const emptyDoc: TiptapDoc = { type: "doc", content: [{ type: "paragraph" }] };
const historyKey = "spaced.api.chat.v1";

function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Please try again."; }
function sizeLabel(size: number) { return size < 1024 ? `${size} B` : size < 1024*1024 ? `${Math.round(size/1024)} KB` : `${(size/1024/1024).toFixed(1)} MB`; }
function dateLabel(value?: string | null) { if (!value) return ""; const date=new Date(value); return Number.isNaN(date.getTime())?"":date.toLocaleDateString(undefined,{month:"short",day:"numeric"}); }
function excerptFromJson(doc: TiptapDoc) {
  const words: string[]=[];
  const visit=(node: unknown)=>{if(!node||typeof node!=="object")return;const item=node as {type?:string;text?:string;content?:unknown[]};if(item.type==="text"&&item.text)words.push(item.text);item.content?.forEach(visit);};
  visit(doc);return words.join(" ").slice(0,110)||"No content yet";
}

export default function Workspace() {
  const [pages,setPages]=useState<Page[]>([]);
  const [documents,setDocuments]=useState<DocumentFile[]>([]);
  const [activePageId,setActivePageId]=useState<string|null>(null);
  const [view,setView]=useState<View>("home");
  const [theme,setTheme]=useState<Theme>("light");
  const [loaded,setLoaded]=useState(false);
  const [loadError,setLoadError]=useState("");
  const [saveState,setSaveState]=useState<"saved"|"saving"|"error">("saved");
  const [sidebarOpen,setSidebarOpen]=useState(false);
  const [collapsed,setCollapsed]=useState<Set<string>>(new Set());
  const [menuPageId,setMenuPageId]=useState<string|null>(null);
  const [searchOpen,setSearchOpen]=useState(false);
  const [searchQuery,setSearchQuery]=useState("");
  const [searchResults,setSearchResults]=useState<SearchHit[]>([]);
  const [searchError,setSearchError]=useState("");
  const [assistantOpen,setAssistantOpen]=useState(false);
  const [chat,setChat]=useState<ChatMessage[]>([]);
  const [chatInput,setChatInput]=useState("");
  const [chatLoading,setChatLoading]=useState(false);
  const [notice,setNotice]=useState("");
  const [mobile,setMobile]=useState(false);
  const fileInput=useRef<HTMLInputElement>(null);
  const saveTimers=useRef<Map<string,ReturnType<typeof setTimeout>>>(new Map());
  const pendingPatch=useRef<Map<string,PagePatch>>(new Map());
  const searchRef=useRef<HTMLInputElement>(null);
  const chatRef=useRef<HTMLTextAreaElement>(null);

  const activePage=pages.find(page=>page.id===activePageId)||null;
  const favorites=pages.filter(page=>page.favorite);
  const privatePages=pages.filter(page=>!page.parent_id);
  const recentPages=[...pages].sort((a,b)=>new Date(b.last_opened_at||b.updated_at).getTime()-new Date(a.last_opened_at||a.updated_at).getTime()).slice(0,6);
  const linkedDocuments=documents.filter(doc=>doc.source_page_id===activePageId);

  const showNotice=useCallback((text:string)=>{setNotice(text);window.setTimeout(()=>setNotice(""),2600);},[]);

  const loadWorkspace=useCallback(async()=>{
    setLoadError("");
    try{
      const [pageList,documentList]=await Promise.all([api.pages(),api.documents()]);
      setPages(pageList);setDocuments(documentList);setLoaded(true);
      const requested=new URLSearchParams(window.location.search).get("page");
      const saved=localStorage.getItem("spaced.activePage");
      const next=[requested,saved].find(id=>id&&pageList.some(page=>page.id===id));
      if(next){setActivePageId(next!);setView("page");}
    }catch(error){setLoadError(errorMessage(error));setLoaded(true);}
  },[]);

  useEffect(()=>{
    void loadWorkspace();
    try{setTheme(localStorage.getItem("spaced.theme")==="dark"?"dark":"light");const savedChat=JSON.parse(localStorage.getItem(historyKey)||"[]");if(Array.isArray(savedChat))setChat(savedChat);}catch{/* First visit uses defaults. */}
    const updateMobile=()=>setMobile(window.innerWidth<640);updateMobile();window.addEventListener("resize",updateMobile);
    return()=>window.removeEventListener("resize",updateMobile);
  },[loadWorkspace]);

  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem("spaced.theme",theme);},[theme]);
  useEffect(()=>{localStorage.setItem(historyKey,JSON.stringify(chat.slice(-30)));},[chat]);
  useEffect(()=>{
    if(!searchOpen)return;
    const query=searchQuery.trim();setSearchError("");
    if(!query){setSearchResults([]);return;}
    const timer=window.setTimeout(()=>api.search(query).then(setSearchResults).catch(error=>{setSearchResults([]);setSearchError(errorMessage(error));}),260);
    return()=>window.clearTimeout(timer);
  },[searchOpen,searchQuery]);
  useEffect(()=>{if(searchOpen)searchRef.current?.focus();},[searchOpen]);
  useEffect(()=>{if(assistantOpen)chatRef.current?.focus();},[assistantOpen]);
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();setSearchOpen(true);}
      if(event.key==="Escape"){setSearchOpen(false);setMenuPageId(null);setAssistantOpen(false);}
    };
    window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);
  },[]);

  const flushPage=useCallback(async(id:string)=>{
    const timer=saveTimers.current.get(id);if(timer)clearTimeout(timer);saveTimers.current.delete(id);
    const patch=pendingPatch.current.get(id);if(!patch)return;
    pendingPatch.current.delete(id);setSaveState("saving");
    try{const updated=await api.updatePage(id,patch);setPages(current=>current.map(page=>page.id===id?{...page,updated_at:updated.updated_at}:page));setSaveState("saved");}
    catch(error){setSaveState("error");showNotice(`Could not save page: ${errorMessage(error)}`);}
  },[showNotice]);

  const schedulePagePatch=useCallback((id:string,patch:PagePatch)=>{
    pendingPatch.current.set(id,{...pendingPatch.current.get(id),...patch});
    setSaveState("saving");
    const existing=saveTimers.current.get(id);if(existing)clearTimeout(existing);
    saveTimers.current.set(id,setTimeout(()=>void flushPage(id),1800));
  },[flushPage]);

  const openPage=useCallback(async(id:string)=>{
    if(activePageId&&pendingPatch.current.has(activePageId))await flushPage(activePageId);
    setActivePageId(id);setView("page");setSidebarOpen(false);setMenuPageId(null);localStorage.setItem("spaced.activePage",id);
    try{const page=await api.openPage(id);setPages(current=>current.map(item=>item.id===id?{...item,...page}:item));}
    catch(error){showNotice(`Could not open page: ${errorMessage(error)}`);}
  },[activePageId,flushPage,showNotice]);

  const createPage=useCallback(async(parentId:string|null=null)=>{
    try{const page=await api.createPage({title:"Untitled",parent_id:parentId,blocks:emptyDoc});setPages(current=>[...current,page]);setCollapsed(current=>{const next=new Set(current);if(parentId)next.delete(parentId);return next;});await openPage(page.id);window.setTimeout(()=>document.querySelector<HTMLTextAreaElement>(".page-title-input")?.focus(),80);}
    catch(error){showNotice(`Could not create page: ${errorMessage(error)}`);}
  },[openPage,showNotice]);

  const deletePage=useCallback(async(id:string)=>{
    const target=pages.find(page=>page.id===id);if(!target||!window.confirm(`Delete “${target.title}” and its subpages?`))return;
    try{
      await api.deletePage(id);
      const ids=new Set([id]);let changed=true;while(changed){changed=false;for(const page of pages)if(page.parent_id&&ids.has(page.parent_id)&&!ids.has(page.id)){ids.add(page.id);changed=true;}}
      setPages(current=>current.filter(page=>!ids.has(page.id)));
      if(activePageId&&ids.has(activePageId)){setActivePageId(null);setView("home");localStorage.removeItem("spaced.activePage");}
      showNotice("Page deleted");
    }catch(error){showNotice(`Could not delete page: ${errorMessage(error)}`);}
  },[activePageId,pages,showNotice]);

  const updateFavorite=useCallback((page:Page)=>{
    const favorite=!page.favorite;setPages(current=>current.map(item=>item.id===page.id?{...item,favorite}:item));schedulePagePatch(page.id,{favorite});
  },[schedulePagePatch]);

  const movePage=useCallback(async(page:Page,parentId:string|null)=>{
    setPages(current=>current.map(item=>item.id===page.id?{...item,parent_id:parentId}:item));setMenuPageId(null);
    try{await api.updatePage(page.id,{parent_id:parentId});}
    catch(error){setPages(current=>current.map(item=>item.id===page.id?{...item,parent_id:page.parent_id}:item));showNotice(`Could not move page: ${errorMessage(error)}`);}
  },[showNotice]);

  const uploadFiles=useCallback(async(files:FileList|File[],pageId?:string)=>{
    for(const file of Array.from(files)){
      try{const document=await api.upload(file,pageId);setDocuments(current=>[document,...current]);showNotice(`${file.name} uploaded`);}
      catch(error){showNotice(`Could not upload ${file.name}: ${errorMessage(error)}`);}
    }
    if(fileInput.current)fileInput.current.value="";
  },[showNotice]);

  const removeDocument=useCallback(async(document:DocumentFile)=>{
    if(!window.confirm(`Remove “${document.name}” from this workspace?`))return;
    try{await api.deleteDocument(document.id);setDocuments(current=>current.filter(item=>item.id!==document.id));showNotice("File removed");}
    catch(error){showNotice(`Could not remove file: ${errorMessage(error)}`);}
  },[showNotice]);

  const exportBackup=()=>{
    const blob=new Blob([JSON.stringify({pages,documents,exported_at:new Date().toISOString()},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=`spaced-workspace-${new Date().toISOString().slice(0,10)}.json`;link.click();URL.revokeObjectURL(url);
  };

  const askAssistant=async(query:string)=>{
    const clean=query.trim();if(!clean||chatLoading)return;
    const userMessage:ChatMessage={role:"user",content:clean};const next=[...chat,userMessage];setChat(next);setChatInput("");setChatLoading(true);
    try{const result=await api.chat(clean,chat,activePageId||undefined);setChat([...next,{role:"assistant",content:result.answer,citations:result.citations}]);}
    catch(error){setChat([...next,{role:"assistant",content:`I couldn't reach the workspace assistant. ${errorMessage(error)}`}]);}
    finally{setChatLoading(false);}
  };

  const selectHit=(hit:SearchHit)=>{
    setSearchOpen(false);setSearchQuery("");
    if(hit.source_type==="page")void openPage(hit.source_id);
    else{const file=documents.find(document=>document.id===hit.source_id);if(file)window.open(file.file_url,"_blank","noopener,noreferrer");}
  };

  const pageRow=(page:Page,depth:number,hasChildren:boolean,tree=true)=> <div key={`${page.id}:${depth}`} className={`page-row ${view==="page"&&activePageId===page.id?"is-selected":""}`} style={{"--depth":depth} as CSSProperties} draggable={tree} onDragStart={tree?event=>event.dataTransfer.setData("text/spaced-page",page.id):undefined} onDragOver={tree?event=>event.preventDefault():undefined} onDrop={tree?event=>{event.preventDefault();event.stopPropagation();const id=event.dataTransfer.getData("text/spaced-page");const dragged=pages.find(item=>item.id===id);if(dragged&&id!==page.id)void movePage(dragged,page.id);}:undefined}>
    <button type="button" className="tree-toggle" aria-label={collapsed.has(page.id)?"Expand page":"Collapse page"} onClick={()=>setCollapsed(current=>{const next=new Set(current);next.has(page.id)?next.delete(page.id):next.add(page.id);return next;})}>{hasChildren?(collapsed.has(page.id)?<ChevronRight size={13}/>:<ChevronDown size={13}/>):<span className="tree-spacer"/>}</button>
    <button type="button" className="page-row-open" onClick={()=>void openPage(page.id)}><span className="page-row-icon">{page.icon||"📄"}</span><span className="page-row-title">{page.title||"Untitled"}</span></button>
    <span className="page-row-actions"><button title={page.favorite?"Remove favorite":"Add favorite"} aria-label={page.favorite?"Remove favorite":"Add favorite"} onClick={()=>updateFavorite(page)}><Star size={13} fill={page.favorite?"currentColor":"none"}/></button><button title="Page options" aria-label="Page options" onClick={()=>setMenuPageId(menuPageId===page.id?null:page.id)}><MoreHorizontal size={15}/></button></span>
    {menuPageId===page.id&&<div className="page-menu" onClick={event=>event.stopPropagation()}><button onClick={()=>{const title=window.prompt("Page name",page.title);if(title?.trim()){setPages(current=>current.map(item=>item.id===page.id?{...item,title:title.trim()}:item));schedulePagePatch(page.id,{title:title.trim()});}setMenuPageId(null);}}>Rename</button><button onClick={()=>{setMenuPageId(null);void createPage(page.id);}}>Add subpage</button><button onClick={()=>void updateFavorite(page)}>{page.favorite?"Remove from favorites":"Add to favorites"}</button><label>Move to<select value="" onChange={event=>void movePage(page,event.target.value||null)}><option value="">Private root</option>{pages.filter(parent=>parent.id!==page.id&&!isDescendant(parent.id,page.id,pages)).map(parent=><option key={parent.id} value={parent.id}>{parent.title}</option>)}</select></label><button className="danger-action" onClick={()=>void deletePage(page.id)}>Delete</button></div>}
  </div>;

  const renderTree=(parentId:string|null,depth:number):ReactNode=>pages.filter(page=>page.parent_id===parentId).map(page=>{
    const hasChildren=pages.some(child=>child.parent_id===page.id);
    return <div className="tree-branch" key={page.id}>{pageRow(page,depth,hasChildren)}{hasChildren&&!collapsed.has(page.id)&&renderTree(page.id,depth+1)}</div>;
  });

  if(!loaded)return <main className="boot-screen"><div className="boot-mark">S</div><p>Opening your workspace…</p></main>;

  return <main className={`app-shell ${theme}`} onClick={()=>menuPageId&&setMenuPageId(null)}>
    <aside className={`sidebar ${sidebarOpen?"is-open":""}`} onClick={event=>event.stopPropagation()}>
      <div className="brand-row"><button className="brand" onClick={()=>{setView("home");setActivePageId(null);}}><span className="brand-mark">S</span><span>spaced</span></button><button className="mobile-close" onClick={()=>setSidebarOpen(false)} aria-label="Close sidebar"><X size={16}/></button><button className="sidebar-more" aria-label="Workspace options" onClick={()=>setView("settings")}><MoreHorizontal size={17}/></button></div>
      <button className="workspace-switcher" onClick={()=>setView("settings")}><span className="workspace-avatar">S</span><span>Personal workspace</span><ChevronDown size={14}/></button>
      <button className="sidebar-search" onClick={()=>setSearchOpen(true)}><Search size={15}/><span>Search</span><kbd>⌘ K</kbd></button>
      <nav className="primary-nav" aria-label="Workspace"><button className={view==="home"?"active":""} onClick={()=>{setView("home");setActivePageId(null);}}><Home size={15}/>Home</button><button className={view==="updates"?"active":""} onClick={()=>setView("updates")}><Clock3 size={15}/>Updates</button><button className={view==="settings"?"active":""} onClick={()=>setView("settings")}><Settings size={15}/>Settings</button></nav>
      <section className="sidebar-section"><div className="side-section-title"><span>FAVORITES</span><button aria-label="Favorite current page" onClick={()=>activePage&&updateFavorite(activePage)}><Plus size={14}/></button></div><div className="side-pages">{favorites.length?favorites.map(page=>pageRow(page,0,false,false)):<div className="sidebar-empty">No favorites yet</div>}</div></section>
      <section className="sidebar-section private-section"><div className="side-section-title"><span>PRIVATE</span><button aria-label="Create a page" onClick={()=>void createPage()}><Plus size={14}/></button></div><div className="side-pages page-tree" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();const id=event.dataTransfer.getData("text/spaced-page");const page=pages.find(item=>item.id===id);if(page)void movePage(page,null);}}>{renderTree(null,0)}</div></section>
      <div className="sidebar-bottom"><button className="ask-nav" onClick={()=>setAssistantOpen(true)}><span className="assistant-star"><Sparkles size={15}/></span><span>Ask Spaced</span><span className="local-label">RAG</span></button><div className="profile-row"><div className="profile-avatar">T</div><div className="profile-info"><strong>Tanishq Jain</strong><small>Personal workspace</small></div><button className="theme-button" aria-label={theme==="light"?"Switch to dark mode":"Switch to light mode"} title={theme==="light"?"Switch to dark mode":"Switch to light mode"} onClick={()=>setTheme(theme==="light"?"dark":"light")}>{theme==="light"?<Moon size={15}/>:<Sun size={15}/>}</button></div></div>
    </aside>

    <section className="main-column">
      <header className="topbar"><div className="breadcrumbs"><button className="mobile-menu" aria-label="Open sidebar" onClick={()=>setSidebarOpen(true)}><Menu size={17}/></button><button onClick={()=>{setView("home");setActivePageId(null);}}>Personal workspace</button><ChevronRight size={13}/><span>{view==="page"?activePage?.title:view==="home"?"Home":view==="settings"?"Settings":"Updates"}</span></div><div className="top-actions"><span className={`save-indicator ${saveState}`}><i/>{saveState==="saving"?"Saving…":saveState==="error"?"Retry save":"Saved"}</span>{view==="page"&&activePage&&<><button className="top-action" onClick={async()=>{const url=`${location.origin}${location.pathname}?page=${activePage.id}`;try{await navigator.clipboard.writeText(url);showNotice("Page link copied");}catch{showNotice("Clipboard access is unavailable");}}}><Share2 size={14}/><span>Share</span></button><button className="top-action" aria-label="Page options" onClick={()=>setMenuPageId(menuPageId===activePage.id?null:activePage.id)}><MoreHorizontal size={17}/></button></>}</div></header>
      {loadError&&<div className="connection-banner"><span>Backend connection failed: {loadError}</span><button onClick={()=>void loadWorkspace()}>Retry</button></div>}
      <div className="workspace-content">
        {view==="home"&&<div className="home-view"><div className="home-heading"><h1>Home</h1><Button variant="outline" className="subtle-button" onClick={()=>void createPage()}><Plus size={15}/>New page</Button></div><section className="home-section"><div className="section-heading"><span>RECENTLY VISITED</span><button onClick={()=>setSearchOpen(true)}>Search pages</button></div>{recentPages.length?recentPages.map(page=><HomeRow key={page.id} page={page} open={()=>void openPage(page.id)}/>):<div className="empty-list">Pages you open will appear here.</div>}</section><section className="home-section"><div className="section-heading"><span>FAVORITES</span></div>{favorites.length?favorites.map(page=><HomeRow key={page.id} page={page} open={()=>void openPage(page.id)}/>):<div className="empty-list">Star a page to keep it close.</div>}</section><section className="home-section"><div className="section-heading"><span>PRIVATE</span><button onClick={()=>void createPage()}><Plus size={13}/>New</button></div>{privatePages.map(page=><HomeRow key={page.id} page={page} open={()=>void openPage(page.id)}/>)}</section><section className="home-section"><div className="section-heading"><span>FILES</span><button onClick={()=>fileInput.current?.click()}><Upload size={13}/>Add file</button></div>{documents.length?documents.slice(0,8).map(document=><DocumentRow key={document.id} document={document} open={()=>window.open(document.file_url,"_blank","noopener,noreferrer")} remove={()=>void removeDocument(document)}/>):<div className="empty-list">Upload a text file or PDF to keep a source in your workspace.</div>}</section><button className="home-ask-link" onClick={()=>setAssistantOpen(true)}><Sparkles size={15}/>Ask Spaced about your workspace</button></div>}

        {view==="page"&&activePage&&<article className="page-view"><div className="page-header"><button className="page-icon-button" title="Change page icon" onClick={()=>{const icon=window.prompt("Choose a page icon",activePage.icon);if(icon?.trim()){setPages(current=>current.map(page=>page.id===activePage.id?{...page,icon:icon.trim().slice(0,4)}:page));schedulePagePatch(activePage.id,{icon:icon.trim().slice(0,4)});}}}>{activePage.icon||"📄"}</button><textarea className="page-title-input" rows={1} value={activePage.title} placeholder="Untitled" onChange={event=>{const title=event.target.value;setPages(current=>current.map(page=>page.id===activePage.id?{...page,title}:page));schedulePagePatch(activePage.id,{title:title||"Untitled"});}}/><div className="page-meta"><span>Edited {dateLabel(activePage.updated_at)}</span><span>·</span><button onClick={()=>updateFavorite(activePage)}><Star size={13} fill={activePage.favorite?"currentColor":"none"}/>{activePage.favorite?"In favorites":"Add to favorites"}</button></div></div><BlockEditor key={activePage.id} pageId={activePage.id} content={activePage.blocks||emptyDoc} onChange={blocks=>schedulePagePatch(activePage.id,{blocks})} onUploadedFile={document=>setDocuments(current=>[document,...current])}/>{linkedDocuments.length>0&&<section className="page-files"><div className="section-heading"><span>SOURCES IN THIS PAGE</span><button onClick={()=>fileInput.current?.click()}><Plus size={13}/>Add</button></div>{linkedDocuments.map(document=><DocumentRow key={document.id} document={document} open={()=>window.open(document.file_url,"_blank","noopener,noreferrer")} remove={()=>void removeDocument(document)}/>)}</section>}<div className="page-upload"><span><Upload size={15}/></span><span>Bring a document into this page</span><button onClick={()=>fileInput.current?.click()}>Upload file</button></div></article>}

        {view==="updates"&&<div className="home-view"><div className="home-heading"><div><div className="eyebrow">WORKSPACE</div><h1>Recently updated</h1></div></div>{recentPages.map(page=><HomeRow key={page.id} page={page} open={()=>void openPage(page.id)}/>)}</div>}
        {view==="settings"&&<div className="settings-view"><div className="eyebrow">WORKSPACE</div><h1>Settings</h1><p className="settings-intro">Your Spaced workspace and connected services.</p><div className="settings-row"><div><strong>Appearance</strong><small>Choose a light or dark workspace.</small></div><button className={`settings-switch ${theme==="dark"?"on":""}`} aria-pressed={theme==="dark"} onClick={()=>setTheme(theme==="light"?"dark":"light")}><span/></button></div><div className="settings-row"><div><strong>Workspace</strong><small>{pages.length} pages · {documents.length} files · stored in PostgreSQL</small></div><button className="outlined-button" onClick={exportBackup}><ArrowDownToLine size={14}/>Export backup</button></div><div className="settings-row"><div><strong>Knowledge search</strong><small>Semantic retrieval uses Qdrant and OpenAI embeddings when an API key is configured.</small></div><span className="service-badge">Qdrant · RAG</span></div><div className="settings-row"><div><strong>Assistant</strong><small>Responses API with source excerpts and page citations.</small></div><button className="outlined-button" onClick={()=>setAssistantOpen(true)}><Sparkles size={14}/>Open assistant</button></div><div className="settings-row"><div><strong>Connected services</strong><small>FastAPI · PostgreSQL · Redis · Qdrant · OpenAI</small></div><span className="service-badge">LOCAL STACK</span></div></div>}
      </div>
    </section>

    {searchOpen&&<div className="search-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setSearchOpen(false);}}><div className="search-dialog"><div className="search-input-row"><Search size={19}/><input ref={searchRef} value={searchQuery} onChange={event=>setSearchQuery(event.target.value)} placeholder="Search pages and files…"/><kbd>ESC</kbd></div><div className="search-results">{searchError?<div className="search-empty">{searchError}</div>:!searchQuery.trim()?<div className="search-empty">Type to search across notes and documents.</div>:searchResults.length?searchResults.map(hit=><button className="search-result" key={`${hit.source_type}:${hit.source_id}`} onClick={()=>selectHit(hit)}><span className="result-icon">{hit.source_type==="page"?<FileText size={15}/>:<BookOpen size={15}/>}</span><span><strong>{hit.title}</strong><small>{hit.excerpt}</small></span><ArrowUpRight size={14}/></button>):<div className="search-empty">No matches found yet.</div>}</div><div className="search-footer"><span>Search uses workspace text and semantic matches</span><span>ESC to close</span></div></div></div>}

    {assistantOpen&&<motion.aside className="assistant-panel" initial={{opacity:0,x:24}} animate={{opacity:1,x:0}} transition={{duration:.18,ease:"easeOut"}}><header className="assistant-header"><div className="assistant-title"><span className="assistant-mark"><Sparkles size={16}/></span><span><strong>Ask your workspace</strong><small>OpenAI · Qdrant retrieval</small></span></div><button className="icon-button" onClick={()=>setAssistantOpen(false)} aria-label="Close assistant"><X size={17}/></button></header><div className="assistant-notice"><span>◎</span><p>Answers use relevant excerpts from your pages and documents. Retrieved sources appear as citations.</p></div><div className="chat-messages">{chat.length?chat.map((message,index)=><div className={`chat-message ${message.role}`} key={`${index}:${message.content.slice(0,16)}`}><div className="chat-role">{message.role==="user"?"YOU":"SPACED"}</div><div className="chat-bubble">{message.content}</div>{message.citations?.length&&<div className="citation-list">{message.citations.map((citation,ci)=><button className="citation" key={`${citation.source_id}:${ci}`} onClick={()=>selectHit(citation)}>{citation.source_type==="page"?<FileText size={12}/>:<BookOpen size={12}/>} {citation.title}</button>)}</div>}</div>):<div className="chat-empty"><Sparkles size={21}/><p>Ask about a project, a meeting, or an idea you saved.</p></div>}{chatLoading&&<div className="chat-message assistant"><div className="chat-role">SPACED</div><div className="chat-bubble typing">Finding relevant notes…</div></div>}</div><div className="assistant-suggestions"><button onClick={()=>void askAssistant("Summarize my recent notes")}>Summarize notes</button><button onClick={()=>void askAssistant("What action items are in my notes?")}>Find action items</button></div><form className="chat-form" onSubmit={event=>{event.preventDefault();void askAssistant(chatInput);}}><textarea ref={chatRef} rows={1} value={chatInput} onChange={event=>setChatInput(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();void askAssistant(chatInput);}}} placeholder="Ask about your workspace…"/><button type="submit" disabled={chatLoading||!chatInput.trim()} aria-label="Send message"><ArrowLeft className="send-icon" size={16}/></button></form><div className="assistant-footnote">Your OpenAI API key stays on the backend.</div></motion.aside>}

    <input ref={fileInput} type="file" multiple accept=".txt,.md,.markdown,.pdf,.png,.jpg,.jpeg,.webp" hidden onChange={event=>{if(event.target.files?.length)void uploadFiles(event.target.files,view==="page"?activePageId||undefined:undefined);}}/>
    {notice&&<div className="toast" role="status">{notice}</div>}
  </main>;
}

function HomeRow({page,open}:{page:Page;open:()=>void}){
  return <button className="home-row" onClick={open}><span className="home-row-icon">{page.icon||"📄"}</span><span className="home-row-copy"><strong>{page.title||"Untitled"}</strong><small>{excerptFromJson(page.blocks)}</small></span><time>{dateLabel(page.last_opened_at||page.updated_at)}</time></button>;
}

function DocumentRow({document,open,remove}:{document:DocumentFile;open:()=>void;remove:()=>void}){
  return <div className="document-row"><button className="document-open" onClick={open}><span className="document-icon"><FileText size={15}/></span><span className="document-name">{document.name}</span><small>{sizeLabel(document.size_bytes)}</small></button><button className="document-remove" aria-label={`Remove ${document.name}`} onClick={remove}><Trash2 size={14}/></button></div>;
}

function isDescendant(targetId:string,ancestorId:string,pages:Page[]){let cursor=pages.find(item=>item.id===targetId)?.parent_id;while(cursor){if(cursor===ancestorId)return true;cursor=pages.find(item=>item.id===cursor)?.parent_id;}return false;}
