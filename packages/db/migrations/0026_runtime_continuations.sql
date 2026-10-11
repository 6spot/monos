ALTER TABLE attempts ADD COLUMN runtime_chain_root_id text REFERENCES attempts(id);
ALTER TABLE attempts ADD COLUMN runtime_target_index integer CHECK(runtime_target_index BETWEEN 0 AND 16);
ALTER TABLE attempts ADD COLUMN runtime_predecessor_id text UNIQUE REFERENCES attempts(id);
ALTER TABLE attempts ADD CHECK((runtime_chain_root_id IS NULL)=(runtime_target_index IS NULL));
ALTER TABLE attempts ADD CHECK(runtime_predecessor_id IS NULL OR runtime_chain_root_id IS NOT NULL);
ALTER TABLE attempts ADD UNIQUE(runtime_chain_root_id,runtime_target_index);

CREATE TABLE runtime_continuations (
  predecessor_attempt_id text PRIMARY KEY REFERENCES attempts(id),
  failure_stream_id text NOT NULL, failure_sequence bigint NOT NULL,
  stop_operation_id text NOT NULL REFERENCES operations(id),
  successor_planned_attempt_id text UNIQUE,
  state text NOT NULL CHECK(state IN ('settling','prepared','queued','exhausted','superseded')),
  reason text CHECK(char_length(reason) BETWEEN 1 AND 128), resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_checked_at timestamptz NOT NULL DEFAULT 'epoch',
  FOREIGN KEY(predecessor_attempt_id,failure_stream_id,failure_sequence) REFERENCES runtime_events(attempt_id,stream_id,sequence),
  CHECK(state NOT IN ('prepared','queued') OR successor_planned_attempt_id IS NOT NULL),
  CHECK(state NOT IN ('settling','prepared') OR resolved_at IS NULL)
);
CREATE INDEX pending_runtime_continuations ON runtime_continuations(last_checked_at,predecessor_attempt_id) WHERE resolved_at IS NULL;

ALTER TABLE task_planning_outbox ADD COLUMN runtime_predecessor_attempt_id text REFERENCES runtime_continuations(predecessor_attempt_id);
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO STRICT constraint_name FROM pg_constraint
    WHERE conrelid='task_planning_outbox'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%owner_request_id%' AND pg_get_constraintdef(oid) LIKE '%requirement_change_id%';
  EXECUTE format('ALTER TABLE task_planning_outbox DROP CONSTRAINT %I',constraint_name);
END;
$$;
ALTER TABLE task_planning_outbox ADD CONSTRAINT planning_origin CHECK(num_nonnulls(owner_request_id,requirement_change_id,runtime_predecessor_attempt_id)=1);
ALTER TABLE todo_discussion_outbox ADD UNIQUE(todo_id,id);
ALTER TABLE todo_discussion_outbox ADD COLUMN previous_intent_id text;
ALTER TABLE todo_discussion_outbox ADD FOREIGN KEY(todo_id,previous_intent_id) REFERENCES todo_discussion_outbox(todo_id,id);
ALTER TABLE todo_discussion_outbox ADD CHECK(previous_intent_id IS DISTINCT FROM id);

