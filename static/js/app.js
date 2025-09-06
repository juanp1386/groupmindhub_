import { applyOps } from './applyOps.js';
import { outlineDiff, decorateOutline } from './diff.js';
import { isPassing, targetedSets } from './rules.js';
import { loadState, saveState, resetState } from './state.js';

// Config
const PROJECT_ID = document.currentScript.getAttribute('data-project-id');
const USE_API = PROJECT_ID && PROJECT_ID !== '0';

// State
let { users, entry, patches } = loadState();
let currentUserId = users[0]?.id;
let draft = { ops: [], opSeq: 1 };

// Elements
const el = (tag, attrs={}, ...children)=>{ const e=document.createElement(tag); for(const [k,v] of Object.entries(attrs)){
  if(k==='class') e.className=v; else if(k==='html') e.innerHTML=v; else if(k.startsWith('on')&&typeof v==='function') e.addEventListener(k.slice(2),v); else if(typeof v==='boolean'){ if(v){ e.setAttribute(k,''); if(k in e) e[k]=true; } else { e.removeAttribute(k); if(k in e) e[k]=false; } } else e.setAttribute(k,v);
} children.forEach(c=>{ if(c==null) return; e.append(c.nodeType?c:document.createTextNode(c)); }); return e; };

function userName(id){ return users.find(u=>u.id===id)?.name||id; }

// API helpers
async function apiFetch(url, opts){ if(!USE_API) return null; try{ const r= await fetch(url, opts); if(!r.ok) return null; return await r.json(); }catch{ return null; } }
async function syncFromApi(){
  if(!USE_API) return;
  const entryData = await apiFetch(`/api/projects/${PROJECT_ID}/entry`);
  if(entryData?.entry){
    entry = { id:'e'+entryData.entry.id, title: entryData.entry.title, version: entryData.entry.version, votes:0, blocks: entryData.entry.blocks.map(b=>({id:b.id,type:b.type,text:b.text,parent:b.parent})) };
  }
  const patchesData = await apiFetch(`/api/projects/${PROJECT_ID}/patches`);
  if(patchesData?.patches){
    patches = patchesData.patches.map(p=>({ ...p, votes: p.votes||{}, status:p.status||'published' }));
  }
}

function renderUsers(){
  const sel = document.getElementById('userSelect'); if(!sel) return; sel.innerHTML='';
  users.forEach(u=> sel.append(el('option',{value:u.id},u.name)) ); sel.value=currentUserId;
  sel.onchange=()=>{ currentUserId=sel.value; renderPatches(); updateUserDot(); saveState({users,entry,patches}); };
  updateUserDot();
}
function updateUserDot(){ const dot=document.getElementById('userDot'); if(dot) dot.textContent=userName(currentUserId).slice(0,1); }

function renderEntry(){ const cont=document.getElementById('entryBlocks'); cont.innerHTML=''; entry.blocks.forEach(b=>{
  const node=el('div',{class:'block','data-block-id':b.id},
    el('div',{class:'gutter'},
      el('span',{class:'handle',title:b.type==='h2'?`Section: ${b.text}`:'Paragraph'}, b.type==='h2'?'§':'¶'),
      el('button',{class:'icon-btn',onclick:(ev)=>{ev.stopPropagation(); openMenuForBlock(b.id, ev.currentTarget);} },'⋯')
    ),
    el('div',{}, b.type==='h2'?el('h2',{}, b.text):el('p',{}, b.text))
  ); cont.append(node);
 }); document.getElementById('entryVersion').textContent=entry.version; document.getElementById('entryVotes').textContent=entry.votes; }

// Context menu (subset)
let openMenuBlockId=null; const ctxMenu=document.getElementById('ctxMenu');
function openMenuForBlock(blockId, anchorEl){ closeMenu(); openMenuBlockId=blockId; const r=anchorEl.getBoundingClientRect();
  ctxMenu.style.cssText=`position:fixed;display:block;top:${r.bottom+6}px;left:${r.left-10}px;background:var(--bg);border:1px solid var(--border);padding:6px;border-radius:10px;z-index:1000;`;
  ctxMenu.innerHTML='';
  const add=(label,handler)=> ctxMenu.append(el('div',{style:'padding:6px 8px;cursor:pointer;font-size:13px',onclick:()=>{handler(); closeMenu();}},label));
  add('Edit text',()=>stageUpdate(blockId)); add('Insert heading above',()=>stageInsert(blockId,'h2','above')); add('Insert paragraph below',()=>stageInsert(blockId,'p','below'));
  ctxMenu.append(el('div',{style:'height:1px;background:var(--border);margin:4px 0'}));
  add('Move up',()=>stageMove(blockId,'up')); add('Move down',()=>stageMove(blockId,'down'));
  ctxMenu.append(el('div',{style:'height:1px;background:var(--border);margin:4px 0'})); add('Delete block',()=>stageDelete(blockId));
  document.addEventListener('click', handleDocClick,{once:true});
}
function handleDocClick(ev){ if(!ctxMenu.contains(ev.target)) closeMenu(); }
function closeMenu(){ ctxMenu.style.display='none'; }

