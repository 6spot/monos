-- Allocation identity separates private Node work from the logical Task repository.
ALTER TABLE workspace_leases ADD COLUMN allocation_id text;
ALTER TABLE workspace_leases ADD COLUMN start_commit text;
ALTER TABLE workspace_leases ADD CHECK(allocation_id IS NULL OR length(allocation_id) BETWEEN 1 AND 128);
ALTER TABLE workspace_leases ADD CHECK(start_commit IS NULL OR (allocation_id IS NOT NULL AND start_commit ~ '^(?:[a-f0-9]{40}|[a-f0-9]{64})$'));
DROP INDEX one_live_workspace_lease;
DROP INDEX one_serial_task_lease;
CREATE UNIQUE INDEX one_live_workspace_allocation ON workspace_leases(workspace_id,COALESCE(allocation_id,'')) WHERE state<>'released';

ALTER TABLE operations ADD COLUMN integration jsonb;
ALTER TABLE operations ADD CHECK(integration IS NULL OR (
 kind='complete_node' AND repository_free IS NULL AND workspace_descriptor IS NOT NULL
 AND jsonb_typeof(workspace_descriptor->'isolation')='object'
 AND jsonb_typeof(integration)='object' AND integration-ARRAY['expected_task_commit']='{}'::jsonb
 AND jsonb_typeof(integration->'expected_task_commit')='string'
 AND integration->>'expected_task_commit' ~ '^(?:[a-f0-9]{40}|[a-f0-9]{64})$'));

ALTER TABLE replan_workspace_transfers DROP CONSTRAINT replan_workspace_transfers_publication_id_workspace_id_key;
ALTER TABLE replan_workspace_transfers ADD COLUMN from_lease_id text GENERATED ALWAYS AS (descriptor->>'from_lease_id') STORED;
ALTER TABLE replan_workspace_transfers ALTER COLUMN from_lease_id SET NOT NULL;
ALTER TABLE replan_workspace_transfers ADD FOREIGN KEY(from_lease_id) REFERENCES workspace_leases(id);
ALTER TABLE replan_workspace_transfers ADD UNIQUE(publication_id,from_lease_id,target_node_id,target_node_activation);
CREATE UNIQUE INDEX one_replan_checkpoint_adoption ON replan_workspace_transfers(publication_id,from_lease_id) WHERE descriptor->>'kind'='checkpoint';

CREATE FUNCTION preserve_parallel_workspace_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='operations' THEN
  IF NEW.integration IS DISTINCT FROM OLD.integration THEN RAISE EXCEPTION 'integration admission identity is immutable' USING ERRCODE='23514';END IF;
 ELSE
  IF NEW.allocation_id IS DISTINCT FROM OLD.allocation_id OR (OLD.start_commit IS NOT NULL AND NEW.start_commit IS DISTINCT FROM OLD.start_commit)
  THEN RAISE EXCEPTION 'workspace allocation and start revision are immutable' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_parallel_operation BEFORE UPDATE ON operations FOR EACH ROW EXECUTE FUNCTION preserve_parallel_workspace_identity();
CREATE TRIGGER immutable_parallel_lease BEFORE UPDATE ON workspace_leases FOR EACH ROW EXECUTE FUNCTION preserve_parallel_workspace_identity();

-- The Task row serializes admission even before an Attempt opens a repository.
CREATE FUNCTION validate_parallel_attempt_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE isolated boolean;
BEGIN
 IF NEW.kind<>'node' OR NEW.node_execution_source_id IS NULL OR (NEW.state<>'QUEUED' AND NEW.process_released) THEN RETURN NEW;END IF;
 PERFORM 1 FROM tasks WHERE id=NEW.task_id FOR UPDATE;
 isolated:=COALESCE(NEW.launch->'workspace_reservations' ? 'isolation',false);
 IF EXISTS(SELECT 1 FROM attempts a WHERE a.task_id=NEW.task_id AND a.kind='node' AND a.id<>NEW.id
  AND (a.state='QUEUED' OR NOT a.process_released OR EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN ('succeeded','cancelled')))
  AND (NOT isolated OR NOT COALESCE(a.launch->'workspace_reservations' ? 'isolation',false)))
 OR EXISTS(SELECT 1 FROM workspace_leases l WHERE l.task_id=NEW.task_id AND l.attempt_id<>NEW.id AND l.state<>'released'
  AND (NOT isolated OR l.allocation_id IS NULL))
 THEN RAISE EXCEPTION 'direct Node admission requires exclusive Task ownership' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER parallel_attempt_admission BEFORE INSERT OR UPDATE ON attempts FOR EACH ROW EXECUTE FUNCTION validate_parallel_attempt_admission();

