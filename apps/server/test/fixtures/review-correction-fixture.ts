import {randomUUID} from 'node:crypto';
import {ownerDeliveryFixture} from './owner-delivery-fixture.ts';
import {TaskReviewCommands} from '../../src/task-review-commands.ts';
import type {ReviewHooks} from '../../src/task-review-commands.ts';
import {TaskReviewReads} from '../../src/task-review-reads.ts';
import {TaskReviewCoordinator} from '../../src/task-review-coordinator.ts';
import {ownerDeliveryHooks} from '../../src/owner-delivery-control.ts';
import {ownerReviewHooks} from '../../src/owner-review-control.ts';
import type {OwnerReviewCommand} from '../../../../packages/protocol/src/index.ts';
export async function reviewCorrectionFixture(mode:'repository_free'|'modified'|'no_change'='repository_free',hooks:ReviewHooks=ownerReviewHooks,options:{runnerCredential?:string;artifactCount?:number}={}){
 const x=await ownerDeliveryFixture(mode,ownerDeliveryHooks,options);const reviewCommands=new TaskReviewCommands(x.db,hooks),reviewReads=new TaskReviewReads(x.db),reviewCoordinator=new TaskReviewCoordinator(x.db,x.service.instanceId,hooks);
 const reviewCommand=(name:OwnerReviewCommand['name'],payload:OwnerReviewCommand['payload'],requestId=randomUUID())=>reviewCommands.command(x.token,{schema_version:1,task_id:x.f.task,request_id:requestId,name,payload});
 const requestChanges=async(text='Improve the exact current result',feedbackId=randomUUID(),requestId=randomUUID())=>{const state=await reviewReads.task(x.token,x.f.task);return reviewCommand('request_changes',{feedback_id:feedbackId,text,basis:state.basis!,...(state.accepted_batch?{accepted_batch:state.accepted_batch}:{})},requestId);};
 const reviewTurn=async()=>{for(let i=0;i<30;i++){await reviewCoordinator.pump();if((await x.db.pool.query("SELECT 1 FROM attempts WHERE task_id=$1 AND task_review_source_id IS NOT NULL AND state='QUEUED'",[x.f.task])).rowCount)return x.promote();await new Promise(resolve=>setTimeout(resolve,200));}throw new Error('No current review dispatch within the bounded fixture wait');};
 const reviewBinding=(a:Awaited<ReturnType<typeof x.promote>>)=>{const b=a.dispatch.task_review_source!;return {feedback_id:b.feedback_id,operation_id:b.operation_id,operation_version:b.operation_version,source_id:b.source_id};};
 const reviewActionBasis=(a:Awaited<ReturnType<typeof x.promote>>)=>{const b=a.dispatch.task_review_source!;return {control_version:b.control_version,specification_id:b.specification_id,plan_id:b.plan_id};};
 return {...x,reviewTurn,reviewBinding,reviewActionBasis,reviewCommands,reviewReads,reviewCoordinator,reviewCommand,requestChanges};
}
