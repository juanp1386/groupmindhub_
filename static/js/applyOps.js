// applyOps.js - pure transformation of blocks by ops
export function cloneBlocks(blocks){ return blocks.map(b=>({...b})); }
export function findIndex(blocks, id){ return blocks.findIndex(b=>b.id===id); }
export function applyOps(blocks, ops){
  const out = cloneBlocks(blocks);
  const ensureNewId = (prefix)=> `${prefix}_${Date.now()}_${Math.floor(Math.random()*1e5)}`;
  for(const op of ops){
    if(op.type==='UPDATE_TEXT'){
      const i = findIndex(out, op.block_id); if(i!==-1) out[i].text = op.new_text;
    } else if(op.type==='INSERT_BLOCK'){
      const nb = { id: op.new_block.id || ensureNewId('new'), type: op.new_block.type, text: op.new_block.text, parent: op.new_block.parent||null };
      const idx = op.after_id? findIndex(out, op.after_id) : -1;
      out.splice(idx+1, 0, nb);
    } else if(op.type==='DELETE_BLOCK'){
      const i = findIndex(out, op.block_id); if(i!==-1) out.splice(i,1);
    } else if(op.type==='MOVE_BLOCK'){
      const i = findIndex(out, op.block_id); if(i!==-1){
        const blk = out.splice(i,1)[0];
        const j = op.after_id? findIndex(out, op.after_id) : -1;
        blk.parent = op.new_parent ?? blk.parent;
        out.splice(j+1,0,blk);
      }
    }
  }
  return out;
}