CREATE FUNCTION validate_parallel_lease_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state='released' THEN RETURN NEW;END IF;
 PERFORM 1 FROM tasks WHERE id=NEW.task_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM task_workspaces w JOIN workspace_leases l ON l.workspace_id=w.id
  WHERE w.id=NEW.workspace_id AND NOT w.ever_materialized AND l.id<>NEW.id AND l.state<>'released')
 THEN RAISE EXCEPTION 'first workspace initialization must settle before another allocation opens' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM workspace_leases l WHERE l.task_id=NEW.task_id AND l.id<>NEW.id AND l.state<>'released'
  AND (NEW.allocation_id IS NULL OR l.allocation_id IS NULL))
 OR EXISTS(SELECT 1 FROM attempts a WHERE a.task_id=NEW.task_id AND a.id<>NEW.attempt_id AND a.kind='node'
  AND (a.state='QUEUED' OR NOT a.process_released OR EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN ('succeeded','cancelled')))
  AND (NEW.allocation_id IS NULL OR NOT COALESCE(a.launch->'workspace_reservations' ? 'isolation',false)))
 THEN RAISE EXCEPTION 'direct workspace lease requires exclusive Task ownership' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER parallel_lease_admission BEFORE INSERT OR UPDATE ON workspace_leases FOR EACH ROW EXECUTE FUNCTION validate_parallel_lease_admission();

CREATE FUNCTION validate_parallel_completion_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_attempt attempts;head text;
BEGIN
 IF NEW.kind<>'complete_node' THEN RETURN NEW;END IF;
 SELECT * INTO owner_attempt FROM attempts WHERE id=NEW.attempt_id;
 IF owner_attempt.node_execution_source_id IS NULL THEN RETURN NEW;END IF;
 PERFORM 1 FROM tasks WHERE id=owner_attempt.task_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM operations o JOIN attempts a ON a.id=o.attempt_id WHERE a.task_id=owner_attempt.task_id AND o.kind='complete_node'
  AND o.id<>NEW.id AND o.state NOT IN ('succeeded','cancelled'))
 THEN RAISE EXCEPTION 'Task completion and integration admission must be serialized' USING ERRCODE='23514';END IF;
 IF NEW.integration IS NOT NULL THEN
  SELECT w.finalized_commit INTO head FROM task_workspaces w WHERE w.id=NEW.workspace_descriptor->>'workspace_id';
  IF NEW.integration->>'expected_task_commit' IS DISTINCT FROM head
  THEN RAISE EXCEPTION 'integration requires the exact current Task revision' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER parallel_completion_admission BEFORE INSERT ON operations FOR EACH ROW EXECUTE FUNCTION validate_parallel_completion_admission();

