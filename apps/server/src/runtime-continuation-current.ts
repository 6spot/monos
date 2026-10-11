import type { Transaction } from '../../../packages/db/src/index.ts';
import type { RuntimePredecessor } from './runtime-continuation-state.ts';

/** The coordinator holds the Task/Todo control lock. A prepared replacement has
 * its own source/version before it has an Attempt; the predecessor's old source
 * pointer is therefore not a currentness check. This checks durable obligation
 * and basis identity only. Freeze, settlement, input ordering and capacity remain
 * dispatch waits and must not supersede an otherwise current replacement. */
export async function preparedRuntimeSourceCurrent(
  tx: Transaction,
  predecessor: RuntimePredecessor,
  plannedAttemptID: string,
): Promise<boolean> {
  if (predecessor.launch.node_execution_source) {
    return !!(await tx.query(`SELECT 1 FROM node_execution_outbox s
      JOIN tasks t ON t.id=s.task_id JOIN nodes n ON n.id=s.node_id AND n.task_id=t.id
      WHERE s.planned_attempt_id=$1 AND s.task_id=$2 AND s.node_id=$3
        AND n.execution_source_id=s.id AND n.activation=s.node_activation
        AND n.state IN ('PENDING','RUNNING') AND t.state='RUNNING'
        AND t.accepted_delivery_operation_id IS NULL
        AND t.specification_id=s.specification_id AND t.plan_id=s.plan_id
        AND t.control_version=s.expected_version AND s.preparation_failure IS NULL`,
    [plannedAttemptID, predecessor.task_id, predecessor.node_id])).rowCount;
  }
  if (predecessor.launch.task_planning_source) {
    return !!(await tx.query(`SELECT 1 FROM task_planning_outbox s JOIN tasks t ON t.id=s.task_id
      WHERE s.planned_attempt_id=$1 AND s.task_id=$2 AND t.initial_planning_intent_id=s.id
        AND t.state='RUNNING' AND t.plan_id IS NULL AND t.planning_issue_sequence IS NULL
        AND t.specification_id=s.specification_id AND t.control_version=s.expected_version
        AND s.preparation_failure IS NULL`, [plannedAttemptID, predecessor.task_id])).rowCount;
  }
  if (predecessor.todo_id) {
    return !!(await tx.query(`SELECT 1 FROM todo_discussion_outbox s
      JOIN todo_discussion_controls c ON c.todo_id=s.todo_id
      JOIN todo_discussion_messages m ON m.id=s.source_message_id AND m.todo_id=s.todo_id
      WHERE s.planned_attempt_id=$1 AND s.todo_id=$2 AND s.source_message_id=$3
        AND c.source_message_id=s.source_message_id AND c.version=s.expected_version
        AND c.desired_attempt_id IS NULL AND m.author='owner' AND m.sequence>c.resolved_watermark
        AND NOT EXISTS(SELECT 1 FROM todo_discussion_resolutions r WHERE r.source_message_id=s.source_message_id)`,
    [plannedAttemptID, predecessor.todo_id, predecessor.launch.source_message_id])).rowCount;
  }
  if (predecessor.launch.task_conversation_source) {
    return !!(await tx.query(`SELECT 1 FROM task_conversation_outbox s
      JOIN tasks t ON t.id=s.task_id JOIN task_inputs i ON i.id=s.input_id AND i.task_id=t.id
      JOIN task_messages m ON m.id=i.message_id AND m.task_id=t.id
      WHERE s.planned_attempt_id=$1 AND s.task_id=$2 AND s.input_id=$3
        AND t.conversation_source_id=s.id AND t.conversation_input_id=s.input_id
        AND t.conversation_version=s.expected_version AND m.sequence=s.source_watermark
        AND i.status='pending' AND s.preparation_failure IS NULL
        AND (s.reply_only OR (t.state NOT IN ('COMPLETED','CANCELLED')
          AND t.accepted_delivery_operation_id IS NULL AND i.accepted_delivery_operation_id IS NULL))
        AND NOT EXISTS(SELECT 1 FROM task_input_reconsiderations r WHERE r.input_id=i.id)`,
    [plannedAttemptID, predecessor.task_id, predecessor.launch.task_conversation_source.input_id])).rowCount;
  }
  if (predecessor.launch.task_replan_source) {
    return !!(await tx.query(`SELECT 1 FROM replan_sources s
      JOIN replan_requests r ON r.id=s.request_id AND r.task_id=s.task_id
      JOIN tasks t ON t.id=s.task_id
      WHERE s.planned_attempt_id=$1 AND s.task_id=$2 AND s.request_id=$3 AND r.source_id=s.id
        AND r.status='pending' AND r.issue_id IS NULL AND r.proposal_id IS NULL
        AND t.state='REPLAN_REQUIRED' AND t.specification_id=s.specification_id AND t.plan_id=s.plan_id
        AND t.control_version=s.expected_version AND s.preparation_failure IS NULL`,
    [plannedAttemptID, predecessor.task_id, predecessor.launch.task_replan_source.request_id])).rowCount;
  }
  if (predecessor.launch.task_review_source) {
    const previous = predecessor.launch.task_review_source;
    return !!(await tx.query(`SELECT 1 FROM task_review_sources s
      JOIN task_review_operations o ON o.id=s.operation_id AND o.task_id=s.task_id
      JOIN tasks t ON t.id=s.task_id JOIN task_review_feedback f ON f.id=o.feedback_id AND f.task_id=t.id
      WHERE s.planned_attempt_id=$1 AND s.task_id=$2 AND o.id=$3 AND o.feedback_id=$4 AND o.purpose=$5
        AND o.source_id=s.id AND s.source->>'source_id'=s.id AND s.source->>'operation_id'=o.id
        AND s.source->>'feedback_id'=o.feedback_id AND s.source->>'purpose'=o.purpose
        AND o.version=(s.source->>'operation_version')::bigint
        AND o.status IN ('queued','running') AND o.issue_id IS NULL
        AND t.state='REVIEW' AND t.accepted_delivery_operation_id IS NULL
        AND t.specification_id=s.source->>'specification_id' AND t.plan_id=s.source->>'plan_id'
        AND t.control_version=(s.source->>'control_version')::bigint
        AND o.basis->>'specification_id'=s.source->>'specification_id'
        AND o.basis->>'plan_id'=s.source->>'plan_id'
        AND o.basis->>'review_result_digest'=s.source->>'review_result_digest'
        AND s.preparation_failure IS NULL
        AND NOT EXISTS(SELECT 1 FROM task_review_resolutions r WHERE r.operation_id=o.id)
        AND ((o.purpose='route_feedback' AND f.status='active' AND f.current_operation_id=o.id)
          OR (o.purpose='reconsider_input' AND EXISTS(
            SELECT 1 FROM task_input_reconsiderations i
            WHERE i.id=o.reconsideration_id AND i.task_id=t.id
              AND i.id=s.source->>'reconsideration_id' AND i.input_id=s.source->>'input_id'
              AND ((i.operation_id=o.id AND i.status='pending') OR EXISTS(
                SELECT 1 FROM task_review_input_successors successor
                WHERE successor.reconsideration_id=i.id AND successor.operation_id=o.id)))))`,
    [plannedAttemptID, predecessor.task_id, previous.operation_id, previous.feedback_id, previous.purpose])).rowCount;
  }
  return false;
}
