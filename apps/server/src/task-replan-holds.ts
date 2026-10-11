import type { Transaction } from '../../../packages/db/src/index.ts';
import type { ReplanHold } from '../../../packages/protocol/src/index.ts';
import { blockNodeSource } from './node-execution-state.ts';
import type { NodeSource } from './node-execution-state.ts';
export async function activateInheritedHold(tx:Transaction,source:NodeSource):Promise<string|undefined>{
 const rows=(await tx.query<{id:string;origin:ReplanHold;current_blocker_id:string|null}>(`SELECT h.id,h.origin,h.current_blocker_id FROM replan_control_holds h
  JOIN replan_publications p ON p.id=h.publication_id JOIN tasks t ON t.id=h.task_id
  WHERE h.task_id=$1 AND h.node_id=$2 AND h.node_activation=$3 AND h.resolved_by IS NULL AND p.new_plan_id=t.plan_id
  ORDER BY (h.origin->>'kind'='owner_stopped'),h.id`,[source.task_id,source.node_id,source.node_activation])).rows;
 const hold=rows[0];if(!hold)return;
 if(hold.current_blocker_id&&(await tx.query('SELECT 1 FROM nodes WHERE id=$1 AND blocker_id=$2',[source.node_id,hold.current_blocker_id])).rowCount)return hold.current_blocker_id;
 const id=await blockNodeSource(tx,source,hold.origin.kind,hold.origin.reason);await tx.query('UPDATE replan_control_holds SET current_blocker_id=$2 WHERE id=$1',[hold.id,id]);await tx.query('UPDATE nodes SET guidance_paused=$2 WHERE id=$1',[source.node_id,rows.some(h=>h.origin.kind==='owner_stopped')]);return id;
}
export async function resolveInheritedHold(tx:Transaction,nodeId:string,blockerId:string|undefined,requestId:string):Promise<void>{if(blockerId)await tx.query(`UPDATE replan_control_holds h SET resolved_by=$3 FROM replan_publications p,tasks t WHERE h.publication_id=p.id AND t.id=h.task_id AND p.new_plan_id=t.plan_id AND h.node_id=$1 AND h.current_blocker_id=$2 AND h.resolved_by IS NULL`,[nodeId,blockerId,requestId]);}