CREATE FUNCTION validate_parallel_workspace_records() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lease workspace_leases;owner_attempt attempts;work task_workspaces;metadata jsonb;integrated jsonb;
BEGIN
 IF TG_TABLE_NAME='workspace_leases' THEN
  lease:=NEW;SELECT * INTO owner_attempt FROM attempts WHERE id=lease.attempt_id;
  IF lease.allocation_id IS DISTINCT FROM owner_attempt.launch->'workspace_reservations'->'isolation'->>'allocation_id'
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
 IF (NEW.integration IS NOT NULL) IS DISTINCT FROM (NEW.kind='complete_node' AND lease.allocation_id IS NOT NULL)
 THEN RAISE EXCEPTION 'isolated completion requires exact integration admission' USING ERRCODE='23514';END IF;
 IF NEW.state<>'succeeded' THEN RETURN NULL;END IF;
 metadata:=NEW.result->'workspace_metadata';
 IF metadata IS NOT NULL AND metadata->'isolation' IS DISTINCT FROM (CASE WHEN lease.allocation_id IS NULL THEN NULL ELSE jsonb_build_object('allocation_id',lease.allocation_id,'start_commit',lease.start_commit) END)
 THEN RAISE EXCEPTION 'workspace result changed its allocation start revision' USING ERRCODE='23514';END IF;
 integrated:=NEW.result->'integration';
 IF NEW.integration IS NULL THEN
  IF integrated IS NOT NULL THEN RAISE EXCEPTION 'unexpected integration result' USING ERRCODE='23514';END IF;
  RETURN NULL;
 END IF;
 IF jsonb_typeof(integrated) IS DISTINCT FROM 'object' OR
  (integrated->>'outcome' IN ('integrated','conflict')) IS NOT TRUE OR integrated-ARRAY['outcome','start_commit','node_commit','node_tree','expected_task_commit','task_commit','task_tree']<>'{}'::jsonb OR
  integrated->>'start_commit' IS DISTINCT FROM lease.start_commit OR integrated->'expected_task_commit' IS DISTINCT FROM NEW.integration->'expected_task_commit' OR
  integrated->>'task_commit' IS DISTINCT FROM work.finalized_commit OR
  (SELECT count(*) FROM jsonb_each_text(integrated) e WHERE e.key<>'outcome' AND e.value ~ '^(?:[a-f0-9]{40}|[a-f0-9]{64})$')<>6
 THEN RAISE EXCEPTION 'integration result differs from frozen allocation or Task revision' USING ERRCODE='23514';END IF;
 IF integrated->>'outcome'='integrated' THEN
  IF NEW.result->'git_commit' IS DISTINCT FROM integrated->'task_commit' OR NEW.result->'git_tree' IS DISTINCT FROM integrated->'task_tree' OR metadata->>'finalized_commit' IS DISTINCT FROM integrated->>'task_commit'
  THEN RAISE EXCEPTION 'integrated completion must expose its exact Task result' USING ERRCODE='23514';END IF;
 ELSE
  IF integrated->'task_commit' IS DISTINCT FROM integrated->'expected_task_commit' OR NEW.result ? 'git_commit' OR NEW.result ? 'git_tree'
   OR metadata->>'finalized_commit' IS DISTINCT FROM (SELECT o.result->'workspace_metadata'->>'finalized_commit' FROM operations o WHERE o.id=lease.open_operation_id)
   OR EXISTS(SELECT 1 FROM node_completions c WHERE c.operation_id=NEW.id)
  THEN RAISE EXCEPTION 'integration conflict cannot advance Task revision or grant completion' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER parallel_workspace_lease AFTER INSERT OR UPDATE ON workspace_leases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_parallel_workspace_records();
CREATE CONSTRAINT TRIGGER parallel_workspace_operation AFTER INSERT OR UPDATE ON operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_parallel_workspace_records();