function renderComposer(){ const area=document.getElementById('composerArea'); area.innerHTML=''; if(draft.ops.length===0){ area.append(el('div',{class:'help'},'No ops staged. Use block actions.')); } else {
  draft.ops.forEach(op=>{ const row=el('div',{style:'display:flex;flex-direction:column;gap:4px;border:1px solid var(--border);padding:8px;border-radius:8px'},
    el('div',{style:'display:flex;justify-content:space-between;align-items:center;'},
      el('span',{class:'pill'}, `${op.type} #${op.seq}`),
      el('button',{class:'icon-btn',onclick:()=>removeOp(op.seq),title:'Remove'},'✖')
    ));
    if(op.type==='UPDATE_TEXT'){ const b=entry.blocks.find(x=>x.id===op.block_id); const ta=el('textarea',{style:'min-height:70px'}); ta.value=op.new_text; ta.oninput=()=>{op.new_text=ta.value; refreshAffects(); }; row.append(el('div',{class:'help'},`Edit ${b?.id}`), ta); }
    if(op.type==='INSERT_BLOCK'){ const ta=el('textarea',{style:'min-height:70px'}); ta.value=op.new_block.text; ta.oninput=()=>{op.new_block.text=ta.value; refreshAffects();}; row.append(el('div',{class:'help'},`Insert ${op.new_block.type} after ${op.after_id||'start'}`), ta); }
    if(op.type==='DELETE_BLOCK'){ row.append(el('div',{class:'help'},`Delete ${op.block_id}`)); }
    if(op.type==='MOVE_BLOCK'){ row.append(el('div',{class:'help'},`Move ${op.block_id} after ${op.after_id||'start'}`)); }
    area.append(row);
  });
 }
 document.getElementById('btnPublish').disabled = draft.ops.length===0; refreshAffects(); }

function removeOp(seq){ draft.ops = draft.ops.filter(o=>o.seq!==seq); renderComposer(); }
function stageUpdate(blockId){ if(draft.ops.some(o=>o.type==='UPDATE_TEXT'&&o.block_id===blockId)) return; const text=entry.blocks.find(b=>b.id===blockId)?.text||''; draft.ops.push({seq:draft.opSeq++,type:'UPDATE_TEXT',block_id:blockId,new_text:text}); renderComposer(); }
function stageInsert(anchorId,type,where){ let after_id=where==='below'?anchorId:null; if(where==='above'){ const idx=entry.blocks.findIndex(b=>b.id===anchorId); after_id=idx>0? entry.blocks[idx-1].id : null; } draft.ops.push({seq:draft.opSeq++,type:'INSERT_BLOCK',after_id,new_block:{id:null,type,text:'New '+(type==='h2'?'heading':'paragraph'),parent:null}}); renderComposer(); }
function stageDelete(blockId){ draft.ops.push({seq:draft.opSeq++,type:'DELETE_BLOCK',block_id:blockId}); renderComposer(); }
function stageMove(blockId,dir){ const curIdx=entry.blocks.findIndex(b=>b.id===blockId); const anchorIdx=dir==='up'? Math.max(-1, curIdx-2): Math.min(entry.blocks.length-1, curIdx); const after_id=anchorIdx>=0? entry.blocks[anchorIdx].id:null; draft.ops.push({seq:draft.opSeq++,type:'MOVE_BLOCK',block_id:blockId,after_id}); renderComposer(); }

document.getElementById('btnClear').onclick=()=>{ draft.ops=[]; renderComposer(); };
document.getElementById('btnPublish').onclick=async ()=>{
  const ops= JSON.parse(JSON.stringify(draft.ops)); const afterBlocks = applyOps(entry.blocks, ops); const diff = outlineDiff(entry.blocks, afterBlocks); const tsets= targetedSets(ops);
  const patch = { id: patches.length+1, targetEntryId: entry.id, authorId: currentUserId, summary: document.getElementById('patchSummary').value.trim()||`Patch #${patches.length+1}`, ops_json: ops, affected_blocks: tsets.blocks, anchors: tsets.anchors, before_outline: diff.before, after_outline: diff.after, votes:{[currentUserId]:1}, status:'published' };
  patches.push(patch); draft.ops=[]; document.getElementById('patchSummary').value=''; recomputeOverlaps(); renderComposer(); renderPatches(); saveState({users,entry,patches});
  if(USE_API){ // fire-and-forget create
    fetch(`/api/projects/${PROJECT_ID}/patches/create`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ entry_id: entry.id.replace(/^e/,''), summary: patch.summary, ops_json: ops, affected_blocks: tsets.blocks, anchors: tsets.anchors })});
  }
};

function refreshAffects(){ const tags=document.getElementById('affectsTags'); tags.innerHTML=''; const ids=new Set(); draft.ops.forEach(o=>{ if(o.block_id) ids.add(o.block_id); }); [...ids].forEach(id=>{ tags.append(el('span',{class:'pill'}, id)); }); }

