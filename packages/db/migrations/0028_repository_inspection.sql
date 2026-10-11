ALTER TABLE operations ADD COLUMN inspection_descriptor jsonb;
ALTER TABLE operations ADD COLUMN inspection_digest text;
ALTER TABLE operations ADD CHECK (
  (inspection_descriptor IS NULL AND inspection_digest IS NULL) OR
  (inspection_descriptor IS NOT NULL AND inspection_digest ~ '^[a-f0-9]{64}$' AND kind='inspect_repository'
    AND workspace_descriptor IS NULL AND workspace_digest IS NULL AND workspace_lease_id IS NULL
    AND repository_free IS NULL AND completion_manifest_digest IS NULL AND completion_operation_id IS NULL)
);

CREATE FUNCTION protect_repository_inspection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d jsonb; p jsonb; a attempts; w task_workspaces; resource project_resources; current_source boolean;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW.inspection_descriptor,NEW.inspection_digest) IS DISTINCT FROM (OLD.inspection_descriptor,OLD.inspection_digest) THEN
      RAISE EXCEPTION 'Inspection descriptor is immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.kind<>'inspect_repository' THEN RETURN NEW; END IF;
  SELECT * INTO a FROM attempts WHERE id=NEW.attempt_id;
  IF NEW.inspection_descriptor IS NULL THEN
    IF NOT EXISTS(SELECT 1 FROM legacy_probe_attempts WHERE attempt_id=a.id) THEN
      RAISE EXCEPTION 'Canonical inspection requires an independent descriptor' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  d:=NEW.inspection_descriptor;p:=d->'planner_source';
  SELECT * INTO resource FROM project_resources WHERE id=NEW.resource_id;
  IF (a.kind='planner' AND a.mutation_allowed AND NOT a.process_released AND NEW.state='admitted'
    AND resource.project_id=d->>'project_id' AND resource.active
    AND resource.repository_identity=d->'resource'->>'repository_identity') IS NOT TRUE THEN
    RAISE EXCEPTION 'Inspection requires a live Planner and active Project repository' USING ERRCODE='23514';
  END IF;
  CASE p->>'kind'
  WHEN 'todo_discussion' THEN
    SELECT EXISTS(SELECT 1 FROM todo_discussion_controls c JOIN todo_discussion_outbox s ON s.source_message_id=p->>'source_id'
      JOIN todos t ON t.id=c.todo_id WHERE c.todo_id=a.todo_id AND s.todo_id=c.todo_id AND s.planned_attempt_id=a.id
      AND t.project_id=resource.project_id AND c.source_message_id=s.source_message_id AND c.desired_attempt_id=a.id
      AND c.version=s.expected_version AND c.version=(p->>'control_version')::bigint
      AND NOT EXISTS(SELECT 1 FROM todo_discussion_resolutions r WHERE r.source_message_id=c.source_message_id)) INTO current_source;
  WHEN 'task_initial_planning' THEN
    SELECT EXISTS(SELECT 1 FROM task_planning_outbox s JOIN tasks t ON t.id=s.task_id
      WHERE s.id=p->>'source_id' AND s.task_id=a.task_id AND s.planned_attempt_id=a.id AND t.project_id=resource.project_id
      AND t.initial_planning_intent_id=s.id AND t.state='RUNNING' AND t.plan_id IS NULL AND t.specification_id=s.specification_id
      AND t.control_version=s.expected_version AND s.preparation_failure IS NULL) INTO current_source;
  WHEN 'task_conversation' THEN
    SELECT EXISTS(SELECT 1 FROM task_conversation_outbox s JOIN tasks t ON t.id=s.task_id JOIN task_inputs i ON i.id=s.input_id
      WHERE s.id=p->>'source_id' AND s.task_id=a.task_id AND s.planned_attempt_id=a.id AND t.project_id=resource.project_id
      AND t.conversation_source_id=s.id AND t.conversation_input_id=s.input_id AND t.conversation_version=s.expected_version
      AND i.status='pending' AND s.preparation_failure IS NULL
      AND NOT EXISTS(SELECT 1 FROM task_input_reconsiderations r WHERE r.input_id=i.id)) INTO current_source;
  WHEN 'task_replan' THEN
    SELECT EXISTS(SELECT 1 FROM replan_sources s JOIN replan_requests r ON r.source_id=s.id JOIN tasks t ON t.id=s.task_id
      WHERE s.id=p->>'source_id' AND s.task_id=a.task_id AND s.planned_attempt_id=a.id AND t.project_id=resource.project_id
      AND r.status='pending' AND r.issue_id IS NULL AND r.proposal_id IS NULL AND t.state='REPLAN_REQUIRED'
      AND t.specification_id=s.specification_id AND t.plan_id=s.plan_id AND t.control_version=s.expected_version
      AND s.preparation_failure IS NULL AND NOT EXISTS(SELECT 1 FROM task_publication_slots slot WHERE slot.task_id=t.id)) INTO current_source;
  WHEN 'task_review' THEN
    SELECT EXISTS(SELECT 1 FROM task_review_sources s JOIN task_review_operations o ON o.source_id=s.id
      JOIN tasks t ON t.id=s.task_id JOIN task_review_feedback f ON f.id=o.feedback_id
      WHERE s.id=p->>'source_id' AND s.task_id=a.task_id AND s.planned_attempt_id=a.id AND t.project_id=resource.project_id
      AND o.status IN('queued','running') AND o.version=(s.source->>'operation_version')::bigint AND NOT o.settlement_pending
      AND t.state='REVIEW' AND t.accepted_delivery_operation_id IS NULL AND t.control_version=(s.source->>'control_version')::bigint
      AND t.specification_id=s.source->>'specification_id' AND t.plan_id=s.source->>'plan_id' AND s.preparation_failure IS NULL
      AND NOT EXISTS(SELECT 1 FROM task_publication_slots slot WHERE slot.task_id=t.id)
      AND (o.purpose='route_feedback' AND f.status='active' AND f.current_operation_id=o.id OR o.purpose='reconsider_input'
        AND EXISTS(SELECT 1 FROM task_input_reconsiderations i WHERE i.id=o.reconsideration_id AND
          (i.operation_id=o.id AND i.status='pending' OR EXISTS(SELECT 1 FROM task_review_input_successors successor WHERE successor.reconsideration_id=i.id AND successor.operation_id=o.id))))) INTO current_source;
  ELSE current_source:=false;
  END CASE;
  IF current_source IS NOT TRUE THEN RAISE EXCEPTION 'Inspection Planner source is not current' USING ERRCODE='23514'; END IF;
  SELECT * INTO w FROM task_workspaces WHERE task_id=a.task_id AND resource_id=NEW.resource_id AND ever_materialized;
  IF w.id IS NULL THEN
    IF d->'origin' IS DISTINCT FROM jsonb_build_object('kind','default_ref') OR d->'resource' IS DISTINCT FROM
      jsonb_strip_nulls(jsonb_build_object('resource_id',resource.id,'repository_identity',resource.repository_identity,'remote_url',resource.remote_url,
        'default_ref',resource.settings->'default_ref','default_branch',resource.settings->'default_branch',
        'provider_metadata',CASE WHEN resource.settings->>'provider'='github' AND resource.settings ? 'provider_repo_id'
          THEN jsonb_build_object('github',jsonb_build_object('repository_id',resource.settings->>'provider_repo_id')) END))
    THEN RAISE EXCEPTION 'Inspection default reference differs from current Project resource' USING ERRCODE='23514'; END IF;
  ELSE
    IF w.runner_id<>a.runner_id OR d->'resource' IS DISTINCT FROM w.resource OR
      (d->'origin'->>'kind'='task_completion' AND d->'origin'->'identity'->>'workspace_id'=w.id
        AND d->'origin'->'identity'->>'git_commit'=w.finalized_commit OR
        d->'origin'->>'kind'='task_open' AND d->'origin'->>'operation_id'=w.materialized_by_operation_id
        AND d->'origin'->'workspace'->>'workspace_id'=w.id AND d->'origin'->'metadata'->>'base_commit'=w.finalized_commit) IS NOT TRUE
    THEN RAISE EXCEPTION 'Inspection must select the latest finalized Task revision on its host' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER repository_inspection_identity BEFORE INSERT OR UPDATE ON operations FOR EACH ROW EXECUTE FUNCTION protect_repository_inspection();

