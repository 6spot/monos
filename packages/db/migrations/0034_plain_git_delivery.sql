-- Plain Git publishes an accepted branch; it never manufactures a GitHub PR or
-- merge operation. The existing accepted membership and receipt chain remain.
CREATE FUNCTION delivery_json_digest(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT encode(sha256(convert_to(review_canonical_json(value),'UTF8')),'hex')
$$;

ALTER TABLE publication_permission_observations ALTER COLUMN repository_id DROP NOT NULL;
ALTER TABLE publication_permission_observations DROP CONSTRAINT publication_permission_observations_check1;
ALTER TABLE publication_permission_observations ADD CONSTRAINT publication_permission_scope CHECK((
 proof->>'observation_id'=id AND proof->>'resource_id'=resource_id AND proof->>'repository_identity'=repository_identity
 AND proof->>'configuration_fingerprint'=configuration_fingerprint AND proof->>'permission_fingerprint'=permission_fingerprint
 AND proof_digest=delivery_json_digest(proof)
 AND ((proof->>'kind'='github_installation' AND repository_id IS NOT NULL AND proof->>'repository_id'=repository_id)
   OR (proof->>'kind'='git_https_configuration' AND repository_id IS NULL AND NOT(proof ?| ARRAY['repository_id','app_id','installation_id','key_fingerprint','permissions'])))
) IS TRUE);

CREATE FUNCTION git_https_permission_scope_current(proof jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM git_https_credentials c JOIN project_resources r ON r.id=c.resource_id
  WHERE r.active AND c.resource_id=proof->>'resource_id' AND c.repository_identity=proof->>'repository_identity'
   AND c.remote_url=proof->>'remote_url' AND c.username=proof->>'username' AND c.scope_digest=proof->>'scope_digest'
   AND r.remote_url=c.remote_url AND r.repository_identity=c.repository_identity
   AND proof->>'kind'='git_https_configuration'
   AND proof->>'permission_fingerprint'=delivery_json_digest(jsonb_build_object('kind','git_https_configuration','scope_digest',c.scope_digest))
   AND proof->>'configuration_fingerprint'=delivery_json_digest(jsonb_build_object('kind','git_https_configuration','resource_id',r.id,'repository_identity',r.repository_identity,'remote_url',r.remote_url,'scope_digest',c.scope_digest))
   AND git_https_credential_receipt_matches(proof->>'configuration_request_id',c.resource_id,c.username,c.scope_digest)
   AND git_https_credential_receipt_matches(c.configuration_request_id,c.resource_id,c.username,c.scope_digest,c.generation))
$$;
CREATE FUNCTION validate_git_https_permission_observation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.proof->>'kind'='git_https_configuration' AND (NOT git_https_permission_scope_current(NEW.proof)
   OR (NEW.proof->>'observed_at')::timestamptz IS DISTINCT FROM NEW.observed_at
   OR (NEW.proof->>'expires_at')::timestamptz IS DISTINCT FROM NEW.expires_at
   OR NEW.expires_at>NEW.observed_at+interval '5 minutes 1 second') THEN
  RAISE EXCEPTION 'Plain Git permission requires a genuine current resource credential receipt' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER git_https_permission_authority AFTER INSERT ON publication_permission_observations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_git_https_permission_observation();

ALTER TABLE remote_preparation_items ADD COLUMN delivery_kind text NOT NULL DEFAULT 'github_pr' CHECK(delivery_kind IN ('github_pr','git_branch'));
ALTER TABLE remote_preparation_items ALTER COLUMN repository_id DROP NOT NULL, ALTER COLUMN marker DROP NOT NULL;
ALTER TABLE remote_preparation_items DROP CONSTRAINT remote_preparation_items_repository_id_delivery_ref_key;
ALTER TABLE remote_preparation_items ADD UNIQUE(repository_identity,delivery_ref);
ALTER TABLE remote_preparation_items ADD CONSTRAINT remote_item_provider_kind CHECK(
 (delivery_kind='github_pr' AND repository_id IS NOT NULL AND marker IS NOT NULL AND repository_identity LIKE 'github.com/%')
 OR (delivery_kind='git_branch' AND repository_id IS NULL AND marker IS NULL AND pr_id IS NULL AND pr_number IS NULL AND repository_identity NOT LIKE 'github.com/%' AND remote_url LIKE 'https://%'));
CREATE OR REPLACE FUNCTION preserve_remote_item_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.item_id,NEW.task_id,NEW.resource_id,NEW.runner_id,NEW.storage_id,NEW.repository_identity,NEW.repository_id,NEW.remote_url,NEW.delivery_ref,NEW.target_branch,NEW.marker,NEW.created_at,NEW.delivery_kind)
 IS DISTINCT FROM (OLD.item_id,OLD.task_id,OLD.resource_id,OLD.runner_id,OLD.storage_id,OLD.repository_identity,OLD.repository_id,OLD.remote_url,OLD.delivery_ref,OLD.target_branch,OLD.marker,OLD.created_at,OLD.delivery_kind)
 OR (OLD.pr_id IS NOT NULL AND (NEW.pr_id,NEW.pr_number) IS DISTINCT FROM (OLD.pr_id,OLD.pr_number))
 OR (OLD.cancel_requested AND NOT NEW.cancel_requested) THEN RAISE EXCEPTION 'Remote item identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION validate_remote_provider_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item remote_preparation_items; r project_resources;
