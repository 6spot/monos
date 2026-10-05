-- Acceptance is actual Owner command authority, never legacy seam attribution.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM tasks WHERE accepted_delivery_operation_id IS NOT NULL OR accepted_delivery_input_cutoff IS NOT NULL)
 OR EXISTS(SELECT 1 FROM task_inputs WHERE accepted_delivery_operation_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Owner delivery migration requires reconciliation of legacy acceptance seam values; no approval can be manufactured' USING ERRCODE='23514';
 END IF;
END $$;
CREATE TABLE owner_delivery_command_receipts (
 task_id text NOT NULL REFERENCES tasks(id), request_id text NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'), envelope jsonb NOT NULL, response jsonb NOT NULL,
 PRIMARY KEY(task_id,request_id),
 CHECK((envelope->>'task_id'=task_id AND envelope->>'request_id'=request_id AND response->>'task_id'=task_id AND response->>'request_id'=request_id AND response->>'status'='committed' AND response->>'name'=envelope->>'name') IS TRUE)
);
CREATE TABLE owner_delivery_proposals (
 proposal_id text PRIMARY KEY REFERENCES task_command_proposals(id), task_id text NOT NULL REFERENCES tasks(id), request_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(task_id,proposal_id), FOREIGN KEY(task_id,request_id) REFERENCES owner_delivery_command_receipts(task_id,request_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE owner_delivery_authorization_commands (
 authorization_id text PRIMARY KEY REFERENCES authorization_receipts(id), task_id text NOT NULL REFERENCES tasks(id), request_id text NOT NULL,
 FOREIGN KEY(task_id,request_id) REFERENCES owner_delivery_command_receipts(task_id,request_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE owner_delivery_batches (
 id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), manifest jsonb NOT NULL,
 content_digest text NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'),
 proposal_id text NOT NULL UNIQUE REFERENCES owner_delivery_proposals(proposal_id), confirmation_id text NOT NULL UNIQUE REFERENCES authorization_receipts(id),
 admission_request_id text NOT NULL, input_cutoff bigint NOT NULL CHECK(input_cutoff BETWEEN 0 AND 9007199254740991),
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','waiting','failed','reconciling','attention','completed','cancelled')),
 version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991), attention_reason text,
 due_at timestamptz NOT NULL DEFAULT clock_timestamp(), checkpoint jsonb,
 UNIQUE(task_id,id), UNIQUE(task_id,id,input_cutoff),
 FOREIGN KEY(task_id,admission_request_id) REFERENCES owner_delivery_command_receipts(task_id,request_id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((manifest->>'task_id'=task_id AND jsonb_typeof(manifest->'outputs')='array' AND jsonb_array_length(manifest->'outputs') BETWEEN 1 AND 256 AND jsonb_typeof(manifest->'repositories')='array' AND jsonb_array_length(manifest->'repositories')<=64) IS TRUE)
);
CREATE UNIQUE INDEX owner_delivery_one_live_batch ON owner_delivery_batches(task_id) WHERE status NOT IN ('completed','cancelled');
CREATE TABLE owner_delivery_batch_items (
 batch_id text NOT NULL REFERENCES owner_delivery_batches(id), ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 63),
 task_id text NOT NULL REFERENCES tasks(id), item_id text, resource_id text NOT NULL REFERENCES project_resources(id),
 repository jsonb NOT NULL, repository_digest text NOT NULL CHECK(repository_digest ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(batch_id,resource_id), UNIQUE(batch_id,ordinal), UNIQUE(batch_id,item_id),
 FOREIGN KEY(task_id,batch_id) REFERENCES owner_delivery_batches(task_id,id),
 FOREIGN KEY(item_id,task_id) REFERENCES remote_preparation_items(item_id,task_id),
 CHECK((repository->>'resource_id'=resource_id AND ((repository->>'outcome'='no_change' AND item_id IS NULL) OR (repository->>'outcome'='modified' AND repository->>'item_id'=item_id))) IS TRUE)
);
CREATE TABLE owner_delivery_preparation_links (
 batch_id text NOT NULL, item_id text NOT NULL, operation_id text PRIMARY KEY REFERENCES remote_preparation_operations(id),
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 FOREIGN KEY(batch_id,item_id) REFERENCES owner_delivery_batch_items(batch_id,item_id)
);
CREATE TABLE owner_delivery_merge_operations (
 id text PRIMARY KEY, batch_id text NOT NULL, item_id text NOT NULL,
 request jsonb NOT NULL, request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 selected_method text NOT NULL CHECK(selected_method IN ('merge','squash','rebase')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','started','unknown','failed','succeeded','cancelled')),
 version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991), claim text, backend_instance text,
 claim_expires_at timestamptz, may_have_mutated boolean NOT NULL DEFAULT false, effect_owned boolean NOT NULL DEFAULT false,
 due_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reason text, result jsonb, result_digest text, checkpoint jsonb,
 UNIQUE(id,batch_id,item_id), FOREIGN KEY(batch_id,item_id) REFERENCES owner_delivery_batch_items(batch_id,item_id)
);
CREATE UNIQUE INDEX owner_delivery_one_merge_owner ON owner_delivery_merge_operations(item_id) WHERE status IN ('pending','started','unknown');
CREATE TABLE owner_delivery_observations (
 id text PRIMARY KEY, batch_id text NOT NULL, item_id text NOT NULL, operation_id text,
 kind text NOT NULL CHECK(kind IN ('readiness','merge','reconcile','final','cleanup')),
 observation jsonb NOT NULL, digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(batch_id,item_id) REFERENCES owner_delivery_batch_items(batch_id,item_id),
 FOREIGN KEY(operation_id,batch_id,item_id) REFERENCES owner_delivery_merge_operations(id,batch_id,item_id)
);
CREATE TABLE owner_delivery_finalizations (
 batch_id text NOT NULL, item_id text NOT NULL, operation_id text NOT NULL,
 final_commit text NOT NULL CHECK(final_commit ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'), finalized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 fact jsonb NOT NULL, digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'), PRIMARY KEY(batch_id,item_id),
 FOREIGN KEY(operation_id,batch_id,item_id) REFERENCES owner_delivery_merge_operations(id,batch_id,item_id)
);
ALTER TABLE tasks ADD FOREIGN KEY(id,accepted_delivery_operation_id,accepted_delivery_input_cutoff)
 REFERENCES owner_delivery_batches(task_id,id,input_cutoff) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE task_inputs ADD FOREIGN KEY(task_id,accepted_delivery_operation_id)
 REFERENCES owner_delivery_batches(task_id,id) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION validate_owner_delivery_authority() RETURNS trigger LANGUAGE plpgsql AS $$
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
   (m.task_id=b.task_id AND m.node_id=e->>'node_id' AND m.content_digest=e->>'completion_manifest_digest' AND e->'completion'=to_jsonb(m) AND o.kind='complete_node' AND o.state='succeeded' AND e->'repository_free'=to_jsonb(COALESCE(o.repository_free,false))
    AND ((COALESCE(o.repository_free,false) AND NOT(e ? 'source') AND NOT(e ? 'source_digest')) OR (NOT COALESCE(o.repository_free,false) AND e->'source'->>'operation_id'=m.operation_id AND e->'source'->>'manifest_digest'=m.content_digest AND e->'source'->>'git_commit'=o.result->>'git_commit' AND e->'source'->>'git_tree'=o.result->>'git_tree' AND e->'source'->>'storage_id'=o.result->'workspace_metadata'->>'storage_id' AND e->'source'->>'workspace_id'=o.workspace_descriptor->>'workspace_id'))
    AND e->'completion'->>'attempt_id'=m.attempt_id AND e->'completion'->>'source_id'=m.source_id AND e->'completion'->>'specification_id'=m.specification_id AND e->'completion'->>'plan_id'=m.plan_id AND e->'completion'->>'summary'=m.summary AND e->'completion'->'artifact_ids'=m.artifact_ids
    AND e->'effective_basis'->>'task_id'=b.task_id AND e->'effective_basis'->>'specification_id'=b.manifest->'basis'->>'specification_id' AND e->'effective_basis'->>'plan_id'=b.manifest->'basis'->>'plan_id' AND e->'effective_basis'->>'completion_operation_id'=m.operation_id AND e->'effective_basis'->>'completion_manifest_digest'=m.content_digest
    AND jsonb_array_length(e->'artifacts')=jsonb_array_length(m.artifact_ids)
    AND (SELECT count(DISTINCT a->>'artifact_id') FROM jsonb_array_elements(e->'artifacts') a)=jsonb_array_length(e->'artifacts')) IS NOT TRUE
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(e->'artifacts') a WHERE NOT EXISTS(SELECT 1 FROM artifacts artifact_row WHERE artifact_row.id=a->>'artifact_id' AND artifact_row.task_id=b.task_id AND artifact_row.node_id=m.node_id AND artifact_row.node_activation=m.node_activation AND m.artifact_ids ? artifact_row.id AND a=jsonb_strip_nulls(jsonb_build_object('artifact_id',artifact_row.id,'task_id',artifact_row.task_id,'node_id',artifact_row.node_id,'node_activation',artifact_row.node_activation,'attempt_id',artifact_row.attempt_id,'specification_id',artifact_row.specification_id,'plan_id',artifact_row.plan_id,'title',artifact_row.title,'media_type',artifact_row.media_type,'size_bytes',artifact_row.size_bytes,'content_digest',artifact_row.content_digest,'references',artifact_row.external_references,'created_at',to_char(artifact_row.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'supersedes',artifact_row.supersedes))))) THEN RAISE EXCEPTION 'Delivery output attribution or selected evidence differs' USING ERRCODE='23514'; END IF;
  IF (SELECT COALESCE(jsonb_agg(resource_id ORDER BY resource_id),'[]'::jsonb) FROM (SELECT DISTINCT e->'source'->>'resource_id' resource_id FROM jsonb_array_elements(b.manifest->'outputs') e WHERE e->'repository_free'='false'::jsonb) resources)
   IS DISTINCT FROM (SELECT COALESCE(jsonb_agg(resource_id ORDER BY resource_id),'[]'::jsonb) FROM (SELECT DISTINCT repository_entry->>'resource_id' resource_id FROM jsonb_array_elements(b.manifest->'repositories') repository_entry) resources) THEN RAISE EXCEPTION 'Delivery repository set differs from Git outputs' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM owner_delivery_batch_items i LEFT JOIN delivery_operations o ON o.id=i.repository->'preparation_request'->>'operation_id' WHERE i.batch_id=b.id AND
   (o.task_id=b.task_id AND o.resource_id=i.resource_id AND o.state='terminal' AND o.request=i.repository->'preparation_request' AND o.request_digest=i.repository->>'preparation_request_digest' AND o.result=i.repository->'preparation_result' AND o.result_digest=i.repository->>'preparation_result_digest' AND o.request->'source'=i.repository->'source' AND o.request->>'source_digest'=i.repository->>'source_digest' AND o.request->'effective_basis'=i.repository->'effective_basis' AND o.request->>'effective_basis_digest'=i.repository->>'effective_basis_digest'
    AND ((i.repository->>'outcome'='no_change' AND o.result->>'status'='not_applicable' AND o.result->>'reason'='no_change') OR (i.repository->>'outcome'='modified' AND o.item_id=i.item_id AND o.result->>'status' IN ('prepared','mapped') AND i.repository->'candidate'=o.result->'candidate' AND i.repository->>'candidate_manifest_digest'=o.result->>'candidate_manifest_digest' AND i.repository->'scan'=o.result->'scan' AND i.repository->>'scan_digest'=o.result->>'scan_digest' AND i.repository->'permission_proof'=o.request->'permission_proof' AND i.repository->>'permission_proof_digest'=o.request->>'permission_proof_digest'))) IS NOT TRUE) THEN RAISE EXCEPTION 'Delivery repository lacks exact retained local preparation' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER owner_delivery_proposal_authority AFTER INSERT ON owner_delivery_proposals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_owner_delivery_authority();
CREATE CONSTRAINT TRIGGER owner_delivery_confirmation_authority AFTER INSERT ON owner_delivery_authorization_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_owner_delivery_authority();
CREATE CONSTRAINT TRIGGER owner_delivery_admission_authority AFTER INSERT ON owner_delivery_batches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_owner_delivery_authority();
CREATE CONSTRAINT TRIGGER owner_delivery_membership_authority AFTER INSERT ON owner_delivery_batch_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_owner_delivery_authority();

CREATE FUNCTION owner_delivery_authorization_owned() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM owner_delivery_proposals WHERE proposal_id=NEW.proposal_id) THEN
  IF NOT EXISTS(SELECT 1 FROM owner_delivery_authorization_commands WHERE authorization_id=NEW.id)
  OR (NEW.consumed_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM owner_delivery_batches WHERE confirmation_id=NEW.id AND admission_request_id=NEW.consumed_by)) THEN RAISE EXCEPTION 'Delivery authorization requires real confirmation and admission provenance' USING ERRCODE='23514'; END IF;
 END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER owner_delivery_authorization_origin AFTER INSERT OR UPDATE ON authorization_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION owner_delivery_authorization_owned();
