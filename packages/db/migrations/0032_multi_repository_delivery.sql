-- Each Node retains one output; all resource results are exact, ordered members.
CREATE FUNCTION completion_result_read_sources(operation_identity text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('source',identity,'source_digest',
   encode(sha256(convert_to(review_canonical_json(identity),'UTF8')),'hex')) ORDER BY resource_id COLLATE "C"),'[]'::jsonb)
 FROM (
  SELECT r.resource_id,jsonb_build_object('task_id',m.task_id,'operation_id',o.id,'attempt_id',a.id,'dispatch_id',a.dispatch_id,
   'node_id',m.node_id,'node_activation',m.node_activation,'specification_id',m.specification_id,'plan_id',m.plan_id,
   'manifest_digest',m.content_digest,'capture',r.result->'capture','workspace_id',r.workspace_id,'resource_id',r.resource_id,
   'runner_id',a.runner_id,'storage_id',r.result->'workspace_metadata'->>'storage_id','lease_id',r.result->'workspace_metadata'->>'lease_id',
   'generation',r.result->'workspace_metadata'->'generation','repository_identity',r.result->'workspace_metadata'->>'repository_identity',
   'base_commit',r.result->'workspace_metadata'->>'base_commit','git_commit',r.result->>'git_commit','git_tree',r.result->>'git_tree',
   'operation_identity_digest',encode(sha256(convert_to(review_canonical_json(completion_operation_identity(o.id)),'UTF8')),'hex')) identity
  FROM operations o JOIN attempts a ON a.id=o.attempt_id JOIN completion_manifests m ON m.operation_id=o.id
  CROSS JOIN LATERAL operation_workspace_results(o.id) r
  WHERE o.id=operation_identity AND o.kind='complete_node' AND o.state='succeeded' AND o.result->>'completion_outcome'='finalized'
 ) sources
$$;

