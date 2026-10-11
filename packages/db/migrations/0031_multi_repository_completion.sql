-- One completion owns the complete immutable set of initialized workspace leases.
CREATE TABLE operation_workspaces (
 operation_id text NOT NULL REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED,
 resource_id text NOT NULL REFERENCES project_resources(id),
 workspace_id text NOT NULL REFERENCES task_workspaces(id),
 lease_id text NOT NULL REFERENCES workspace_leases(id),
 workspace_descriptor jsonb NOT NULL,
 workspace_digest text NOT NULL CHECK(workspace_digest ~ '^[a-f0-9]{64}$'),
 integration jsonb,
 PRIMARY KEY(operation_id,resource_id), UNIQUE(operation_id,workspace_id), UNIQUE(operation_id,lease_id),
 CHECK(jsonb_typeof(workspace_descriptor)='object'),
 CHECK(integration IS NULL OR (jsonb_typeof(integration)='object'
  AND integration-ARRAY['expected_task_commit']='{}'::jsonb
  AND (integration->>'expected_task_commit' ~ '^(?:[a-f0-9]{40}|[a-f0-9]{64})$') IS TRUE))
);
CREATE TRIGGER immutable_operation_workspace BEFORE UPDATE OR DELETE ON operation_workspaces
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();

CREATE FUNCTION workspace_reservations_isolated(reservations jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN jsonb_typeof(reservations->'resources')='array' THEN NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(reservations->'resources') r WHERE jsonb_typeof(r->'isolation') IS DISTINCT FROM 'object'
 ) ELSE false END
$$;

CREATE FUNCTION operation_workspace_inputs(operation_identity text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN o.kind='complete_node' THEN COALESCE((
  SELECT jsonb_agg(jsonb_build_object('workspace',w.workspace_descriptor,'workspace_digest',w.workspace_digest)
   || CASE WHEN w.integration IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('integration',w.integration) END ORDER BY w.resource_id COLLATE "C")
  FROM operation_workspaces w WHERE w.operation_id=o.id
 ),'[]'::jsonb) ELSE NULL END FROM operations o WHERE o.id=operation_identity
$$;

CREATE FUNCTION operation_workspace_results(operation_identity text)
 RETURNS TABLE(resource_id text,workspace_id text,lease_id text,workspace_descriptor jsonb,workspace_digest text,integration jsonb,result jsonb)
 LANGUAGE sql STABLE AS $$
 SELECT o.resource_id,o.workspace_descriptor->>'workspace_id',o.workspace_lease_id,o.workspace_descriptor,o.workspace_digest,o.integration,o.result
 FROM operations o WHERE o.id=operation_identity AND o.kind IN ('open_workspace','stop') AND o.workspace_descriptor IS NOT NULL
 UNION ALL
 SELECT w.resource_id,w.workspace_id,w.lease_id,w.workspace_descriptor,w.workspace_digest,w.integration,r.value
 FROM operations o JOIN operation_workspaces w ON w.operation_id=CASE WHEN o.kind='settle_completion' THEN o.completion_operation_id ELSE o.id END
 LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.result->'workspace_results')='array' THEN o.result->'workspace_results' ELSE '[]'::jsonb END) r
  ON r.value->>'resource_id'=w.resource_id AND r.value->>'workspace_id'=w.workspace_id
 WHERE o.id=operation_identity AND o.kind IN ('complete_node','settle_completion')
$$;

-- Retire completion aliases without changing the singular open/Stop contract.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='operations'::regclass AND contype='c' LOOP
  IF c.definition LIKE '%repository_free%' OR c.definition LIKE '%integration%'
   OR c.definition LIKE '%kind%' AND c.definition LIKE '%resource_id%'
   OR c.definition LIKE '%completion_operation_id%' AND c.definition LIKE '%workspace_descriptor%'
   OR c.definition LIKE '%state%' AND c.definition LIKE '%workspace_descriptor%'
  THEN EXECUTE format('ALTER TABLE operations DROP CONSTRAINT %I',c.conname);END IF;
 END LOOP;
END $$;
ALTER TABLE operations ADD CONSTRAINT operation_completion_collection_shape CHECK(
 repository_free IS NULL AND integration IS NULL AND
 (kind NOT IN ('complete_node','settle_completion') OR
  resource_id IS NULL AND workspace_descriptor IS NULL AND workspace_digest IS NULL AND workspace_lease_id IS NULL));
ALTER TABLE operations ADD CHECK(kind IN ('stop','complete_node','settle_completion') OR resource_id IS NOT NULL);
ALTER TABLE operations ADD CHECK((kind='settle_completion' AND completion_operation_id IS NOT NULL
 AND completion_identity_digest IS NOT NULL AND settlement_purpose IS NOT NULL)
 OR (kind<>'settle_completion' AND completion_operation_id IS NULL AND completion_identity_digest IS NULL AND settlement_purpose IS NULL));

CREATE FUNCTION guard_operation_workspace_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent operations;w task_workspaces;
BEGIN
 SELECT * INTO parent FROM operations WHERE id=NEW.operation_id;
 IF parent.id IS NOT NULL AND (parent.kind<>'complete_node' OR parent.state<>'admitted'
  OR (SELECT xmin::text FROM operations WHERE id=parent.id)<>pg_current_xact_id()::text)
 THEN RAISE EXCEPTION 'completion membership must be admitted with its immutable parent' USING ERRCODE='23514';END IF;
 SELECT * INTO w FROM task_workspaces WHERE id=NEW.workspace_id;
 PERFORM 1 FROM tasks WHERE id=w.task_id FOR UPDATE;
 IF NEW.integration IS NOT NULL AND NEW.integration->>'expected_task_commit' IS DISTINCT FROM w.finalized_commit
 THEN RAISE EXCEPTION 'integration requires the exact current Task revision' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER operation_workspace_admission BEFORE INSERT ON operation_workspaces FOR EACH ROW EXECUTE FUNCTION guard_operation_workspace_insert();

CREATE OR REPLACE FUNCTION validate_parallel_attempt_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE isolated boolean;
BEGIN
 IF NEW.kind<>'node' OR NEW.node_execution_source_id IS NULL OR (NEW.state<>'QUEUED' AND NEW.process_released) THEN RETURN NEW;END IF;
 PERFORM 1 FROM tasks WHERE id=NEW.task_id FOR UPDATE;
 isolated:=workspace_reservations_isolated(NEW.launch->'workspace_reservations');
 IF EXISTS(SELECT 1 FROM attempts a WHERE a.task_id=NEW.task_id AND a.kind='node' AND a.id<>NEW.id
  AND (a.state='QUEUED' OR NOT a.process_released OR EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN ('succeeded','cancelled')))
  AND (NOT isolated OR NOT workspace_reservations_isolated(a.launch->'workspace_reservations')))
 OR EXISTS(SELECT 1 FROM workspace_leases l WHERE l.task_id=NEW.task_id AND l.attempt_id<>NEW.id AND l.state<>'released'
  AND (NOT isolated OR l.allocation_id IS NULL))
 THEN RAISE EXCEPTION 'direct Node admission requires exclusive Task ownership' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION validate_parallel_lease_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state='released' THEN RETURN NEW;END IF;
 PERFORM 1 FROM tasks WHERE id=NEW.task_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM task_workspaces w JOIN workspace_leases l ON l.workspace_id=w.id
  WHERE w.id=NEW.workspace_id AND NOT w.ever_materialized AND l.id<>NEW.id AND l.state<>'released')
 THEN RAISE EXCEPTION 'first workspace initialization must settle before another allocation opens' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM workspace_leases l WHERE l.task_id=NEW.task_id AND l.attempt_id<>NEW.attempt_id AND l.state<>'released'
  AND (NEW.allocation_id IS NULL OR l.allocation_id IS NULL))
 OR EXISTS(SELECT 1 FROM attempts a WHERE a.task_id=NEW.task_id AND a.id<>NEW.attempt_id AND a.kind='node'
  AND (a.state='QUEUED' OR NOT a.process_released OR EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN ('succeeded','cancelled')))
  AND (NEW.allocation_id IS NULL OR NOT workspace_reservations_isolated(a.launch->'workspace_reservations')))
 THEN RAISE EXCEPTION 'direct workspace lease requires exclusive Task ownership' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

-- Only new source/dispatch/open admission is barred. Existing settlement updates
-- must remain runnable or a sibling Stop can deadlock completion recovery.
CREATE FUNCTION guard_task_completion_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid text;
BEGIN
 IF TG_TABLE_NAME='node_execution_outbox' THEN tid:=NEW.task_id;
 ELSIF TG_TABLE_NAME='attempts' THEN
  IF NEW.kind<>'node' OR NEW.node_execution_source_id IS NULL THEN RETURN NEW;END IF;
  IF TG_OP='UPDATE' AND NOT (OLD.state='QUEUED' AND NEW.state='RUNNING') THEN RETURN NEW;END IF;
  tid:=NEW.task_id;
 ELSE
  IF NEW.kind<>'open_workspace' THEN RETURN NEW;END IF;
  SELECT task_id INTO tid FROM attempts WHERE id=NEW.attempt_id;
 END IF;
 PERFORM 1 FROM tasks WHERE id=tid FOR UPDATE;
 IF EXISTS(SELECT 1 FROM operations o JOIN attempts a ON a.id=o.attempt_id
  WHERE a.task_id=tid AND o.kind='complete_node' AND o.state NOT IN ('succeeded','cancelled'))
 THEN RAISE EXCEPTION 'Task completion boundary retains all repository ownership' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER completion_source_boundary BEFORE INSERT ON node_execution_outbox FOR EACH ROW EXECUTE FUNCTION guard_task_completion_boundary();
