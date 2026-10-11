import {transaction} from '../../../packages/db/src/index.ts';
import type {Database} from '../../../packages/db/src/index.ts';
import {CommandError} from '../../../packages/domain/src/commands.ts';
import {lockConfiguration} from './configuration-guards.ts';
import {RuntimeScheduling} from './runtime-scheduling.ts';
import {DispatchQueue} from './dispatch-queue.ts';
import {createReviewSource} from './task-review-sources.ts';
import {reviewOperation,reviewSettlementReady,reviewInputOrderBlocked} from './task-review-state.ts';
import type {ReviewOperationRow,ReviewSourceRow} from './task-review-state.ts';
import type {ReviewHooks} from './task-review-commands.ts';
import type {SpecificationTask} from './task-specification-state.ts';
export class TaskReviewCoordinator {
 readonly db:Database;readonly hooks:ReviewHooks;private readonly scheduling:RuntimeScheduling;private pumping=false;
 constructor(db:Database,backendInstance='',hooks:ReviewHooks={}){this.db=db;this.hooks=hooks;this.scheduling=new RuntimeScheduling(new DispatchQueue(db),backendInstance);}
 async pump(limit=8):Promise<void>{if(this.pumping)return;this.pumping=true;try{
  const rows=(await this.db.pool.query<ReviewOperationRow>(`SELECT o.* FROM task_review_operations o JOIN tasks t ON t.id=o.task_id WHERE (o.settlement_pending OR o.status IN('settling','queued')) AND o.due_at<=clock_timestamp() AND (o.status IN('withdrawn','cancelled','rework','replan','requirement','resolved') OR t.state='REVIEW') ORDER BY o.due_at,o.created_at,o.id LIMIT $1`,[limit])).rows;
  for(const row of rows){
   try{
    const source=await transaction(this.db,async tx=>{
     const config=await lockConfiguration(tx);const runners=(await tx.query<{runner_id:string}>('SELECT DISTINCT runner_id FROM attempts WHERE task_id=$1 ORDER BY runner_id',[row.task_id])).rows;for(const r of runners)await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE',[r.runner_id]);
     const task=(await tx.query<SpecificationTask>('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[row.task_id])).rows[0]!,op=await reviewOperation(tx,row.task_id,row.id,true);
     if(op.settlement_pending){if(!await (this.hooks.settlementReady??reviewSettlementReady)(tx,task.id)){await tx.query("UPDATE task_review_operations SET due_at=clock_timestamp()+interval '1 second',reason='waiting_for_original_settlement' WHERE id=$1",[op.id]);return;}
      await tx.query('INSERT INTO task_review_settlements(operation_id,task_id,version,phase) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[op.id,op.task_id,op.version,op.status==='settling'?'original':'outcome']);
      await tx.query('INSERT INTO owner_delivery_revocation_settlements(revocation_id,task_id) SELECT id,task_id FROM owner_delivery_revocations WHERE feedback_id=$1 ON CONFLICT DO NOTHING',[op.feedback_id]);
      await tx.query('UPDATE task_review_operations SET settlement_pending=false,reason=NULL WHERE id=$1',[op.id]);if(op.status!=='settling')return;
     }
     if(!['settling','queued'].includes(op.status)||task.state!=='REVIEW')return;
     if(await reviewInputOrderBlocked(tx,op)){await tx.query("UPDATE task_review_operations SET due_at=clock_timestamp()+interval '1 second' WHERE id=$1",[op.id]);return;}
     if(op.source_id)return (await tx.query<ReviewSourceRow>('SELECT * FROM task_review_sources WHERE id=$1 AND preparation_failure IS NULL',[op.source_id])).rows[0];
     return createReviewSource(tx,task,op,config);
    });
    if(!source||source.preparation_failure)continue;
    await transaction(this.db,async tx=>{
     const result=await this.scheduling.selectAndEnqueue(tx,{attempt_id:source.planned_attempt_id,task_id:source.task_id,kind:'planner',expected:{control_version:source.source.control_version,specification_id:source.source.specification_id,plan_id:source.source.plan_id},prompt:source.prompt!,source_watermark:0,task_review_source:source.source});
     // selectAndEnqueue already owns Runner -> Task locks when queued; acquire Task only on read-only selection failure.
     await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[source.task_id]);
     await tx.query('UPDATE task_review_sources SET waiting_reason=$2,last_checked_at=clock_timestamp() WHERE id=$1',[source.id,result.status==='unavailable'?result.reason:null]);await tx.query("UPDATE task_review_operations SET status=CASE WHEN $2 THEN 'running' ELSE status END,reason=$3,due_at=clock_timestamp()+interval '1 second' WHERE id=$1 AND source_id=$4 AND status='queued'",[source.operation_id,result.status==='queued',result.status==='unavailable'?result.reason:null,source.id]);
    });
   }catch(e){if(!(e instanceof CommandError))throw e;await this.db.pool.query("UPDATE task_review_operations SET reason=$2,due_at=clock_timestamp()+interval '1 second' WHERE id=$1 AND status IN('settling','queued')",[row.id,e.detail.code]);}
  }
 }finally{this.pumping=false;}}
}