CREATE OR REPLACE FUNCTION validate_owner_delivery_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p task_command_proposals; ar authorization_receipts; c jsonb; r jsonb; b owner_delivery_batches; membership jsonb;
BEGIN
 IF TG_TABLE_NAME='owner_delivery_proposals' THEN
  SELECT * INTO p FROM task_command_proposals WHERE id=NEW.proposal_id;
  SELECT envelope,response INTO c,r FROM owner_delivery_command_receipts WHERE task_id=NEW.task_id AND request_id=NEW.request_id;
  IF (p.task_id=NEW.task_id AND p.action='accept_delivery' AND p.content->>'task_id'=NEW.task_id AND p.content->'basis'=p.basis AND c->>'name'='prepare_delivery_acceptance' AND c->'payload'=jsonb_build_object('basis',p.basis) AND r->>'proposal_id'=p.id AND r->>'content_digest'=p.content_digest) IS NOT TRUE THEN RAISE EXCEPTION 'Delivery proposal lacks exact prepare command receipt' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='owner_delivery_authorization_commands' THEN
  SELECT * INTO ar FROM authorization_receipts WHERE id=NEW.authorization_id;
  SELECT * INTO p FROM task_command_proposals WHERE id=ar.proposal_id;
  SELECT envelope,response INTO c,r FROM owner_delivery_command_receipts WHERE task_id=NEW.task_id AND request_id=NEW.request_id;
  IF (p.task_id=NEW.task_id AND p.action='accept_delivery' AND EXISTS(SELECT 1 FROM owner_delivery_proposals WHERE proposal_id=p.id AND task_id=NEW.task_id) AND c->>'name'='confirm_delivery_acceptance' AND c->'payload'=jsonb_build_object('proposal_id',p.id,'content_digest',p.content_digest) AND r->>'proposal_id'=p.id AND r->>'content_digest'=p.content_digest AND r->>'confirmation_id'=ar.id) IS NOT TRUE THEN RAISE EXCEPTION 'Delivery authorization lacks dedicated exact confirmation' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO b FROM owner_delivery_batches WHERE id=COALESCE(to_jsonb(NEW)->>'batch_id',to_jsonb(NEW)->>'id');
  SELECT * INTO p FROM task_command_proposals WHERE id=b.proposal_id;
  SELECT * INTO ar FROM authorization_receipts WHERE id=b.confirmation_id;
  SELECT envelope,response INTO c,r FROM owner_delivery_command_receipts WHERE task_id=b.task_id AND request_id=b.admission_request_id;
  IF (p.task_id=b.task_id AND p.action='accept_delivery' AND p.content=b.manifest AND p.content_digest=b.content_digest AND ar.proposal_id=p.id AND ar.consumed_by=b.admission_request_id AND EXISTS(SELECT 1 FROM owner_delivery_authorization_commands WHERE authorization_id=ar.id AND task_id=b.task_id) AND c->>'name'='accept_delivery' AND c->'payload'=jsonb_build_object('proposal_id',p.id,'confirmation_id',ar.id,'content_digest',p.content_digest,'basis',p.basis) AND r->>'operation_id'=b.id AND r->>'proposal_id'=p.id AND r->>'confirmation_id'=ar.id AND r->>'content_digest'=b.content_digest AND r->'input_cutoff'=to_jsonb(b.input_cutoff) AND (r->>'operation_version')::bigint=1) IS NOT TRUE THEN RAISE EXCEPTION 'Delivery batch lacks exact consumed Owner admission receipt' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(jsonb_agg(repository ORDER BY ordinal),'[]'::jsonb) INTO membership FROM owner_delivery_batch_items WHERE batch_id=b.id;
  IF membership IS DISTINCT FROM b.manifest->'repositories' THEN RAISE EXCEPTION 'Delivery repository membership is incomplete' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(b.manifest->'outputs'))<>(SELECT count(*) FROM plan_nodes WHERE plan_id=b.manifest->'basis'->>'plan_id' AND task_id=b.task_id)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(b.manifest->'outputs') o WHERE NOT EXISTS(SELECT 1 FROM plan_nodes pn JOIN nodes n ON n.id=pn.node_id JOIN node_completions nc ON nc.node_id=n.id AND nc.activation=n.activation JOIN completion_manifests m ON m.operation_id=nc.operation_id WHERE pn.task_id=b.task_id AND pn.plan_id=b.manifest->'basis'->>'plan_id' AND n.id=o->>'node_id' AND n.activation=(o->>'node_activation')::bigint AND m.operation_id=o->'completion'->>'operation_id' AND m.content_digest=o->>'completion_manifest_digest'))
  OR (SELECT count(DISTINCT o->>'node_id') FROM jsonb_array_elements(b.manifest->'outputs') o)<>jsonb_array_length(b.manifest->'outputs') THEN RAISE EXCEPTION 'Delivery output membership lacks complete canonical completions' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(b.manifest->'outputs') e LEFT JOIN completion_manifests m ON m.operation_id=e->'completion'->>'operation_id' LEFT JOIN operations o ON o.id=m.operation_id WHERE
   (m.task_id=b.task_id AND m.node_id=e->>'node_id' AND m.content_digest=e->>'completion_manifest_digest' AND e->'completion'=to_jsonb(m) AND o.kind='complete_node' AND o.state='succeeded' AND o.result->>'completion_outcome'='finalized' AND e->'repository_free'=to_jsonb(operation_workspace_inputs(o.id)='[]'::jsonb)
    AND e->'sources'=completion_result_read_sources(o.id) AND NOT(e ? 'source' OR e ? 'source_digest')
    AND e->'completion'->>'attempt_id'=m.attempt_id AND e->'completion'->>'source_id'=m.source_id AND e->'completion'->>'specification_id'=m.specification_id AND e->'completion'->>'plan_id'=m.plan_id AND e->'completion'->>'summary'=m.summary AND e->'completion'->'artifact_ids'=m.artifact_ids
    AND e->'effective_basis'->>'task_id'=b.task_id AND e->'effective_basis'->>'specification_id'=b.manifest->'basis'->>'specification_id' AND e->'effective_basis'->>'plan_id'=b.manifest->'basis'->>'plan_id' AND e->'effective_basis'->>'completion_operation_id'=m.operation_id AND e->'effective_basis'->>'completion_manifest_digest'=m.content_digest
    AND jsonb_array_length(e->'artifacts')=jsonb_array_length(m.artifact_ids)
    AND (SELECT count(DISTINCT a->>'artifact_id') FROM jsonb_array_elements(e->'artifacts') a)=jsonb_array_length(e->'artifacts')) IS NOT TRUE
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(e->'artifacts') a WHERE NOT EXISTS(SELECT 1 FROM artifacts artifact_row WHERE artifact_row.id=a->>'artifact_id' AND artifact_row.task_id=b.task_id AND artifact_row.node_id=m.node_id AND artifact_row.node_activation=m.node_activation AND m.artifact_ids ? artifact_row.id AND a=jsonb_strip_nulls(jsonb_build_object('artifact_id',artifact_row.id,'task_id',artifact_row.task_id,'node_id',artifact_row.node_id,'node_activation',artifact_row.node_activation,'attempt_id',artifact_row.attempt_id,'specification_id',artifact_row.specification_id,'plan_id',artifact_row.plan_id,'title',artifact_row.title,'media_type',artifact_row.media_type,'size_bytes',artifact_row.size_bytes,'content_digest',artifact_row.content_digest,'references',artifact_row.external_references,'created_at',to_char(artifact_row.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'supersedes',artifact_row.supersedes))))) THEN RAISE EXCEPTION 'Delivery output attribution or selected evidence differs' USING ERRCODE='23514'; END IF;
  IF (SELECT COALESCE(jsonb_agg(resource_id ORDER BY resource_id),'[]'::jsonb) FROM (SELECT DISTINCT source_entry->'source'->>'resource_id' resource_id FROM jsonb_array_elements(b.manifest->'outputs') e CROSS JOIN LATERAL jsonb_array_elements(e->'sources') source_entry) resources)
   IS DISTINCT FROM (SELECT COALESCE(jsonb_agg(resource_id ORDER BY resource_id),'[]'::jsonb) FROM (SELECT DISTINCT repository_entry->>'resource_id' resource_id FROM jsonb_array_elements(b.manifest->'repositories') repository_entry) resources) THEN RAISE EXCEPTION 'Delivery repository set differs from Git outputs' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM owner_delivery_batch_items i LEFT JOIN delivery_operations o ON o.id=i.repository->'preparation_request'->>'operation_id' WHERE i.batch_id=b.id AND
   (o.task_id=b.task_id AND o.resource_id=i.resource_id AND o.state='terminal' AND o.request=i.repository->'preparation_request' AND o.request_digest=i.repository->>'preparation_request_digest' AND o.result=i.repository->'preparation_result' AND o.result_digest=i.repository->>'preparation_result_digest' AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.manifest->'outputs') output CROSS JOIN LATERAL jsonb_array_elements(output->'sources') source_entry WHERE source_entry->'source'=i.repository->'source' AND source_entry->>'source_digest'=i.repository->>'source_digest') AND o.request->'source'=i.repository->'source' AND o.request->>'source_digest'=i.repository->>'source_digest' AND o.request->'effective_basis'=i.repository->'effective_basis' AND o.request->>'effective_basis_digest'=i.repository->>'effective_basis_digest'
    AND ((i.repository->>'outcome'='no_change' AND o.result->>'status'='not_applicable' AND o.result->>'reason'='no_change') OR (i.repository->>'outcome'='modified' AND o.item_id=i.item_id AND o.result->>'status' IN ('prepared','mapped') AND i.repository->'candidate'=o.result->'candidate' AND i.repository->>'candidate_manifest_digest'=o.result->>'candidate_manifest_digest' AND i.repository->'scan'=o.result->'scan' AND i.repository->>'scan_digest'=o.result->>'scan_digest' AND i.repository->'permission_proof'=o.request->'permission_proof' AND i.repository->>'permission_proof_digest'=o.request->>'permission_proof_digest'))) IS NOT TRUE) THEN RAISE EXCEPTION 'Delivery repository lacks exact retained local preparation' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION validate_task_review_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f task_review_feedback;o task_review_operations;s task_review_sources;c owner_review_command_receipts;v owner_delivery_revocations;b owner_delivery_batches;i task_inputs;msg task_messages;rec task_input_reconsiderations;r command_receipts;decision task_review_decisions;