CREATE FUNCTION validate_repository_inspection_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o operations; a attempts; receipt command_receipts; d jsonb; p jsonb; expected_source jsonb; origin jsonb;
  proof operations; original attempts; metadata jsonb; identity jsonb; expected_identity jsonb; manifest completion_manifests;
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
    metadata:=proof.result->'workspace_metadata';
    IF (proof.state='succeeded' AND original.task_id=a.task_id AND original.runner_id=a.runner_id
      AND original.kind='node' AND original.launch ? 'node_execution_source' AND proof.resource_id=o.resource_id
      AND proof.workspace_descriptor->'resource'=d->'resource' AND metadata IS NOT NULL AND NOT metadata ? 'checkpoint') IS NOT TRUE
    THEN RAISE EXCEPTION 'Inspection Task revision lacks canonical finalized provenance' USING ERRCODE='23514'; END IF;
    IF origin->>'kind'='task_open' THEN
      IF (proof.kind='open_workspace' AND origin->'workspace'=proof.workspace_descriptor AND origin->>'workspace_digest'=proof.workspace_digest
        AND origin->'metadata'=metadata AND NOT proof.workspace_descriptor ? 'basis'
        AND metadata->>'base_commit'=metadata->>'finalized_commit'
        AND EXISTS(SELECT 1 FROM task_workspaces w WHERE w.id=proof.workspace_descriptor->>'workspace_id' AND w.materialized_by_operation_id=proof.id)) IS NOT TRUE
      THEN RAISE EXCEPTION 'Inspection initial base differs from original open' USING ERRCODE='23514'; END IF;
    ELSE
      identity:=origin->'identity';
      SELECT * INTO manifest FROM completion_manifests WHERE operation_id=proof.id;
      expected_identity:=jsonb_build_object('task_id',manifest.task_id,'operation_id',proof.id,'attempt_id',original.id,'dispatch_id',original.dispatch_id,
        'node_id',manifest.node_id,'node_activation',manifest.node_activation,'specification_id',manifest.specification_id,'plan_id',manifest.plan_id,
        'manifest_digest',manifest.content_digest,'workspace_id',proof.workspace_descriptor->>'workspace_id','resource_id',proof.resource_id,
        'runner_id',original.runner_id,'storage_id',metadata->>'storage_id','lease_id',metadata->>'lease_id','generation',metadata->'generation',
        'repository_identity',metadata->>'repository_identity','base_commit',metadata->>'base_commit','git_commit',proof.result->>'git_commit','git_tree',proof.result->>'git_tree',
        'operation_identity_digest',encode(sha256(convert_to(review_canonical_json(jsonb_build_object('schema_version',proof.schema_version,
          'operation_id',proof.id,'attempt_id',original.id,'dispatch_id',original.dispatch_id,'request_id',proof.request_id,'kind',proof.kind,
          'resource_id',proof.resource_id,'workspace',proof.workspace_descriptor,'workspace_digest',proof.workspace_digest,'completion_manifest_digest',proof.completion_manifest_digest)),'UTF8')),'hex'));
      IF (proof.kind='complete_node' AND proof.result->>'writer_absent'='true' AND proof.result->>'git_commit'=metadata->>'finalized_commit'
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
CREATE CONSTRAINT TRIGGER repository_inspection_authority AFTER INSERT OR UPDATE ON operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_repository_inspection_authority();