BEGIN
 IF TG_TABLE_NAME='remote_preparation_items' THEN item:=NEW;
 ELSE SELECT * INTO item FROM remote_preparation_items WHERE item_id=NEW.item_id; END IF;
 SELECT * INTO r FROM project_resources WHERE id=item.resource_id;
 IF (r.repository_identity=item.repository_identity AND r.remote_url=item.remote_url
   AND ((item.delivery_kind='github_pr' AND r.settings->>'provider_repo_id'=item.repository_id)
     OR (item.delivery_kind='git_branch' AND NOT(r.settings ?| ARRAY['provider','provider_repo_id','merge_method'])))) IS NOT TRUE THEN
  RAISE EXCEPTION 'Remote destination differs from its configured repository adapter' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='remote_preparation_operations' THEN
  IF NEW.kind='push' THEN
   IF (NEW.request->'provider_metadata'=CASE WHEN item.delivery_kind='github_pr' THEN jsonb_build_object('github',jsonb_build_object('repository_id',item.repository_id)) ELSE '{}'::jsonb END
     AND NEW.request->>'remote_url'=item.remote_url AND NEW.request->>'repository_identity'=item.repository_identity
     AND NEW.request->>'storage_id'=item.storage_id AND NEW.request->>'target_branch'=item.target_branch AND NEW.request->>'delivery_ref'=item.delivery_ref
     AND NEW.request->'permission_proof'->>'kind'=CASE WHEN item.delivery_kind='github_pr' THEN 'github_installation' ELSE 'git_https_configuration' END) IS NOT TRUE THEN
    RAISE EXCEPTION 'Push metadata differs from exact repository destination' USING ERRCODE='23514';
   END IF;
  ELSIF item.delivery_kind<>'github_pr' THEN RAISE EXCEPTION 'Plain Git has no PR operation' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER remote_item_provider_scope AFTER INSERT ON remote_preparation_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_remote_provider_identity();
CREATE CONSTRAINT TRIGGER remote_operation_provider_scope AFTER INSERT ON remote_preparation_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_remote_provider_identity();

ALTER TABLE owner_delivery_observations ADD UNIQUE(id,batch_id,item_id);
ALTER TABLE owner_delivery_finalizations ADD COLUMN kind text NOT NULL DEFAULT 'github_merge' CHECK(kind IN ('github_merge','git_branch'));
ALTER TABLE owner_delivery_finalizations ADD COLUMN observation_id text;
ALTER TABLE owner_delivery_finalizations ALTER COLUMN operation_id DROP NOT NULL;
ALTER TABLE owner_delivery_finalizations ADD FOREIGN KEY(batch_id,item_id) REFERENCES owner_delivery_batch_items(batch_id,item_id);
ALTER TABLE owner_delivery_finalizations ADD FOREIGN KEY(observation_id,batch_id,item_id) REFERENCES owner_delivery_observations(id,batch_id,item_id);
ALTER TABLE owner_delivery_finalizations ADD CONSTRAINT owner_delivery_final_kind CHECK(
 (kind='github_merge' AND operation_id IS NOT NULL AND observation_id IS NULL)
 OR (kind='git_branch' AND operation_id IS NULL AND observation_id IS NOT NULL));