-- Sources are immutable physical provenance, checked at open admission rather
-- than against a Task head that may advance while this allocation is working.
CREATE FUNCTION validate_parallel_workspace_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE work task_workspaces;source jsonb;source_kind text;effect operations;prior workspace_leases;owner_attempt attempts;field text;
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
  SELECT * INTO prior FROM workspace_leases WHERE id=effect.workspace_lease_id;
  SELECT * INTO owner_attempt FROM attempts WHERE id=effect.attempt_id;
  IF effect.id IS NULL OR effect.state<>'succeeded' OR source->>'attempt_id' IS DISTINCT FROM effect.attempt_id
   OR source->>'kind' IS DISTINCT FROM effect.kind OR prior.workspace_id IS DISTINCT FROM work.id
   OR prior.attempt_id IS DISTINCT FROM effect.attempt_id OR source->'metadata' IS DISTINCT FROM effect.result->'workspace_metadata'
   OR source->'integration' IS DISTINCT FROM effect.result->'integration'
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
    IF effect.id IS DISTINCT FROM work.materialized_by_operation_id OR source ? 'integration'
     OR source->'metadata'->'finalized_commit' IS DISTINCT FROM source->'metadata'->'base_commit'
    THEN RAISE EXCEPTION 'initial canonical source requires original materialization pins' USING ERRCODE='23514';END IF;
    IF source ? 'recovery_operation_id' AND NOT EXISTS(SELECT 1 FROM operations stop
     WHERE stop.id=source->>'recovery_operation_id' AND stop.id=prior.settle_operation_id AND stop.attempt_id=effect.attempt_id
      AND stop.workspace_lease_id=prior.id AND stop.kind='stop' AND stop.state='succeeded' AND stop.result->>'writer_absent'='true')
    THEN RAISE EXCEPTION 'initial source recovery requires its exact settled Stop' USING ERRCODE='23514';END IF;
   ELSIF effect.kind='complete_node' THEN
    IF prior.state<>'released' OR effect.result->>'writer_absent' IS DISTINCT FROM 'true' OR source ? 'recovery_operation_id'
     OR effect.result->'git_commit' IS DISTINCT FROM source->'metadata'->'finalized_commit' OR effect.result->>'git_tree' IS NULL
     OR (effect.integration IS NOT NULL AND source->'integration'->>'outcome' IS DISTINCT FROM 'integrated')
     OR NOT EXISTS(SELECT 1 FROM completion_manifests m WHERE m.operation_id=effect.id AND m.attempt_id=effect.attempt_id
      AND m.node_id=prior.node_id AND m.node_activation=prior.node_activation AND m.content_digest=effect.completion_manifest_digest)
    THEN RAISE EXCEPTION 'canonical completion source requires exact released integrated evidence' USING ERRCODE='23514';END IF;
   ELSE RAISE EXCEPTION 'canonical source kind cannot establish Task code' USING ERRCODE='23514';END IF;
  ELSE
   IF effect.kind<>'complete_node' OR effect.integration IS NULL OR source->'integration'->>'outcome' IS DISTINCT FROM 'conflict'
    OR source ? 'recovery_operation_id' OR prior.state<>'released' OR effect.result->>'writer_absent' IS DISTINCT FROM 'true'
    OR NOT owner_attempt.process_absent OR NOT owner_attempt.process_released OR owner_attempt.mutation_allowed
    OR prior.node_id IS DISTINCT FROM NEW.workspace_descriptor->>'node_id'
    OR to_jsonb(prior.node_activation) IS DISTINCT FROM NEW.workspace_descriptor->'node_activation'
   THEN RAISE EXCEPTION 'conflict source requires this exact activation and settled private result' USING ERRCODE='23514';END IF;
  END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER parallel_workspace_sources AFTER INSERT ON operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_parallel_workspace_sources();

CREATE FUNCTION validate_parallel_completion_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE effect operations;
BEGIN
 SELECT * INTO effect FROM operations WHERE id=NEW.operation_id;
 IF effect.integration IS NOT NULL AND (effect.kind<>'complete_node' OR effect.state<>'succeeded'
  OR effect.result->'integration'->>'outcome' IS DISTINCT FROM 'integrated' OR effect.attempt_id IS DISTINCT FROM NEW.attempt_id
  OR NOT EXISTS(SELECT 1 FROM completion_manifests m WHERE m.operation_id=effect.id AND m.node_id=NEW.node_id
   AND m.node_activation=NEW.activation AND m.attempt_id=NEW.attempt_id AND m.content_digest=effect.completion_manifest_digest))
 THEN RAISE EXCEPTION 'isolated Node completion requires its exact integrated result' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER parallel_completion_evidence AFTER INSERT ON node_completions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_parallel_completion_evidence();

