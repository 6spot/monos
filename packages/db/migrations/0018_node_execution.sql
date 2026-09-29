-- Canonical Node work is derived only from source-bound public Plan publication.
CREATE TABLE node_execution_outbox (
 id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), node_id text NOT NULL,
 node_activation bigint NOT NULL, specification_id text NOT NULL, plan_id text NOT NULL,
 expected_version bigint NOT NULL, planned_attempt_id text NOT NULL UNIQUE,
 configuration_version bigint NOT NULL, role_id text NOT NULL REFERENCES roles(id),
 previous_source_id text, owner_request_id text, recovery jsonb NOT NULL DEFAULT '{}',
 context jsonb, prompt text, context_digest text NOT NULL CHECK(context_digest ~ '^[a-f0-9]{64}$'),
 preparation_failure text, done boolean NOT NULL DEFAULT false, waiting_reason text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), last_checked_at timestamptz NOT NULL DEFAULT 'epoch',
 UNIQUE(task_id,id), UNIQUE(task_id,node_id,node_activation,id),
 UNIQUE(id,planned_attempt_id,task_id,node_id,node_activation,specification_id,plan_id),
 FOREIGN KEY(task_id,node_id) REFERENCES nodes(task_id,id),
 FOREIGN KEY(node_id,node_activation) REFERENCES node_activations(node_id,activation),
 FOREIGN KEY(task_id,specification_id) REFERENCES specification_revisions(task_id,id),
 FOREIGN KEY(task_id,plan_id) REFERENCES plan_revisions(task_id,id),
 FOREIGN KEY(task_id,previous_source_id) REFERENCES node_execution_outbox(task_id,id),
 FOREIGN KEY(task_id,owner_request_id) REFERENCES owner_command_receipts(scope_id,request_id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((prompt IS NULL AND context IS NULL AND preparation_failure IS NOT NULL) OR (prompt IS NOT NULL AND context IS NOT NULL AND preparation_failure IS NULL)),
 CHECK(prompt IS NULL OR (char_length(prompt)<=262144 AND octet_length(prompt)<=1040384))
);
CREATE UNIQUE INDEX one_pending_node_execution_source ON node_execution_outbox(node_id) WHERE NOT done;
CREATE TRIGGER immutable_node_execution_source BEFORE UPDATE ON node_execution_outbox FOR EACH ROW EXECUTE FUNCTION preserve_task_planning_intent();
CREATE TRIGGER retained_node_execution_source BEFORE DELETE ON node_execution_outbox FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
ALTER TABLE nodes ADD COLUMN execution_source_id text;
ALTER TABLE nodes ADD FOREIGN KEY(task_id,id,activation,execution_source_id) REFERENCES node_execution_outbox(task_id,node_id,node_activation,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE attempts ADD COLUMN node_execution_source_id text;
ALTER TABLE attempts ADD FOREIGN KEY(node_execution_source_id,id,task_id,node_id,node_activation,specification_id,plan_id)
 REFERENCES node_execution_outbox(id,planned_attempt_id,task_id,node_id,node_activation,specification_id,plan_id);
CREATE FUNCTION preserve_node_execution_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source node_execution_outbox;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.node_execution_source_id IS DISTINCT FROM OLD.node_execution_source_id OR (OLD.node_execution_source_id IS NOT NULL AND
    (NEW.specification_id,NEW.plan_id,NEW.launch-ARRAY['fencing_generation','mutation_allowed','process_released']) IS DISTINCT FROM
    (OLD.specification_id,OLD.plan_id,OLD.launch-ARRAY['fencing_generation','mutation_allowed','process_released'])) THEN
   RAISE EXCEPTION 'Node source and launch are immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.node_execution_source_id IS NOT NULL THEN
  SELECT * INTO source FROM node_execution_outbox WHERE id=NEW.node_execution_source_id;
  IF source.id IS NULL OR source.preparation_failure IS NOT NULL OR NEW.kind<>'node' OR NEW.todo_id IS NOT NULL OR
   NEW.launch->>'prompt' IS DISTINCT FROM source.prompt OR NEW.launch->'workspace_reservations' IS DISTINCT FROM source.context->'workspace_reservations' OR NEW.launch->'node_execution_source' IS DISTINCT FROM
   jsonb_build_object('source_id',source.id,'node_id',source.node_id,'node_activation',source.node_activation,
    'specification_id',source.specification_id,'plan_id',source.plan_id,'control_version',source.expected_version,'context_digest',source.context_digest)
   THEN RAISE EXCEPTION 'Node Attempt requires exact prepared source' USING ERRCODE='23514'; END IF;
 ELSIF NEW.launch ? 'node_execution_source' THEN RAISE EXCEPTION 'Node source provenance is missing' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER canonical_node_execution_attempt BEFORE INSERT OR UPDATE ON attempts FOR EACH ROW EXECUTE FUNCTION preserve_node_execution_attempt();
CREATE TABLE node_blockers (
 id text PRIMARY KEY, task_id text NOT NULL, node_id text NOT NULL, node_activation bigint NOT NULL, source_id text NOT NULL,
 attempt_id text REFERENCES attempts(id), kind text NOT NULL CHECK(kind IN ('semantic','factual','owner_stopped')),
 reason text NOT NULL CHECK(octet_length(reason)<=262144), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(task_id,node_id,node_activation,id),
 FOREIGN KEY(task_id,node_id,node_activation,source_id) REFERENCES node_execution_outbox(task_id,node_id,node_activation,id)
);
CREATE TRIGGER immutable_node_blocker BEFORE UPDATE OR DELETE ON node_blockers FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
ALTER TABLE nodes ADD COLUMN blocker_id text;
ALTER TABLE nodes ADD FOREIGN KEY(task_id,id,activation,blocker_id) REFERENCES node_blockers(task_id,node_id,node_activation,id);
CREATE TABLE artifacts (
 id text PRIMARY KEY, task_id text NOT NULL, node_id text NOT NULL, node_activation bigint NOT NULL,
 attempt_id text NOT NULL REFERENCES attempts(id), source_id text NOT NULL, specification_id text NOT NULL, plan_id text NOT NULL,
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 256), media_type text NOT NULL,
 content text NOT NULL CHECK(octet_length(content)<=262144), size_bytes integer NOT NULL CHECK(size_bytes=octet_length(content)),
 content_digest text NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'), external_references jsonb NOT NULL DEFAULT '[]',
 supersedes text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(task_id,id),
 FOREIGN KEY(task_id,supersedes) REFERENCES artifacts(task_id,id),
 FOREIGN KEY(source_id,attempt_id,task_id,node_id,node_activation,specification_id,plan_id)
 REFERENCES node_execution_outbox(id,planned_attempt_id,task_id,node_id,node_activation,specification_id,plan_id)
);
CREATE TRIGGER immutable_artifact BEFORE UPDATE OR DELETE ON artifacts FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TABLE completion_manifests (
 operation_id text PRIMARY KEY REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED,
 task_id text NOT NULL, node_id text NOT NULL, node_activation bigint NOT NULL, attempt_id text NOT NULL REFERENCES attempts(id),
 source_id text NOT NULL, specification_id text NOT NULL, plan_id text NOT NULL,
 summary text NOT NULL CHECK(octet_length(summary)<=262144), artifact_ids jsonb NOT NULL, content_digest text NOT NULL,
 FOREIGN KEY(source_id,attempt_id,task_id,node_id,node_activation,specification_id,plan_id)
 REFERENCES node_execution_outbox(id,planned_attempt_id,task_id,node_id,node_activation,specification_id,plan_id)
);
CREATE TRIGGER immutable_completion_manifest BEFORE UPDATE OR DELETE ON completion_manifests FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
ALTER TABLE operations ADD COLUMN repository_free boolean;
ALTER TABLE operations ADD COLUMN completion_manifest_digest text;
ALTER TABLE operations ADD COLUMN completion_operation_id text UNIQUE REFERENCES operations(id);
ALTER TABLE operations ADD COLUMN completion_identity_digest text;
ALTER TABLE operations ADD COLUMN completion_settlement jsonb;
ALTER TABLE operations ADD COLUMN settlement_purpose text CHECK(settlement_purpose IN ('correct','cancel_task'));
-- Replace only the three old checks whose explicitly supported operation shapes expand.
DO $$ DECLARE row record; BEGIN
 FOR row IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='operations'::regclass AND contype='c' LOOP
  IF row.definition LIKE '%kind%' AND (row.definition LIKE '%resource_id%' OR row.definition LIKE '%open_workspace%') THEN
   EXECUTE format('ALTER TABLE operations DROP CONSTRAINT %I',row.conname);
  END IF;
 END LOOP;
