import type { Transaction } from '../../../packages/db/src/index.ts';
import type { ReplanHold } from '../../../packages/protocol/src/index.ts';
import { blockNodeSource } from './node-execution-state.ts';
import type { NodeSource } from './node-execution-state.ts';
export async function activateInheritedHold(tx:Transaction,source:NodeSource):Promise<string|undefined>{
 const rows=(await tx.query<{id:string;origin:ReplanHold}>('SELECT id,origin FROM replan_control_holds WHERE task_id=$1 AND node_id=$2 AND node_activation=$3 AND resolved_by IS NULL ORDER BY (origin->>\'kind\'=\'owner_stopped\'),id',[source.task_id,source.node_id,source.node_activation])).rows;
 const hold=rows[0];if(!hold)return;
 const id=await blockNodeSource(tx,source,hold.origin.kind,hold.origin.reason);await tx.query('UPDATE replan_control_holds SET current_blocker_id=$2 WHERE id=$1',[hold.id,id]);await tx.query('UPDATE nodes SET guidance_paused=$2 WHERE id=$1',[source.node_id,rows.some(h=>h.origin.kind==='owner_stopped')]);return id;
}
export async function resolveInheritedHold(tx:Transaction,nodeId:string,blockerId:string|undefined,requestId:string):Promise<void>{if(blockerId)await tx.query('UPDATE replan_control_holds SET resolved_by=$3 WHERE node_id=$1 AND current_blocker_id=$2 AND resolved_by IS NULL',[nodeId,blockerId,requestId]);}