CREATE TRIGGER completion_dispatch_boundary BEFORE INSERT OR UPDATE ON attempts FOR EACH ROW EXECUTE FUNCTION guard_task_completion_boundary();
CREATE TRIGGER completion_open_boundary BEFORE INSERT ON operations FOR EACH ROW EXECUTE FUNCTION guard_task_completion_boundary();

CREATE FUNCTION validate_completion_workspace_records() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent operations;a attempts;item operation_workspaces;l workspace_leases;w task_workspaces;opened operations;
 entry jsonb;metadata jsonb;capture jsonb;proof jsonb;field text;outcome text;members integer;conflicts integer:=0;ids jsonb;
BEGIN
 IF TG_TABLE_NAME='operation_workspaces' THEN
  SELECT * INTO parent FROM operations WHERE id=NEW.operation_id;
  IF parent.kind IS DISTINCT FROM 'complete_node' THEN RAISE EXCEPTION 'workspace membership requires a completion parent' USING ERRCODE='23514';END IF;
 ELSE SELECT * INTO parent FROM operations WHERE id=NEW.id;END IF;
 IF parent.kind<>'complete_node' THEN RETURN NULL;END IF;
 SELECT * INTO a FROM attempts WHERE id=parent.attempt_id;
 SELECT count(*),COALESCE(jsonb_agg(resource_id ORDER BY resource_id COLLATE "C"),'[]'::jsonb) INTO members,ids
  FROM operation_workspaces WHERE operation_id=parent.id;
 -- A conflicting parent preserves every capture, including clean siblings.
 -- Bind retries to the latest earlier parent, never the parent settling now.
 IF EXISTS(WITH conflict AS (
   SELECT prior.id FROM operations prior JOIN attempts origin ON origin.id=prior.attempt_id
   WHERE origin.task_id=a.task_id AND origin.node_id=a.node_id AND origin.node_activation=a.node_activation
    AND prior.kind='complete_node' AND prior.state='succeeded' AND prior.result->>'completion_outcome'='conflict'
    AND (prior.created_at,prior.id)<(parent.created_at,parent.id)
   ORDER BY prior.created_at DESC,prior.id DESC LIMIT 1)
  SELECT 1 FROM conflict c JOIN operation_workspaces captured ON captured.operation_id=c.id
  WHERE NOT EXISTS(SELECT 1 FROM operation_workspaces current WHERE current.operation_id=parent.id
    AND current.resource_id=captured.resource_id AND current.workspace_id=captured.workspace_id))
 THEN RAISE EXCEPTION 'completion retry must include every captured conflicting workspace' USING ERRCODE='23514';END IF;
 IF members>64 OR EXISTS(SELECT 1 FROM workspace_leases live WHERE live.attempt_id=a.id
  AND (live.state<>'released' OR live.settle_operation_id=parent.id)
  AND NOT EXISTS(SELECT 1 FROM operation_workspaces m WHERE m.operation_id=parent.id AND m.lease_id=live.id))
 THEN RAISE EXCEPTION 'completion must include every initialized held workspace exactly once' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM operations pending WHERE pending.attempt_id=a.id AND pending.kind='open_workspace' AND pending.state NOT IN ('succeeded','cancelled'))
 THEN RAISE EXCEPTION 'completion requires all admitted opens to settle first' USING ERRCODE='23514';END IF;
 IF parent.state='succeeded' THEN
  outcome:=parent.result->>'completion_outcome';
  IF parent.result->>'writer_absent' IS DISTINCT FROM 'true' OR (outcome IN ('finalized','conflict')) IS NOT TRUE
   OR jsonb_typeof(parent.result->'workspace_results') IS DISTINCT FROM 'array'
   OR parent.result ?| ARRAY['workspace_id','workspace_metadata','git_commit','git_tree','integration','path','instruction_files']
  THEN RAISE EXCEPTION 'completion requires one aggregate terminal result' USING ERRCODE='23514';END IF;
  IF (SELECT COALESCE(jsonb_agg(value->'resource_id' ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(parent.result->'workspace_results') WITH ORDINALITY r(value,ord)) IS DISTINCT FROM ids
  THEN RAISE EXCEPTION 'completion result must cover the exact ordered repository membership' USING ERRCODE='23514';END IF;
 END IF;
 FOR item IN SELECT * FROM operation_workspaces WHERE operation_id=parent.id ORDER BY resource_id COLLATE "C" LOOP
  SELECT * INTO l FROM workspace_leases WHERE id=item.lease_id;
  SELECT * INTO w FROM task_workspaces WHERE id=item.workspace_id;
  SELECT * INTO opened FROM operations WHERE id=l.open_operation_id;
  IF l.id IS NULL OR w.id IS NULL OR l.attempt_id IS DISTINCT FROM a.id OR l.dispatch_id IS DISTINCT FROM a.dispatch_id
   OR l.workspace_id IS DISTINCT FROM w.id OR w.resource_id IS DISTINCT FROM item.resource_id OR w.task_id IS DISTINCT FROM a.task_id
   OR w.runner_id IS DISTINCT FROM a.runner_id OR l.node_id IS DISTINCT FROM a.node_id OR l.node_activation IS DISTINCT FROM a.node_activation
   OR l.settle_operation_id IS DISTINCT FROM parent.id OR opened.kind IS DISTINCT FROM 'open_workspace' OR opened.state IS DISTINCT FROM 'succeeded'
   OR opened.workspace_lease_id IS DISTINCT FROM l.id OR opened.workspace_descriptor IS DISTINCT FROM item.workspace_descriptor
   OR opened.workspace_digest IS DISTINCT FROM item.workspace_digest
   OR item.workspace_digest IS DISTINCT FROM encode(sha256(convert_to(review_canonical_json(item.workspace_descriptor),'UTF8')),'hex')
   OR (item.integration IS NOT NULL) IS DISTINCT FROM (l.allocation_id IS NOT NULL)
  THEN RAISE EXCEPTION 'completion member differs from its exact initialized lease and descriptor' USING ERRCODE='23514';END IF;
  IF parent.state<>'succeeded' THEN CONTINUE;END IF;
  SELECT value INTO entry FROM jsonb_array_elements(parent.result->'workspace_results') WHERE value->>'resource_id'=item.resource_id;
  metadata:=entry->'workspace_metadata';capture:=entry->'capture';proof:=entry->'integration';
  IF entry->>'workspace_id' IS DISTINCT FROM w.id OR jsonb_typeof(metadata) IS DISTINCT FROM 'object'
   OR entry-ARRAY['resource_id','workspace_id','workspace_metadata','capture','git_commit','git_tree','integration']<>'{}'::jsonb
   OR jsonb_typeof(capture) IS DISTINCT FROM 'object' OR capture-ARRAY['start_commit','node_commit','node_tree']<>'{}'::jsonb
   OR (SELECT count(*) FROM jsonb_each_text(capture) v WHERE v.value ~ '^(?:[a-f0-9]{40}|[a-f0-9]{64})$')<>3
   OR capture->>'start_commit' IS DISTINCT FROM COALESCE(l.start_commit,opened.result->'workspace_metadata'->>'finalized_commit')
   OR metadata ? 'checkpoint'
  THEN RAISE EXCEPTION 'completion item requires its exact captured repository result' USING ERRCODE='23514';END IF;
  IF metadata-'finalized_commit' IS DISTINCT FROM (opened.result->'workspace_metadata')-'finalized_commit'
  THEN RAISE EXCEPTION 'completion result changed fixed workspace metadata' USING ERRCODE='23514';END IF;
  IF proof IS NOT NULL THEN
   IF item.integration IS NULL OR jsonb_typeof(proof) IS DISTINCT FROM 'object'
    OR proof-ARRAY['outcome','start_commit','node_commit','node_tree','expected_task_commit','task_commit','task_tree']<>'{}'::jsonb
    OR proof->>'outcome' IS DISTINCT FROM (CASE WHEN outcome='finalized' THEN 'integrated' ELSE 'conflict' END)
    OR (SELECT count(*) FROM jsonb_each_text(proof) v WHERE v.key<>'outcome' AND v.value ~ '^(?:[a-f0-9]{40}|[a-f0-9]{64})$')<>6
    OR proof->>'expected_task_commit' IS DISTINCT FROM item.integration->>'expected_task_commit'
   THEN RAISE EXCEPTION 'completion integration differs from its admitted resource' USING ERRCODE='23514';END IF;
   FOREACH field IN ARRAY ARRAY['start_commit','node_commit','node_tree'] LOOP
    IF proof->field IS DISTINCT FROM capture->field THEN RAISE EXCEPTION 'integration differs from captured Node result' USING ERRCODE='23514';END IF;
   END LOOP;
  END IF;
  IF outcome='finalized' THEN
   IF (entry->>'git_commit' ~ '^(?:[a-f0-9]{40}|[a-f0-9]{64})$') IS NOT TRUE
    OR (entry->>'git_tree' ~ '^(?:[a-f0-9]{40}|[a-f0-9]{64})$') IS NOT TRUE
    OR metadata->'finalized_commit' IS DISTINCT FROM entry->'git_commit' OR w.finalized_commit IS DISTINCT FROM entry->>'git_commit'
    OR (l.allocation_id IS NOT NULL AND (proof IS NULL OR proof->'task_commit' IS DISTINCT FROM entry->'git_commit' OR proof->'task_tree' IS DISTINCT FROM entry->'git_tree'))
    OR (l.allocation_id IS NULL AND (capture->'node_commit' IS DISTINCT FROM entry->'git_commit' OR capture->'node_tree' IS DISTINCT FROM entry->'git_tree'))
   THEN RAISE EXCEPTION 'finalized completion requires every exact canonical repository result' USING ERRCODE='23514';END IF;
  ELSE
   IF entry ?| ARRAY['git_commit','git_tree'] OR metadata->'finalized_commit' IS DISTINCT FROM opened.result->'workspace_metadata'->'finalized_commit'
    OR w.finalized_commit IS DISTINCT FROM COALESCE(item.integration->>'expected_task_commit',opened.result->'workspace_metadata'->>'finalized_commit')
    OR proof IS NOT NULL AND proof->'task_commit' IS DISTINCT FROM proof->'expected_task_commit'
   THEN RAISE EXCEPTION 'conflicted completion cannot publish any repository result' USING ERRCODE='23514';END IF;
   IF proof IS NOT NULL THEN conflicts:=conflicts+1;END IF;
  END IF;
  IF l.state<>'released' THEN RAISE EXCEPTION 'terminal completion must release every member lease atomically' USING ERRCODE='23514';END IF;
 END LOOP;
 IF parent.state='succeeded' AND (NOT a.process_absent OR NOT a.process_released OR a.mutation_allowed)
 THEN RAISE EXCEPTION 'terminal completion requires aggregate Attempt release' USING ERRCODE='23514';END IF;
 IF parent.state='succeeded' AND outcome='conflict' AND (conflicts=0 OR EXISTS(SELECT 1 FROM node_completions WHERE operation_id=parent.id))
 THEN RAISE EXCEPTION 'conflict needs a conflicting member and cannot grant Node completion' USING ERRCODE='23514';END IF;
 IF parent.state='succeeded' AND outcome='finalized' AND a.node_execution_source_id IS NOT NULL
  AND EXISTS(SELECT 1 FROM tasks WHERE id=a.task_id AND state<>'CANCELLED')
  AND NOT EXISTS(SELECT 1 FROM node_completions WHERE operation_id=parent.id AND attempt_id=a.id AND node_id=a.node_id AND activation=a.node_activation)
 THEN RAISE EXCEPTION 'finalized completion must commit one exact Node completion atomically' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER completion_workspace_parent AFTER INSERT OR UPDATE ON operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_completion_workspace_records();
CREATE CONSTRAINT TRIGGER completion_workspace_member AFTER INSERT ON operation_workspaces DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_completion_workspace_records();

CREATE FUNCTION completion_operation_identity(operation_identity text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('schema_version',o.schema_version,'operation_id',o.id,'attempt_id',o.attempt_id,
  'dispatch_id',a.dispatch_id,'request_id',o.request_id,'kind',o.kind,'workspaces',operation_workspace_inputs(o.id))
  || CASE WHEN o.completion_manifest_digest IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('completion_manifest_digest',o.completion_manifest_digest) END
 FROM operations o JOIN attempts a ON a.id=o.attempt_id WHERE o.id=operation_identity AND o.kind='complete_node'
$$;

CREATE FUNCTION validate_aggregate_completion_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE settlement operations;original operations;a attempts;m operation_workspaces;member jsonb;before_metadata jsonb;metadata jsonb;pair jsonb;ids jsonb;
BEGIN
 SELECT * INTO settlement FROM operations WHERE id=NEW.id;
 IF settlement.kind<>'settle_completion' THEN RETURN NULL;END IF;
 SELECT * INTO original FROM operations WHERE id=settlement.completion_operation_id;
 SELECT * INTO a FROM attempts WHERE id=settlement.attempt_id;
 IF original.kind IS DISTINCT FROM 'complete_node' OR original.attempt_id IS DISTINCT FROM settlement.attempt_id
  OR settlement.completion_identity_digest IS DISTINCT FROM encode(sha256(convert_to(review_canonical_json(completion_operation_identity(original.id)),'UTF8')),'hex')
 THEN RAISE EXCEPTION 'completion settlement must bind its exact original parent identity' USING ERRCODE='23514';END IF;
 IF settlement.state<>'succeeded' THEN RETURN NULL;END IF;
 pair:=settlement.completion_settlement;
 IF pair->>'completion_operation_id' IS DISTINCT FROM original.id
  OR pair->'completion_result'->>'operation_id' IS DISTINCT FROM original.id
  OR pair->'completion_result'->>'attempt_id' IS DISTINCT FROM original.attempt_id
  OR pair->'completion_result'->'result' IS DISTINCT FROM original.result
  OR settlement.result->>'writer_absent' IS DISTINCT FROM 'true'
  OR NOT a.process_absent OR NOT a.process_released OR a.mutation_allowed
 THEN RAISE EXCEPTION 'completion settlement requires an atomic exact parent result pair' USING ERRCODE='23514';END IF;
 IF pair->>'disposition'='already_finalized' THEN
  IF original.state<>'succeeded' OR pair->'completion_result'->>'success' IS DISTINCT FROM 'true'
   OR (original.result->>'completion_outcome' IN ('finalized','conflict')) IS NOT TRUE
   OR pair->'completion_result' ? 'cancelled_by_operation_id'
  THEN RAISE EXCEPTION 'finalized settlement requires the exact terminal completion' USING ERRCODE='23514';END IF;
 ELSIF pair->>'disposition'='cancelled' THEN
  IF original.state<>'cancelled' OR original.cancelled_by_operation_id IS DISTINCT FROM settlement.id
   OR pair->'completion_result'->>'success' IS DISTINCT FROM 'false'
   OR pair->'completion_result'->>'cancelled_by_operation_id' IS DISTINCT FROM settlement.id
   OR original.result IS DISTINCT FROM '{"writer_absent":true}'::jsonb
   OR jsonb_typeof(settlement.result->'workspace_results') IS DISTINCT FROM 'array'
   OR settlement.result ?| ARRAY['workspace_id','workspace_metadata','git_commit','git_tree','integration']
  THEN RAISE EXCEPTION 'cancelled completion requires its exact absence tombstone and checkpoints' USING ERRCODE='23514';END IF;
  SELECT COALESCE(jsonb_agg(resource_id ORDER BY resource_id COLLATE "C"),'[]'::jsonb) INTO ids FROM operation_workspaces WHERE operation_id=original.id;
  IF (SELECT COALESCE(jsonb_agg(value->'resource_id' ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(settlement.result->'workspace_results') WITH ORDINALITY r(value,ord)) IS DISTINCT FROM ids
  THEN RAISE EXCEPTION 'completion cancellation must checkpoint every exact parent member' USING ERRCODE='23514';END IF;
  FOR m IN SELECT * FROM operation_workspaces WHERE operation_id=original.id LOOP
   SELECT value INTO member FROM jsonb_array_elements(settlement.result->'workspace_results') WHERE value->>'resource_id'=m.resource_id;
   SELECT result->'workspace_metadata' INTO before_metadata FROM operations WHERE id=m.workspace_descriptor->>'open_operation_id';
   metadata:=member->'workspace_metadata';
   IF member->>'workspace_id' IS DISTINCT FROM m.workspace_id OR member ?| ARRAY['git_commit','git_tree','integration']
    OR metadata-'checkpoint' IS DISTINCT FROM before_metadata-'checkpoint'
    OR metadata->'checkpoint'->>'operation_id' IS DISTINCT FROM settlement.id
    OR metadata->'checkpoint'->>'completion_operation_id' IS DISTINCT FROM original.id
    OR metadata->'checkpoint'->>'completion_identity_digest' IS DISTINCT FROM settlement.completion_identity_digest
    OR NOT EXISTS(SELECT 1 FROM workspace_leases l WHERE l.id=m.lease_id AND l.state='released'
      AND l.settle_operation_id=original.id AND l.checkpoint=metadata->'checkpoint')
   THEN RAISE EXCEPTION 'completion cancellation checkpoint differs from exact initialized member' USING ERRCODE='23514';END IF;
  END LOOP;
 ELSE RAISE EXCEPTION 'completion settlement disposition is missing' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM workspace_leases WHERE attempt_id=a.id AND state<>'released')
  OR EXISTS(SELECT 1 FROM operations WHERE attempt_id=a.id AND state NOT IN ('succeeded','cancelled'))
 THEN RAISE EXCEPTION 'completion settlement must release the full Attempt ownership' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER aggregate_completion_settlement AFTER INSERT OR UPDATE ON operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_aggregate_completion_settlement();

CREATE FUNCTION validate_attempt_workspace_release() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a attempts;
BEGIN
 SELECT * INTO a FROM attempts WHERE id=NEW.id;
 IF a.node_execution_source_id IS NOT NULL AND a.process_released AND (
  NOT a.process_absent OR EXISTS(SELECT 1 FROM workspace_leases WHERE attempt_id=a.id AND state<>'released')
  OR EXISTS(SELECT 1 FROM operations WHERE attempt_id=a.id AND state NOT IN ('succeeded','cancelled')))
 THEN RAISE EXCEPTION 'Attempt release requires every workspace and operation to settle' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER attempt_workspace_release AFTER UPDATE ON attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_attempt_workspace_release();

CREATE OR REPLACE FUNCTION validate_parallel_completion_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE effect operations;
BEGIN
 SELECT * INTO effect FROM operations WHERE id=NEW.operation_id;
 IF effect.kind IS DISTINCT FROM 'complete_node' OR effect.state IS DISTINCT FROM 'succeeded'
  OR effect.result->>'completion_outcome' IS DISTINCT FROM 'finalized' OR effect.attempt_id IS DISTINCT FROM NEW.attempt_id
  OR NEW.result->'workspace_results' IS DISTINCT FROM effect.result->'workspace_results'
  OR NEW.result->'completion_outcome' IS DISTINCT FROM effect.result->'completion_outcome'
  OR EXISTS(SELECT 1 FROM attempts a WHERE a.id=effect.attempt_id AND a.node_execution_source_id IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM completion_manifests m WHERE m.operation_id=effect.id AND m.node_id=NEW.node_id
    AND m.node_activation=NEW.activation AND m.attempt_id=NEW.attempt_id AND m.content_digest=effect.completion_manifest_digest)
 THEN RAISE EXCEPTION 'Node completion requires its exact finalized aggregate result' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION validate_task_workspace_completion_pointer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT OLD.ever_materialized OR NEW.finalized_commit IS NOT DISTINCT FROM OLD.finalized_commit THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM operation_workspaces m JOIN operations o ON o.id=m.operation_id
  JOIN workspace_leases l ON l.id=m.lease_id JOIN operations opened ON opened.id=l.open_operation_id
  CROSS JOIN LATERAL operation_workspace_results(o.id) r
  WHERE m.workspace_id=NEW.id AND r.workspace_id=NEW.id AND r.lease_id=l.id AND o.state='succeeded'
   AND o.xmin::text=pg_current_xact_id()::text AND o.result->>'completion_outcome'='finalized'
   AND r.result->>'git_commit'=NEW.finalized_commit
   AND COALESCE(m.integration->>'expected_task_commit',opened.result->'workspace_metadata'->>'finalized_commit')=OLD.finalized_commit
   AND l.state='released')
 THEN RAISE EXCEPTION 'Task repository pointer requires its exact atomic completion result' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER workspace_completion_pointer AFTER UPDATE ON task_workspaces DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_task_workspace_completion_pointer();

CREATE TABLE node_rework_request_stops (
 request_id text NOT NULL REFERENCES node_rework_requests(id) DEFERRABLE INITIALLY DEFERRED,
 operation_id text NOT NULL UNIQUE REFERENCES operations(id),
 workspace_id text REFERENCES task_workspaces(id), lease_id text REFERENCES workspace_leases(id),
 PRIMARY KEY(request_id,operation_id), UNIQUE(request_id,workspace_id), UNIQUE(request_id,lease_id),
 CHECK((workspace_id IS NULL)=(lease_id IS NULL))
);
CREATE UNIQUE INDEX one_process_only_rework_stop ON node_rework_request_stops(request_id) WHERE lease_id IS NULL;
CREATE TRIGGER immutable_rework_stop BEFORE UPDATE OR DELETE ON node_rework_request_stops FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();

CREATE OR REPLACE FUNCTION replan_workspace_input_rows(tid text) RETURNS TABLE(workspace_id text,from_lease_id text,input jsonb) LANGUAGE sql STABLE AS $$
 WITH canonical AS (
  SELECT DISTINCT ON(w.id) w.id workspace_id,w.task_id,w.resource_id,w.runner_id,l.id lease_id,l.node_id,l.node_activation,l.attempt_id,a.plan_id,
   o.id operation_id,o.completion_manifest_digest,r.result,false checkpoint
  FROM task_workspaces w JOIN workspace_leases l ON l.workspace_id=w.id JOIN attempts a ON a.id=l.attempt_id
  JOIN operations o ON o.id=l.settle_operation_id AND o.attempt_id=l.attempt_id AND o.kind='complete_node' AND o.state='succeeded'
  CROSS JOIN LATERAL operation_workspace_results(o.id) r
  JOIN completion_manifests m ON m.operation_id=o.id AND m.content_digest=o.completion_manifest_digest
  WHERE w.task_id=tid AND w.ever_materialized AND l.state='released' AND o.result->>'writer_absent'='true'
   AND o.result->>'completion_outcome'='finalized' AND r.resource_id=w.resource_id AND r.workspace_id=w.id AND r.lease_id=l.id
   AND r.result->>'git_commit'=w.finalized_commit AND r.result->'workspace_metadata'->>'finalized_commit'=w.finalized_commit
   AND r.result->>'git_tree' IS NOT NULL
  ORDER BY w.id,o.created_at DESC,o.id DESC
 ), checkpoints AS (
  SELECT w.id workspace_id,w.task_id,w.resource_id,w.runner_id,l.id lease_id,l.node_id,l.node_activation,l.attempt_id,a.plan_id,
   o.id operation_id,o.completion_manifest_digest,r.result,true checkpoint
  FROM task_workspaces w JOIN workspace_leases l ON l.workspace_id=w.id JOIN attempts a ON a.id=l.attempt_id
  JOIN operations o ON o.id=l.checkpoint->>'operation_id' AND o.attempt_id=l.attempt_id AND o.state='succeeded'
  CROSS JOIN LATERAL operation_workspace_results(o.id) r
  WHERE w.task_id=tid AND w.ever_materialized AND l.state='released' AND l.checkpoint IS NOT NULL
   AND r.resource_id=w.resource_id AND r.workspace_id=w.id AND r.lease_id=l.id
   AND NOT EXISTS(SELECT 1 FROM node_rework_request_stops member JOIN node_rework_requests request ON request.id=member.request_id
    WHERE member.operation_id=o.id AND member.lease_id=l.id AND request.status='applied')
   AND NOT EXISTS(SELECT 1 FROM workspace_leases later WHERE later.workspace_id=l.workspace_id AND later.allocation_id IS NOT DISTINCT FROM l.allocation_id AND (later.created_at,later.id)>(l.created_at,l.id))
 ), inputs AS (SELECT * FROM canonical UNION ALL SELECT * FROM checkpoints)
 SELECT i.workspace_id,i.lease_id,jsonb_build_object('workspace_id',i.workspace_id,'task_id',i.task_id,'resource_id',i.resource_id,'runner_id',i.runner_id,
  'from_plan_id',i.plan_id,'from_node_id',i.node_id,'from_node_activation',i.node_activation,'from_attempt_id',i.attempt_id,'from_lease_id',i.lease_id,
  'settle_operation_id',i.operation_id,'kind',CASE WHEN i.checkpoint THEN 'checkpoint' ELSE 'completed' END,'metadata',i.result->'workspace_metadata') ||
  CASE WHEN i.checkpoint THEN '{}'::jsonb ELSE jsonb_build_object('completion_operation_id',i.operation_id,'completion_manifest_digest',i.completion_manifest_digest,'finalized_tree',i.result->'git_tree') END
 FROM inputs i ORDER BY i.workspace_id,i.lease_id
$$;
ALTER TABLE node_rework_requests DROP COLUMN stop_operation_id;
CREATE UNIQUE INDEX one_replan_checkpoint_target_resource ON replan_workspace_transfers(publication_id,target_node_id,target_node_activation,workspace_id)
 WHERE descriptor->>'kind'='checkpoint';

CREATE FUNCTION guard_rework_stop_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM node_rework_requests WHERE id=NEW.request_id AND xmin::text<>pg_current_xact_id()::text)
 THEN RAISE EXCEPTION 'Rework Stop membership must be admitted with its request' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rework_stop_admission BEFORE INSERT ON node_rework_request_stops FOR EACH ROW EXECUTE FUNCTION guard_rework_stop_membership();


CREATE OR REPLACE FUNCTION validate_parallel_workspace_records() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lease workspace_leases;owner_attempt attempts;work task_workspaces;metadata jsonb;integrated jsonb;
BEGIN
 IF TG_TABLE_NAME='workspace_leases' THEN
  lease:=NEW;SELECT * INTO owner_attempt FROM attempts WHERE id=lease.attempt_id;
  IF lease.allocation_id IS DISTINCT FROM (SELECT r->'isolation'->>'allocation_id' FROM jsonb_array_elements(owner_attempt.launch->'workspace_reservations'->'resources') r JOIN task_workspaces w ON w.resource_id=r->>'resource_id' WHERE w.id=lease.workspace_id)
  THEN RAISE EXCEPTION 'lease allocation differs from immutable Attempt placement' USING ERRCODE='23514';END IF;
  IF lease.start_commit IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operations o WHERE o.workspace_lease_id=lease.id AND o.state='succeeded'
   AND o.result->'workspace_metadata'->'isolation'=jsonb_build_object('allocation_id',lease.allocation_id,'start_commit',lease.start_commit))
  THEN RAISE EXCEPTION 'allocation start requires an exact successful initialization result' USING ERRCODE='23514';END IF;
  IF lease.allocation_id IS NOT NULL AND lease.start_commit IS NOT NULL AND EXISTS(SELECT 1 FROM workspace_leases other
   WHERE other.workspace_id=lease.workspace_id AND other.allocation_id=lease.allocation_id AND other.id<>lease.id
    AND other.start_commit IS NOT NULL AND other.start_commit<>lease.start_commit)
  THEN RAISE EXCEPTION 'successive leases must preserve the allocation start revision' USING ERRCODE='23514';END IF;
  RETURN NULL;
 END IF;
 IF NEW.workspace_descriptor IS NULL THEN
  IF NEW.integration IS NOT NULL OR NEW.result ? 'integration' THEN RAISE EXCEPTION 'integration requires an isolated workspace operation' USING ERRCODE='23514';END IF;
  RETURN NULL;
 END IF;
 SELECT * INTO lease FROM workspace_leases WHERE id=NEW.workspace_lease_id;
 SELECT * INTO work FROM task_workspaces WHERE id=lease.workspace_id;
 IF NEW.workspace_descriptor->'isolation' IS DISTINCT FROM (CASE WHEN lease.allocation_id IS NULL THEN NULL ELSE jsonb_build_object('allocation_id',lease.allocation_id) END)
 THEN RAISE EXCEPTION 'operation allocation differs from its exact lease' USING ERRCODE='23514';END IF;
 IF NEW.state<>'succeeded' THEN RETURN NULL;END IF;
 metadata:=NEW.result->'workspace_metadata';
 IF metadata IS NOT NULL AND metadata->'isolation' IS DISTINCT FROM (CASE WHEN lease.allocation_id IS NULL THEN NULL ELSE jsonb_build_object('allocation_id',lease.allocation_id,'start_commit',lease.start_commit) END)
 THEN RAISE EXCEPTION 'workspace result changed its allocation start revision' USING ERRCODE='23514';END IF;
 IF NEW.result ? 'integration' THEN RAISE EXCEPTION 'singular workspace operations cannot integrate a completion' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION validate_parallel_workspace_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE work task_workspaces;source jsonb;source_kind text;effect operations;prior workspace_leases;owner_attempt attempts;field text;result_item record;
BEGIN
 IF NEW.kind<>'open_workspace' OR NEW.workspace_descriptor IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO work FROM task_workspaces WHERE id=NEW.workspace_descriptor->>'workspace_id';
 IF NEW.workspace_descriptor ? 'isolation' AND NEW.workspace_descriptor ? 'basis' THEN
  IF NOT NEW.workspace_descriptor ? 'canonical_source' OR
   NEW.workspace_descriptor->'basis'->>'finalized_commit' IS DISTINCT FROM work.finalized_commit
  THEN RAISE EXCEPTION 'isolated open requires exact admitted canonical provenance' USING ERRCODE='23514';END IF;
 ELSIF NEW.workspace_descriptor ? 'canonical_source' OR NEW.workspace_descriptor ? 'conflict_source' THEN
  RAISE EXCEPTION 'workspace sources require isolated placement and a frozen basis' USING ERRCODE='23514';
 END IF;
 FOREACH source_kind IN ARRAY ARRAY['canonical_source','conflict_source'] LOOP
  source:=NEW.workspace_descriptor->source_kind;
  IF source IS NULL THEN CONTINUE;END IF;
  SELECT * INTO effect FROM operations WHERE id=source->>'operation_id';
  SELECT * INTO result_item FROM operation_workspace_results(effect.id) r WHERE r.resource_id=work.resource_id AND r.workspace_id=work.id;
  SELECT * INTO prior FROM workspace_leases WHERE id=result_item.lease_id;
  SELECT * INTO owner_attempt FROM attempts WHERE id=effect.attempt_id;
  IF effect.id IS NULL OR effect.state<>'succeeded' OR source->>'attempt_id' IS DISTINCT FROM effect.attempt_id
   OR source->>'kind' IS DISTINCT FROM effect.kind OR prior.workspace_id IS DISTINCT FROM work.id
   OR prior.attempt_id IS DISTINCT FROM effect.attempt_id OR source->'metadata' IS DISTINCT FROM result_item.result->'workspace_metadata'
   OR source->'integration' IS DISTINCT FROM result_item.result->'integration'
   OR source->'capture' IS DISTINCT FROM result_item.result->'capture'
   OR source->'completion_outcome' IS DISTINCT FROM effect.result->'completion_outcome'
   OR source->'metadata'->>'lease_id' IS DISTINCT FROM prior.id
   OR source->'metadata'->'generation' IS DISTINCT FROM NEW.workspace_descriptor->'generation'
   OR owner_attempt.runner_id IS DISTINCT FROM work.runner_id
  THEN RAISE EXCEPTION 'workspace source differs from exact successful operation ownership' USING ERRCODE='23514';END IF;
  FOREACH field IN ARRAY ARRAY['storage_id','repository_identity','provider_metadata','base_commit','target_branch'] LOOP
   IF source->'metadata'->field IS DISTINCT FROM NEW.workspace_descriptor->'basis'->field
   THEN RAISE EXCEPTION 'workspace source differs from fixed repository lineage' USING ERRCODE='23514';END IF;
  END LOOP;
  IF source_kind='canonical_source' THEN
   IF source->'metadata'->'finalized_commit' IS DISTINCT FROM NEW.workspace_descriptor->'basis'->'finalized_commit'
   THEN RAISE EXCEPTION 'canonical source differs from the admitted Task revision' USING ERRCODE='23514';END IF;
   IF effect.kind='open_workspace' THEN
    IF effect.id IS DISTINCT FROM work.materialized_by_operation_id OR source ?| ARRAY['integration','capture','completion_outcome']
     OR source->'metadata'->'finalized_commit' IS DISTINCT FROM source->'metadata'->'base_commit'
    THEN RAISE EXCEPTION 'initial canonical source requires original materialization pins' USING ERRCODE='23514';END IF;
    IF source ? 'recovery_operation_id' AND NOT EXISTS(SELECT 1 FROM operations stop
     WHERE stop.id=source->>'recovery_operation_id' AND stop.id=prior.settle_operation_id AND stop.attempt_id=effect.attempt_id
      AND stop.workspace_lease_id=prior.id AND stop.kind='stop' AND stop.state='succeeded' AND stop.result->>'writer_absent'='true')
    THEN RAISE EXCEPTION 'initial source recovery requires its exact settled Stop' USING ERRCODE='23514';END IF;
   ELSIF effect.kind='complete_node' THEN
    IF effect.result->>'completion_outcome' IS DISTINCT FROM 'finalized' OR prior.state<>'released' OR effect.result->>'writer_absent' IS DISTINCT FROM 'true' OR source ? 'recovery_operation_id'
     OR result_item.result->'git_commit' IS DISTINCT FROM source->'metadata'->'finalized_commit' OR result_item.result->>'git_tree' IS NULL
     OR (result_item.integration IS NOT NULL AND source->'integration'->>'outcome' IS DISTINCT FROM 'integrated')
     OR NOT EXISTS(SELECT 1 FROM completion_manifests m WHERE m.operation_id=effect.id AND m.attempt_id=effect.attempt_id
      AND m.node_id=prior.node_id AND m.node_activation=prior.node_activation AND m.content_digest=effect.completion_manifest_digest)
    THEN RAISE EXCEPTION 'canonical completion source requires exact released integrated evidence' USING ERRCODE='23514';END IF;
   ELSE RAISE EXCEPTION 'canonical source kind cannot establish Task code' USING ERRCODE='23514';END IF;
  ELSE
   IF effect.kind<>'complete_node' OR effect.result->>'completion_outcome' IS DISTINCT FROM 'conflict' OR result_item.result->'capture' IS NULL
    OR source ? 'recovery_operation_id' OR prior.state<>'released' OR effect.result->>'writer_absent' IS DISTINCT FROM 'true'
    OR NOT owner_attempt.process_absent OR NOT owner_attempt.process_released OR owner_attempt.mutation_allowed
    OR prior.node_id IS DISTINCT FROM NEW.workspace_descriptor->>'node_id'
    OR to_jsonb(prior.node_activation) IS DISTINCT FROM NEW.workspace_descriptor->'node_activation'
   THEN RAISE EXCEPTION 'conflict source requires this exact activation and settled private result' USING ERRCODE='23514';END IF;
  END IF;
 END LOOP;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION validate_replan_graph_impact(p replan_proposals) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s replan_sources; graph jsonb:=p.content->'nodes';impact jsonb:=p.content->'impact';item jsonb;workspace_target jsonb;prior jsonb;expected_activation bigint;
BEGIN
 SELECT * INTO s FROM replan_sources WHERE id=p.source_id;
 IF jsonb_typeof(graph) IS DISTINCT FROM 'array' OR jsonb_typeof(impact) IS DISTINCT FROM 'object' OR
  jsonb_typeof(impact->'nodes') IS DISTINCT FROM 'array' OR jsonb_typeof(impact->'guidance') IS DISTINCT FROM 'array' OR
  jsonb_typeof(impact->'holds') IS DISTINCT FROM 'array' OR jsonb_typeof(impact->'workspaces') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Replan requires complete graph and mapping arrays' USING ERRCODE='23514';END IF;
 IF jsonb_array_length(graph) NOT BETWEEN 1 AND 256 OR jsonb_array_length(impact->'nodes') NOT BETWEEN 1 AND 256 OR
  jsonb_array_length(impact->'guidance')>256 OR jsonb_array_length(impact->'holds')>256 OR jsonb_array_length(impact->'workspaces')>256 OR
  (impact-ARRAY['nodes','guidance','holds','workspaces'])<>'{}'::jsonb
 THEN RAISE EXCEPTION 'Replan complete graph exceeds contract' USING ERRCODE='23514';END IF;
 IF s.context IS NULL OR
  (SELECT jsonb_agg(n-ARRAY['disposition','target_node_id','target_node_activation'] ORDER BY ord) FROM jsonb_array_elements(impact->'nodes') WITH ORDINALITY x(n,ord)) IS DISTINCT FROM
  (SELECT jsonb_agg(n-ARRAY['disposition','target_node_id','target_node_activation'] ORDER BY ord) FROM jsonb_array_elements(s.context->'impact'->'nodes') WITH ORDINALITY x(n,ord))
 THEN RAISE EXCEPTION 'proposal must preserve every ordered source Node fact' USING ERRCODE='23514';END IF;
 IF (SELECT count(DISTINCT n->>'node_id') FROM jsonb_array_elements(graph) n)<>jsonb_array_length(graph)
 THEN RAISE EXCEPTION 'Replan graph Node IDs must be unique' USING ERRCODE='23514';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(graph) LOOP
  IF jsonb_typeof(item->'node_id') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'goal') IS DISTINCT FROM 'string' OR
   jsonb_typeof(item->'role_id') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'dependencies') IS DISTINCT FROM 'array' OR
   (item ? 'hard_requirements' AND jsonb_typeof(item->'hard_requirements') IS DISTINCT FROM 'array') OR
   (item ? 'consumes' AND jsonb_typeof(item->'consumes') IS DISTINCT FROM 'array') OR
   (item ? 'expected_outputs' AND jsonb_typeof(item->'expected_outputs') IS DISTINCT FROM 'array') OR
   item-ARRAY['node_id','goal','role_id','dependencies','hard_requirements','consumes','expected_outputs']<>'{}'::jsonb
  THEN RAISE EXCEPTION 'Replan graph definition is malformed' USING ERRCODE='23514';END IF;
  IF NOT EXISTS(SELECT 1 FROM tasks t JOIN project_roles pr ON pr.project_id=t.project_id JOIN roles r ON r.id=pr.role_id WHERE t.id=p.task_id AND r.id=item->>'role_id' AND NOT r.archived) OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(item->'dependencies') dep WHERE jsonb_typeof(dep)<>'string' OR dep=to_jsonb(item->>'node_id') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph) n WHERE n->'node_id'=dep)) OR
   (SELECT count(DISTINCT dep) FROM jsonb_array_elements(item->'dependencies') dep)<>jsonb_array_length(item->'dependencies')
  THEN RAISE EXCEPTION 'Replan graph needs selected Roles and exact internal dependencies' USING ERRCODE='23514';END IF;
  IF jsonb_array_length(COALESCE(item->'consumes','[]'::jsonb))>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(item->'hard_requirements','[]'::jsonb)) x WHERE jsonb_typeof(x)<>'string') OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(item->'consumes','[]'::jsonb)) x WHERE jsonb_typeof(x)<>'string') OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(item->'expected_outputs','[]'::jsonb)) x WHERE jsonb_typeof(x)<>'string')
  THEN RAISE EXCEPTION 'Replan Node constraints and references must be strings' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM plan_nodes old WHERE old.plan_id=s.plan_id AND old.node_id=item->>'node_id' AND old.definition IS DISTINCT FROM item) OR
   (NOT EXISTS(SELECT 1 FROM plan_nodes old WHERE old.plan_id=s.plan_id AND old.node_id=item->>'node_id') AND
    EXISTS(SELECT 1 FROM nodes old WHERE old.id=item->>'node_id' AND (old.task_id<>p.task_id OR EXISTS(SELECT 1 FROM node_activations a WHERE a.node_id=old.id AND a.plan_id<>p.plan_id))))
  THEN RAISE EXCEPTION 'retained definitions are immutable and new work needs a new Node identity' USING ERRCODE='23514';END IF;
 END LOOP;
 IF EXISTS(WITH RECURSIVE edges(n,d) AS (SELECT n->>'node_id',dep FROM jsonb_array_elements(graph) n CROSS JOIN LATERAL jsonb_array_elements_text(n->'dependencies') dep),reach(n,d) AS (SELECT n,d FROM edges UNION SELECT r.n,e.d FROM reach r JOIN edges e ON e.n=r.d) SELECT 1 FROM reach WHERE n=d)
 THEN RAISE EXCEPTION 'Replan graph must be acyclic' USING ERRCODE='23514';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(impact->'nodes') LOOP
  IF item->>'disposition'='remove' THEN
   IF item->'target_node_id' IS DISTINCT FROM 'null'::jsonb OR item->'target_node_activation' IS DISTINCT FROM 'null'::jsonb OR EXISTS(SELECT 1 FROM jsonb_array_elements(graph) n WHERE n->'node_id'=item->'node_id')
   THEN RAISE EXCEPTION 'removed Node cannot remain a graph member or target' USING ERRCODE='23514';END IF;
  ELSE
   IF (item->>'disposition' IN ('refresh','carry','invalidate')) IS NOT TRUE OR item->'target_node_id' IS DISTINCT FROM item->'node_id' OR
    item->'target_node_activation' IS DISTINCT FROM to_jsonb((item->>'node_activation')::bigint+CASE WHEN item->>'disposition'='invalidate' THEN 1 ELSE 0 END) OR
    NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph) n WHERE n->'node_id'=item->'node_id') OR
    ((item->>'disposition'='refresh') IS DISTINCT FROM (item->>'completion_operation_id' IS NULL)) OR
    (item->>'disposition'='carry' AND (item->>'completion_operation_id' IS NULL OR NOT review_completion_applies(item->>'completion_operation_id',s.specification_id,s.plan_id)))
   THEN RAISE EXCEPTION 'Node disposition does not authorize its exact activation/evidence' USING ERRCODE='23514';END IF;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(graph) n JOIN jsonb_array_elements(impact->'nodes') evidence ON evidence->'node_id'=n->'node_id'
  CROSS JOIN LATERAL jsonb_array_elements(n->'dependencies') dep WHERE evidence->>'disposition'='carry' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(impact->'nodes') upstream WHERE upstream->'node_id'=dep AND upstream->>'disposition'='carry'))
 THEN RAISE EXCEPTION 'carried Node requires carried dependency evidence' USING ERRCODE='23514';END IF;
 IF EXISTS(WITH RECURSIVE invalid(node_identity) AS (
  SELECT entry.value->>'node_id' FROM jsonb_array_elements(impact->'nodes') AS entry(value) WHERE entry.value->>'disposition'='invalidate'
  UNION
  SELECT entry.value->>'node_id' FROM invalid i CROSS JOIN jsonb_array_elements(graph) AS entry(value) WHERE entry.value->'dependencies' ? i.node_identity
 ) SELECT 1 FROM invalid i JOIN jsonb_array_elements(impact->'nodes') AS entry(value) ON entry.value->>'node_id'=i.node_identity WHERE entry.value->>'disposition'='carry')
 THEN RAISE EXCEPTION 'descendants of invalidated upstream evidence cannot carry completion' USING ERRCODE='23514';END IF;
 IF (SELECT COALESCE(jsonb_agg(g-ARRAY['disposition','target_node_ids'] ORDER BY g->>'guidance_id'),'[]'::jsonb) FROM jsonb_array_elements(impact->'guidance') g) IS DISTINCT FROM
    (SELECT COALESCE(jsonb_agg(g-ARRAY['disposition','target_node_ids'] ORDER BY g->>'guidance_id'),'[]'::jsonb) FROM jsonb_array_elements(s.context->'impact'->'guidance') g) OR
    (SELECT count(DISTINCT g->>'guidance_id') FROM jsonb_array_elements(impact->'guidance') g)<>jsonb_array_length(impact->'guidance')
 THEN RAISE EXCEPTION 'proposal must disposition each exact source guidance once' USING ERRCODE='23514';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(impact->'guidance') LOOP
  IF jsonb_typeof(item->'target_node_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'guidance targets required' USING ERRCODE='23514';END IF;
  IF (item->>'disposition' IN ('retain','supersede')) IS NOT TRUE OR ((item->>'disposition'='supersede') IS DISTINCT FROM (jsonb_array_length(item->'target_node_ids')=0)) OR
   (SELECT count(DISTINCT target) FROM jsonb_array_elements(item->'target_node_ids') target)<>jsonb_array_length(item->'target_node_ids') OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(item->'target_node_ids') target WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph) n WHERE n->'node_id'=target))
  THEN RAISE EXCEPTION 'guidance disposition targets must be unique current graph members' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(impact->'nodes') n WHERE n->>'disposition'='carry' AND item->'target_node_ids' ? (n->>'node_id') AND NOT EXISTS(SELECT 1 FROM task_guidance_obligations o WHERE o.task_id=p.task_id AND o.guidance_id=item->>'guidance_id' AND o.node_id=n->>'node_id' AND o.node_activation=(n->>'node_activation')::bigint AND o.status='handled' AND o.completion_operation_id=n->>'completion_operation_id'))
  THEN RAISE EXCEPTION 'carried completion cannot silently handle newly assigned guidance' USING ERRCODE='23514';END IF;
 END LOOP;
 IF (SELECT COALESCE(jsonb_agg(h->'origin' ORDER BY review_canonical_json(h->'origin')),'[]'::jsonb) FROM jsonb_array_elements(impact->'holds') h) IS DISTINCT FROM
    (SELECT COALESCE(jsonb_agg(h->'origin' ORDER BY review_canonical_json(h->'origin')),'[]'::jsonb) FROM jsonb_array_elements(s.context->'impact'->'holds') h) OR
    (SELECT count(DISTINCT h->'origin') FROM jsonb_array_elements(impact->'holds') h)<>jsonb_array_length(impact->'holds')
 THEN RAISE EXCEPTION 'proposal must preserve every source control origin once' USING ERRCODE='23514';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(impact->'holds') LOOP
  IF jsonb_typeof(item->'target_node_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'hold targets required' USING ERRCODE='23514';END IF;
  IF jsonb_array_length(item->'target_node_ids')=0 OR
   (SELECT count(DISTINCT target) FROM jsonb_array_elements(item->'target_node_ids') target)<>jsonb_array_length(item->'target_node_ids') OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(item->'target_node_ids') target WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph) n WHERE n->'node_id'=target)) OR item-ARRAY['origin','target_node_ids']<>'{}'::jsonb
  THEN RAISE EXCEPTION 'each independent control needs explicit unique graph targets' USING ERRCODE='23514';END IF;
 END LOOP;
 IF (SELECT COALESCE(jsonb_agg(w->'input' ORDER BY w->'input'->>'workspace_id',w->'input'->>'from_lease_id'),'[]'::jsonb) FROM jsonb_array_elements(impact->'workspaces') w) IS DISTINCT FROM
    (SELECT COALESCE(jsonb_agg(w->'input' ORDER BY w->'input'->>'workspace_id',w->'input'->>'from_lease_id'),'[]'::jsonb) FROM jsonb_array_elements(s.context->'impact'->'workspaces') w) OR
    (SELECT count(DISTINCT w->'input'->>'from_lease_id') FROM jsonb_array_elements(impact->'workspaces') w)<>jsonb_array_length(impact->'workspaces')
 THEN RAISE EXCEPTION 'proposal must preserve every exact workspace input once' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(impact->'workspaces') w CROSS JOIN LATERAL jsonb_array_elements(w->'target_nodes') target
  WHERE w->'input'->>'kind'='checkpoint' GROUP BY target->>'node_id',target->>'node_activation',w->'input'->>'resource_id' HAVING count(*)>1)
 THEN RAISE EXCEPTION 'multiple private checkpoints cannot share one target resource' USING ERRCODE='23514';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(impact->'workspaces') LOOP
  IF jsonb_typeof(item->'target_nodes') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'workspace target set required' USING ERRCODE='23514';END IF;
  IF (item->'input'->>'kind'='checkpoint' AND jsonb_array_length(item->'target_nodes')<>1) OR
   (SELECT count(DISTINCT target->>'node_id') FROM jsonb_array_elements(item->'target_nodes') target)<>jsonb_array_length(item->'target_nodes') OR item-ARRAY['input','target_nodes']<>'{}'::jsonb
  THEN RAISE EXCEPTION 'private checkpoint needs one target; completed input permits unique approved targets' USING ERRCODE='23514';END IF;
  FOR workspace_target IN SELECT value FROM jsonb_array_elements(item->'target_nodes') LOOP
   SELECT n INTO prior FROM jsonb_array_elements(impact->'nodes') n WHERE n->'target_node_id'=workspace_target->'node_id';
   IF item->'input'->>'kind'='checkpoint' AND prior->>'disposition'='carry'
   THEN RAISE EXCEPTION 'private checkpoint requires an unfinished target' USING ERRCODE='23514';END IF;
   expected_activation:=CASE WHEN prior IS NULL THEN 1 ELSE (prior->>'target_node_activation')::bigint END;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph) n WHERE n->'node_id'=workspace_target->'node_id') OR workspace_target->'node_activation' IS DISTINCT FROM to_jsonb(expected_activation) OR workspace_target-ARRAY['node_id','node_activation']<>'{}'::jsonb
   THEN RAISE EXCEPTION 'workspace target must bind exact published activation' USING ERRCODE='23514';END IF;
  END LOOP;
 END LOOP;
