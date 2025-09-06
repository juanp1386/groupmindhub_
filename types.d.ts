// types.d.ts — GroupMindHub MVP logical types
export type BlockType = 'h2' | 'p';
export interface Block { id: string; type: BlockType; text: string; parent: string | null }
export interface Entry { id: string; title: string; version: number; votes: number; blocks: Block[] }
export type Op = UpdateText | InsertBlock | DeleteBlock | MoveBlock;
export interface UpdateText { type: 'UPDATE_TEXT'; block_id: string; new_text: string }
export interface InsertBlock { type: 'INSERT_BLOCK'; after_id?: string | null; new_block: { id?: string | null; type: BlockType; text: string; parent?: string | null } }
export interface DeleteBlock { type: 'DELETE_BLOCK'; block_id: string }
export interface MoveBlock { type: 'MOVE_BLOCK'; block_id: string; after_id?: string | null; new_parent?: string | null }
export type VoteValue = -1 | 0 | 1;
export interface Patch {
  id: number; targetEntryId: string; authorId: string; summary: string; ops_json: Op[];
  affected_blocks: string[]; anchors: string[]; before_outline: string; after_outline: string;
  votes: Record<string, VoteValue>; status: 'published'|'merged'|'needs_update';
  created_at?: number; merged_at?: number;
}