CREATE FUNCTION validate_runtime_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE predecessor attempts;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW.runtime_chain_root_id,NEW.runtime_target_index,NEW.runtime_predecessor_id,NEW.selection_context) IS DISTINCT FROM
       (OLD.runtime_chain_root_id,OLD.runtime_target_index,OLD.runtime_predecessor_id,OLD.selection_context) THEN
      RAISE EXCEPTION 'Runtime selection and continuation chain are immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.runtime_chain_root_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.selection_context IS NULL OR jsonb_typeof(NEW.selection_context->'policy_targets') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.selection_context->'policy_targets') NOT BETWEEN 1 AND 17
    OR (NEW.selection_context->'policy_targets'->NEW.runtime_target_index) IS DISTINCT FROM (NEW.selection_context->'target')
    OR NEW.selection_context->'target'->>'runtime_id' IS DISTINCT FROM NEW.launch->>'runtime_id'
    OR NEW.selection_context->'target'->>'model_id' IS DISTINCT FROM NEW.launch->>'model'
    OR NEW.selection_context->'target'->>'thinking_level' IS DISTINCT FROM NEW.launch->>'thinking_level' THEN
    RAISE EXCEPTION 'Runtime target must match its frozen policy position and dispatch' USING ERRCODE='23514';
  END IF;
  IF NEW.runtime_predecessor_id IS NULL THEN
    IF NEW.runtime_chain_root_id<>NEW.id THEN RAISE EXCEPTION 'Runtime chain root must identify itself' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO STRICT predecessor FROM attempts WHERE id=NEW.runtime_predecessor_id;
  IF NEW.runtime_chain_root_id IS DISTINCT FROM predecessor.runtime_chain_root_id
    OR NEW.runtime_target_index<=predecessor.runtime_target_index
    OR NEW.selection_context->'policy_targets' IS DISTINCT FROM predecessor.selection_context->'policy_targets'
    OR NEW.selection_context->'source' IS DISTINCT FROM predecessor.selection_context->'source'
    OR NEW.selection_context->'configuration_version' IS DISTINCT FROM predecessor.selection_context->'configuration_version'
    OR (NEW.runner_id,NEW.owner_key,NEW.task_id,NEW.todo_id,NEW.node_id,NEW.node_activation) IS DISTINCT FROM
       (predecessor.runner_id,predecessor.owner_key,predecessor.task_id,predecessor.todo_id,predecessor.node_id,predecessor.node_activation)
    OR (NEW.planning_intent_id IS NOT NULL,NEW.node_execution_source_id IS NOT NULL,NEW.task_conversation_source_id IS NOT NULL,NEW.replan_source_id IS NOT NULL,NEW.task_review_source_id IS NOT NULL) IS DISTINCT FROM
       (predecessor.planning_intent_id IS NOT NULL,predecessor.node_execution_source_id IS NOT NULL,predecessor.task_conversation_source_id IS NOT NULL,predecessor.replan_source_id IS NOT NULL,predecessor.task_review_source_id IS NOT NULL)
    OR NOT EXISTS(SELECT 1 FROM runtime_continuations c WHERE c.predecessor_attempt_id=predecessor.id AND c.successor_planned_attempt_id=NEW.id AND c.state='prepared') THEN
    RAISE EXCEPTION 'Runtime successor must preserve execution ownership and advance the frozen policy' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_runtime_chain BEFORE INSERT OR UPDATE ON attempts FOR EACH ROW EXECUTE FUNCTION validate_runtime_chain();

-- Prepared sources are immutable family-owned contexts, never a second use of
-- the predecessor source or an unrelated Planner obligation.
CREATE FUNCTION runtime_source_follows(predecessor_id text, planned_id text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM attempts p JOIN node_execution_outbox s ON s.planned_attempt_id=planned_id
    WHERE p.id=predecessor_id AND s.previous_source_id=p.node_execution_source_id AND s.task_id=p.task_id
      AND s.node_id=p.node_id AND s.node_activation=p.node_activation AND s.specification_id=p.specification_id AND s.plan_id=p.plan_id)
  OR EXISTS(SELECT 1 FROM attempts p JOIN task_planning_outbox s ON s.planned_attempt_id=planned_id
    WHERE p.id=predecessor_id AND s.previous_intent_id=p.planning_intent_id AND s.runtime_predecessor_attempt_id=p.id
      AND s.task_id=p.task_id AND s.specification_id=p.specification_id)
  OR EXISTS(SELECT 1 FROM attempts p JOIN todo_discussion_outbox old ON old.planned_attempt_id=p.id
    JOIN todo_discussion_outbox s ON s.previous_intent_id=old.id AND s.planned_attempt_id=planned_id
    WHERE p.id=predecessor_id AND s.todo_id=p.todo_id AND s.source_message_id=old.source_message_id)
  OR EXISTS(SELECT 1 FROM attempts p JOIN task_conversation_outbox old ON old.id=p.task_conversation_source_id
    JOIN task_conversation_outbox s ON s.previous_source_id=old.id AND s.planned_attempt_id=planned_id
    WHERE p.id=predecessor_id AND s.task_id=p.task_id AND s.input_id=old.input_id AND s.source_watermark=old.source_watermark)
  OR EXISTS(SELECT 1 FROM attempts p JOIN replan_sources old ON old.id=p.replan_source_id
    JOIN replan_sources s ON s.previous_source_id=old.id AND s.planned_attempt_id=planned_id
    WHERE p.id=predecessor_id AND s.task_id=p.task_id AND s.request_id=old.request_id
      AND s.specification_id=old.specification_id AND s.plan_id=old.plan_id)
  OR EXISTS(SELECT 1 FROM attempts p JOIN task_review_sources old ON old.id=p.task_review_source_id
    JOIN task_review_sources s ON s.previous_source_id=old.id AND s.planned_attempt_id=planned_id
    WHERE p.id=predecessor_id AND s.task_id=p.task_id AND s.operation_id=old.operation_id
      AND s.source->>'purpose'=old.source->>'purpose' AND s.source->>'feedback_id'=old.source->>'feedback_id');