END $$;


CREATE OR REPLACE FUNCTION validate_node_rework_authority() RETURNS trigger LANGUAGE plpgsql AS $$
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
  SELECT * INTO effect FROM operations WHERE id=receipt.response->>'operation_id';
  envelope:=receipt.envelope_json::jsonb;
  SELECT array_agg(node_id ORDER BY node_id) INTO ids FROM node_rework_targets WHERE request_id=r.id;
  IF (receipt.command_name='request_rework' AND envelope->>'name'='request_rework'
      AND envelope->'payload'->>'reason'=r.reason AND envelope->>'scope_id'=r.task_id
      AND (envelope->>'expected_control_version')::bigint=source.expected_version
      AND receipt.response->>'status'='committed' AND EXISTS(SELECT 1 FROM node_rework_request_stops m WHERE m.request_id=r.id AND m.operation_id=effect.id)
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
  IF NOT EXISTS(SELECT 1 FROM node_rework_request_stops WHERE request_id=r.id)
    OR EXISTS(SELECT 1 FROM node_rework_request_stops m LEFT JOIN operations o ON o.id=m.operation_id
      LEFT JOIN workspace_leases l ON l.id=m.lease_id WHERE m.request_id=r.id AND
      (o.id IS NULL OR o.kind<>'stop' OR o.attempt_id<>r.requester_attempt_id OR o.request_id<>r.agent_request_id
       OR o.workspace_lease_id IS DISTINCT FROM m.lease_id OR o.workspace_descriptor->>'workspace_id' IS DISTINCT FROM m.workspace_id
       OR m.lease_id IS NOT NULL AND (l.attempt_id<>r.requester_attempt_id OR l.workspace_id<>m.workspace_id OR l.settle_operation_id<>o.id)))
    OR EXISTS(SELECT 1 FROM workspace_leases l WHERE l.attempt_id=r.requester_attempt_id
      AND (l.state<>'released' OR EXISTS(SELECT 1 FROM operations o WHERE o.id=l.settle_operation_id AND o.request_id=r.agent_request_id))
      AND NOT EXISTS(SELECT 1 FROM node_rework_request_stops m WHERE m.request_id=r.id AND m.lease_id=l.id AND m.operation_id=l.settle_operation_id))
    OR EXISTS(SELECT 1 FROM node_rework_request_stops m WHERE m.request_id=r.id AND m.lease_id IS NULL)
      AND (SELECT count(*) FROM node_rework_request_stops WHERE request_id=r.id)<>1
    OR EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=r.requester_attempt_id AND o.kind='stop' AND o.request_id=r.agent_request_id
      AND NOT EXISTS(SELECT 1 FROM node_rework_request_stops m WHERE m.request_id=r.id AND m.operation_id=o.id))
  THEN RAISE EXCEPTION 'Rework requires complete exact request-to-Stop membership' USING ERRCODE='23514';END IF;
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
    IF EXISTS(SELECT 1 FROM node_rework_request_stops m JOIN operations o ON o.id=m.operation_id WHERE m.request_id=r.id AND o.state<>'succeeded') OR NOT EXISTS(SELECT 1 FROM attempts a WHERE a.id=r.requester_attempt_id AND a.process_absent AND a.process_released)
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
CREATE CONSTRAINT TRIGGER node_rework_stop_authority AFTER INSERT ON node_rework_request_stops DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_node_rework_authority();