CREATE FUNCTION owner_delivery_pointer_owned() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.accepted_delivery_operation_id IS NOT NULL THEN
  IF TG_TABLE_NAME='tasks' THEN
   IF NOT EXISTS(SELECT 1 FROM owner_delivery_batches b WHERE b.id=NEW.accepted_delivery_operation_id AND b.task_id=NEW.id AND b.input_cutoff=NEW.accepted_delivery_input_cutoff) THEN RAISE EXCEPTION 'Task acceptance pointer lacks real exact batch' USING ERRCODE='23514'; END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM owner_delivery_batches b JOIN task_messages m ON m.task_id=b.task_id AND m.input_id=NEW.id AND m.author='owner' WHERE b.id=NEW.accepted_delivery_operation_id AND b.task_id=NEW.task_id AND m.sequence>b.input_cutoff) THEN RAISE EXCEPTION 'Later input lacks same Task batch and exact cutoff attribution' USING ERRCODE='23514'; END IF;
  END IF;
 END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER owner_delivery_task_pointer AFTER INSERT OR UPDATE ON tasks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION owner_delivery_pointer_owned();
CREATE CONSTRAINT TRIGGER owner_delivery_input_pointer AFTER INSERT OR UPDATE ON task_inputs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION owner_delivery_pointer_owned();
CREATE FUNCTION preserve_owner_delivery_task_pointer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.accepted_delivery_operation_id IS NOT NULL AND (NEW.accepted_delivery_operation_id,NEW.accepted_delivery_input_cutoff) IS DISTINCT FROM (OLD.accepted_delivery_operation_id,OLD.accepted_delivery_input_cutoff) THEN RAISE EXCEPTION 'Accepted delivery attribution is retained' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER owner_delivery_task_pointer_retained BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION preserve_owner_delivery_task_pointer();
CREATE FUNCTION preserve_owner_delivery_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='task_command_proposals' THEN
  IF EXISTS(SELECT 1 FROM owner_delivery_proposals WHERE proposal_id=OLD.id) AND (TG_OP='DELETE' OR (to_jsonb(NEW)-'revoked') IS DISTINCT FROM (to_jsonb(OLD)-'revoked') OR OLD.revoked AND NOT NEW.revoked) THEN RAISE EXCEPTION 'Delivery proposal identity is immutable' USING ERRCODE='23514'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM owner_delivery_proposals WHERE proposal_id=OLD.proposal_id) AND (TG_OP='DELETE' OR (to_jsonb(NEW)-'consumed_by') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_by') OR OLD.consumed_by IS NOT NULL AND NEW.consumed_by IS DISTINCT FROM OLD.consumed_by) THEN RAISE EXCEPTION 'Delivery confirmation identity is immutable' USING ERRCODE='23514'; END IF;
 END IF; IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER owner_delivery_proposal_identity BEFORE UPDATE OR DELETE ON task_command_proposals FOR EACH ROW EXECUTE FUNCTION preserve_owner_delivery_confirmation();
CREATE TRIGGER owner_delivery_authorization_identity BEFORE UPDATE OR DELETE ON authorization_receipts FOR EACH ROW EXECUTE FUNCTION preserve_owner_delivery_confirmation();

CREATE FUNCTION preserve_owner_delivery_batch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','version','attention_reason','due_at','checkpoint']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','attention_reason','due_at','checkpoint']) THEN RAISE EXCEPTION 'Delivery batch acceptance is immutable' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER owner_delivery_batch_identity BEFORE UPDATE OR DELETE ON owner_delivery_batches FOR EACH ROW EXECUTE FUNCTION preserve_owner_delivery_batch();
CREATE FUNCTION preserve_owner_delivery_merge() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (NEW.id,NEW.batch_id,NEW.item_id,NEW.request,NEW.request_digest,NEW.selected_method,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.batch_id,OLD.item_id,OLD.request,OLD.request_digest,OLD.selected_method,OLD.created_at) OR (OLD.may_have_mutated AND NOT NEW.may_have_mutated) THEN RAISE EXCEPTION 'Merge request and possible effect are immutable' USING ERRCODE='23514'; END IF;
 IF OLD.status IN ('failed','succeeded','cancelled') AND (NEW.status,NEW.result,NEW.result_digest,NEW.reason) IS DISTINCT FROM (OLD.status,OLD.result,OLD.result_digest,OLD.reason) THEN RAISE EXCEPTION 'Terminal merge outcome is immutable' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER owner_delivery_merge_identity BEFORE UPDATE OR DELETE ON owner_delivery_merge_operations FOR EACH ROW EXECUTE FUNCTION preserve_owner_delivery_merge();