BEGIN
 IF TG_TABLE_NAME='task_review_feedback' THEN
  SELECT * INTO f FROM task_review_feedback WHERE id=NEW.id;SELECT * INTO c FROM owner_review_command_receipts WHERE task_id=f.task_id AND request_id=f.request_id;
  IF c.digest IS DISTINCT FROM encode(sha256(convert_to(review_canonical_json(c.envelope),'UTF8')),'hex') THEN RAISE EXCEPTION 'Review command digest differs' USING ERRCODE='23514';END IF;
  IF (c.envelope->>'name'='request_changes' AND c.envelope->'payload'->>'feedback_id'=f.id AND c.envelope->'payload'->>'text'=f.text AND c.envelope->'payload'->'basis'=f.basis AND c.response->>'feedback_id'=f.id AND c.response->>'review_result_digest'=f.review_result_digest AND f.manifest->>'task_id'=f.task_id AND f.manifest->>'specification_id'=f.basis->>'specification_id' AND f.manifest->>'plan_id'=f.basis->>'plan_id' AND f.basis->>'review_result_digest'=f.review_result_digest AND jsonb_typeof(f.manifest->'outputs')='array' AND jsonb_array_length(f.manifest->'outputs')>0) IS NOT TRUE THEN RAISE EXCEPTION 'Feedback lacks actual exact Owner review command' USING ERRCODE='23514';END IF;
  IF NOT EXISTS(SELECT 1 FROM tasks current WHERE current.id=f.task_id AND current.state='REVIEW' AND current.specification_id=f.basis->>'specification_id' AND current.plan_id=f.basis->>'plan_id') THEN RAISE EXCEPTION 'Review admission requires effective current revisions' USING ERRCODE='23514';END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(f.manifest->'outputs'))<>(SELECT count(*) FROM plan_nodes WHERE plan_id=f.basis->>'plan_id' AND task_id=f.task_id)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(f.manifest->'outputs') output_or_operation WHERE NOT EXISTS(SELECT 1 FROM plan_nodes pn JOIN nodes n ON n.id=pn.node_id JOIN node_completions nc ON nc.node_id=n.id AND nc.activation=n.activation JOIN completion_manifests m ON m.operation_id=nc.operation_id WHERE pn.task_id=f.task_id AND pn.plan_id=f.basis->>'plan_id' AND n.id=output_or_operation->>'node_id' AND n.state='COMPLETED' AND n.activation=(output_or_operation->>'node_activation')::bigint AND review_completion_applies(m.operation_id,f.basis->>'specification_id',f.basis->>'plan_id') AND m.operation_id=output_or_operation->'completion'->>'operation_id' AND m.content_digest=output_or_operation->>'completion_manifest_digest'))
  OR (SELECT count(DISTINCT output_or_operation->>'node_id') FROM jsonb_array_elements(f.manifest->'outputs') output_or_operation)<>jsonb_array_length(f.manifest->'outputs') THEN RAISE EXCEPTION 'Review output membership lacks complete canonical completions' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(f.manifest->'outputs') e LEFT JOIN completion_manifests m ON m.operation_id=e->'completion'->>'operation_id' LEFT JOIN operations output_or_operation ON output_or_operation.id=m.operation_id WHERE
   (m.task_id=f.task_id AND m.node_id=e->>'node_id' AND m.content_digest=e->>'completion_manifest_digest' AND e->'completion'=to_jsonb(m) AND output_or_operation.kind='complete_node' AND output_or_operation.state='succeeded' AND output_or_operation.result->>'completion_outcome'='finalized' AND e->'repository_free'=to_jsonb(operation_workspace_inputs(output_or_operation.id)='[]'::jsonb)
    AND e->'sources'=completion_result_read_sources(output_or_operation.id) AND NOT(e ? 'source' OR e ? 'source_digest')
    AND e->'completion'->>'attempt_id'=m.attempt_id AND e->'completion'->>'source_id'=m.source_id AND e->'completion'->>'specification_id'=m.specification_id AND e->'completion'->>'plan_id'=m.plan_id AND e->'completion'->>'summary'=m.summary AND e->'completion'->'artifact_ids'=m.artifact_ids
    AND e->'effective_basis'->>'task_id'=f.task_id AND e->'effective_basis'->>'specification_id'=f.basis->>'specification_id' AND e->'effective_basis'->>'plan_id'=f.basis->>'plan_id' AND e->'effective_basis'->>'completion_operation_id'=m.operation_id AND e->'effective_basis'->>'completion_manifest_digest'=m.content_digest
    AND e->>'effective_basis_digest'=encode(sha256(convert_to(review_canonical_json(e->'effective_basis'),'UTF8')),'hex')
    AND jsonb_array_length(e->'artifacts')=jsonb_array_length(m.artifact_ids)
    AND (SELECT count(DISTINCT a->>'artifact_id') FROM jsonb_array_elements(e->'artifacts') a)=jsonb_array_length(e->'artifacts')) IS NOT TRUE
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(e->'artifacts') a WHERE NOT EXISTS(SELECT 1 FROM artifacts artifact_row WHERE artifact_row.id=a->>'artifact_id' AND artifact_row.task_id=f.task_id AND artifact_row.node_id=m.node_id AND artifact_row.node_activation=m.node_activation AND m.artifact_ids ? artifact_row.id AND a=jsonb_strip_nulls(jsonb_build_object('artifact_id',artifact_row.id,'task_id',artifact_row.task_id,'node_id',artifact_row.node_id,'node_activation',artifact_row.node_activation,'attempt_id',artifact_row.attempt_id,'specification_id',artifact_row.specification_id,'plan_id',artifact_row.plan_id,'title',artifact_row.title,'media_type',artifact_row.media_type,'size_bytes',artifact_row.size_bytes,'content_digest',artifact_row.content_digest,'references',artifact_row.external_references,'created_at',to_char(artifact_row.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'supersedes',artifact_row.supersedes))))) THEN RAISE EXCEPTION 'Review output attribution or selected evidence differs' USING ERRCODE='23514'; END IF;

  IF f.review_result_digest IS DISTINCT FROM encode(sha256(convert_to(review_canonical_json(f.manifest),'UTF8')),'hex') OR f.manifest->>'specification_digest' IS DISTINCT FROM (SELECT content_digest FROM specification_revisions WHERE id=f.basis->>'specification_id' AND task_id=f.task_id) OR f.manifest->>'plan_digest' IS DISTINCT FROM (SELECT content_digest FROM plan_revisions WHERE id=f.basis->>'plan_id' AND task_id=f.task_id) THEN RAISE EXCEPTION 'Review canonical manifest digest/revisions differ' USING ERRCODE='23514';END IF;
  IF NOT EXISTS(SELECT 1 FROM task_review_operations current WHERE current.id=f.current_operation_id AND current.feedback_id=f.id AND current.task_id=f.task_id) THEN RAISE EXCEPTION 'Feedback operation attribution differs' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='owner_delivery_revocations' THEN
  v:=NEW;SELECT * INTO c FROM owner_review_command_receipts WHERE task_id=v.task_id AND request_id=v.request_id;SELECT * INTO b FROM owner_delivery_batches WHERE id=v.batch_id;
  IF (c.envelope->>'name'='request_changes' AND c.envelope->'payload'->>'feedback_id'=v.feedback_id AND c.envelope->'payload'->'accepted_batch'->>'operation_id'=b.id AND c.envelope->'payload'->'accepted_batch'->>'content_digest'=b.content_digest AND (c.envelope->'payload'->'accepted_batch'->>'expected_version')::bigint+1=v.batch_version AND c.response->'revoked_batch'=jsonb_build_object('operation_id',b.id,'content_digest',b.content_digest,'operation_version',v.batch_version,'input_cutoff',b.input_cutoff,'revocation_id',v.id) AND b.task_id=v.task_id AND b.content_digest=v.content_digest AND b.input_cutoff=v.input_cutoff AND b.status='revoked') IS NOT TRUE OR EXISTS(SELECT 1 FROM owner_delivery_finalizations fin JOIN owner_delivery_batches previous_batch ON previous_batch.id=fin.batch_id WHERE previous_batch.task_id=v.task_id) OR EXISTS(SELECT 1 FROM owner_delivery_merge_operations m JOIN owner_delivery_batches previous_batch ON previous_batch.id=m.batch_id WHERE previous_batch.task_id=v.task_id AND (m.effect_owned OR m.claim IS NOT NULL OR m.status IN('started','unknown') OR m.may_have_mutated AND (m.status<>'failed' OR m.result->>'state' IS DISTINCT FROM 'rejected' OR m.result_digest IS NULL OR NOT EXISTS(SELECT 1 FROM owner_delivery_observations obs WHERE obs.batch_id=m.batch_id AND obs.item_id=m.item_id AND obs.operation_id=m.id AND obs.kind='merge' AND obs.digest=m.result_digest AND obs.observation=m.result)))) THEN RAISE EXCEPTION 'Revocation lacks exact undelivered Owner authority' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='task_input_reconsiderations' THEN
  SELECT * INTO rec FROM task_input_reconsiderations WHERE id=NEW.id;SELECT * INTO i FROM task_inputs WHERE id=rec.input_id;SELECT * INTO msg FROM task_messages WHERE id=i.message_id;SELECT * INTO v FROM owner_delivery_revocations WHERE id=rec.revocation_id;
  IF (i.task_id=rec.task_id AND i.accepted_delivery_operation_id=rec.accepted_batch_id AND v.batch_id=rec.accepted_batch_id AND v.feedback_id=rec.feedback_id AND msg.sequence=rec.sequence AND msg.sequence>v.input_cutoff AND i.status<>'withdrawn') IS NOT TRUE OR rec.original_reply_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM task_messages reply WHERE reply.id=rec.original_reply_id AND reply.task_id=rec.task_id AND reply.input_id=rec.input_id AND reply.author='assistant') THEN RAISE EXCEPTION 'Reconsideration lacks exact original late input' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='task_review_sources' THEN
  s:=NEW;SELECT * INTO o FROM task_review_operations WHERE id=s.operation_id;
  IF s.prompt IS NOT NULL AND (s.prompt IS DISTINCT FROM review_canonical_json(s.context) OR s.context_digest IS DISTINCT FROM encode(sha256(convert_to(s.prompt,'UTF8')),'hex')) THEN RAISE EXCEPTION 'Review source context digest differs' USING ERRCODE='23514';END IF;
  IF (s.source->>'source_id'=s.id AND s.source->>'operation_id'=o.id AND s.source->>'feedback_id'=o.feedback_id AND s.source->>'purpose'=o.purpose AND s.source->>'review_result_digest'=o.basis->>'review_result_digest' AND s.source->>'specification_id'=o.basis->>'specification_id' AND s.source->>'plan_id'=o.basis->>'plan_id' AND s.source->>'context_digest'=s.context_digest AND (s.source->>'operation_version')::bigint>0 AND (s.source->>'control_version')::bigint>0) IS NOT TRUE OR o.purpose='reconsider_input' AND NOT EXISTS(SELECT 1 FROM task_input_reconsiderations original WHERE original.id=o.reconsideration_id AND s.source->>'reconsideration_id'=original.id AND s.source->>'input_id'=original.input_id) OR o.purpose='route_feedback' AND (s.source ? 'input_id' OR s.source ? 'reconsideration_id') THEN RAISE EXCEPTION 'Review source exact obligation identity differs' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='attempts' THEN
  IF NEW.task_review_source_id IS NULL THEN RETURN NULL;END IF;
  SELECT * INTO s FROM task_review_sources WHERE id=NEW.task_review_source_id;
  IF (NEW.kind='planner' AND NEW.owner_key='planner:'||NEW.task_id AND NEW.launch->'task_review_source'=s.source AND NEW.launch->>'prompt'=s.prompt AND NEW.launch->'source_watermark'='0'::jsonb AND NEW.launch->'workspace_reservations'->'resources'='[]'::jsonb) IS NOT TRUE OR num_nonnulls(NEW.node_id,NEW.todo_id,NEW.planning_intent_id,NEW.node_execution_source_id,NEW.task_conversation_source_id,NEW.replan_source_id)>0 THEN RAISE EXCEPTION 'Review Attempt requires exclusive repository-free source' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='task_review_resolutions' THEN
  SELECT * INTO o FROM task_review_operations WHERE id=NEW.operation_id;
  IF NEW.attempt_id IS NOT NULL THEN
   SELECT * INTO s FROM task_review_sources WHERE id=NEW.source_id;SELECT * INTO r FROM command_receipts WHERE attempt_id=NEW.attempt_id AND scope_id=NEW.task_id AND request_id=NEW.request_id;
   IF (s.operation_id=o.id AND s.planned_attempt_id=NEW.attempt_id AND r.response->>'status'='committed' AND r.response->'result'->>'source_id'=s.id AND r.response->'result'->>'obligation_id'=o.id AND r.command_name IN('apply_review_rework','commit_review_feedback','resolve_review_input','request_replan')) IS NOT TRUE THEN RAISE EXCEPTION 'Review resolution lacks actual source-bound Agent receipt' USING ERRCODE='23514';END IF;

   IF r.command_name='commit_review_feedback' AND NOT EXISTS(SELECT 1 FROM requirement_proposals proposal JOIN task_review_operations origin ON origin.id=proposal.review_operation_id JOIN requirement_attachments attachment ON attachment.proposal_id=proposal.id AND attachment.review_source_id=proposal.review_source_id WHERE proposal.id=NEW.body->>'proposal_id' AND origin.feedback_id=o.feedback_id AND origin.basis->>'specification_id'=o.basis->>'specification_id' AND origin.basis->>'plan_id'=o.basis->>'plan_id' AND origin.basis->>'review_result_digest'=o.basis->>'review_result_digest' AND (proposal.review_source_id=s.id OR origin.purpose='reconsider_input' AND EXISTS(SELECT 1 FROM task_review_resolutions predecessor WHERE predecessor.operation_id=origin.id AND predecessor.source_id=proposal.review_source_id AND predecessor.kind='requirement' AND predecessor.body->'routing'->>'proposal_id'=proposal.id) AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.context->'reconsideration_proposals') frozen WHERE frozen->>'id'=proposal.id AND frozen->>'review_operation_id'=origin.id))) THEN RAISE EXCEPTION 'Requirement adoption lacks genuine exact source ancestry' USING ERRCODE='23514';END IF;
   IF NEW.body->>'request_id' IS DISTINCT FROM r.request_id OR
    (r.command_name='apply_review_rework' AND (NEW.kind IS DISTINCT FROM 'rework' OR NEW.body->'node_ids' IS DISTINCT FROM r.envelope_json::jsonb->'payload'->'node_ids' OR NEW.body->>'reason' IS DISTINCT FROM r.envelope_json::jsonb->'payload'->>'reason')) OR
    (r.command_name='commit_review_feedback' AND (NEW.kind IS DISTINCT FROM 'requirement' OR NEW.body->>'proposal_id' IS DISTINCT FROM r.envelope_json::jsonb->'payload'->>'proposal_id')) OR
    (r.command_name='request_replan' AND (NEW.kind IS DISTINCT FROM 'replan' OR NOT EXISTS(SELECT 1 FROM replan_requests structural WHERE structural.id=NEW.body->>'replan_request_id' AND structural.review_operation_id=o.id AND structural.review_source_id=s.id AND structural.reason=r.envelope_json::jsonb->'payload'->>'reason'))) OR
    (r.command_name='resolve_review_input' AND (NEW.body->>'summary' IS DISTINCT FROM r.envelope_json::jsonb->'payload'->>'summary' OR NEW.body->'routing' IS DISTINCT FROM r.envelope_json::jsonb->'payload'->'routing' OR NEW.kind IS DISTINCT FROM CASE WHEN NEW.body->'routing'->>'kind'='specification_proposal' THEN 'requirement' WHEN NEW.body->'routing'->>'kind'='replan' THEN 'replan' ELSE 'resolved' END)) THEN RAISE EXCEPTION 'Review outcome differs from exact formal command payload' USING ERRCODE='23514';END IF;
  ELSE
   SELECT * INTO c FROM owner_review_command_receipts WHERE task_id=NEW.task_id AND request_id=NEW.request_id;
   IF (NEW.kind='withdrawn' AND c.envelope->>'name' IN('withdraw_review_feedback','withdraw_review_input') AND c.response->>'operation_id'=o.id) IS NOT TRUE THEN RAISE EXCEPTION 'Review resolution lacks actual Owner exit' USING ERRCODE='23514';END IF;
  END IF;
 ELSIF TG_TABLE_NAME='task_review_issues' THEN
  IF NOT EXISTS(SELECT 1 FROM task_review_sources origin JOIN command_receipts receipt ON receipt.attempt_id=origin.planned_attempt_id AND receipt.scope_id=NEW.task_id WHERE origin.id=NEW.source_id AND origin.operation_id=NEW.operation_id AND receipt.command_name='raise_planning_issue' AND receipt.response->>'status'='committed' AND receipt.response->'result'->>'source_id'=origin.id AND receipt.envelope_json::jsonb->'payload'->>'reason'=NEW.reason AND receipt.response->'result'->>'obligation_id'=NEW.id) THEN RAISE EXCEPTION 'Review issue lacks actual source receipt' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='task_review_decisions' THEN
  IF NOT EXISTS(SELECT 1 FROM owner_review_command_receipts receipt WHERE receipt.task_id=NEW.task_id AND receipt.request_id=NEW.request_id AND receipt.envelope->>'name'=NEW.name AND receipt.envelope->'payload'=NEW.body AND receipt.response->>'operation_id'=NEW.operation_id AND receipt.response->'operation_version'=to_jsonb(NEW.operation_version)) AND NOT EXISTS(SELECT 1 FROM owner_command_receipts receipt WHERE receipt.scope_id=NEW.task_id AND receipt.request_id=NEW.request_id AND receipt.envelope_json::jsonb->>'name'=NEW.name AND NEW.name='dismiss_replan') THEN RAISE EXCEPTION 'Review decision lacks original Owner command receipt' USING ERRCODE='23514';END IF;
 END IF;RETURN NULL;