CREATE OR REPLACE FUNCTION validate_repository_inspection_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o operations; a attempts; receipt command_receipts; d jsonb; p jsonb; expected_source jsonb; origin jsonb;
  proof operations; original attempts; metadata jsonb; identity jsonb; expected_identity jsonb; manifest completion_manifests; result_item record;
BEGIN
  SELECT * INTO o FROM operations WHERE id=NEW.id;
  IF o.inspection_descriptor IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO a FROM attempts WHERE id=o.attempt_id;
  d:=o.inspection_descriptor;p:=d->'planner_source';origin:=d->'origin';
  IF (jsonb_typeof(d)='object' AND d ?& ARRAY['schema_version','inspection_id','attempt_id','dispatch_id','scope_kind','scope_id','project_id','runner_id','resource','planner_source','origin']
    AND d-ARRAY['schema_version','inspection_id','attempt_id','dispatch_id','scope_kind','scope_id','project_id','runner_id','resource','planner_source','origin']='{}'::jsonb
    AND jsonb_typeof(origin)='object' AND origin->>'kind' IN('default_ref','task_open','task_completion')) IS NOT TRUE THEN
    RAISE EXCEPTION 'Inspection descriptor shape differs' USING ERRCODE='23514';
  END IF;
  SELECT * INTO receipt FROM command_receipts WHERE attempt_id=a.id AND scope_id=COALESCE(a.todo_id,a.task_id) AND request_id=o.request_id;
  IF (d->'schema_version'='1'::jsonb AND d->>'inspection_id'=o.id AND d->>'attempt_id'=a.id
    AND d->>'dispatch_id'=a.dispatch_id AND d->>'runner_id'=a.runner_id AND d->>'scope_id'=COALESCE(a.todo_id,a.task_id)
    AND d->>'scope_kind'=CASE WHEN a.todo_id IS NULL THEN 'task' ELSE 'todo' END
    AND d->'resource'->>'resource_id'=o.resource_id AND a.kind='planner' AND a.launch->>'kind'='planner'
    AND p->'control_version'=a.launch->'control_version' AND p->'source_watermark'=a.launch->'source_watermark'
    AND o.inspection_digest=encode(sha256(convert_to(review_canonical_json(d),'UTF8')),'hex')
    AND receipt.command_name='inspect_repository' AND receipt.operation_id=o.id
    AND receipt.schema_version=1 AND receipt.envelope_json::jsonb->'schema_version'='1'::jsonb
    AND receipt.envelope_json::jsonb->>'request_id'=o.request_id
    AND receipt.digest=encode(sha256(convert_to(receipt.envelope_json,'UTF8')),'hex')
    AND receipt.envelope_json::jsonb->>'name'='inspect_repository'
    AND receipt.envelope_json::jsonb->>'scope_id'=d->>'scope_id'
    AND receipt.envelope_json::jsonb->'expected_control_version'=p->'control_version'
    AND receipt.envelope_json::jsonb->'payload'->>'resource_id'=o.resource_id
    AND receipt.response->>'operation_id'=o.id AND receipt.response->>'request_id'=o.request_id
    AND receipt.response->>'status' IN('admitted','committed')) IS NOT TRUE
  THEN RAISE EXCEPTION 'Inspection lacks its exact Agent receipt and operation identity' USING ERRCODE='23514'; END IF;
  CASE p->>'kind'
  WHEN 'todo_discussion' THEN
    SELECT jsonb_build_object('kind','todo_discussion','source_id',s.source_message_id,'control_version',s.expected_version,
      'source_watermark',s.context->'source_watermark','context_digest',encode(sha256(convert_to(s.context->>'prompt','UTF8')),'hex'))
    INTO expected_source FROM todo_discussion_outbox s WHERE s.source_message_id=p->>'source_id' AND s.todo_id=a.todo_id
      AND s.planned_attempt_id=a.id AND s.source_message_id=a.launch->>'source_message_id'
      AND s.context->>'prompt'=a.launch->>'prompt' AND s.context->>'project_id'=d->>'project_id';
  WHEN 'task_initial_planning' THEN
    SELECT jsonb_build_object('kind','task_initial_planning','source_id',s.id,'control_version',s.expected_version,
      'source_watermark',0,'context_digest',s.context_digest)
    INTO expected_source FROM task_planning_outbox s WHERE s.id=p->>'source_id' AND s.task_id=a.task_id
      AND s.planned_attempt_id=a.id AND s.id=a.launch->'task_planning_source'->>'intent_id'
      AND s.prompt=a.launch->>'prompt' AND s.context_digest=a.launch->'task_planning_source'->>'context_digest';
  WHEN 'task_conversation' THEN
    SELECT jsonb_build_object('kind','task_conversation','source_id',s.id,'control_version',s.expected_version,
      'source_watermark',s.source_watermark,'context_digest',s.context_digest)
    INTO expected_source FROM task_conversation_outbox s WHERE s.id=p->>'source_id' AND s.task_id=a.task_id
      AND s.planned_attempt_id=a.id AND s.id=a.launch->'task_conversation_source'->>'source_id'
      AND s.prompt=a.launch->>'prompt' AND s.context_digest=a.launch->'task_conversation_source'->>'context_digest';
  WHEN 'task_replan' THEN
    SELECT jsonb_build_object('kind','task_replan','source_id',s.id,'control_version',s.expected_version,
      'source_watermark',0,'context_digest',s.context_digest)
    INTO expected_source FROM replan_sources s WHERE s.id=p->>'source_id' AND s.task_id=a.task_id
      AND s.planned_attempt_id=a.id AND s.id=a.launch->'task_replan_source'->>'source_id'
      AND s.prompt=a.launch->>'prompt' AND s.context_digest=a.launch->'task_replan_source'->>'context_digest';
  WHEN 'task_review' THEN
    SELECT jsonb_build_object('kind','task_review','source_id',s.id,'control_version',s.source->'control_version',
      'source_watermark',0,'context_digest',s.context_digest)
    INTO expected_source FROM task_review_sources s WHERE s.id=p->>'source_id' AND s.task_id=a.task_id
      AND s.planned_attempt_id=a.id AND s.source=a.launch->'task_review_source' AND s.prompt=a.launch->>'prompt';
  ELSE expected_source:=NULL;
  END CASE;
  IF expected_source IS NULL OR p IS DISTINCT FROM expected_source THEN
    RAISE EXCEPTION 'Inspection frozen Planner source differs from its retained launch' USING ERRCODE='23514';
  END IF;
  IF origin->>'kind' IN('task_completion','task_open') THEN
    SELECT * INTO proof FROM operations WHERE id=CASE WHEN origin->>'kind'='task_open' THEN origin->>'operation_id' ELSE origin->'identity'->>'operation_id' END;
    SELECT * INTO original FROM attempts WHERE id=proof.attempt_id;
    SELECT * INTO result_item FROM operation_workspace_results(proof.id) r WHERE r.resource_id=o.resource_id;
    metadata:=result_item.result->'workspace_metadata';
    IF (proof.state='succeeded' AND original.task_id=a.task_id AND original.runner_id=a.runner_id
      AND original.kind='node' AND original.launch ? 'node_execution_source' AND result_item.resource_id=o.resource_id
      AND result_item.workspace_descriptor->'resource'=d->'resource' AND metadata IS NOT NULL AND NOT metadata ? 'checkpoint') IS NOT TRUE
    THEN RAISE EXCEPTION 'Inspection Task revision lacks canonical finalized provenance' USING ERRCODE='23514'; END IF;
    IF origin->>'kind'='task_open' THEN
      IF (proof.kind='open_workspace' AND origin->'workspace'=result_item.workspace_descriptor AND origin->>'workspace_digest'=result_item.workspace_digest
        AND origin->'metadata'=metadata AND NOT result_item.workspace_descriptor ? 'basis'
        AND metadata->>'base_commit'=metadata->>'finalized_commit'
        AND EXISTS(SELECT 1 FROM task_workspaces w WHERE w.id=result_item.workspace_descriptor->>'workspace_id' AND w.materialized_by_operation_id=proof.id)) IS NOT TRUE
      THEN RAISE EXCEPTION 'Inspection initial base differs from original open' USING ERRCODE='23514'; END IF;
    ELSE
      identity:=origin->'identity';
      SELECT * INTO manifest FROM completion_manifests WHERE operation_id=proof.id;
      expected_identity:=jsonb_build_object('task_id',manifest.task_id,'operation_id',proof.id,'attempt_id',original.id,'dispatch_id',original.dispatch_id,
        'node_id',manifest.node_id,'node_activation',manifest.node_activation,'specification_id',manifest.specification_id,'plan_id',manifest.plan_id,
        'manifest_digest',manifest.content_digest,'capture',result_item.result->'capture','workspace_id',result_item.workspace_descriptor->>'workspace_id','resource_id',result_item.resource_id,
        'runner_id',original.runner_id,'storage_id',metadata->>'storage_id','lease_id',metadata->>'lease_id','generation',metadata->'generation',
        'repository_identity',metadata->>'repository_identity','base_commit',metadata->>'base_commit','git_commit',result_item.result->>'git_commit','git_tree',result_item.result->>'git_tree',
        'operation_identity_digest',encode(sha256(convert_to(review_canonical_json(completion_operation_identity(proof.id)),'UTF8')),'hex'));
      IF (proof.kind='complete_node' AND proof.result->>'completion_outcome'='finalized' AND proof.result->>'writer_absent'='true' AND result_item.result->>'git_commit'=metadata->>'finalized_commit'
        AND manifest.content_digest=proof.completion_manifest_digest AND EXISTS(SELECT 1 FROM node_completions WHERE operation_id=proof.id)
        AND identity=expected_identity AND origin->>'identity_digest'=encode(sha256(convert_to(review_canonical_json(identity),'UTF8')),'hex')) IS NOT TRUE
      THEN RAISE EXCEPTION 'Inspection completion identity differs from original manifest and result' USING ERRCODE='23514'; END IF;
    END IF;
  ELSIF origin<>jsonb_build_object('kind','default_ref') THEN
    RAISE EXCEPTION 'Unknown inspection origin' USING ERRCODE='23514';
  END IF;
  IF o.state='succeeded' THEN
    IF (o.result-'inspection'='{}'::jsonb AND o.result->'inspection'->>'inspection_id'=o.id
      AND o.result->'inspection'->>'descriptor_digest'=o.inspection_digest
      AND o.result->'inspection'->>'status' IN('available','unavailable')
      AND ((o.result->'inspection'->>'status'='available')=(o.result->'inspection' ? 'snapshot'))) IS NOT TRUE THEN
      RAISE EXCEPTION 'Inspection settlement lacks its exact immutable observation' USING ERRCODE='23514';
    END IF;
    IF o.result->'inspection'->>'status'='available' AND (
      (o.result->'inspection'->'snapshot'->>'snapshot_id'=o.id AND o.result->'inspection'->'snapshot'->>'repository_identity'=d->'resource'->>'repository_identity') IS NOT TRUE
      OR origin->>'kind'='task_completion' AND (o.result->'inspection'->'snapshot'->>'commit',o.result->'inspection'->'snapshot'->>'tree',o.result->'inspection'->'snapshot'->>'storage_id')
        IS DISTINCT FROM (origin->'identity'->>'git_commit',origin->'identity'->>'git_tree',origin->'identity'->>'storage_id')
      OR origin->>'kind'='task_open' AND (o.result->'inspection'->'snapshot'->>'commit',o.result->'inspection'->'snapshot'->>'storage_id')
        IS DISTINCT FROM (origin->'metadata'->>'base_commit',origin->'metadata'->>'storage_id')) THEN
      RAISE EXCEPTION 'Inspection snapshot differs from its exact revision' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