$$;

CREATE FUNCTION validate_runtime_continuation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE predecessor attempts;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW.predecessor_attempt_id,NEW.failure_stream_id,NEW.failure_sequence,NEW.stop_operation_id,NEW.created_at) IS DISTINCT FROM
       (OLD.predecessor_attempt_id,OLD.failure_stream_id,OLD.failure_sequence,OLD.stop_operation_id,OLD.created_at)
      OR (OLD.successor_planned_attempt_id IS NOT NULL AND NEW.successor_planned_attempt_id IS DISTINCT FROM OLD.successor_planned_attempt_id)
      OR (OLD.state='prepared' AND NEW.state='settling')
      OR (OLD.state='exhausted' AND NEW.state NOT IN ('exhausted','superseded'))
      OR (OLD.resolved_at IS NOT NULL AND (NEW.state,NEW.resolved_at) IS DISTINCT FROM (OLD.state,OLD.resolved_at)) THEN
      RAISE EXCEPTION 'Runtime continuation evidence and successor are immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  SELECT * INTO STRICT predecessor FROM attempts WHERE id=NEW.predecessor_attempt_id;
  IF TG_OP='INSERT' AND (predecessor.runtime_chain_root_id IS NULL OR predecessor.state<>'FAILED' OR predecessor.mutation_allowed
    OR NOT EXISTS(SELECT 1 FROM runtime_events e WHERE e.attempt_id=predecessor.id AND e.stream_id=NEW.failure_stream_id AND e.sequence=NEW.failure_sequence
      AND e.body->>'kind' IN ('exited','process_absent') AND e.body->>'runtime_failure'='native_terminal_error')
    OR NOT EXISTS(SELECT 1 FROM operations o WHERE o.id=NEW.stop_operation_id AND o.attempt_id=predecessor.id AND o.kind='stop')) THEN
    RAISE EXCEPTION 'Runtime continuation requires retained terminal failure and exact Stop' USING ERRCODE='23514';
  END IF;
  IF NEW.successor_planned_attempt_id IS NOT NULL AND NOT runtime_source_follows(NEW.predecessor_attempt_id,NEW.successor_planned_attempt_id) THEN
    RAISE EXCEPTION 'Runtime successor source must retain its original obligation and predecessor' USING ERRCODE='23514';
  END IF;
  IF NEW.state='queued' AND NOT EXISTS(SELECT 1 FROM attempts successor WHERE successor.id=NEW.successor_planned_attempt_id
    AND successor.runtime_predecessor_id=NEW.predecessor_attempt_id) THEN
    RAISE EXCEPTION 'Queued continuation requires its exact selected Attempt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER retained_runtime_continuation BEFORE INSERT OR UPDATE ON runtime_continuations FOR EACH ROW EXECUTE FUNCTION validate_runtime_continuation();
CREATE TRIGGER no_delete_runtime_continuation BEFORE DELETE ON runtime_continuations FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();