-- Canonical integrated code and unconsumed private allocations are independent
-- inputs. Physical code provenance does not grant current completion evidence.
CREATE FUNCTION replan_workspace_input_rows(tid text) RETURNS TABLE(workspace_id text,from_lease_id text,input jsonb) LANGUAGE sql STABLE AS $$
 WITH canonical AS (
  SELECT DISTINCT ON(w.id) w.id workspace_id,w.task_id,w.resource_id,w.runner_id,l.id lease_id,l.node_id,l.node_activation,l.attempt_id,a.plan_id,
   o.id operation_id,o.completion_manifest_digest,o.result,false checkpoint
  FROM task_workspaces w JOIN workspace_leases l ON l.workspace_id=w.id JOIN attempts a ON a.id=l.attempt_id
  JOIN operations o ON o.workspace_lease_id=l.id AND o.attempt_id=l.attempt_id AND o.kind='complete_node' AND o.state='succeeded'
  JOIN completion_manifests m ON m.operation_id=o.id AND m.content_digest=o.completion_manifest_digest
  WHERE w.task_id=tid AND w.ever_materialized AND l.state='released' AND o.result->>'writer_absent'='true'
   AND o.result->>'git_commit'=w.finalized_commit AND o.result->'workspace_metadata'->>'finalized_commit'=w.finalized_commit
   AND o.result->>'git_tree' IS NOT NULL AND (o.integration IS NULL OR o.result->'integration'->>'outcome'='integrated')
  ORDER BY w.id,o.created_at DESC,o.id DESC
 ), checkpoints AS (
  SELECT w.id workspace_id,w.task_id,w.resource_id,w.runner_id,l.id lease_id,l.node_id,l.node_activation,l.attempt_id,a.plan_id,
   o.id operation_id,o.completion_manifest_digest,o.result,true checkpoint
  FROM task_workspaces w JOIN workspace_leases l ON l.workspace_id=w.id JOIN attempts a ON a.id=l.attempt_id
  JOIN operations o ON o.id=l.checkpoint->>'operation_id' AND o.workspace_lease_id=l.id AND o.attempt_id=l.attempt_id AND o.state='succeeded'
  WHERE w.task_id=tid AND w.ever_materialized AND l.state='released' AND l.checkpoint IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM node_rework_requests r WHERE r.stop_operation_id=o.id AND r.status='applied')
   AND NOT EXISTS(SELECT 1 FROM workspace_leases later WHERE later.workspace_id=l.workspace_id AND later.allocation_id IS NOT DISTINCT FROM l.allocation_id AND (later.created_at,later.id)>(l.created_at,l.id))
 ), inputs AS (SELECT * FROM canonical UNION ALL SELECT * FROM checkpoints)
 SELECT i.workspace_id,i.lease_id,jsonb_build_object('workspace_id',i.workspace_id,'task_id',i.task_id,'resource_id',i.resource_id,'runner_id',i.runner_id,
  'from_plan_id',i.plan_id,'from_node_id',i.node_id,'from_node_activation',i.node_activation,'from_attempt_id',i.attempt_id,'from_lease_id',i.lease_id,
  'settle_operation_id',i.operation_id,'kind',CASE WHEN i.checkpoint THEN 'checkpoint' ELSE 'completed' END,'metadata',i.result->'workspace_metadata') ||
  CASE WHEN i.checkpoint THEN '{}'::jsonb ELSE jsonb_build_object('completion_operation_id',i.operation_id,'completion_manifest_digest',i.completion_manifest_digest,'finalized_tree',i.result->'git_tree') END
 FROM inputs i ORDER BY i.workspace_id,i.lease_id
$$;

ALTER FUNCTION replan_source_impact(text,text,text) RENAME TO replan_source_impact_serial;
CREATE FUNCTION replan_source_impact(tid text,pid text,rid text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 WITH members AS (
  SELECT n.id,n.activation,c.operation_id FROM plan_nodes pn JOIN nodes n ON n.id=pn.node_id
  LEFT JOIN node_completions c ON c.node_id=n.id AND c.activation=n.activation WHERE pn.task_id=tid AND pn.plan_id=pid
 ), workspaces AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('input',w.input,'target_nodes',CASE WHEN w.input->>'kind'='completed'
   THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('node_id',n.id,'node_activation',n.activation) ORDER BY n.id),'[]'::jsonb) FROM members n)
   ELSE (SELECT COALESCE(jsonb_agg(jsonb_build_object('node_id',n.id,'node_activation',n.activation)),'[]'::jsonb) FROM
    (SELECT n.id,n.activation FROM members n WHERE n.id=w.input->>'from_node_id' OR n.operation_id IS NULL
     ORDER BY (n.id=w.input->>'from_node_id') DESC,n.id LIMIT 1) n) END) ORDER BY w.workspace_id,w.from_lease_id),'[]'::jsonb) body
  FROM replan_workspace_input_rows(tid) w
 ) SELECT jsonb_set(replan_source_impact_serial(tid,pid,rid),'{workspaces}',w.body) FROM workspaces w
$$;

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
  WHERE w->'input'->>'kind'='checkpoint' GROUP BY target->>'node_id' HAVING count(*)>1)
 THEN RAISE EXCEPTION 'multiple private checkpoints cannot share one target' USING ERRCODE='23514';END IF;
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
