ALTER TABLE operations DROP CONSTRAINT operations_state_check;
ALTER TABLE operations ADD CHECK(state IN ('admitted','recovery','succeeded','cancelled'));
ALTER TABLE operations ADD COLUMN cancelled_by_operation_id text REFERENCES operations(id);
ALTER TABLE operations ADD CHECK((state='cancelled')=(cancelled_by_operation_id IS NOT NULL));
ALTER TABLE operations ADD CHECK(state<>'cancelled' OR (kind='open_workspace' AND result->>'writer_absent'='true'));

ALTER TABLE tasks ADD UNIQUE(id,project_id);
ALTER TABLE project_resources ADD UNIQUE(id,project_id);
ALTER TABLE attempts ADD UNIQUE(id,task_id,dispatch_id);
CREATE TABLE task_workspaces (
  id text PRIMARY KEY, task_id text NOT NULL, project_id text NOT NULL, resource_id text NOT NULL,
  runner_id text NOT NULL REFERENCES runners(id), generation bigint NOT NULL DEFAULT 1 CHECK(generation=1),
  resource jsonb NOT NULL, repository_identity text NOT NULL,
  state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','ready','recovery')),
  ever_materialized boolean NOT NULL DEFAULT false,
  storage_id text, provider_metadata jsonb, base_commit text, target_branch text, finalized_commit text,
  created_by_operation_id text NOT NULL REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED,
  materialized_by_operation_id text REFERENCES operations(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id,resource_id), UNIQUE(id,task_id), UNIQUE(id,task_id,resource_id),
  FOREIGN KEY(task_id,project_id) REFERENCES tasks(id,project_id),
  FOREIGN KEY(resource_id,project_id) REFERENCES project_resources(id,project_id),
  CHECK(resource->>'resource_id'=resource_id AND resource->>'repository_identity'=repository_identity),
  CHECK(NOT ever_materialized OR (storage_id IS NOT NULL AND base_commit IS NOT NULL AND target_branch IS NOT NULL AND finalized_commit IS NOT NULL AND materialized_by_operation_id IS NOT NULL)),
  CHECK(base_commit IS NULL OR base_commit ~ '^(?:[a-f0-9]{40}|[a-f0-9]{64})$'),
  CHECK(finalized_commit IS NULL OR finalized_commit ~ '^(?:[a-f0-9]{40}|[a-f0-9]{64})$')
);
CREATE TABLE workspace_leases (
  id text PRIMARY KEY, workspace_id text NOT NULL, task_id text NOT NULL, node_id text NOT NULL,
  node_activation bigint NOT NULL, attempt_id text NOT NULL, dispatch_id text NOT NULL,
  generation bigint NOT NULL CHECK(generation=1),
  open_operation_id text NOT NULL UNIQUE REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED,
  state text NOT NULL DEFAULT 'held' CHECK(state IN ('held','settling','released')),
  target_commit text, settle_operation_id text REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED,
  recovered_by_stop_operation_id text REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED,
  target_observation_lease_id text REFERENCES workspace_leases(id),
  checkpoint jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((recovered_by_stop_operation_id IS NULL)=(target_observation_lease_id IS NULL)),
  CHECK(target_observation_lease_id IS NULL OR target_observation_lease_id<>id),
  UNIQUE(id,attempt_id), FOREIGN KEY(workspace_id,task_id) REFERENCES task_workspaces(id,task_id),
  FOREIGN KEY(node_id,node_activation) REFERENCES node_activations(node_id,activation),
  FOREIGN KEY(node_id,task_id) REFERENCES nodes(id,task_id),
  FOREIGN KEY(attempt_id,task_id,dispatch_id) REFERENCES attempts(id,task_id,dispatch_id)
);
CREATE UNIQUE INDEX one_live_workspace_lease ON workspace_leases(workspace_id) WHERE state<>'released';
CREATE UNIQUE INDEX one_serial_task_lease ON workspace_leases(task_id) WHERE state<>'released';
ALTER TABLE operations ADD COLUMN workspace_descriptor jsonb;
ALTER TABLE operations ADD COLUMN workspace_digest text;
ALTER TABLE operations ADD COLUMN workspace_lease_id text;
ALTER TABLE operations ADD FOREIGN KEY(workspace_lease_id,attempt_id) REFERENCES workspace_leases(id,attempt_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE operations ADD CHECK((workspace_descriptor IS NULL AND workspace_digest IS NULL AND workspace_lease_id IS NULL)
  OR (workspace_descriptor IS NOT NULL AND workspace_digest ~ '^[a-f0-9]{64}$' AND workspace_lease_id IS NOT NULL
      AND workspace_descriptor->>'lease_id'=workspace_lease_id AND workspace_descriptor->>'resource_id'=resource_id));
ALTER TABLE operations ADD CHECK(state<>'cancelled' OR workspace_descriptor IS NOT NULL);

CREATE TABLE legacy_probe_attempts (attempt_id text PRIMARY KEY REFERENCES attempts(id));
INSERT INTO legacy_probe_attempts SELECT a.id FROM attempts a JOIN tasks t ON t.id=a.task_id
  JOIN plan_revisions p ON p.id=COALESCE(a.plan_id,t.plan_id) AND p.task_id=t.id
  WHERE p.content->>'probe'='true' AND a.launch->>'resource_id'=t.resource_id
    AND a.launch->>'task_id'=t.id AND a.launch->>'attempt_id'=a.id AND NOT a.launch ? 'workspace_reservations';
CREATE TRIGGER immutable_probe_provenance BEFORE UPDATE OR DELETE ON legacy_probe_attempts FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();

CREATE FUNCTION preserve_workspace_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.task_id,NEW.project_id,NEW.resource_id,NEW.runner_id,NEW.generation,NEW.repository_identity,NEW.created_by_operation_id)
    IS DISTINCT FROM (OLD.id,OLD.task_id,OLD.project_id,OLD.resource_id,OLD.runner_id,OLD.generation,OLD.repository_identity,OLD.created_by_operation_id)
    OR (OLD.ever_materialized AND (NOT NEW.ever_materialized OR
      (NEW.resource,NEW.storage_id,NEW.provider_metadata,NEW.base_commit,NEW.target_branch,NEW.materialized_by_operation_id)
      IS DISTINCT FROM (OLD.resource,OLD.storage_id,OLD.provider_metadata,OLD.base_commit,OLD.target_branch,OLD.materialized_by_operation_id))) THEN
    RAISE EXCEPTION 'Workspace lineage is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_workspace_lineage BEFORE UPDATE ON task_workspaces FOR EACH ROW EXECUTE FUNCTION preserve_workspace_lineage();