END $$;
ALTER TABLE operations ADD CHECK(kind IN ('open_workspace','inspect_repository','complete_node','stop','settle_completion'));
ALTER TABLE operations ADD CHECK(kind='stop' OR resource_id IS NOT NULL OR (kind='complete_node' AND repository_free IS TRUE));
ALTER TABLE operations ADD CHECK(repository_free IS NULL OR (repository_free=true AND kind='complete_node' AND resource_id IS NULL AND workspace_descriptor IS NULL));
ALTER TABLE operations ADD CHECK(state<>'cancelled' OR (kind IN ('open_workspace','complete_node') AND result->>'writer_absent'='true'));
ALTER TABLE operations ADD CHECK((kind='settle_completion' AND completion_operation_id IS NOT NULL AND completion_identity_digest IS NOT NULL AND settlement_purpose IS NOT NULL AND workspace_descriptor IS NOT NULL AND workspace_lease_id IS NOT NULL) OR (kind<>'settle_completion' AND completion_operation_id IS NULL AND completion_identity_digest IS NULL AND settlement_purpose IS NULL));
ALTER TABLE operations ADD CHECK(completion_manifest_digest IS NULL OR (kind='complete_node' AND completion_manifest_digest ~ '^[a-f0-9]{64}$'));
ALTER TABLE operations ADD CHECK(completion_identity_digest IS NULL OR completion_identity_digest ~ '^[a-f0-9]{64}$');
CREATE OR REPLACE FUNCTION preserve_workspace_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.attempt_id,NEW.schema_version,NEW.kind,NEW.request_id,NEW.resource_id,NEW.workspace_descriptor,NEW.workspace_digest,NEW.workspace_lease_id,
     NEW.repository_free,NEW.completion_manifest_digest,NEW.completion_operation_id,NEW.completion_identity_digest,NEW.settlement_purpose)
 IS DISTINCT FROM (OLD.id,OLD.attempt_id,OLD.schema_version,OLD.kind,OLD.request_id,OLD.resource_id,OLD.workspace_descriptor,OLD.workspace_digest,OLD.workspace_lease_id,
     OLD.repository_free,OLD.completion_manifest_digest,OLD.completion_operation_id,OLD.completion_identity_digest,OLD.settlement_purpose)
 OR (OLD.state IN ('succeeded','cancelled') AND NEW IS DISTINCT FROM OLD) THEN
  RAISE EXCEPTION 'Operation identity or terminal result is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION validate_workspace_operation_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l workspace_leases; w task_workspaces; a attempts;