-- A fresh read is correlated to the original settled push. Neither a retained
-- push response nor observation of the remote head proves worker absence alone.
CREATE FUNCTION plain_git_delivery_evidence_valid(batch_identity text,item_identity text,facts jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE b owner_delivery_batches; member owner_delivery_batch_items; item remote_preparation_items;
 op remote_preparation_operations; retained remote_preparation_observations; proof jsonb; refread jsonb; observed jsonb; request jsonb;
BEGIN
 SELECT * INTO b FROM owner_delivery_batches WHERE id=batch_identity;
 SELECT * INTO member FROM owner_delivery_batch_items WHERE batch_id=batch_identity AND item_id=item_identity;
 SELECT * INTO item FROM remote_preparation_items WHERE item_id=item_identity;
 proof:=facts->'published_proof'; refread:=facts->'ref_read'; request:=refread->'request'; observed:=refread->'response'->'observation';
 SELECT * INTO op FROM remote_preparation_operations WHERE id=proof->>'operation_id' AND item_id=item_identity;
 SELECT * INTO retained FROM remote_preparation_observations WHERE id=refread->>'observation_id' AND item_id=item_identity AND kind='ref';
 IF (facts->>'kind'='git_branch' AND facts->>'batch_id'=b.id AND facts->>'content_digest'=b.content_digest
   AND facts->>'item_id'=member.item_id AND facts->>'repository_digest'=member.repository_digest
   AND member.repository_digest=delivery_json_digest(member.repository) AND member.repository->>'delivery_kind'='git_branch'
   AND item.delivery_kind='git_branch' AND item.task_id=b.task_id AND item.resource_id=member.resource_id
   AND member.repository->'provider_metadata'='{}'::jsonb AND member.repository->>'repository_identity'=item.repository_identity
   AND member.repository->>'delivery_ref'=item.delivery_ref AND member.repository->>'target_branch'=item.target_branch
   AND NOT(member.repository ?| ARRAY['marker','provider_content','provider_content_digest','review','merge_method'])
   AND proof=item.last_published_proof AND facts->>'published_proof_digest'=item.last_published_digest
   AND facts->>'published_proof_digest'=delivery_json_digest(proof)
   AND proof->'candidate'=member.repository->'candidate' AND proof->>'candidate_manifest_digest'=member.repository->>'candidate_manifest_digest'
   AND proof->>'candidate_manifest_digest'=delivery_json_digest(proof->'candidate')
   AND proof->>'item_id'=item.item_id AND proof->>'task_id'=item.task_id AND proof->>'resource_id'=item.resource_id
   AND proof->>'runner_id'=item.runner_id AND proof->>'storage_id'=item.storage_id AND proof->>'repository_identity'=item.repository_identity
   AND proof->>'delivery_ref'=item.delivery_ref AND proof->'provider_metadata'='{}'::jsonb
   AND op.kind='push' AND op.state='settled' AND NOT op.effect_owned AND NOT op.active AND op.worker_absent
   AND op.result->'worker_absent'='true'::jsonb AND op.result->>'status' IN ('published','reconciliation_required')
   AND op.request_digest=proof->>'request_digest' AND op.request_digest=delivery_json_digest(op.request)
   AND op.result_digest=proof->>'result_digest' AND op.result_digest=delivery_json_digest(op.result)
   AND op.result->>'operation_id'=op.id AND op.result->>'request_digest'=op.request_digest
   AND op.request->'prepared'->'candidate'=proof->'candidate' AND op.request->>'remote_url'=item.remote_url
   AND proof->'observation'->>'status'='present' AND proof->'observation'->>'head'=proof->'candidate'->>'head'
   AND proof->>'observation_digest'=delivery_json_digest(proof->'observation')
   AND EXISTS(SELECT 1 FROM remote_preparation_observations p WHERE p.operation_id=op.id AND p.item_id=item_identity AND p.kind='published' AND p.observation=proof AND p.digest=facts->>'published_proof_digest')
   AND retained.task_id=b.task_id AND retained.operation_id=op.id AND retained.observation=refread AND retained.digest=delivery_json_digest(refread)
   AND refread->'request'->'schema_version'='1'::jsonb AND length(request->>'request_id')>0
   AND request->'push'=op.request AND request->>'push_request_digest'=op.request_digest
   AND refread->'response'->'request'=request AND refread->'response'->'schema_version'='1'::jsonb AND refread->'response'->'worker_absent'='true'::jsonb
   AND refread->'response'->>'observation_digest'=delivery_json_digest(observed)
   AND observed->>'operation_id'=op.id AND observed->>'item_id'=item.item_id AND observed->>'task_id'=item.task_id
   AND observed->>'resource_id'=item.resource_id AND observed->>'runner_id'=item.runner_id AND observed->>'storage_id'=item.storage_id
   AND observed->>'repository_identity'=item.repository_identity AND observed->'provider_metadata'='{}'::jsonb
   AND observed->>'delivery_ref'=item.delivery_ref AND observed->>'status'='present' AND observed->>'head'=member.repository->'candidate'->>'head'
   AND (refread->>'issued_at')::timestamptz<=(refread->>'received_at')::timestamptz
   AND (refread->>'received_at')::timestamptz<=(refread->>'issued_at')::timestamptz+interval '10 seconds'
   AND (refread->>'received_at')::timestamptz BETWEEN statement_timestamp()-interval '30 seconds' AND statement_timestamp()+interval '1 second'
   AND EXISTS(SELECT 1 FROM runners r WHERE r.id=item.runner_id AND r.incarnation=(refread->>'incarnation')::bigint
     AND r.connection_instance=refread->>'backend_instance' AND r.connected AND r.ready)
   AND member.repository->'scan'->>'status'='complete'
   AND jsonb_typeof(member.repository->'waivers')='array'
   AND EXISTS(SELECT 1 FROM publication_scans scan WHERE scan.id=member.repository->'scan'->>'scan_id'
     AND scan.candidate_id=member.repository->'candidate'->>'candidate_id' AND scan.summary=member.repository->'scan'
     AND scan.digest=member.repository->>'scan_digest' AND scan.digest=delivery_json_digest(scan.summary)
     AND scan.configuration=member.repository->'preparation_request'->'configuration'
     AND scan.effective_basis=member.repository->'effective_basis')
   AND git_https_permission_scope_current(member.repository->'permission_proof')
   AND EXISTS(SELECT 1 FROM publication_permission_observations p WHERE p.id=member.repository->'permission_proof'->>'observation_id' AND p.proof=member.repository->'permission_proof' AND p.proof_digest=member.repository->>'permission_proof_digest')
   AND EXISTS(SELECT 1 FROM delivery_operations local WHERE local.id=member.repository->'preparation_request'->>'operation_id'
     AND local.task_id=b.task_id AND local.resource_id=member.resource_id AND local.state='terminal'
     AND local.request=member.repository->'preparation_request' AND local.request_digest=member.repository->>'preparation_request_digest'
     AND local.result=member.repository->'preparation_result' AND local.result_digest=member.repository->>'preparation_result_digest')
  ) IS NOT TRUE THEN RETURN false; END IF;
 IF (SELECT count(*) FROM publication_findings WHERE scan_id=member.repository->'scan'->>'scan_id')<>(member.repository->'scan'->>'findings_count')::integer
   OR EXISTS(SELECT 1 FROM publication_findings f WHERE f.scan_id=member.repository->'scan'->>'scan_id'
     AND (f.finding->'override_eligible' IS DISTINCT FROM 'true'::jsonb OR NOT EXISTS(
       SELECT 1 FROM jsonb_array_elements(member.repository->'waivers') waiver WHERE waiver->'selection'->'finding_ids' ? f.id))) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(member.repository->'waivers') waiver WHERE NOT EXISTS(
   SELECT 1 FROM publication_override_receipts receipt JOIN authorization_receipts ar ON ar.id=receipt.confirmation_id
   JOIN task_command_proposals proposal ON proposal.id=ar.proposal_id
   JOIN publication_command_receipts command ON command.task_id=receipt.task_id AND command.request_id=receipt.request_id
   WHERE receipt.id=waiver->>'receipt_id' AND receipt.confirmation_id=waiver->>'confirmation_id' AND receipt.task_id=b.task_id
     AND receipt.selection=waiver->'selection' AND receipt.selection_digest=waiver->>'selection_digest'
     AND receipt.selection_digest=delivery_json_digest(receipt.selection) AND receipt.scan_id=member.repository->'scan'->>'scan_id'
     AND receipt.selection->>'candidate_id'=member.repository->'candidate'->>'candidate_id'
     AND receipt.selection->>'candidate_manifest_digest'=member.repository->>'candidate_manifest_digest'
     AND receipt.selection->>'effective_basis_digest'=member.repository->>'effective_basis_digest'
     AND receipt.selection->>'scan_digest'=member.repository->>'scan_digest'
     AND receipt.selection->>'mapping_digest' IS NOT DISTINCT FROM member.repository->>'mapping_digest'
     AND ar.consumed_by=receipt.request_id AND proposal.action='override_publication_findings' AND proposal.task_id=b.task_id
     AND proposal.content=receipt.selection AND proposal.content_digest=receipt.selection_digest
     AND command.envelope->>'name'='override_publication_findings' AND command.envelope->'payload'->>'confirmation_id'=receipt.confirmation_id
     AND (command.envelope->'payload')-'confirmation_id'::text=receipt.selection AND command.response->>'receipt_id'=receipt.id AND command.response->>'status'='committed'
 )) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM remote_published_exposures exposure JOIN remote_preparation_items other ON other.item_id=exposure.item_id
   WHERE other.task_id=b.task_id AND other.resource_id=member.resource_id AND other.repository_identity=item.repository_identity)
   OR EXISTS(SELECT 1 FROM publication_findings finding JOIN publication_scans scan ON scan.id=finding.scan_id
     JOIN publication_candidates candidate ON candidate.id=scan.candidate_id JOIN delivery_items other ON other.id=candidate.item_id
     WHERE other.task_id=b.task_id AND other.resource_id=member.resource_id AND other.repository_identity=item.repository_identity AND finding.finding->>'kind'='published_credential') THEN RETURN false; END IF;
 IF member.repository ? 'mapping' AND NOT EXISTS(SELECT 1 FROM published_result_mappings m WHERE m.operation_id=member.repository->'preparation_request'->>'operation_id'
   AND m.item_id=item.item_id AND m.mapping=member.repository->'mapping' AND m.mapping_digest=member.repository->>'mapping_digest'
   AND m.mapping->'published'=proof AND m.mapping->>'published_digest'=facts->>'published_proof_digest'
   AND m.mapping->'source'=member.repository->'source' AND m.mapping->>'source_digest'=member.repository->>'source_digest'
   AND m.mapping->>'result_tree'=member.repository->'candidate'->>'tree') THEN RETURN false; END IF;
 IF NOT(member.repository ? 'mapping') AND op.request->'preparation'<>member.repository->'preparation_request' THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION validate_owner_delivery_item_validation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE observed owner_delivery_observations;member owner_delivery_batch_items;b owner_delivery_batches;remote remote_preparation_items;fact jsonb;