-- Automatic source generations retain Runtime provenance rather than fabricating Owner receipts.
CREATE OR REPLACE FUNCTION validate_review_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation_row task_review_operations;receipt_row owner_review_command_receipts;
BEGIN
 IF TG_TABLE_NAME='task_review_feedback' THEN
  IF NEW.current_operation_id IS DISTINCT FROM OLD.current_operation_id THEN
   IF NOT EXISTS(SELECT 1 FROM task_review_operations owning WHERE owning.id=NEW.current_operation_id AND owning.task_id=NEW.task_id AND owning.feedback_id=NEW.id AND owning.purpose='route_feedback' AND (OLD.current_operation_id IS NULL AND owning.predecessor_operation_id IS NULL OR owning.predecessor_operation_id=OLD.current_operation_id AND (owning.dismissal_request_id IS NOT NULL OR EXISTS(SELECT 1 FROM owner_command_receipts withdrawal JOIN task_review_operations predecessor ON predecessor.id=owning.predecessor_operation_id WHERE withdrawal.scope_id=NEW.task_id AND withdrawal.envelope_json::jsonb->>'name'='withdraw_specification' AND withdrawal.envelope_json::jsonb->'payload'->>'proposal_id'=predecessor.requirement_proposal_id)))) THEN RAISE EXCEPTION 'Feedback owning pointer requires exact authorized successor' USING ERRCODE='23514';END IF;
  END IF;
  IF NEW.status=OLD.status THEN RETURN NULL;END IF;
  IF NEW.status='resolved' AND NOT EXISTS(SELECT 1 FROM task_review_operations owning LEFT JOIN task_review_resolutions result ON result.operation_id=owning.id WHERE owning.id=NEW.current_operation_id AND (owning.status='rework' AND result.kind='rework' OR owning.status='requirement' AND EXISTS(SELECT 1 FROM requirement_publications publication JOIN requirement_changes change ON change.id=publication.change_id WHERE change.proposal_id=owning.requirement_proposal_id))) THEN RAISE EXCEPTION 'Feedback resolution lacks genuine semantic/publication outcome' USING ERRCODE='23514';END IF;
  IF NEW.status='withdrawn' AND NOT EXISTS(SELECT 1 FROM owner_review_command_receipts receipt WHERE receipt.task_id=NEW.task_id AND receipt.envelope->>'name'='withdraw_review_feedback' AND receipt.envelope->'payload'->>'feedback_id'=NEW.id AND receipt.response->>'operation_id'=NEW.current_operation_id) THEN RAISE EXCEPTION 'Feedback withdrawal lacks actual Owner decision' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='task_input_reconsiderations' THEN
  IF NEW.operation_id IS DISTINCT FROM OLD.operation_id AND (OLD.operation_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM task_review_operations original WHERE original.id=NEW.operation_id AND original.task_id=NEW.task_id AND original.feedback_id=NEW.feedback_id AND original.purpose='reconsider_input' AND original.reconsideration_id=NEW.id AND original.predecessor_operation_id IS NULL)) THEN RAISE EXCEPTION 'Original reconsideration operation ownership is immutable' USING ERRCODE='23514';END IF;
  IF NEW.status=OLD.status THEN RETURN NULL;END IF;
  IF NEW.status IN('resolved','transferred') AND NOT EXISTS(SELECT 1 FROM task_review_resolutions result JOIN task_review_operations owning ON owning.id=result.operation_id WHERE owning.id=NEW.operation_id AND owning.reconsideration_id=NEW.id AND result.kind IN('resolved','requirement','replan') AND (NEW.status='resolved' AND result.body->'routing'->>'kind'='reply' OR NEW.status='transferred' AND result.body->'routing'->>'kind' IN('guidance','issue','answer','resolve_guidance','specification_proposal','replan'))) THEN RAISE EXCEPTION 'Reconsideration status lacks its genuine semantic successor' USING ERRCODE='23514';END IF;
  IF NEW.status='withdrawn' AND NOT EXISTS(SELECT 1 FROM owner_review_command_receipts receipt WHERE receipt.task_id=NEW.task_id AND receipt.envelope->>'name'='withdraw_review_input' AND receipt.envelope->'payload'->>'reconsideration_id'=NEW.id) THEN RAISE EXCEPTION 'Input withdrawal lacks actual Owner decision' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='task_review_operations' THEN
  SELECT * INTO operation_row FROM task_review_operations WHERE id=NEW.id;
  IF NEW.source_id IS DISTINCT FROM OLD.source_id OR NEW.previous_source_id IS DISTINCT FROM OLD.previous_source_id THEN
   IF NEW.source_id IS NULL THEN
    IF NEW.version<>OLD.version+1 OR NEW.previous_source_id IS DISTINCT FROM COALESCE(OLD.source_id,OLD.previous_source_id) THEN RAISE EXCEPTION 'Source retirement lacks exact Owner generation transition' USING ERRCODE='23514';END IF;
   ELSIF OLD.source_id IS NOT NULL OR NEW.version<>OLD.version OR NEW.previous_source_id IS DISTINCT FROM OLD.previous_source_id OR NOT EXISTS(SELECT 1 FROM task_review_sources generation WHERE generation.id=NEW.source_id AND generation.operation_id=NEW.id AND generation.previous_source_id IS NOT DISTINCT FROM OLD.previous_source_id AND generation.source->'operation_version'=to_jsonb(NEW.version)) THEN RAISE EXCEPTION 'Source replacement requires immutable exact predecessor generation' USING ERRCODE='23514';END IF;
  END IF;
  IF NEW.version IS DISTINCT FROM OLD.version THEN
   IF NEW.version<>OLD.version+1 OR NOT EXISTS(SELECT 1 FROM owner_review_command_receipts receipt WHERE receipt.task_id=NEW.task_id AND receipt.envelope->'payload'->>'operation_id'=NEW.id AND receipt.envelope->'payload'->'expected_version'=to_jsonb(OLD.version) AND receipt.response->'operation_version'=to_jsonb(NEW.version) AND receipt.envelope->>'name' IN('retry_review_feedback','withdraw_review_feedback','retry_review_input','withdraw_review_input')) AND NOT EXISTS(
     SELECT 1 FROM runtime_continuations continuation
       JOIN attempts failed ON failed.id=continuation.predecessor_attempt_id
       JOIN operations stopped ON stopped.id=continuation.stop_operation_id AND stopped.attempt_id=failed.id AND stopped.kind='stop' AND stopped.state='succeeded'
       JOIN task_review_sources previous ON previous.planned_attempt_id=failed.id AND previous.id=OLD.source_id
       JOIN task_review_sources successor ON successor.planned_attempt_id=continuation.successor_planned_attempt_id
     WHERE continuation.state IN('prepared','queued','exhausted') AND failed.state='FAILED' AND NOT failed.mutation_allowed
       AND failed.process_absent AND failed.process_released AND previous.operation_id=NEW.id
       AND NEW.source_id IS NULL AND NEW.previous_source_id=previous.id
       AND successor.previous_source_id=previous.id AND successor.operation_id=NEW.id AND successor.id=operation_row.source_id
       AND successor.source->'operation_version'=to_jsonb(NEW.version)
       AND NOT EXISTS(SELECT 1 FROM operations pending WHERE pending.attempt_id=failed.id AND pending.state NOT IN('succeeded','cancelled'))
       AND NOT EXISTS(SELECT 1 FROM workspace_leases lease WHERE lease.attempt_id=failed.id AND lease.state<>'released')
       AND NOT EXISTS(SELECT 1 FROM task_review_resolutions outcome WHERE outcome.operation_id=NEW.id))
    AND NOT EXISTS(SELECT 1 FROM tasks terminal WHERE terminal.id=NEW.task_id AND terminal.state='CANCELLED') THEN RAISE EXCEPTION 'Review capability change lacks exact Owner exit or Runtime continuation' USING ERRCODE='23514';END IF;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
   IF NEW.status IN('rework','replan','requirement','resolved') AND NOT EXISTS(SELECT 1 FROM task_review_resolutions result WHERE result.operation_id=NEW.id AND result.kind=NEW.status) THEN RAISE EXCEPTION 'Review terminal status lacks formal outcome' USING ERRCODE='23514';END IF;
   IF NEW.status='withdrawn' AND NOT EXISTS(SELECT 1 FROM owner_review_command_receipts receipt WHERE receipt.task_id=NEW.task_id AND receipt.response->>'operation_id'=NEW.id AND receipt.envelope->>'name' IN('withdraw_review_feedback','withdraw_review_input')) THEN RAISE EXCEPTION 'Review withdrawal lacks actual command' USING ERRCODE='23514';END IF;
   IF NEW.status='issue' AND NOT EXISTS(SELECT 1 FROM task_review_issues issue WHERE issue.id=NEW.issue_id AND issue.operation_id=NEW.id AND issue.source_id=NEW.source_id) THEN RAISE EXCEPTION 'Review issue attribution differs' USING ERRCODE='23514';END IF;
  END IF;
  IF OLD.settlement_pending AND NOT NEW.settlement_pending AND NOT EXISTS(SELECT 1 FROM task_review_settlements settled WHERE settled.operation_id=NEW.id AND settled.version=NEW.version AND settled.phase=CASE WHEN NEW.status IN('settling','queued','running','failed') THEN 'original' ELSE 'outcome' END) THEN RAISE EXCEPTION 'Review guard cannot clear without original settlement proof' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.status='cancelled' AND NOT EXISTS(SELECT 1 FROM tasks terminal WHERE terminal.id=NEW.task_id AND terminal.state='CANCELLED') THEN RAISE EXCEPTION 'Review cancellation requires terminal Task authority' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