BEGIN
  IF NEW.workspace_descriptor IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO l FROM workspace_leases WHERE id=NEW.workspace_lease_id;
  SELECT * INTO w FROM task_workspaces WHERE id=l.workspace_id;
  SELECT * INTO a FROM attempts WHERE id=NEW.attempt_id;
  IF l.id IS NULL OR w.id IS NULL OR a.id IS NULL
    OR (NEW.workspace_descriptor->>'workspace_id',NEW.workspace_descriptor->>'task_id',NEW.workspace_descriptor->>'project_id',
        NEW.workspace_descriptor->>'resource_id',NEW.workspace_descriptor->>'runner_id',NEW.workspace_descriptor->>'generation',
        NEW.workspace_descriptor->>'lease_id',NEW.workspace_descriptor->>'node_id',NEW.workspace_descriptor->>'node_activation',
        NEW.workspace_descriptor->>'open_operation_id',NEW.resource_id,l.attempt_id,l.dispatch_id,l.node_id,l.node_activation::text)
      IS DISTINCT FROM (w.id,w.task_id,w.project_id,w.resource_id,w.runner_id,w.generation::text,l.id,l.node_id,l.node_activation::text,
        l.open_operation_id,w.resource_id,a.id,a.dispatch_id,a.node_id,a.node_activation::text)
    OR a.runner_id IS DISTINCT FROM w.runner_id OR a.task_id IS DISTINCT FROM w.task_id
    OR (NEW.kind='open_workspace' AND NEW.id IS DISTINCT FROM l.open_operation_id)
    OR (NEW.kind IN ('stop','complete_node') AND NEW.id IS DISTINCT FROM l.settle_operation_id)
    OR (NEW.kind='settle_completion' AND NOT EXISTS (SELECT 1 FROM operations original WHERE original.id=NEW.completion_operation_id AND original.kind='complete_node' AND original.id=l.settle_operation_id AND original.attempt_id=NEW.attempt_id AND original.workspace_descriptor=NEW.workspace_descriptor AND original.workspace_digest=NEW.workspace_digest AND original.workspace_lease_id=NEW.workspace_lease_id AND original.completion_manifest_digest IS NOT NULL))
    OR NEW.kind NOT IN ('open_workspace','stop','complete_node','settle_completion') THEN
    RAISE EXCEPTION 'Workspace operation ownership differs' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_completion_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE op operations; a attempts; value text;
