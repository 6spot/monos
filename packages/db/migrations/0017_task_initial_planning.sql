-- Selection bookkeeping exists before any Runtime/Attempt. No historical source
-- is inferred for old Tasks or probe Attempts.
CREATE TABLE task_planning_outbox (
  id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id),
  previous_intent_id text, owner_request_id text NOT NULL,
  specification_id text NOT NULL,
  expected_version bigint NOT NULL CHECK(expected_version BETWEEN 1 AND 9007199254740991),
  planned_attempt_id text NOT NULL UNIQUE,
  configuration_version bigint NOT NULL CHECK(configuration_version BETWEEN 0 AND 9007199254740991),
  context jsonb, prompt text, context_digest text NOT NULL CHECK(context_digest ~ '^[0-9a-f]{64}$'),
  preparation_failure text CHECK(preparation_failure IN ('context_budget_exceeded')),
  done boolean NOT NULL DEFAULT false,
  waiting_reason text CHECK(char_length(waiting_reason) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), last_checked_at timestamptz NOT NULL DEFAULT 'epoch',
  UNIQUE(task_id,id), UNIQUE(task_id,id,planned_attempt_id,specification_id),
  FOREIGN KEY(task_id,specification_id) REFERENCES specification_revisions(task_id,id),
  FOREIGN KEY(task_id,previous_intent_id) REFERENCES task_planning_outbox(task_id,id),
  FOREIGN KEY(task_id,owner_request_id) REFERENCES owner_command_receipts(scope_id,request_id) DEFERRABLE INITIALLY DEFERRED,
  CHECK(previous_intent_id IS NULL OR previous_intent_id<>id),
  CHECK((context IS NOT NULL AND prompt IS NOT NULL AND preparation_failure IS NULL)
    OR (context IS NULL AND prompt IS NULL AND preparation_failure IS NOT NULL)),
  CHECK(prompt IS NULL OR (char_length(prompt)<=262144 AND octet_length(prompt)<=1040384))
);
CREATE UNIQUE INDEX one_pending_task_planning_intent ON task_planning_outbox(task_id) WHERE NOT done;
-- Typed provenance links supplement the exact immutable event body. An answer
-- or withdrawal can only reference an issue and source within its own Task.
ALTER TABLE task_events ADD COLUMN planning_intent_id text;
ALTER TABLE task_events ADD COLUMN planning_issue_sequence bigint;
ALTER TABLE task_events ADD FOREIGN KEY(task_id,planning_intent_id) REFERENCES task_planning_outbox(task_id,id);
ALTER TABLE task_events ADD FOREIGN KEY(task_id,planning_issue_sequence) REFERENCES task_events(task_id,sequence);
ALTER TABLE tasks ADD COLUMN initial_planning_intent_id text;
ALTER TABLE tasks ADD COLUMN planning_issue_sequence bigint;
ALTER TABLE tasks ADD FOREIGN KEY(id,initial_planning_intent_id) REFERENCES task_planning_outbox(task_id,id);
ALTER TABLE tasks ADD FOREIGN KEY(id,planning_issue_sequence) REFERENCES task_events(task_id,sequence);
ALTER TABLE attempts ADD COLUMN planning_intent_id text;
ALTER TABLE attempts ADD FOREIGN KEY(task_id,planning_intent_id,id,specification_id) REFERENCES task_planning_outbox(task_id,id,planned_attempt_id,specification_id);
ALTER TABLE attempts ADD CHECK(planning_intent_id IS NULL OR
  (task_id IS NOT NULL AND todo_id IS NULL AND kind='planner' AND node_id IS NULL AND node_activation=0
    AND plan_id IS NULL AND specification_id IS NOT NULL AND owner_key='planner:'||task_id));
CREATE FUNCTION preserve_task_planning_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['done','waiting_reason','last_checked_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['done','waiting_reason','last_checked_at']) OR (OLD.done AND NOT NEW.done) THEN
    RAISE EXCEPTION 'Planning source and prepared context are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_task_planning_intent BEFORE UPDATE ON task_planning_outbox FOR EACH ROW EXECUTE FUNCTION preserve_task_planning_intent();
CREATE TRIGGER retained_task_planning_intent BEFORE DELETE ON task_planning_outbox FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE FUNCTION preserve_attempt_planning_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.planning_intent_id IS DISTINCT FROM OLD.planning_intent_id OR
     (OLD.planning_intent_id IS NOT NULL AND
       (NEW.specification_id IS DISTINCT FROM OLD.specification_id OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
        OR (NEW.launch-ARRAY['fencing_generation','mutation_allowed','process_released']) IS DISTINCT FROM
           (OLD.launch-ARRAY['fencing_generation','mutation_allowed','process_released']))) THEN
    RAISE EXCEPTION 'Attempt planning source and launch context are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_attempt_planning_source BEFORE UPDATE ON attempts FOR EACH ROW EXECUTE FUNCTION preserve_attempt_planning_source();
-- Only new planning facts need this added restriction; retained legacy event
-- fixtures and unrelated event owners keep their existing migration contract.
CREATE FUNCTION preserve_planning_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind IN ('task_started','planning_retried','planning_stopped','planning_cancelled','planning_issue_raised','plan_published') THEN
    RAISE EXCEPTION 'Planning events are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_planning_event BEFORE UPDATE OR DELETE ON task_events FOR EACH ROW EXECUTE FUNCTION preserve_planning_event();

CREATE FUNCTION require_attempt_planning_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.planning_intent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM task_planning_outbox p WHERE p.id=NEW.planning_intent_id AND p.task_id=NEW.task_id
      AND p.planned_attempt_id=NEW.id AND p.specification_id=NEW.specification_id AND p.preparation_failure IS NULL
      AND NEW.launch->'task_planning_source'=jsonb_build_object('intent_id',p.id,'specification_id',p.specification_id,'context_digest',p.context_digest)
      AND NEW.launch->>'prompt'=p.prompt AND (NEW.launch->>'control_version')::bigint=p.expected_version
  ) THEN RAISE EXCEPTION 'Attempt launch must bind its exact prepared planning source' USING ERRCODE='23514'; END IF;
  IF NEW.planning_intent_id IS NULL AND NEW.launch ? 'task_planning_source' THEN
    RAISE EXCEPTION 'Task planning metadata requires its canonical source binding' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bound_attempt_planning_source BEFORE INSERT ON attempts FOR EACH ROW EXECUTE FUNCTION require_attempt_planning_source();