BEGIN
 SELECT * INTO observed FROM owner_delivery_observations WHERE id=NEW.observation_id;
 SELECT * INTO member FROM owner_delivery_batch_items WHERE batch_id=NEW.batch_id AND item_id=NEW.item_id;
 SELECT * INTO b FROM owner_delivery_batches WHERE id=NEW.batch_id;
 SELECT * INTO remote FROM remote_preparation_items WHERE item_id=NEW.item_id;
 fact:=observed.observation;
 IF (observed.batch_id=b.id AND observed.item_id=member.item_id AND observed.operation_id IS NULL AND observed.kind='readiness'
   AND observed.digest=delivery_json_digest(fact) AND fact->>'batch_id'=b.id AND fact->>'content_digest'=b.content_digest
   AND fact->>'repository_digest'=member.repository_digest) IS NOT TRUE THEN
  RAISE EXCEPTION 'Delivery validation lacks exact accepted repository readiness' USING ERRCODE='23514'; END IF;
 IF remote.delivery_kind='git_branch' THEN
  IF NOT plain_git_delivery_evidence_valid(b.id,member.item_id,fact) THEN RAISE EXCEPTION 'Plain Git validation lacks fresh exact published branch evidence' USING ERRCODE='23514'; END IF;
 ELSE
  IF (member.repository->>'delivery_kind'='github_pr' AND fact->>'scope_fingerprint' ~ '^[a-f0-9]{64}$'
   AND fact->'stage'->>'item_id'=member.item_id AND fact->'stage'->>'phase'='ready'
   AND fact->'stage'->'decision'->>'state'='ready' AND fact->'stage'->'review'->>'head'=member.repository->'candidate'->>'head'
   AND fact->'stage'->'review'->>'content_digest'=member.repository->>'provider_content_digest'
   AND fact->'stage'->'review'->'review'->>'repository_id'=remote.repository_id
   AND fact->'stage'->'review'->'review'->>'pr_id'=remote.pr_id AND fact->'stage'->'review'->'review'->>'pr_number'=remote.pr_number::text
   AND fact->'stage'->'review'->'review'->>'base_ref'=member.repository->>'target_branch'
   AND fact->'stage'->'review'->'review'->>'head_ref'=substring(member.repository->>'delivery_ref' FROM 12)
   AND fact->'stage'->'review'->'review'->>'marker'=member.repository->>'marker' AND fact->>'method' IN('merge','squash','rebase')) IS NOT TRUE
  THEN RAISE EXCEPTION 'Delivery validation lacks exact accepted repository readiness' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION guard_plain_git_finalization() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b owner_delivery_batches;member owner_delivery_batch_items;task tasks;