BEGIN
 SELECT * INTO op FROM operations WHERE id=NEW.operation_id;
 SELECT * INTO a FROM attempts WHERE id=NEW.attempt_id;
 IF op.id IS NULL OR op.kind<>'complete_node' OR op.attempt_id<>NEW.attempt_id OR
   op.completion_manifest_digest IS DISTINCT FROM NEW.content_digest OR
   (a.task_id,a.node_id,a.node_activation,a.specification_id,a.plan_id,a.node_execution_source_id)
   IS DISTINCT FROM (NEW.task_id,NEW.node_id,NEW.node_activation,NEW.specification_id,NEW.plan_id,NEW.source_id) OR
   jsonb_typeof(NEW.artifact_ids)<>'array' OR jsonb_array_length(NEW.artifact_ids)>256 THEN
  RAISE EXCEPTION 'Completion manifest ownership differs' USING ERRCODE='23514';
 END IF;
 FOR value IN SELECT jsonb_array_elements_text(NEW.artifact_ids) LOOP
  IF NOT EXISTS(SELECT 1 FROM artifacts WHERE id=value AND task_id=NEW.task_id AND node_id=NEW.node_id AND node_activation=NEW.node_activation) THEN
   RAISE EXCEPTION 'Completion Artifact activation differs' USING ERRCODE='23514';
  END IF;
 END LOOP;
 IF (SELECT count(*)<>count(DISTINCT item) FROM jsonb_array_elements(NEW.artifact_ids) item) THEN
  RAISE EXCEPTION 'Completion Artifact IDs must be unique' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER completion_manifest_ownership AFTER INSERT ON completion_manifests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_completion_manifest();
CREATE FUNCTION require_canonical_completion_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='complete_node' AND EXISTS(SELECT 1 FROM attempts WHERE id=NEW.attempt_id AND node_execution_source_id IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM completion_manifests WHERE operation_id=NEW.id AND attempt_id=NEW.attempt_id AND content_digest=NEW.completion_manifest_digest) THEN
  RAISE EXCEPTION 'Canonical completion requires immutable manifest' USING ERRCODE='23514';
 END IF;
 IF NEW.repository_free IS TRUE AND NOT EXISTS(SELECT 1 FROM attempts WHERE id=NEW.attempt_id AND node_execution_source_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Repository-free completion requires canonical Node' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER canonical_completion_manifest AFTER INSERT ON operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_canonical_completion_manifest();