CREATE FUNCTION preserve_workspace_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.attempt_id,NEW.kind,NEW.request_id,NEW.resource_id,NEW.workspace_descriptor,NEW.workspace_digest,NEW.workspace_lease_id)
      IS DISTINCT FROM (OLD.id,OLD.attempt_id,OLD.kind,OLD.request_id,OLD.resource_id,OLD.workspace_descriptor,OLD.workspace_digest,OLD.workspace_lease_id)
    OR (OLD.state IN ('succeeded','cancelled') AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Operation identity or terminal result is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_workspace_operation BEFORE UPDATE ON operations FOR EACH ROW EXECUTE FUNCTION preserve_workspace_operation();
CREATE FUNCTION validate_workspace_operation_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
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
    OR NEW.kind NOT IN ('open_workspace','stop','complete_node') THEN
    RAISE EXCEPTION 'Workspace operation ownership differs' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER workspace_operation_ownership AFTER INSERT OR UPDATE ON operations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_workspace_operation_ownership();
CREATE FUNCTION preserve_workspace_lease() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.workspace_id,NEW.task_id,NEW.node_id,NEW.node_activation,NEW.attempt_id,NEW.dispatch_id,NEW.generation,NEW.open_operation_id)
    IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.task_id,OLD.node_id,OLD.node_activation,OLD.attempt_id,OLD.dispatch_id,OLD.generation,OLD.open_operation_id)
    OR (OLD.state='released' AND NEW IS DISTINCT FROM OLD)
    OR (OLD.target_commit IS NOT NULL AND NEW.target_commit IS DISTINCT FROM OLD.target_commit)
    OR (OLD.target_commit IS NOT NULL AND (NEW.recovered_by_stop_operation_id,NEW.target_observation_lease_id)
      IS DISTINCT FROM (OLD.recovered_by_stop_operation_id,OLD.target_observation_lease_id))
    OR (OLD.settle_operation_id IS NOT NULL AND NEW.settle_operation_id IS DISTINCT FROM OLD.settle_operation_id) THEN
    RAISE EXCEPTION 'Lease ownership is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_workspace_lease BEFORE UPDATE ON workspace_leases FOR EACH ROW EXECUTE FUNCTION preserve_workspace_lease();
