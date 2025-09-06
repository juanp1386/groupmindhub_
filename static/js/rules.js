// rules.js - voting / merge logic
export function isPassing(patch, totalUsers){
  const yes = Object.values(patch.votes).filter(v=>v>0).length;
  return (yes/Math.max(totalUsers,1)) >= 0.4;
}
export function targetedSets(ops){
  const blocks = new Set(); const anchors = new Set();
  ops.forEach(o=>{ if(o.block_id) blocks.add(o.block_id); if(o.after_id) anchors.add('after:'+o.after_id); });
  return { blocks:[...blocks], anchors:[...anchors] };
}
