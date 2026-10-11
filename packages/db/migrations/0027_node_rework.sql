ALTER TABLE tasks ADD COLUMN rework_epoch bigint NOT NULL DEFAULT 1 CHECK (rework_epoch > 0);

CREATE TABLE node_rework_requests (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id),
  specification_id text NOT NULL REFERENCES specification_revisions(id),
  plan_id text NOT NULL REFERENCES plan_revisions(id),
  requester_node_id text NOT NULL REFERENCES nodes(id),
  requester_activation bigint NOT NULL CHECK (requester_activation > 0),
  requester_source_id text NOT NULL REFERENCES node_execution_outbox(id),
  requester_attempt_id text NOT NULL REFERENCES attempts(id),
  agent_request_id text NOT NULL,
  target_node_id text NOT NULL REFERENCES nodes(id),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0 AND octet_length(reason) <= 262144),
  budget_epoch bigint NOT NULL CHECK (budget_epoch > 0),
  automatic_ordinal integer CHECK (automatic_ordinal BETWEEN 1 AND 3),
  status text NOT NULL CHECK (status IN ('settling','limit_blocked','applied','continued','cancelled')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  stop_operation_id text NOT NULL UNIQUE REFERENCES operations(id),
  blocker_id text REFERENCES node_blockers(id),
  owner_decision_request_id text,
  applied_control_version bigint CHECK (applied_control_version > 0),
  continued_source_id text REFERENCES node_execution_outbox(id),
  attention text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id,task_id),
  UNIQUE (requester_attempt_id,agent_request_id),
  UNIQUE (task_id,budget_epoch,automatic_ordinal),
  FOREIGN KEY (requester_attempt_id,task_id,agent_request_id)
    REFERENCES command_receipts(attempt_id,scope_id,request_id) DEFERRABLE INITIALLY DEFERRED,
  CHECK ((automatic_ordinal IS NULL) = (blocker_id IS NOT NULL)),
  CHECK ((status='applied') = (applied_control_version IS NOT NULL)),
  CHECK (status<>'limit_blocked' OR automatic_ordinal IS NULL),
  CHECK (status<>'settling' OR automatic_ordinal IS NOT NULL OR owner_decision_request_id IS NOT NULL),
  CHECK (status<>'continued' OR automatic_ordinal IS NULL AND owner_decision_request_id IS NOT NULL),
  CHECK (continued_source_id IS NULL OR status='continued')
);
CREATE UNIQUE INDEX one_pending_node_rework ON node_rework_requests(task_id) WHERE status IN ('settling','limit_blocked');
CREATE INDEX node_rework_poll ON node_rework_requests(last_checked_at,created_at,id) WHERE status='settling';

