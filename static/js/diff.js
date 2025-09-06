// diff.js - outline + diff decoration
export function outline(blocks){
  return blocks.map(b=> `${b.type==='h2'?'##':'‣'} ${b.text}`).join('\n');
}
export function outlineDiff(before, after){
  const beforeIds = new Set(before.map(b=>b.id));
  const afterIds = new Set(after.map(b=>b.id));
  const moved = new Set(); const updated = new Set();
  const idxBefore = new Map(before.map((b,i)=>[b.id, i]));
  const idxAfter = new Map(after.map((b,i)=>[b.id, i]));
  before.forEach(b=>{
    if(!afterIds.has(b.id)) return; const a = after[idxAfter.get(b.id)];
    if(a.text !== b.text) updated.add(b.id);
    if(idxBefore.get(b.id) !== idxAfter.get(b.id)) moved.add(b.id);
  });
  const linesBefore = before.map(b=>{
    const mark = !afterIds.has(b.id)?'-': updated.has(b.id)?'~': moved.has(b.id)?'↔':' ';
    return `${mark} ${b.type==='h2'?'##':'‣'} ${b.text}`; }).join('\n');
  const linesAfter = after.map(b=>{
    const mark = !beforeIds.has(b.id)?'+': updated.has(b.id)?'~': moved.has(b.id)?'↔':' ';
    return `${mark} ${b.type==='h2'?'##':'‣'} ${b.text}`; }).join('\n');
  return { before: linesBefore, after: linesAfter };
}
export function decorateOutline(text){
  return text
    .replace(/^\- /gm, '<span class="del">- </span>')
    .replace(/^\+ /gm, '<span class="add">+ </span>')
    .replace(/^~ /gm, '<span class="upd">~ </span>')
    .replace(/^↔ /gm, '<span class="mov">↔ </span>');
}