END $$;

-- The batch owns one provider turn; each repository owns its bounded page cache.
CREATE TABLE owner_delivery_item_readiness (
 batch_id text NOT NULL, item_id text NOT NULL, stage jsonb,
 status text NOT NULL DEFAULT 'waiting' CHECK(status IN('waiting','attention')),
 reason text, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(batch_id,item_id), FOREIGN KEY(batch_id,item_id) REFERENCES owner_delivery_batch_items(batch_id,item_id),
 CHECK(stage IS NULL OR (stage->>'item_id'=item_id AND octet_length(stage::text)<=9*1024*1024) IS TRUE)
);
INSERT INTO owner_delivery_item_readiness(batch_id,item_id,stage)
 SELECT b.id,b.checkpoint->'stage'->>'item_id',b.checkpoint->'stage' FROM owner_delivery_batches b
 WHERE b.checkpoint ? 'stage';
UPDATE owner_delivery_batches SET checkpoint=checkpoint-'stage' WHERE checkpoint ? 'stage';

-- A certificate records that every item was actually checked before the first
-- merge. It does not claim simultaneous remote freshness: every PUT rechecks its
-- own current pages, PR bracket, grants, policy and selected merge method.
CREATE TABLE owner_delivery_item_validations (
 batch_id text NOT NULL, item_id text NOT NULL, observation_id text NOT NULL UNIQUE REFERENCES owner_delivery_observations(id),
 PRIMARY KEY(batch_id,item_id), FOREIGN KEY(batch_id,item_id) REFERENCES owner_delivery_batch_items(batch_id,item_id)
);
CREATE TRIGGER owner_delivery_validation_immutable BEFORE UPDATE OR DELETE ON owner_delivery_item_validations FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE FUNCTION validate_owner_delivery_item_validation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE observed owner_delivery_observations;member owner_delivery_batch_items;b owner_delivery_batches;remote remote_preparation_items;fact jsonb;
BEGIN
 SELECT * INTO observed FROM owner_delivery_observations WHERE id=NEW.observation_id;
 SELECT * INTO member FROM owner_delivery_batch_items WHERE batch_id=NEW.batch_id AND item_id=NEW.item_id;
 SELECT * INTO b FROM owner_delivery_batches WHERE id=NEW.batch_id;
 SELECT * INTO remote FROM remote_preparation_items WHERE item_id=NEW.item_id;
 fact:=observed.observation;
 IF (observed.batch_id=b.id AND observed.item_id=member.item_id AND observed.operation_id IS NULL AND observed.kind='readiness'
   AND observed.digest=encode(sha256(convert_to(review_canonical_json(fact),'UTF8')),'hex')
   AND fact->>'batch_id'=b.id AND fact->>'content_digest'=b.content_digest AND fact->>'repository_digest'=member.repository_digest
   AND fact->>'scope_fingerprint' ~ '^[a-f0-9]{64}$' AND fact->'stage'->>'item_id'=member.item_id AND fact->'stage'->>'phase'='ready'
   AND fact->'stage'->'decision'->>'state'='ready' AND fact->'stage'->'review'->>'head'=member.repository->'candidate'->>'head'
   AND fact->'stage'->'review'->>'content_digest'=member.repository->>'provider_content_digest'
   AND fact->'stage'->'review'->'review'->>'repository_id'=remote.repository_id
   AND fact->'stage'->'review'->'review'->>'pr_id'=remote.pr_id AND fact->'stage'->'review'->'review'->>'pr_number'=remote.pr_number::text
   AND fact->'stage'->'review'->'review'->>'base_ref'=member.repository->>'target_branch'
   AND fact->'stage'->'review'->'review'->>'head_ref'=substring(member.repository->>'delivery_ref' FROM 12)
   AND fact->'stage'->'review'->'review'->>'marker'=member.repository->>'marker'
   AND fact->>'method' IN('merge','squash','rebase')) IS NOT TRUE
 THEN RAISE EXCEPTION 'Delivery validation lacks exact accepted repository readiness' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER owner_delivery_validation_authority AFTER INSERT ON owner_delivery_item_validations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_owner_delivery_item_validation();