BEGIN
 IF NEW.kind<>'git_branch' THEN RETURN NEW; END IF;
 PERFORM singleton FROM configuration_control FOR SHARE;
 SELECT * INTO b FROM owner_delivery_batches WHERE id=NEW.batch_id;
 SELECT * INTO task FROM tasks WHERE id=b.task_id FOR UPDATE;
 SELECT * INTO b FROM owner_delivery_batches WHERE id=NEW.batch_id FOR UPDATE;
 SELECT * INTO member FROM owner_delivery_batch_items WHERE batch_id=NEW.batch_id AND item_id=NEW.item_id;
 PERFORM item_id FROM remote_preparation_items WHERE item_id=NEW.item_id FOR UPDATE;
 IF (task.state='REVIEW' AND task.accepted_delivery_operation_id=b.id AND task.accepted_delivery_input_cutoff=b.input_cutoff
   AND task.specification_id=b.manifest->'basis'->>'specification_id' AND task.plan_id=b.manifest->'basis'->>'plan_id'
   AND b.status IN('active','waiting','reconciling') AND member.repository->>'delivery_kind'='git_branch') IS NOT TRUE
   OR EXISTS(SELECT 1 FROM owner_delivery_revocations WHERE batch_id=b.id)
   OR EXISTS(SELECT 1 FROM remote_preparation_items WHERE item_id=NEW.item_id AND cancel_requested) THEN
  RAISE EXCEPTION 'Plain Git finalization requires current uncancelled Owner acceptance' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM owner_delivery_batch_items m WHERE m.batch_id=b.id AND m.repository->>'outcome'='modified'
   AND NOT EXISTS(SELECT 1 FROM owner_delivery_item_validations v WHERE v.batch_id=m.batch_id AND v.item_id=m.item_id)) THEN
  RAISE EXCEPTION 'Every accepted repository requires validation before plain finalization' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM owner_delivery_batch_items m WHERE m.batch_id=b.id AND m.repository->>'outcome'='modified'
   AND m.resource_id COLLATE "C"<member.resource_id COLLATE "C" AND NOT EXISTS(SELECT 1 FROM owner_delivery_finalizations f WHERE f.batch_id=m.batch_id AND f.item_id=m.item_id)) THEN
  RAISE EXCEPTION 'Delivery finalizations must follow stable resource order' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM remote_preparation_operations o WHERE o.item_id=NEW.item_id AND (o.active OR o.effect_owned
   OR o.state='settled' AND o.result->>'status'='reconciliation_required' AND NOT EXISTS(SELECT 1 FROM remote_preparation_observations p WHERE p.operation_id=o.id AND p.kind='published')))
   OR EXISTS(SELECT 1 FROM owner_delivery_merge_operations o WHERE o.batch_id=b.id AND (o.effect_owned OR o.may_have_mutated AND o.status IN('started','unknown'))) THEN
  RAISE EXCEPTION 'Unresolved remote effects prevent plain finalization' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM owner_delivery_batch_items m JOIN project_resources r ON r.id=m.resource_id WHERE m.batch_id=b.id AND m.repository->>'outcome'='modified'
   AND (NOT r.active OR COALESCE(r.settings->>'remote_preparation','automatic') IS DISTINCT FROM m.repository->>'remote_preparation'
     OR m.repository->>'delivery_kind'='git_branch' AND NOT git_https_permission_scope_current(m.repository->'permission_proof')
     OR m.repository->>'delivery_kind'='github_pr' AND (r.settings->>'merge_method' IS DISTINCT FROM m.repository->>'merge_method'
       OR m.repository->'permission_proof'->>'configuration_fingerprint' IS DISTINCT FROM delivery_json_digest(jsonb_build_object(
         'github',(SELECT jsonb_build_object('app_id',g.app_id,'installation_id',g.installation_id,'key_fingerprint',g.key_fingerprint) FROM github_configuration g),
         'repository_identity',r.repository_identity,'provider',r.settings->'provider','provider_repo_id',r.settings->'provider_repo_id'))))) THEN
  RAISE EXCEPTION 'Accepted repository authorization is no longer current' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM attempts a WHERE a.task_id=b.task_id AND NOT a.process_released AND NOT EXISTS(
   SELECT 1 FROM task_conversation_outbox source JOIN task_inputs input ON input.id=source.input_id AND input.task_id=source.task_id
   WHERE source.task_id=a.task_id AND source.planned_attempt_id=a.id AND source.reply_only AND input.accepted_delivery_operation_id=b.id
     AND source.id=a.launch->'task_conversation_source'->>'source_id' AND source.context_digest=a.launch->'task_conversation_source'->>'context_digest'
     AND a.launch->'task_conversation_source'->>'reply_only'='true' AND COALESCE(jsonb_array_length(a.launch->'workspace_reservations'->'resources'),0)=0 AND NOT(a.launch ? 'resource_id')))
   OR EXISTS(SELECT 1 FROM workspace_leases WHERE task_id=b.task_id AND state<>'released')
   OR EXISTS(SELECT 1 FROM operations o JOIN attempts a ON a.id=o.attempt_id WHERE a.task_id=b.task_id AND o.state NOT IN('succeeded','cancelled') AND (o.workspace_descriptor IS NOT NULL OR o.kind IN('open_workspace','complete_node'))) THEN
  RAISE EXCEPTION 'Unsettled workspace ownership prevents plain finalization' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER plain_git_finalization_guard BEFORE INSERT ON owner_delivery_finalizations FOR EACH ROW EXECUTE FUNCTION guard_plain_git_finalization();