CREATE FUNCTION owner_delivery_shared_item_owner() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM item_id FROM remote_preparation_items WHERE item_id=NEW.item_id FOR UPDATE;
 IF TG_TABLE_NAME='owner_delivery_merge_operations' THEN
  IF NEW.status IN ('pending','started','unknown') AND EXISTS(SELECT 1 FROM remote_preparation_operations r WHERE r.item_id=NEW.item_id AND (r.active OR r.effect_owned OR r.state='settled' AND r.result->>'status'='reconciliation_required' AND NOT EXISTS(SELECT 1 FROM remote_preparation_observations p WHERE p.operation_id=r.id AND p.kind='published'))) THEN RAISE EXCEPTION 'Preparation owns delivery item; merge must wait' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.active OR NEW.effect_owned) AND EXISTS(SELECT 1 FROM owner_delivery_merge_operations m WHERE m.item_id=NEW.item_id AND (m.status IN ('pending','started','unknown') OR m.effect_owned)) THEN RAISE EXCEPTION 'Merge owns delivery item; preparation must wait' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER owner_delivery_merge_item_owner BEFORE INSERT OR UPDATE ON owner_delivery_merge_operations FOR EACH ROW EXECUTE FUNCTION owner_delivery_shared_item_owner();
CREATE TRIGGER owner_delivery_preparation_item_owner BEFORE INSERT OR UPDATE ON remote_preparation_operations FOR EACH ROW EXECUTE FUNCTION owner_delivery_shared_item_owner();
CREATE TRIGGER owner_delivery_receipt_immutable BEFORE UPDATE OR DELETE ON owner_delivery_command_receipts FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER owner_delivery_proposal_immutable BEFORE UPDATE OR DELETE ON owner_delivery_proposals FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER owner_delivery_confirmation_immutable BEFORE UPDATE OR DELETE ON owner_delivery_authorization_commands FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER owner_delivery_items_immutable BEFORE UPDATE OR DELETE ON owner_delivery_batch_items FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER owner_delivery_links_immutable BEFORE UPDATE OR DELETE ON owner_delivery_preparation_links FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER owner_delivery_observations_immutable BEFORE UPDATE OR DELETE ON owner_delivery_observations FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER owner_delivery_finals_immutable BEFORE UPDATE OR DELETE ON owner_delivery_finalizations FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE FUNCTION owner_delivery_effect_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b owner_delivery_batches; i owner_delivery_batch_items; p remote_preparation_operations; m owner_delivery_merge_operations; remote remote_preparation_items;
BEGIN
 SELECT * INTO b FROM owner_delivery_batches WHERE id=NEW.batch_id;
 SELECT * INTO i FROM owner_delivery_batch_items WHERE batch_id=NEW.batch_id AND item_id=NEW.item_id;
 IF TG_TABLE_NAME='owner_delivery_preparation_links' THEN
  SELECT * INTO p FROM remote_preparation_operations WHERE id=NEW.operation_id;
  IF (p.item_id=i.item_id AND p.task_id=b.task_id AND p.request_digest=NEW.request_digest AND p.kind IN ('push','create_pr','update_pr') AND p.request->'preparation'=i.repository->'preparation_request' AND p.request->'prepared'=i.repository->'preparation_result' AND p.request->>'preparation_result_digest'=i.repository->>'preparation_result_digest' AND p.request->'override_receipts'=i.repository->'waivers' AND (p.kind='push' OR p.request->'content'=i.repository->'provider_content')) IS NOT TRUE THEN RAISE EXCEPTION 'Preparation attribution must preserve exact approved request and waivers' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='owner_delivery_merge_operations' THEN
  SELECT * INTO remote FROM remote_preparation_items WHERE item_id=NEW.item_id;
  IF (NEW.request->>'operation_id'=NEW.id AND NEW.request->>'batch_id'=b.id AND NEW.request->>'task_id'=b.task_id AND NEW.request->>'item_id'=i.item_id AND NEW.request->>'content_digest'=b.content_digest AND NEW.request->>'repository_digest'=i.repository_digest AND NEW.request->>'head'=i.repository->'candidate'->>'head' AND NEW.request->>'target_branch'=i.repository->>'target_branch' AND NEW.request->>'merge_method'=NEW.selected_method AND NEW.request->'review'=NEW.request->'intent'->'review' AND NEW.request->'intent'->>'accepted_head'=NEW.request->>'head' AND NEW.request->'intent'->>'delivery_ref'=i.repository->>'delivery_ref' AND NEW.request->'intent'->>'target_branch'=i.repository->>'target_branch' AND NEW.request->'intent'->>'item_id'=i.item_id AND NEW.request->'review'->>'repository_id'=remote.repository_id AND NEW.request->'review'->>'pr_id'=remote.pr_id AND NEW.request->'review'->>'pr_number'=remote.pr_number::text AND NEW.request->'review'->>'head_ref'=substring(remote.delivery_ref FROM 12) AND NEW.request->'review'->>'base_ref'=remote.target_branch AND NEW.request->'review'->>'marker'=remote.marker) IS NOT TRUE THEN RAISE EXCEPTION 'Merge intent lacks exact accepted original PR/head/method' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO m FROM owner_delivery_merge_operations WHERE id=NEW.operation_id;
  IF (m.status='succeeded' AND NOT m.effect_owned AND m.result->>'state'='merged' AND m.result->>'final_head'=NEW.final_commit AND NEW.fact->>'batch_id'=b.id AND NEW.fact->>'item_id'=i.item_id AND NEW.fact->>'operation_id'=m.id AND NEW.fact->>'request_digest'=m.request_digest AND NEW.fact->>'accepted_head'=i.repository->'candidate'->>'head' AND NEW.fact->>'requested_method'=m.selected_method AND NEW.fact->>'final_commit'=NEW.final_commit AND NEW.fact->'evidence'=m.result) IS NOT TRUE THEN RAISE EXCEPTION 'Finality lacks exact reconciled merge fact' USING ERRCODE='23514'; END IF;
 END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER owner_delivery_link_scope AFTER INSERT ON owner_delivery_preparation_links DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION owner_delivery_effect_identity();
CREATE CONSTRAINT TRIGGER owner_delivery_merge_scope AFTER INSERT ON owner_delivery_merge_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION owner_delivery_effect_identity();
CREATE CONSTRAINT TRIGGER owner_delivery_final_scope AFTER INSERT ON owner_delivery_finalizations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION owner_delivery_effect_identity();