CREATE FUNCTION guard_owner_delivery_merge_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resource text;
BEGIN
 IF NOT NEW.may_have_mutated OR TG_OP='UPDATE' AND OLD.may_have_mutated THEN RETURN NEW;END IF;
 SELECT resource_id INTO resource FROM owner_delivery_batch_items WHERE batch_id=NEW.batch_id AND item_id=NEW.item_id;
 IF EXISTS(SELECT 1 FROM owner_delivery_batch_items member WHERE member.batch_id=NEW.batch_id AND member.repository->>'outcome'='modified'
   AND NOT EXISTS(SELECT 1 FROM owner_delivery_item_validations validation WHERE validation.batch_id=member.batch_id AND validation.item_id=member.item_id))
 OR NOT EXISTS(SELECT 1 FROM owner_delivery_item_validations validation JOIN owner_delivery_observations observed ON observed.id=validation.observation_id
   WHERE validation.batch_id=NEW.batch_id AND validation.item_id=NEW.item_id AND observed.observation->>'scope_fingerprint'=NEW.request->>'scope_fingerprint')
 THEN RAISE EXCEPTION 'Every accepted repository requires validation before first merge' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM owner_delivery_batch_items member WHERE member.batch_id=NEW.batch_id AND member.repository->>'outcome'='modified'
   AND member.resource_id COLLATE "C" < resource COLLATE "C" AND NOT EXISTS(SELECT 1 FROM owner_delivery_finalizations final WHERE final.batch_id=member.batch_id AND final.item_id=member.item_id))
 THEN RAISE EXCEPTION 'Delivery merges must finalize remaining resources in stable order' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER owner_delivery_merge_barrier BEFORE INSERT OR UPDATE ON owner_delivery_merge_operations FOR EACH ROW EXECUTE FUNCTION guard_owner_delivery_merge_barrier();