CREATE OR REPLACE FUNCTION owner_delivery_effect_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b owner_delivery_batches; i owner_delivery_batch_items; p remote_preparation_operations; m owner_delivery_merge_operations; remote remote_preparation_items; observed owner_delivery_observations;
BEGIN
 SELECT * INTO b FROM owner_delivery_batches WHERE id=NEW.batch_id;
 SELECT * INTO i FROM owner_delivery_batch_items WHERE batch_id=NEW.batch_id AND item_id=NEW.item_id;
 IF TG_TABLE_NAME='owner_delivery_preparation_links' THEN
  SELECT * INTO p FROM remote_preparation_operations WHERE id=NEW.operation_id;
  IF (p.item_id=i.item_id AND p.task_id=b.task_id AND p.request_digest=NEW.request_digest AND p.kind IN ('push','create_pr','update_pr') AND p.request->'preparation'=i.repository->'preparation_request' AND p.request->'prepared'=i.repository->'preparation_result' AND p.request->>'preparation_result_digest'=i.repository->>'preparation_result_digest' AND p.request->'override_receipts'=i.repository->'waivers' AND (p.kind='push' OR p.request->'content'=i.repository->'provider_content')) IS NOT TRUE THEN RAISE EXCEPTION 'Preparation attribution must preserve exact approved request and waivers' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='owner_delivery_merge_operations' THEN
  SELECT * INTO remote FROM remote_preparation_items WHERE item_id=NEW.item_id;
  IF (remote.delivery_kind='github_pr' AND i.repository->>'delivery_kind'='github_pr' AND NEW.request->>'operation_id'=NEW.id AND NEW.request->>'batch_id'=b.id AND NEW.request->>'task_id'=b.task_id AND NEW.request->>'item_id'=i.item_id AND NEW.request->>'content_digest'=b.content_digest AND NEW.request->>'repository_digest'=i.repository_digest AND NEW.request->>'head'=i.repository->'candidate'->>'head' AND NEW.request->>'target_branch'=i.repository->>'target_branch' AND NEW.request->>'merge_method'=NEW.selected_method AND NEW.request->'review'=NEW.request->'intent'->'review' AND NEW.request->'intent'->>'accepted_head'=NEW.request->>'head' AND NEW.request->'intent'->>'delivery_ref'=i.repository->>'delivery_ref' AND NEW.request->'intent'->>'target_branch'=i.repository->>'target_branch' AND NEW.request->'intent'->>'item_id'=i.item_id AND NEW.request->'review'->>'repository_id'=remote.repository_id AND NEW.request->'review'->>'pr_id'=remote.pr_id AND NEW.request->'review'->>'pr_number'=remote.pr_number::text AND NEW.request->'review'->>'head_ref'=substring(remote.delivery_ref FROM 12) AND NEW.request->'review'->>'base_ref'=remote.target_branch AND NEW.request->'review'->>'marker'=remote.marker) IS NOT TRUE THEN RAISE EXCEPTION 'Merge intent lacks exact accepted original PR/head/method' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='git_branch' THEN
  SELECT * INTO observed FROM owner_delivery_observations WHERE id=NEW.observation_id AND batch_id=NEW.batch_id AND item_id=NEW.item_id;
  IF (observed.kind='final' AND observed.operation_id IS NULL AND observed.observation=NEW.fact AND observed.digest=NEW.digest
    AND NEW.digest=delivery_json_digest(NEW.fact) AND NEW.fact->'schema_version'='1'::jsonb AND NEW.fact->>'kind'='git_branch'
    AND NEW.fact->>'batch_id'=b.id AND NEW.fact->>'item_id'=i.item_id AND NEW.fact->>'observation_id'=NEW.observation_id
    AND NEW.fact->>'accepted_head'=i.repository->'candidate'->>'head' AND NEW.fact->>'final_commit'=NEW.final_commit
    AND NEW.final_commit=i.repository->'candidate'->>'head' AND plain_git_delivery_evidence_valid(b.id,i.item_id,NEW.fact->'evidence')
    AND NOT EXISTS(SELECT 1 FROM owner_delivery_item_validations v JOIN owner_delivery_observations certificate ON certificate.id=v.observation_id
      WHERE v.batch_id=b.id AND v.item_id=i.item_id AND certificate.observation->'ref_read'->'request'->>'request_id'=NEW.fact->'evidence'->'ref_read'->'request'->>'request_id')) IS NOT TRUE THEN
   RAISE EXCEPTION 'Plain Git finality lacks fresh exact accepted branch evidence' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO m FROM owner_delivery_merge_operations WHERE id=NEW.operation_id;
  IF (i.repository->>'delivery_kind'='github_pr' AND m.status='succeeded' AND NOT m.effect_owned AND m.result->>'state'='merged' AND m.result->>'final_head'=NEW.final_commit AND NEW.fact->>'batch_id'=b.id AND NEW.fact->>'item_id'=i.item_id AND NEW.fact->>'operation_id'=m.id AND NEW.fact->>'request_digest'=m.request_digest AND NEW.fact->>'accepted_head'=i.repository->'candidate'->>'head' AND NEW.fact->>'requested_method'=m.selected_method AND NEW.fact->>'final_commit'=NEW.final_commit AND NEW.fact->'evidence'=m.result) IS NOT TRUE THEN RAISE EXCEPTION 'Finality lacks exact reconciled merge fact' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