function recomputeOverlaps(){ for(const p of patches){ p.overlaps = patches.filter(q=> q.id!==p.id && (intersects(p.affected_blocks,q.affected_blocks) || intersects(p.anchors,q.anchors))).map(q=>q.id); p.competing = p.overlaps.length>0; } }
function intersects(a,b){ return (a||[]).some(x=> (b||[]).includes(x)); }

function vote(patchId,val){ const p=patches.find(x=>x.id===patchId); if(!p) return; const cur=p.votes[currentUserId]||0; const next=cur===val?0:val; if(next===0) delete p.votes[currentUserId]; else p.votes[currentUserId]=next; renderPatches(); saveState({users,entry,patches}); }

function applyMergeCore(p){ entry.blocks = applyOps(entry.blocks, p.ops_json); entry.version+=1; p.status='merged'; p.merged_at=Date.now(); logHistory(`Merged Patch #${p.id}`); const overlappingIds=new Set(p.overlaps||[]); patches.forEach(q=>{ if(q.id!==p.id && overlappingIds.has(q.id)) q.status='needs_update'; }); }
function autoMergeTick(){ let merged=0; for(const p of patches){ if(p.status!=='merged' && isPassing(p, users.length)) { applyMergeCore(p); merged++; } } if(merged>0){ renderEntry(); saveState({users,entry,patches}); } }

function renderPatches(){ autoMergeTick(); const list=document.getElementById('patchList'); const history=document.getElementById('historyList'); list.innerHTML=''; history.innerHTML=''; for(const p of patches){ if(p.status==='merged'){ history.append(renderPatchCard(p,true)); } else { list.append(renderPatchCard(p,false)); } } }
function renderPatchCard(p, isHistory){ const yes=Object.values(p.votes).filter(v=>v>0).length; const no=Object.values(p.votes).filter(v=>v<0).length; const approval=yes/users.length; const passing=isPassing(p, users.length); const voted=p.votes[currentUserId]||0; const card=el('div',{class:'patch-card'+(p.competing?' overlap':'')}); card.append(
  el('div',{style:'display:flex;justify-content:space-between;align-items:center;'},
    el('div',{}, el('strong',{}, p.summary), el('div',{class:'help'}, `Ops: ${p.ops_json.length}`)),
    el('div',{style:'display:flex;gap:6px;flex-wrap:wrap;'},
      el('span',{class:'pill'}, `${yes} yes / ${no} no`), passing? el('span',{class:'pill green'}, 'merge-ready'): null, p.competing? el('span',{class:'pill'},'overlaps'): null)
  ),
  el('div',{class:'diff'},
    el('div',{}, el('div',{class:'help'},'Outline (before)'), el('pre',{class:'outline',html:decorateOutline(p.before_outline)})),
    el('div',{}, el('div',{class:'help'},'Outline (after)'), el('pre',{class:'outline',html:decorateOutline(p.after_outline)}))
  )
 );
 if(!isHistory){ card.append(el('div',{style:'display:flex;justify-content:space-between;align-items:center;margin-top:4px;'},
   el('div',{style:'display:flex;align-items:center;gap:6px;'},
     el('button',{class:(voted===1?'primary':''),onclick:()=>vote(p.id,1)},'▲'),
     el('span',{}, yes-no),
     el('button',{class:(voted===-1?'primary':''),onclick:()=>vote(p.id,-1)},'▼'),
     el('span',{class:'help'}, Math.round(approval*100)+'%')
   ),
   el('div',{style:'display:flex;gap:6px;'},
     el('button',{onclick:()=>{ if(passing) { applyMergeCore(p); renderPatches(); saveState({users,entry,patches}); } }, disabled:!passing}, 'Merge'),
     el('button',{class:'icon-btn',onclick:()=>{ logHistory(`Fork from Patch #${p.id}`); alert('Fork demo'); }}, '⚑')
   )
  )); }
 return card; }

function logHistory(msg){ const h=document.getElementById('historyLog'); const t=new Date().toLocaleTimeString(); h.textContent += `\n[${t}] ${msg}`; h.scrollTop=h.scrollHeight; }

// Tests (subset) for parity
function runTests(){ try{ const base=JSON.parse(JSON.stringify(entry.blocks)); const after=applyOps(base,[{type:'UPDATE_TEXT',block_id:base[0].id,new_text:'X'}]); if(after[0].text!=='X') throw new Error('applyOps update fail'); logHistory('Tests passed ✅'); }catch(e){ console.error(e); logHistory('Test failed: '+e.message); } }

// Reset button
document.getElementById('btnReset').onclick=()=>{ if(confirm('Reset local demo state?')){ resetState(); ({users,entry,patches}=loadState()); currentUserId=users[0].id; draft={ops:[],opSeq:1}; bootAfterState(); } };
document.getElementById('runTests').onclick=runTests;

function bootAfterState(){ renderUsers(); renderEntry(); renderComposer(); renderPatches(); }

async function boot(){ await syncFromApi(); bootAfterState(); }
boot();