CREATE TABLE node_rework_targets (
  request_id text NOT NULL,
  task_id text NOT NULL,
  node_id text NOT NULL REFERENCES nodes(id),
  from_activation bigint NOT NULL CHECK (from_activation > 0),
  source_id text REFERENCES node_execution_outbox(id),
  completion_operation_id text REFERENCES completion_manifests(operation_id),
  completion_manifest_digest text CHECK (completion_manifest_digest ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (request_id,node_id),
  FOREIGN KEY (request_id,task_id) REFERENCES node_rework_requests(id,task_id),
  CHECK ((completion_operation_id IS NULL) = (completion_manifest_digest IS NULL))
);
CREATE TABLE node_rework_decisions (
  request_id text PRIMARY KEY,
  task_id text NOT NULL,
  owner_request_id text NOT NULL,
  name text NOT NULL CHECK (name IN ('apply_rework','continue_without_rework')),
  expected_version bigint NOT NULL CHECK (expected_version > 0),
  answer text CHECK (length(btrim(answer)) > 0 AND octet_length(answer) <= 262144),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (task_id,owner_request_id),
  FOREIGN KEY (request_id,task_id) REFERENCES node_rework_requests(id,task_id),
  FOREIGN KEY (task_id,owner_request_id) REFERENCES owner_command_receipts(scope_id,request_id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE node_rework_requests ADD FOREIGN KEY (task_id,owner_decision_request_id)
  REFERENCES node_rework_decisions(task_id,owner_request_id) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION node_rework_closure(plan_identity text,target_identity text) RETURNS text[] LANGUAGE sql STABLE AS $$
  WITH RECURSIVE affected(node_id) AS (
    SELECT node_id FROM plan_nodes WHERE plan_id=plan_identity AND node_id=target_identity
    UNION
    SELECT pn.node_id FROM plan_nodes pn JOIN affected a ON pn.definition->'dependencies' ? a.node_id WHERE pn.plan_id=plan_identity
  ) SELECT array_agg(node_id ORDER BY node_id) FROM affected;
$$;

CREATE FUNCTION protect_node_rework_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='node_rework_requests' AND TG_OP='INSERT' THEN
    IF NEW.version<>1 OR NEW.status<>(CASE WHEN NEW.automatic_ordinal IS NULL THEN 'limit_blocked' ELSE 'settling' END)
      OR NEW.owner_decision_request_id IS NOT NULL OR NEW.applied_control_version IS NOT NULL OR NEW.continued_source_id IS NOT NULL
      OR NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=NEW.task_id AND t.rework_epoch=NEW.budget_epoch
        AND t.specification_id=NEW.specification_id AND t.plan_id=NEW.plan_id AND t.state IN('RUNNING','BLOCKED'))
    THEN RAISE EXCEPTION 'Rework starts at the current Task basis and budget epoch' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME IN ('node_rework_targets','node_rework_decisions') OR TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Rework history is immutable' USING ERRCODE='23514';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['status','version','owner_decision_request_id','applied_control_version','continued_source_id','attention','last_checked_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','owner_decision_request_id','applied_control_version','continued_source_id','attention','last_checked_at'])
    OR OLD.status IN ('applied','continued','cancelled') AND NEW IS DISTINCT FROM OLD AND NOT
      (OLD.status='continued' AND OLD.continued_source_id IS NULL AND NEW.continued_source_id IS NOT NULL AND
       (to_jsonb(NEW)-'continued_source_id')=(to_jsonb(OLD)-'continued_source_id'))
    OR NEW.status IS DISTINCT FROM OLD.status AND NOT (
      OLD.status='settling' AND NEW.status IN ('applied','cancelled') OR
      OLD.status='limit_blocked' AND NEW.status IN ('settling','continued','cancelled'))
    OR NEW.version<>OLD.version+(CASE WHEN NEW.status IS DISTINCT FROM OLD.status THEN 1 ELSE 0 END)
    OR OLD.owner_decision_request_id IS NOT NULL AND NEW.owner_decision_request_id IS DISTINCT FROM OLD.owner_decision_request_id
  THEN RAISE EXCEPTION 'Rework operation identity or transition changed' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER node_rework_request_history BEFORE INSERT OR UPDATE OR DELETE ON node_rework_requests FOR EACH ROW EXECUTE FUNCTION protect_node_rework_history();
CREATE TRIGGER node_rework_target_history BEFORE UPDATE OR DELETE ON node_rework_targets FOR EACH ROW EXECUTE FUNCTION protect_node_rework_history();
CREATE TRIGGER node_rework_decision_history BEFORE UPDATE OR DELETE ON node_rework_decisions FOR EACH ROW EXECUTE FUNCTION protect_node_rework_history();

CREATE FUNCTION validate_node_rework_initial_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM node_rework_requests r JOIN nodes n ON n.id=NEW.node_id AND n.task_id=r.task_id
    LEFT JOIN node_completions c ON c.node_id=n.id AND c.activation=n.activation
    LEFT JOIN completion_manifests m ON m.operation_id=c.operation_id
    WHERE r.id=NEW.request_id AND r.task_id=NEW.task_id AND r.version=1 AND r.status IN('settling','limit_blocked')
      AND n.activation=NEW.from_activation AND n.execution_source_id IS NOT DISTINCT FROM NEW.source_id
      AND c.operation_id IS NOT DISTINCT FROM NEW.completion_operation_id AND m.content_digest IS NOT DISTINCT FROM NEW.completion_manifest_digest)
  THEN RAISE EXCEPTION 'Rework target must freeze the exact current activation and completion' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER node_rework_initial_target BEFORE INSERT ON node_rework_targets FOR EACH ROW EXECUTE FUNCTION validate_node_rework_initial_target();

CREATE FUNCTION validate_node_rework_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r node_rework_requests; x node_rework_targets; d node_rework_decisions;
  receipt command_receipts; owner_receipt owner_command_receipts; source node_execution_outbox; effect operations;
  ids text[]; envelope jsonb; old_epoch bigint;
BEGIN
  IF TG_TABLE_NAME='tasks' THEN
    IF NEW.rework_epoch=OLD.rework_epoch THEN RETURN NULL; END IF;
    old_epoch:=OLD.rework_epoch;
    IF NEW.rework_epoch<>old_epoch+1 OR NOT EXISTS(
      SELECT 1 FROM node_rework_requests request JOIN node_rework_decisions decision ON decision.request_id=request.id
      WHERE request.task_id=NEW.id AND request.budget_epoch=old_epoch AND request.status='applied'
        AND request.owner_decision_request_id=decision.owner_request_id AND decision.name='apply_rework'
        AND request.applied_control_version=NEW.control_version
    ) THEN RAISE EXCEPTION 'Rework budget resets require the exact applied Owner decision' USING ERRCODE='23514'; END IF;
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME='node_rework_requests' THEN SELECT * INTO r FROM node_rework_requests WHERE id=NEW.id;
  ELSE SELECT * INTO r FROM node_rework_requests WHERE id=NEW.request_id; END IF;
  SELECT * INTO receipt FROM command_receipts WHERE attempt_id=r.requester_attempt_id AND scope_id=r.task_id AND request_id=r.agent_request_id;
  SELECT * INTO source FROM node_execution_outbox WHERE id=r.requester_source_id;
  SELECT * INTO effect FROM operations WHERE id=r.stop_operation_id;
  envelope:=receipt.envelope_json::jsonb;
  SELECT array_agg(node_id ORDER BY node_id) INTO ids FROM node_rework_targets WHERE request_id=r.id;
  IF (receipt.command_name='request_rework' AND envelope->>'name'='request_rework'
      AND envelope->'payload'->>'reason'=r.reason AND envelope->>'scope_id'=r.task_id
      AND (envelope->>'expected_control_version')::bigint=source.expected_version
      AND receipt.response->>'status'='committed' AND receipt.response->>'operation_id'=r.stop_operation_id
      AND receipt.response->'result'->'rework_outcome'->>'rework_request_id'=r.id
      AND receipt.response->'result'->'rework_outcome'->>'target_node_id'=r.target_node_id
      AND receipt.response->'result'->'rework_outcome'->'affected_node_ids'=to_jsonb(ids)
      AND receipt.response->'result'->'rework_outcome'->>'status'=CASE WHEN r.automatic_ordinal IS NULL THEN 'limit_blocked' ELSE 'settling' END
      AND receipt.response->'result'->'rework_outcome'->'version'='1'::jsonb
      AND receipt.response->'result'->'rework_outcome'->'automatic_requests_used'=to_jsonb(COALESCE(r.automatic_ordinal,3))
      AND source.task_id=r.task_id AND source.node_id=r.requester_node_id AND source.node_activation=r.requester_activation
      AND source.planned_attempt_id=r.requester_attempt_id AND source.specification_id=r.specification_id AND source.plan_id=r.plan_id
      AND effect.kind='stop' AND effect.attempt_id=r.requester_attempt_id AND effect.request_id=r.agent_request_id
      AND r.requester_node_id<>r.target_node_id AND r.requester_node_id=ANY(node_rework_closure(r.plan_id,r.target_node_id))
      AND ids=node_rework_closure(r.plan_id,r.target_node_id)
      AND EXISTS(SELECT 1 FROM attempts a WHERE a.id=r.requester_attempt_id AND a.task_id=r.task_id AND a.kind='node'
        AND a.node_id=r.requester_node_id AND a.node_activation=r.requester_activation AND a.node_execution_source_id=source.id)
      AND EXISTS(SELECT 1 FROM node_rework_targets t WHERE t.request_id=r.id AND t.node_id=r.requester_node_id
        AND t.from_activation=r.requester_activation AND t.source_id=r.requester_source_id)) IS NOT TRUE
  THEN RAISE EXCEPTION 'Rework request lacks exact canonical Agent and Stop authority' USING ERRCODE='23514'; END IF;
  IF envelope->'payload' ? 'target_node_id' THEN
    IF envelope->'payload'->>'target_node_id' IS DISTINCT FROM r.target_node_id THEN RAISE EXCEPTION 'Rework target differs from Agent request' USING ERRCODE='23514'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM plan_nodes pn WHERE pn.plan_id=r.plan_id AND pn.node_id=r.requester_node_id
    AND pn.definition->'dependencies'=jsonb_build_array(r.target_node_id)) THEN
    RAISE EXCEPTION 'Omitted Rework target requires exactly one direct upstream' USING ERRCODE='23514';
  END IF;
  IF r.automatic_ordinal IS NOT NULL AND (SELECT count(*) FROM node_rework_requests previous
      WHERE previous.task_id=r.task_id AND previous.budget_epoch=r.budget_epoch AND previous.automatic_ordinal<=r.automatic_ordinal)<>r.automatic_ordinal
    OR r.automatic_ordinal IS NULL AND (SELECT count(*) FROM node_rework_requests previous
      WHERE previous.task_id=r.task_id AND previous.budget_epoch=r.budget_epoch AND previous.automatic_ordinal IS NOT NULL)<>3
  THEN RAISE EXCEPTION 'Rework automatic budget does not match durable requests' USING ERRCODE='23514'; END IF;
  IF r.blocker_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM node_blockers b WHERE b.id=r.blocker_id AND b.task_id=r.task_id
    AND b.node_id=r.requester_node_id AND b.node_activation=r.requester_activation AND b.source_id=r.requester_source_id
    AND b.attempt_id=r.requester_attempt_id AND b.kind='semantic') THEN
    RAISE EXCEPTION 'Rework limit blocker attribution differs' USING ERRCODE='23514'; END IF;
  FOR x IN SELECT * FROM node_rework_targets WHERE request_id=r.id LOOP
    IF x.task_id<>r.task_id OR NOT EXISTS(SELECT 1 FROM node_activations a WHERE a.task_id=r.task_id AND a.node_id=x.node_id
      AND a.activation=x.from_activation AND activation_applies(r.task_id,x.node_id,x.from_activation,r.specification_id,r.plan_id))
      OR x.source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM node_execution_outbox s WHERE s.id=x.source_id AND s.task_id=r.task_id
        AND s.node_id=x.node_id AND s.node_activation=x.from_activation AND s.specification_id=r.specification_id AND s.plan_id=r.plan_id)
      OR x.completion_operation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM completion_manifests m JOIN node_completions c ON c.operation_id=m.operation_id
        WHERE m.operation_id=x.completion_operation_id AND m.task_id=r.task_id AND m.node_id=x.node_id AND m.node_activation=x.from_activation
          AND m.content_digest=x.completion_manifest_digest)
    THEN RAISE EXCEPTION 'Rework target lineage or historical completion differs' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF r.owner_decision_request_id IS NOT NULL THEN
    SELECT * INTO d FROM node_rework_decisions WHERE request_id=r.id;
    SELECT * INTO owner_receipt FROM owner_command_receipts WHERE scope_id=r.task_id AND request_id=r.owner_decision_request_id;
    IF (d.task_id=r.task_id AND d.owner_request_id=r.owner_decision_request_id AND r.automatic_ordinal IS NULL
      AND owner_receipt.envelope_json::jsonb->>'name'=d.name
      AND owner_receipt.envelope_json::jsonb->'payload'->>'rework_request_id'=r.id
      AND (owner_receipt.envelope_json::jsonb->'payload'->>'expected_version')::bigint=d.expected_version
      AND (owner_receipt.envelope_json::jsonb->'payload'->>'answer') IS NOT DISTINCT FROM d.answer
      AND owner_receipt.response->'rework_outcome'->>'rework_request_id'=r.id
      AND owner_receipt.response->'rework_outcome'->>'target_node_id'=r.target_node_id
      AND owner_receipt.response->'rework_outcome'->'affected_node_ids'=to_jsonb(ids)
      AND d.expected_version<r.version
      AND (d.name='apply_rework' AND r.status IN('settling','applied','cancelled') OR d.name='continue_without_rework' AND r.status='continued')) IS NOT TRUE
    THEN RAISE EXCEPTION 'Rework resolution lacks its exact Owner decision receipt' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='node_rework_decisions' THEN
    RAISE EXCEPTION 'Unattached Rework Owner decision' USING ERRCODE='23514';
  END IF;
  IF r.status IN ('applied','continued') THEN
    IF effect.state<>'succeeded' OR NOT EXISTS(SELECT 1 FROM attempts a WHERE a.id=r.requester_attempt_id AND a.process_absent AND a.process_released)
      OR EXISTS(SELECT 1 FROM operations op WHERE op.attempt_id=r.requester_attempt_id AND op.state NOT IN('succeeded','cancelled'))
      OR EXISTS(SELECT 1 FROM workspace_leases l WHERE l.attempt_id=r.requester_attempt_id AND l.state<>'released') THEN
      RAISE EXCEPTION 'Rework resolution requires exact physical settlement' USING ERRCODE='23514'; END IF;
  END IF;
  IF r.status='applied' THEN
    IF EXISTS(SELECT 1 FROM node_rework_targets t WHERE t.request_id=r.id AND NOT EXISTS(SELECT 1 FROM node_activations a
      WHERE a.task_id=r.task_id AND a.node_id=t.node_id AND a.activation=t.from_activation+1
        AND a.specification_id=r.specification_id AND a.plan_id=r.plan_id))
      OR EXISTS(SELECT 1 FROM workspace_leases l JOIN node_rework_targets t ON t.node_id=l.node_id AND t.request_id=r.id WHERE l.state<>'released')
      OR EXISTS(SELECT 1 FROM attempts a JOIN node_rework_targets t ON t.node_id=a.node_id AND t.request_id=r.id
        WHERE a.node_activation=t.from_activation AND (NOT a.process_released OR EXISTS(SELECT 1 FROM operations op WHERE op.attempt_id=a.id AND op.state NOT IN('succeeded','cancelled'))))
      OR r.automatic_ordinal IS NULL AND r.owner_decision_request_id IS NULL THEN
      RAISE EXCEPTION 'Applied Rework lacks the complete settled activation publication' USING ERRCODE='23514'; END IF;
  END IF;
  IF r.continued_source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM node_execution_outbox s WHERE s.id=r.continued_source_id AND s.task_id=r.task_id
    AND s.node_id=r.requester_node_id AND s.node_activation=r.requester_activation AND s.specification_id=r.specification_id AND s.plan_id=r.plan_id
    AND s.id<>r.requester_source_id) THEN RAISE EXCEPTION 'Rework Continue source differs' USING ERRCODE='23514'; END IF;
  IF r.status='cancelled' AND NOT EXISTS(SELECT 1 FROM tasks WHERE id=r.task_id AND state='CANCELLED') THEN
    RAISE EXCEPTION 'Rework cancellation requires terminal Task authority' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER node_rework_request_authority AFTER INSERT OR UPDATE ON node_rework_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_node_rework_authority();
CREATE CONSTRAINT TRIGGER node_rework_target_authority AFTER INSERT ON node_rework_targets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_node_rework_authority();
CREATE CONSTRAINT TRIGGER node_rework_decision_authority AFTER INSERT ON node_rework_decisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_node_rework_authority();
CREATE CONSTRAINT TRIGGER node_rework_budget_authority AFTER UPDATE ON tasks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.rework_epoch IS DISTINCT FROM NEW.rework_epoch) EXECUTE FUNCTION validate_node_rework_authority();
