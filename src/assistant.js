import { plainText } from './editor.js';

const words = text => (String(text).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter(word => !new Set(['the','and','for','are','with','that','this','from','your','about','what','where','when','into','have','does','with','would','could','should','there','their','you','how','can','was','were','been','then','than','them','they','will','just','some','page','notes','note']).has(word));
const sourceText = page => (page.blocks || []).map(block => `${block.type==='task'?'[ ] ':''}${plainText(block.content || '')}`).filter(Boolean).join('\n');
const sentenceChunks = text => text.split(/(?<=[.!?])\s+|\n+/).map(s=>s.trim()).filter(s=>s.length>15);

function rankedSources(state, query, currentPageId) {
  const queryWords = [...new Set(words(query))];
  const sources = [
    ...state.pages.map(page=>({id:page.id,title:page.title,text:sourceText(page),type:'page'})),
    ...state.documents.filter(doc=>doc.content).map(doc=>({id:doc.id,title:doc.name,text:doc.content,type:'document'}))
  ];
  return sources.map(source=>{
    const bodyWords=words(source.text), titleWords=words(source.title);
    let score=0;
    for(const word of queryWords){if(titleWords.includes(word))score+=4;if(bodyWords.includes(word))score+=1+Math.min(2,bodyWords.filter(w=>w===word).length*.15);}
    if(source.id===currentPageId)score+=1.5;
    return {...source,score,queryWords};
  }).filter(source=>source.score>0).sort((a,b)=>b.score-a.score).slice(0,5);
}

export function answerWorkspaceQuery(query, state, currentPageId) {
  const normalized=query.toLowerCase();
  const citations=[];
  const addCitation=source=>{if(!citations.some(c=>c.id===source.id))citations.push({id:source.id,title:source.title,type:source.type});};
  if(/summari[sz]e|overview|key points/.test(normalized)){
    const target=normalized.includes('current page')||normalized.includes('this page')?state.pages.find(p=>p.id===currentPageId):null;
    const sources=target?[{...target,text:sourceText(target),type:'page'}]:rankedSources(state,query,currentPageId).slice(0,3);
    if(!sources.length)return {text:'I couldn’t find any saved page or text file to summarize yet. Add a few notes or import a text document and try again.',citations};
    const lines=[];
    for(const source of sources){const chunks=sentenceChunks(source.text);const picks=chunks.filter(s=>s.length<210).slice(0,3);if(picks.length){addCitation(source);lines.push(...picks.map(s=>`• ${s}`));}}
    return {text:lines.length?`Here are the main points I found in your workspace:\n\n${lines.join('\n')}`:'There isn’t enough written content in that page to summarize yet.',citations};
  }
  if(/action item|to.?do|tasks?\b/.test(normalized)){
    const tasks=[];
    for(const page of state.pages)for(const item of page.blocks||[])if(item.type==='task'&&!item.checked){const text=plainText(item.content||'').trim();if(text){tasks.push({text,page});}}
    for(const task of tasks.slice(0,10))addCitation({id:task.page.id,title:task.page.title,type:'page'});
    return {text:tasks.length?`Open action items I found:\n\n${tasks.slice(0,10).map(t=>`• ${t.text} — ${t.page.title}`).join('\n')}`:'I didn’t find any unchecked to-dos in your pages yet.',citations};
  }
  const sources=rankedSources(state,query,currentPageId);
  if(!sources.length)return {text:'I couldn’t find a close match in your saved workspace. Try a different phrase, or add a note or text file first.',citations};
  const excerpts=[];
  for(const source of sources.slice(0,3)){
    const chunks=sentenceChunks(source.text);const matches=chunks.map(text=>({text,score:source.queryWords.reduce((n,w)=>n+(text.toLowerCase().includes(w)?1:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,2);
    if(matches.length){addCitation(source);excerpts.push(`${source.title}\n${matches.map(m=>`• ${m.text}`).join('\n')}`);}
  }
  return {text:excerpts.length?`I found these passages in your workspace:\n\n${excerpts.join('\n\n')}`:'I found related pages, but couldn’t identify a matching passage. Try using a more specific phrase.',citations};
}
