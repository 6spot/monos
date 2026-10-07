-- Add explicit review authority; preserve all prior migration checksums/history.
CREATE TABLE owner_review_command_receipts (
 task_id text NOT NULL REFERENCES tasks(id),request_id text NOT NULL,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 envelope jsonb NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(task_id,request_id),
 CHECK((envelope->>'task_id'=task_id AND envelope->>'request_id'=request_id AND response->>'task_id'=task_id AND response->>'request_id'=request_id AND response->>'status'='committed' AND response->>'name'=envelope->>'name' AND response ? 'operation_id' AND response ? 'feedback_id' AND response ? 'operation_version') IS TRUE)
);
CREATE TABLE task_review_feedback (
 id text PRIMARY KEY,task_id text NOT NULL REFERENCES tasks(id),request_id text NOT NULL,text text NOT NULL CHECK(octet_length(text) BETWEEN 1 AND 65536),basis jsonb NOT NULL,
 manifest jsonb NOT NULL,review_result_digest text NOT NULL CHECK(review_result_digest ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','resolved','withdrawn','cancelled')),current_operation_id text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(task_id,id),FOREIGN KEY(task_id,request_id) REFERENCES owner_review_command_receipts(task_id,request_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX task_one_effective_review ON task_review_feedback(task_id) WHERE status='active';
CREATE TABLE owner_delivery_revocations (
 id text PRIMARY KEY,task_id text NOT NULL,batch_id text NOT NULL UNIQUE,feedback_id text NOT NULL,request_id text NOT NULL,content_digest text NOT NULL,input_cutoff bigint NOT NULL,batch_version bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(task_id,id),FOREIGN KEY(task_id,batch_id) REFERENCES owner_delivery_batches(task_id,id),
 FOREIGN KEY(task_id,feedback_id) REFERENCES task_review_feedback(task_id,id),FOREIGN KEY(task_id,request_id) REFERENCES owner_review_command_receipts(task_id,request_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE task_input_reconsiderations (
 id text PRIMARY KEY,task_id text NOT NULL,feedback_id text NOT NULL,revocation_id text NOT NULL,input_id text NOT NULL,accepted_batch_id text NOT NULL,sequence bigint NOT NULL,original_reply_id text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','transferred','withdrawn','cancelled')),operation_id text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(task_id,id),UNIQUE(revocation_id,input_id),
 FOREIGN KEY(task_id,feedback_id) REFERENCES task_review_feedback(task_id,id),FOREIGN KEY(task_id,revocation_id) REFERENCES owner_delivery_revocations(task_id,id),
 FOREIGN KEY(task_id,input_id) REFERENCES task_inputs(task_id,id),FOREIGN KEY(task_id,accepted_batch_id) REFERENCES owner_delivery_batches(task_id,id),FOREIGN KEY(task_id,original_reply_id) REFERENCES task_messages(task_id,id)
);
CREATE TABLE task_review_operations (
 id text PRIMARY KEY,task_id text NOT NULL,feedback_id text NOT NULL,purpose text NOT NULL CHECK(purpose IN ('route_feedback','reconsider_input')),reconsideration_id text,
 basis jsonb NOT NULL,version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),status text NOT NULL DEFAULT 'settling' CHECK(status IN ('settling','queued','running','issue','failed','rework','replan','requirement','withdrawn','cancelled','resolved')),
 source_id text,previous_source_id text,predecessor_operation_id text,dismissal_request_id text,issue_id text,requirement_proposal_id text,replan_request_id text,
 settlement_pending boolean NOT NULL DEFAULT true,reason text,due_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(task_id,id),FOREIGN KEY(task_id,feedback_id) REFERENCES task_review_feedback(task_id,id),FOREIGN KEY(task_id,reconsideration_id) REFERENCES task_input_reconsiderations(task_id,id),
 FOREIGN KEY(task_id,predecessor_operation_id) REFERENCES task_review_operations(task_id,id),CHECK((purpose='reconsider_input')=(reconsideration_id IS NOT NULL))
);
ALTER TABLE task_review_feedback ADD FOREIGN KEY(task_id,current_operation_id) REFERENCES task_review_operations(task_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE task_input_reconsiderations ADD FOREIGN KEY(task_id,operation_id) REFERENCES task_review_operations(task_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE task_review_sources (
 id text PRIMARY KEY,task_id text NOT NULL,operation_id text NOT NULL,planned_attempt_id text NOT NULL UNIQUE,previous_source_id text,source jsonb NOT NULL,context jsonb,prompt text,context_digest text NOT NULL,
 configuration_version bigint NOT NULL,done boolean NOT NULL DEFAULT false,preparation_failure text,waiting_reason text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),last_checked_at timestamptz NOT NULL DEFAULT 'epoch',
 UNIQUE(task_id,id),UNIQUE(id,planned_attempt_id,task_id),FOREIGN KEY(task_id,operation_id) REFERENCES task_review_operations(task_id,id),FOREIGN KEY(task_id,previous_source_id) REFERENCES task_review_sources(task_id,id),
 CHECK(context_digest ~ '^[a-f0-9]{64}$'),CHECK((prompt IS NULL AND context IS NULL AND preparation_failure IS NOT NULL) OR (prompt IS NOT NULL AND context IS NOT NULL AND preparation_failure IS NULL))
);
ALTER TABLE task_review_operations ADD FOREIGN KEY(task_id,source_id) REFERENCES task_review_sources(task_id,id);
ALTER TABLE task_review_operations ADD FOREIGN KEY(task_id,previous_source_id) REFERENCES task_review_sources(task_id,id);
CREATE TABLE task_review_issues (
 id text PRIMARY KEY,task_id text NOT NULL,operation_id text NOT NULL,source_id text NOT NULL,reason text NOT NULL,version bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(task_id,id),FOREIGN KEY(task_id,operation_id) REFERENCES task_review_operations(task_id,id),FOREIGN KEY(task_id,source_id) REFERENCES task_review_sources(task_id,id)
);
ALTER TABLE task_review_operations ADD FOREIGN KEY(task_id,issue_id) REFERENCES task_review_issues(task_id,id);
CREATE TABLE task_review_decisions (
 task_id text NOT NULL,request_id text NOT NULL,operation_id text NOT NULL,operation_version bigint NOT NULL,name text NOT NULL,body jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(task_id,request_id),
 FOREIGN KEY(task_id,operation_id) REFERENCES task_review_operations(task_id,id)
);
CREATE TABLE task_review_resolutions (
 operation_id text PRIMARY KEY,task_id text NOT NULL,source_id text,attempt_id text,request_id text NOT NULL,kind text NOT NULL,body jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(task_id,operation_id) REFERENCES task_review_operations(task_id,id),FOREIGN KEY(task_id,source_id) REFERENCES task_review_sources(task_id,id),FOREIGN KEY(attempt_id) REFERENCES attempts(id)
);
ALTER TABLE attempts ADD COLUMN task_review_source_id text;
ALTER TABLE attempts ADD FOREIGN KEY(task_review_source_id,id,task_id) REFERENCES task_review_sources(id,planned_attempt_id,task_id);
-- Actual review origins are distinct from Node and Conversation origins.
ALTER TABLE replan_requests ADD COLUMN review_operation_id text;
ALTER TABLE replan_requests ADD COLUMN review_source_id text;
ALTER TABLE replan_requests ADD FOREIGN KEY(task_id,review_operation_id) REFERENCES task_review_operations(task_id,id);
ALTER TABLE replan_requests ADD FOREIGN KEY(task_id,review_source_id) REFERENCES task_review_sources(task_id,id);
DO $$ DECLARE constraint_row record; BEGIN
 FOR constraint_row IN SELECT conname FROM pg_constraint WHERE conrelid='replan_requests'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%origin_node_id IS NOT NULL%' LOOP EXECUTE format('ALTER TABLE replan_requests DROP CONSTRAINT %I',constraint_row.conname);END LOOP;
END $$;
ALTER TABLE replan_requests ADD CHECK(num_nonnulls(origin_node_id,input_id,review_operation_id)=1);
ALTER TABLE replan_requests ADD CHECK((review_operation_id IS NULL)=(review_source_id IS NULL));
ALTER TABLE requirement_proposals ADD COLUMN review_source_id text;
ALTER TABLE requirement_proposals ADD COLUMN review_operation_id text;
ALTER TABLE requirement_attachments ADD COLUMN review_source_id text;
ALTER TABLE requirement_proposals ADD FOREIGN KEY(task_id,review_source_id) REFERENCES task_review_sources(task_id,id);
ALTER TABLE requirement_proposals ADD FOREIGN KEY(task_id,review_operation_id) REFERENCES task_review_operations(task_id,id);
ALTER TABLE requirement_attachments ADD FOREIGN KEY(task_id,review_source_id) REFERENCES task_review_sources(task_id,id);
-- Batch revocation is distinct from Task cancellation.
DO $$ DECLARE constraint_row record; BEGIN
 FOR constraint_row IN SELECT conname FROM pg_constraint WHERE conrelid='owner_delivery_batches'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%status%' LOOP EXECUTE format('ALTER TABLE owner_delivery_batches DROP CONSTRAINT %I',constraint_row.conname);END LOOP;
END $$;
ALTER TABLE owner_delivery_batches ADD CHECK(status IN ('active','waiting','failed','reconciling','attention','completed','cancelled','revoked'));
DROP INDEX owner_delivery_one_live_batch;
CREATE UNIQUE INDEX owner_delivery_one_live_batch ON owner_delivery_batches(task_id) WHERE status NOT IN ('completed','cancelled','revoked');
CREATE OR REPLACE FUNCTION preserve_owner_delivery_task_pointer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.accepted_delivery_operation_id IS NOT NULL AND (NEW.accepted_delivery_operation_id,NEW.accepted_delivery_input_cutoff) IS DISTINCT FROM (OLD.accepted_delivery_operation_id,OLD.accepted_delivery_input_cutoff) THEN
  IF NEW.accepted_delivery_operation_id IS NOT NULL OR NEW.accepted_delivery_input_cutoff IS NOT NULL OR NOT EXISTS(SELECT 1 FROM owner_delivery_revocations v JOIN owner_review_command_receipts c ON c.task_id=v.task_id AND c.request_id=v.request_id JOIN owner_delivery_batches b ON b.id=v.batch_id WHERE v.task_id=OLD.id AND v.batch_id=OLD.accepted_delivery_operation_id AND v.input_cutoff=OLD.accepted_delivery_input_cutoff AND b.status='revoked' AND c.envelope->>'name'='request_changes' AND c.response->'revoked_batch'->>'revocation_id'=v.id AND c.response->'revoked_batch'->>'operation_id'=v.batch_id AND c.response->>'feedback_id'=v.feedback_id)
   THEN RAISE EXCEPTION 'Pointer clear lacks exact Owner revocation' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE FUNCTION preserve_task_review_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Review history is retained' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='task_review_feedback' THEN
  IF (to_jsonb(NEW)-ARRAY['status','current_operation_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','current_operation_id']) OR OLD.status<>'active' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Feedback history is immutable' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='task_review_operations' THEN
  IF (NEW.id,NEW.task_id,NEW.feedback_id,NEW.purpose,NEW.reconsideration_id,NEW.basis,NEW.predecessor_operation_id,NEW.dismissal_request_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.task_id,OLD.feedback_id,OLD.purpose,OLD.reconsideration_id,OLD.basis,OLD.predecessor_operation_id,OLD.dismissal_request_id,OLD.created_at) OR OLD.status IN ('rework','replan','requirement','withdrawn','cancelled','resolved') AND (NEW.status,NEW.requirement_proposal_id,NEW.replan_request_id) IS DISTINCT FROM (OLD.status,OLD.requirement_proposal_id,OLD.replan_request_id) THEN RAISE EXCEPTION 'Review operation identity/outcome is immutable' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='task_input_reconsiderations' THEN
  IF (to_jsonb(NEW)-ARRAY['status','operation_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','operation_id']) OR OLD.status<>'pending' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Input reconsideration history is immutable' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='task_review_sources' THEN
  IF (to_jsonb(NEW)-ARRAY['done','waiting_reason','last_checked_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['done','waiting_reason','last_checked_at']) THEN RAISE EXCEPTION 'Review source is immutable' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER task_review_feedback_retained BEFORE UPDATE OR DELETE ON task_review_feedback FOR EACH ROW EXECUTE FUNCTION preserve_task_review_record();
CREATE TRIGGER task_review_operation_retained BEFORE UPDATE OR DELETE ON task_review_operations FOR EACH ROW EXECUTE FUNCTION preserve_task_review_record();
CREATE TRIGGER task_review_source_retained BEFORE UPDATE OR DELETE ON task_review_sources FOR EACH ROW EXECUTE FUNCTION preserve_task_review_record();
CREATE TRIGGER task_review_input_retained BEFORE UPDATE OR DELETE ON task_input_reconsiderations FOR EACH ROW EXECUTE FUNCTION preserve_task_review_record();
CREATE TRIGGER owner_review_receipt_immutable BEFORE UPDATE OR DELETE ON owner_review_command_receipts FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER owner_delivery_revocation_immutable BEFORE UPDATE OR DELETE ON owner_delivery_revocations FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER task_review_decision_immutable BEFORE UPDATE OR DELETE ON task_review_decisions FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER task_review_resolution_immutable BEFORE UPDATE OR DELETE ON task_review_resolutions FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER task_review_issue_immutable BEFORE UPDATE OR DELETE ON task_review_issues FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TABLE owner_delivery_revocation_settlements (
 revocation_id text PRIMARY KEY,task_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(task_id,revocation_id) REFERENCES owner_delivery_revocations(task_id,id)
);
CREATE TRIGGER review_revocation_settlement_retained BEFORE UPDATE OR DELETE ON owner_delivery_revocation_settlements FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TABLE task_review_input_successors (
 reconsideration_id text NOT NULL,task_id text NOT NULL,operation_id text NOT NULL UNIQUE,predecessor_operation_id text NOT NULL,dismissal_request_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(reconsideration_id,operation_id),FOREIGN KEY(task_id,reconsideration_id) REFERENCES task_input_reconsiderations(task_id,id),FOREIGN KEY(task_id,operation_id) REFERENCES task_review_operations(task_id,id),FOREIGN KEY(task_id,predecessor_operation_id) REFERENCES task_review_operations(task_id,id),FOREIGN KEY(task_id,dismissal_request_id) REFERENCES owner_command_receipts(scope_id,request_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER review_input_successor_retained BEFORE UPDATE OR DELETE ON task_review_input_successors FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
ALTER TABLE requirement_proposals ADD CHECK((review_source_id IS NULL)=(review_operation_id IS NULL));
ALTER TABLE requirement_proposals ADD CHECK(review_source_id IS NULL OR (source_id IS NULL AND input_id IS NULL AND replan_source_id IS NULL));
CREATE OR REPLACE FUNCTION preserve_owner_delivery_task_pointer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.accepted_delivery_operation_id IS NULL AND NEW.accepted_delivery_operation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM owner_delivery_batches b WHERE b.id=NEW.accepted_delivery_operation_id AND b.task_id=NEW.id AND b.status IN('active','waiting') AND NOT EXISTS(SELECT 1 FROM owner_delivery_revocations v WHERE v.batch_id=b.id) AND b.input_cutoff=NEW.accepted_delivery_input_cutoff) THEN RAISE EXCEPTION 'Accepted pointer must install a fresh unrevoked live batch' USING ERRCODE='23514';END IF;
 IF OLD.accepted_delivery_operation_id IS NOT NULL AND (NEW.accepted_delivery_operation_id,NEW.accepted_delivery_input_cutoff) IS DISTINCT FROM (OLD.accepted_delivery_operation_id,OLD.accepted_delivery_input_cutoff) THEN
  IF NEW.accepted_delivery_operation_id IS NOT NULL OR NEW.accepted_delivery_input_cutoff IS NOT NULL OR NOT EXISTS(SELECT 1 FROM owner_delivery_revocations v JOIN owner_review_command_receipts c ON c.task_id=v.task_id AND c.request_id=v.request_id JOIN owner_delivery_batches b ON b.id=v.batch_id WHERE v.task_id=OLD.id AND v.batch_id=OLD.accepted_delivery_operation_id AND v.input_cutoff=OLD.accepted_delivery_input_cutoff AND b.status='revoked' AND c.envelope->>'name'='request_changes' AND c.response->'revoked_batch'->>'revocation_id'=v.id AND c.response->'revoked_batch'->>'operation_id'=v.batch_id AND c.response->>'feedback_id'=v.feedback_id) THEN RAISE EXCEPTION 'Pointer clear lacks exact Owner revocation' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE FUNCTION validate_task_review_authority() RETURNS trigger LANGUAGE plpgsql AS $$
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
   (m.task_id=f.task_id AND m.node_id=e->>'node_id' AND m.content_digest=e->>'completion_manifest_digest' AND e->'completion'=to_jsonb(m) AND output_or_operation.kind='complete_node' AND output_or_operation.state='succeeded' AND e->'repository_free'=to_jsonb(COALESCE(output_or_operation.repository_free,false))
    AND ((COALESCE(output_or_operation.repository_free,false) AND NOT(e ? 'source') AND NOT(e ? 'source_digest')) OR (NOT COALESCE(output_or_operation.repository_free,false) AND e->'source'->>'operation_id'=m.operation_id AND e->'source'->>'manifest_digest'=m.content_digest AND e->'source'->>'git_commit'=output_or_operation.result->>'git_commit' AND e->'source'->>'git_tree'=output_or_operation.result->>'git_tree' AND e->'source'->>'storage_id'=output_or_operation.result->'workspace_metadata'->>'storage_id' AND e->'source'->>'workspace_id'=output_or_operation.workspace_descriptor->>'workspace_id'))
    AND e->'completion'->>'attempt_id'=m.attempt_id AND e->'completion'->>'source_id'=m.source_id AND e->'completion'->>'specification_id'=m.specification_id AND e->'completion'->>'plan_id'=m.plan_id AND e->'completion'->>'summary'=m.summary AND e->'completion'->'artifact_ids'=m.artifact_ids
    AND e->'effective_basis'->>'task_id'=f.task_id AND e->'effective_basis'->>'specification_id'=f.basis->>'specification_id' AND e->'effective_basis'->>'plan_id'=f.basis->>'plan_id' AND e->'effective_basis'->>'completion_operation_id'=m.operation_id AND e->'effective_basis'->>'completion_manifest_digest'=m.content_digest
    AND e->>'effective_basis_digest'=encode(sha256(convert_to(review_canonical_json(e->'effective_basis'),'UTF8')),'hex') AND (COALESCE(output_or_operation.repository_free,false) OR e->>'source_digest'=encode(sha256(convert_to(review_canonical_json(e->'source'),'UTF8')),'hex'))
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
DO $$ DECLARE table_name text;BEGIN FOREACH table_name IN ARRAY ARRAY['task_review_feedback','owner_delivery_revocations','task_input_reconsiderations','task_review_sources','task_review_resolutions','task_review_issues','task_review_decisions'] LOOP EXECUTE format('CREATE CONSTRAINT TRIGGER task_review_authority AFTER INSERT ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_task_review_authority()',table_name);END LOOP;END $$;
CREATE CONSTRAINT TRIGGER task_review_attempt_authority AFTER INSERT OR UPDATE ON attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_task_review_authority();
CREATE FUNCTION validate_review_requirement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p requirement_proposals;s task_review_sources;receipt command_receipts;
BEGIN
 IF TG_TABLE_NAME='requirement_proposals' THEN
  p:=NEW;IF p.review_source_id IS NULL THEN RETURN NULL;END IF;
  SELECT * INTO s FROM task_review_sources WHERE id=p.review_source_id;
  SELECT * INTO receipt FROM command_receipts WHERE attempt_id=s.planned_attempt_id AND scope_id=p.task_id AND command_name='prepare_specification_revision' AND envelope_json::jsonb->'payload'->>'proposal_id'=p.id;
  IF (s.operation_id=p.review_operation_id AND s.task_id=p.task_id AND receipt.response->'result'->>'proposal_id'=p.id AND receipt.response->'result'->>'content_digest'=p.content_digest AND receipt.envelope_json::jsonb->'payload'->>'specification'=p.specification AND receipt.envelope_json::jsonb->'payload'->>'summary'=p.summary AND receipt.envelope_json::jsonb->'payload'->'impact'=p.impact AND receipt.envelope_json::jsonb->'payload'->'basis'=jsonb_build_object('control_version',p.base_control_version,'specification_id',p.base_specification_id,'plan_id',p.base_plan_id) AND EXISTS(SELECT 1 FROM task_command_proposals g WHERE g.id=p.id AND g.content->>'review_source_id'=s.id AND g.content->>'review_operation_id'=s.operation_id)) IS NOT TRUE THEN RAISE EXCEPTION 'Requirement proposal lacks real review source receipt' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='requirement_attachments' THEN
  SELECT * INTO p FROM requirement_proposals WHERE id=NEW.proposal_id;
  IF p.review_source_id IS NULL THEN RETURN NULL;END IF;
  IF (NEW.review_source_id=p.review_source_id AND NEW.source_id IS NULL AND NEW.input_id IS NULL AND EXISTS(SELECT 1 FROM task_review_resolutions outcome WHERE outcome.operation_id=p.review_operation_id AND outcome.source_id=p.review_source_id AND outcome.kind='requirement' AND (outcome.body->>'proposal_id'=p.id OR outcome.body->'routing'->>'proposal_id'=p.id))) IS NOT TRUE THEN RAISE EXCEPTION 'Requirement attachment lacks real terminal review adoption' USING ERRCODE='23514';END IF;
 END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER review_requirement_exact AFTER INSERT ON requirement_proposals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_review_requirement();
CREATE CONSTRAINT TRIGGER review_requirement_attachment_exact AFTER INSERT ON requirement_attachments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_review_requirement();
CREATE FUNCTION validate_review_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o task_review_operations;f task_review_feedback;c owner_review_command_receipts;previous task_review_operations;
BEGIN
 SELECT * INTO o FROM task_review_operations WHERE id=NEW.id;SELECT * INTO f FROM task_review_feedback WHERE id=o.feedback_id;
 IF (o.basis->>'specification_id'=f.basis->>'specification_id' AND o.basis->>'plan_id'=f.basis->>'plan_id' AND o.basis->>'review_result_digest'=f.review_result_digest AND jsonb_typeof(o.basis->'control_version')='number') IS NOT TRUE THEN RAISE EXCEPTION 'Review operation cannot substitute semantic authority' USING ERRCODE='23514';END IF;
 IF o.predecessor_operation_id IS NOT NULL THEN
  SELECT * INTO previous FROM task_review_operations WHERE id=o.predecessor_operation_id;
  IF previous.feedback_id IS DISTINCT FROM o.feedback_id OR previous.purpose IS DISTINCT FROM o.purpose OR previous.reconsideration_id IS DISTINCT FROM o.reconsideration_id OR previous.status NOT IN('replan','requirement') THEN RAISE EXCEPTION 'Review successor requires exact transferred predecessor' USING ERRCODE='23514';END IF;
  IF o.dismissal_request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM replan_requests original JOIN replan_decisions direction ON direction.request_id=original.id JOIN owner_command_receipts owner_receipt ON owner_receipt.scope_id=original.task_id AND owner_receipt.request_id=direction.owner_request_id WHERE original.id=previous.replan_request_id AND original.status='dismissed' AND direction.owner_request_id=o.dismissal_request_id AND direction.kind='dismiss_replan' AND owner_receipt.response->>'review_operation_id'=o.id AND owner_receipt.response->>'review_predecessor_operation_id'=previous.id) THEN RAISE EXCEPTION 'Review successor lacks actual Owner dismissal receipt' USING ERRCODE='23514';END IF;
 ELSIF o.purpose='route_feedback' THEN
  SELECT * INTO c FROM owner_review_command_receipts WHERE task_id=o.task_id AND request_id=f.request_id;
  IF c.response->>'operation_id' IS DISTINCT FROM o.id THEN RAISE EXCEPTION 'Initial feedback operation differs from Owner receipt' USING ERRCODE='23514';END IF;
 ELSIF NOT EXISTS(SELECT 1 FROM task_input_reconsiderations original WHERE original.id=o.reconsideration_id AND original.feedback_id=o.feedback_id AND original.operation_id=o.id) THEN RAISE EXCEPTION 'Input operation lacks original reconsideration owner' USING ERRCODE='23514';END IF;
 IF o.status='requirement' AND NOT EXISTS(SELECT 1 FROM task_review_resolutions outcome WHERE outcome.operation_id=o.id AND outcome.kind='requirement' AND COALESCE(outcome.body->>'proposal_id',outcome.body->'routing'->>'proposal_id')=o.requirement_proposal_id) THEN RAISE EXCEPTION 'Review requirement pointer differs from exact resolution' USING ERRCODE='23514';END IF;
 IF o.status='replan' AND NOT EXISTS(SELECT 1 FROM task_review_resolutions outcome JOIN replan_requests structural ON structural.review_operation_id=o.id AND structural.review_source_id=outcome.source_id WHERE outcome.operation_id=o.id AND outcome.kind='replan' AND structural.id=o.replan_request_id AND (outcome.body->>'replan_request_id'=structural.id OR outcome.body->'routing'->>'kind'='replan' AND outcome.body->'routing'->>'text'=structural.reason)) THEN RAISE EXCEPTION 'Review Replan pointer differs from exact resolution' USING ERRCODE='23514';END IF;
 IF o.source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM task_review_sources current WHERE current.id=o.source_id AND current.operation_id=o.id AND current.source->'operation_version'=to_jsonb(o.version)) THEN RAISE EXCEPTION 'Review operation source version differs' USING ERRCODE='23514';END IF;
 IF o.issue_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM task_review_issues issue WHERE issue.id=o.issue_id AND issue.operation_id=o.id AND issue.source_id=o.source_id) THEN RAISE EXCEPTION 'Review issue belongs to another generation' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER review_operation_exact AFTER INSERT OR UPDATE ON task_review_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_review_operation();

CREATE OR REPLACE FUNCTION validate_replan_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a attempts;r replan_requests;
BEGIN
 SELECT * INTO r FROM replan_requests WHERE id=NEW.id;SELECT * INTO a FROM attempts WHERE id=r.origin_attempt_id;
 IF r.review_operation_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM task_review_sources origin JOIN task_review_resolutions outcome ON outcome.operation_id=origin.operation_id JOIN command_receipts receipt ON receipt.attempt_id=origin.planned_attempt_id AND receipt.request_id=outcome.request_id AND receipt.scope_id=origin.task_id WHERE origin.id=r.review_source_id AND origin.operation_id=r.review_operation_id AND origin.planned_attempt_id=r.origin_attempt_id AND origin.task_id=r.task_id AND outcome.kind='replan' AND (outcome.body->>'replan_request_id'=r.id OR outcome.body->'routing'->>'text'=r.reason) AND receipt.command_name IN('request_replan','resolve_review_input')) THEN RAISE EXCEPTION 'Replan lacks genuine review origin and terminal receipt' USING ERRCODE='23514';END IF;RETURN NULL;
 END IF;
 IF a.task_id IS DISTINCT FROM r.task_id OR (r.origin_node_id IS NOT NULL AND (a.node_id IS DISTINCT FROM r.origin_node_id OR a.node_activation IS DISTINCT FROM r.origin_activation OR a.node_execution_source_id IS NULL OR r.requester_blocker_id IS NULL OR NOT EXISTS(SELECT 1 FROM command_receipts c WHERE c.attempt_id=a.id AND c.scope_id=r.task_id AND c.command_name='request_replan' AND c.envelope_json::jsonb->'payload'->>'reason'=r.reason AND c.response->'result'->'replan_outcome'->>'replan_request_id'=r.id))) OR (r.input_id IS NOT NULL AND (a.task_conversation_source_id IS DISTINCT FROM r.origin_source_id OR NOT EXISTS(SELECT 1 FROM task_input_resolutions x WHERE x.task_id=r.task_id AND x.input_id=r.input_id AND x.source_id=r.origin_source_id AND x.attempt_id=a.id AND x.routing->>'kind'='replan' AND x.routing->>'text'=r.reason))) THEN RAISE EXCEPTION 'Replan request lacks exact terminal source outcome' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE TABLE task_review_settlements (
 operation_id text NOT NULL,task_id text NOT NULL,version bigint NOT NULL,phase text NOT NULL CHECK(phase IN('original','outcome')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(operation_id,version,phase),FOREIGN KEY(task_id,operation_id) REFERENCES task_review_operations(task_id,id)
);
CREATE TRIGGER review_settlement_retained BEFORE UPDATE OR DELETE ON task_review_settlements FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE FUNCTION validate_review_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM attempts a WHERE a.task_id=NEW.task_id AND (a.state='QUEUED' OR NOT a.process_released OR EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN('succeeded','cancelled')))) OR EXISTS(SELECT 1 FROM owner_delivery_merge_operations merging JOIN owner_delivery_batches delivery ON delivery.id=merging.batch_id WHERE delivery.task_id=NEW.task_id AND (merging.effect_owned OR merging.claim IS NOT NULL OR merging.status IN('started','unknown') OR merging.may_have_mutated AND (merging.status<>'failed' OR merging.result->>'state' IS DISTINCT FROM 'rejected' OR NOT EXISTS(SELECT 1 FROM owner_delivery_observations evidence WHERE evidence.operation_id=merging.id AND evidence.kind='merge' AND evidence.digest=merging.result_digest AND evidence.observation=merging.result)))) OR EXISTS(SELECT 1 FROM workspace_leases WHERE task_id=NEW.task_id AND state<>'released') OR EXISTS(SELECT 1 FROM remote_preparation_operations o WHERE o.task_id=NEW.task_id AND (o.effect_owned OR o.kind='push' AND o.state='settled' AND o.result->>'status'='reconciliation_required' AND NOT EXISTS(SELECT 1 FROM remote_preparation_observations proof WHERE proof.operation_id=o.id AND proof.kind='published'))) THEN RAISE EXCEPTION 'Review settlement still has physical/original effects' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER review_settlement_physical BEFORE INSERT ON task_review_settlements FOR EACH ROW EXECUTE FUNCTION validate_review_settlement();
CREATE TRIGGER review_revocation_settlement_physical BEFORE INSERT ON owner_delivery_revocation_settlements FOR EACH ROW EXECUTE FUNCTION validate_review_settlement();
ALTER TABLE task_review_input_successors ADD UNIQUE(predecessor_operation_id);
CREATE FUNCTION validate_review_input_successor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM task_review_operations successor JOIN task_review_operations predecessor ON predecessor.id=NEW.predecessor_operation_id JOIN replan_requests original ON original.id=predecessor.replan_request_id JOIN replan_decisions decision ON decision.request_id=original.id AND decision.owner_request_id=NEW.dismissal_request_id JOIN owner_command_receipts receipt ON receipt.scope_id=NEW.task_id AND receipt.request_id=decision.owner_request_id WHERE successor.id=NEW.operation_id AND successor.task_id=NEW.task_id AND successor.purpose='reconsider_input' AND predecessor.purpose=successor.purpose AND successor.reconsideration_id=NEW.reconsideration_id AND predecessor.reconsideration_id=NEW.reconsideration_id AND successor.feedback_id=predecessor.feedback_id AND successor.predecessor_operation_id=predecessor.id AND successor.dismissal_request_id=NEW.dismissal_request_id AND original.status='dismissed' AND decision.kind='dismiss_replan' AND receipt.response->>'review_operation_id'=successor.id AND receipt.response->>'review_predecessor_operation_id'=predecessor.id) THEN RAISE EXCEPTION 'Input successor lacks exact original dismissal authority' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER review_input_successor_exact AFTER INSERT ON task_review_input_successors DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_review_input_successor();
CREATE FUNCTION validate_review_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation_row task_review_operations;receipt_row owner_review_command_receipts;
BEGIN
 IF TG_TABLE_NAME='task_review_feedback' THEN
  IF NEW.current_operation_id IS DISTINCT FROM OLD.current_operation_id THEN
   IF NOT EXISTS(SELECT 1 FROM task_review_operations owning WHERE owning.id=NEW.current_operation_id AND owning.task_id=NEW.task_id AND owning.feedback_id=NEW.id AND owning.purpose='route_feedback' AND (OLD.current_operation_id IS NULL AND owning.predecessor_operation_id IS NULL OR owning.predecessor_operation_id=OLD.current_operation_id AND (owning.dismissal_request_id IS NOT NULL OR EXISTS(SELECT 1 FROM owner_command_receipts withdrawal JOIN task_review_operations predecessor ON predecessor.id=owning.predecessor_operation_id WHERE withdrawal.scope_id=NEW.task_id AND withdrawal.envelope_json::jsonb->>'name'='withdraw_specification' AND withdrawal.envelope_json::jsonb->'payload'->>'proposal_id'=predecessor.requirement_proposal_id)))) THEN RAISE EXCEPTION 'Feedback owning pointer requires exact authorized successor' USING ERRCODE='23514';END IF;
  END IF;
  IF NEW.status=OLD.status THEN RETURN NULL;END IF;
  IF NEW.status='resolved' AND NOT EXISTS(SELECT 1 FROM task_review_operations owning LEFT JOIN task_review_resolutions result ON result.operation_id=owning.id WHERE owning.id=NEW.current_operation_id AND (owning.status='rework' AND result.kind='rework' OR owning.status='requirement' AND EXISTS(SELECT 1 FROM requirement_publications publication JOIN requirement_changes change ON change.id=publication.change_id WHERE change.proposal_id=owning.requirement_proposal_id))) THEN RAISE EXCEPTION 'Feedback resolution lacks genuine semantic/publication outcome' USING ERRCODE='23514';END IF;
  IF NEW.status='withdrawn' AND NOT EXISTS(SELECT 1 FROM owner_review_command_receipts receipt WHERE receipt.task_id=NEW.task_id AND receipt.envelope->>'name'='withdraw_review_feedback' AND receipt.envelope->'payload'->>'feedback_id'=NEW.id AND receipt.response->>'operation_id'=NEW.current_operation_id) THEN RAISE EXCEPTION 'Feedback withdrawal lacks actual Owner decision' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='task_input_reconsiderations' THEN
  IF NEW.operation_id IS DISTINCT FROM OLD.operation_id AND (OLD.operation_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM task_review_operations original WHERE original.id=NEW.operation_id AND original.task_id=NEW.task_id AND original.feedback_id=NEW.feedback_id AND original.purpose='reconsider_input' AND original.reconsideration_id=NEW.id AND original.predecessor_operation_id IS NULL)) THEN RAISE EXCEPTION 'Original reconsideration operation ownership is immutable' USING ERRCODE='23514';END IF;
  IF NEW.status=OLD.status THEN RETURN NULL;END IF;
  IF NEW.status IN('resolved','transferred') AND NOT EXISTS(SELECT 1 FROM task_review_resolutions result JOIN task_review_operations owning ON owning.id=result.operation_id WHERE owning.id=NEW.operation_id AND owning.reconsideration_id=NEW.id AND result.kind IN('resolved','requirement','replan') AND (NEW.status='resolved' AND result.body->'routing'->>'kind'='reply' OR NEW.status='transferred' AND result.body->'routing'->>'kind' IN('guidance','issue','answer','resolve_guidance','specification_proposal','replan'))) THEN RAISE EXCEPTION 'Reconsideration status lacks its genuine semantic successor' USING ERRCODE='23514';END IF;
  IF NEW.status='withdrawn' AND NOT EXISTS(SELECT 1 FROM owner_review_command_receipts receipt WHERE receipt.task_id=NEW.task_id AND receipt.envelope->>'name'='withdraw_review_input' AND receipt.envelope->'payload'->>'reconsideration_id'=NEW.id) THEN RAISE EXCEPTION 'Input withdrawal lacks actual Owner decision' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='task_review_operations' THEN
  SELECT * INTO operation_row FROM task_review_operations WHERE id=NEW.id;
  IF NEW.source_id IS DISTINCT FROM OLD.source_id OR NEW.previous_source_id IS DISTINCT FROM OLD.previous_source_id THEN
   IF NEW.source_id IS NULL THEN
    IF NEW.version<>OLD.version+1 OR NEW.previous_source_id IS DISTINCT FROM COALESCE(OLD.source_id,OLD.previous_source_id) THEN RAISE EXCEPTION 'Source retirement lacks exact Owner generation transition' USING ERRCODE='23514';END IF;
   ELSIF OLD.source_id IS NOT NULL OR NEW.version<>OLD.version OR NEW.previous_source_id IS DISTINCT FROM OLD.previous_source_id OR NOT EXISTS(SELECT 1 FROM task_review_sources generation WHERE generation.id=NEW.source_id AND generation.operation_id=NEW.id AND generation.previous_source_id IS NOT DISTINCT FROM OLD.previous_source_id AND generation.source->'operation_version'=to_jsonb(NEW.version)) THEN RAISE EXCEPTION 'Source replacement requires immutable exact predecessor generation' USING ERRCODE='23514';END IF;
  END IF;
  IF NEW.version IS DISTINCT FROM OLD.version THEN
   IF NEW.version<>OLD.version+1 OR NOT EXISTS(SELECT 1 FROM owner_review_command_receipts receipt WHERE receipt.task_id=NEW.task_id AND receipt.envelope->'payload'->>'operation_id'=NEW.id AND receipt.envelope->'payload'->'expected_version'=to_jsonb(OLD.version) AND receipt.response->'operation_version'=to_jsonb(NEW.version) AND receipt.envelope->>'name' IN('retry_review_feedback','withdraw_review_feedback','retry_review_input','withdraw_review_input')) AND NOT EXISTS(SELECT 1 FROM tasks terminal WHERE terminal.id=NEW.task_id AND terminal.state='CANCELLED') THEN RAISE EXCEPTION 'Review capability change lacks exact Owner exit' USING ERRCODE='23514';END IF;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
   IF NEW.status IN('rework','replan','requirement','resolved') AND NOT EXISTS(SELECT 1 FROM task_review_resolutions result WHERE result.operation_id=NEW.id AND result.kind=NEW.status) THEN RAISE EXCEPTION 'Review terminal status lacks formal outcome' USING ERRCODE='23514';END IF;
   IF NEW.status='withdrawn' AND NOT EXISTS(SELECT 1 FROM owner_review_command_receipts receipt WHERE receipt.task_id=NEW.task_id AND receipt.response->>'operation_id'=NEW.id AND receipt.envelope->>'name' IN('withdraw_review_feedback','withdraw_review_input')) THEN RAISE EXCEPTION 'Review withdrawal lacks actual command' USING ERRCODE='23514';END IF;
   IF NEW.status='issue' AND NOT EXISTS(SELECT 1 FROM task_review_issues issue WHERE issue.id=NEW.issue_id AND issue.operation_id=NEW.id AND issue.source_id=NEW.source_id) THEN RAISE EXCEPTION 'Review issue attribution differs' USING ERRCODE='23514';END IF;
  END IF;
  IF OLD.settlement_pending AND NOT NEW.settlement_pending AND NOT EXISTS(SELECT 1 FROM task_review_settlements settled WHERE settled.operation_id=NEW.id AND settled.version=NEW.version AND settled.phase=CASE WHEN NEW.status IN('settling','queued','running','failed') THEN 'original' ELSE 'outcome' END) THEN RAISE EXCEPTION 'Review guard cannot clear without original settlement proof' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.status='cancelled' AND NOT EXISTS(SELECT 1 FROM tasks terminal WHERE terminal.id=NEW.task_id AND terminal.state='CANCELLED') THEN RAISE EXCEPTION 'Review cancellation requires terminal Task authority' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER review_feedback_transition AFTER UPDATE ON task_review_feedback DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_review_transition();
CREATE CONSTRAINT TRIGGER review_input_transition AFTER UPDATE ON task_input_reconsiderations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_review_transition();
CREATE CONSTRAINT TRIGGER review_operation_transition AFTER UPDATE ON task_review_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_review_transition();
-- Review identities contain integer counters and JSON strings/arrays/objects.
-- Order public contract keys bytewise; retain every original array element.
CREATE FUNCTION review_canonical_json(value jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result text;
BEGIN
 CASE jsonb_typeof(value)
 WHEN 'object' THEN SELECT '{'||COALESCE(string_agg(to_jsonb(entry.key)::text||':'||review_canonical_json(entry.value),',' ORDER BY entry.key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(value) entry;
 WHEN 'array' THEN SELECT '['||COALESCE(string_agg(review_canonical_json(entry.value),',' ORDER BY entry.ordinality),'')||']' INTO result FROM jsonb_array_elements(value) WITH ORDINALITY entry(value,ordinality);
 ELSE result:=value::text;
 END CASE;RETURN result;
END $$;

CREATE FUNCTION review_completion_applies(operation_id text, specification_id text, plan_id text) RETURNS boolean LANGUAGE sql STABLE STRICT AS $$
 WITH RECURSIVE manifest AS (SELECT * FROM completion_manifests WHERE completion_manifests.operation_id=$1), edges(old_spec,old_plan,new_spec,new_plan) AS (
 SELECT a.parent_id,a.plan_id,a.specification_id,a.plan_id FROM specification_node_applicability a,manifest m WHERE a.task_id=m.task_id AND a.node_id=m.node_id AND a.node_activation=m.node_activation AND a.disposition='carry' AND a.completion_operation_id=m.operation_id AND a.completion_manifest_digest=m.content_digest
 UNION ALL SELECT p.old_specification_id,p.old_plan_id,p.new_specification_id,p.new_plan_id FROM replan_node_applicability a JOIN replan_publications p ON p.id=a.publication_id,manifest m WHERE a.task_id=m.task_id AND a.node_id=m.node_id AND a.node_activation=m.node_activation AND a.target_node_id=m.node_id AND a.target_node_activation=m.node_activation AND a.disposition='carry' AND a.completion_operation_id=m.operation_id AND a.completion_manifest_digest=m.content_digest
 ), path(spec,plan) AS (SELECT m.specification_id,m.plan_id FROM manifest m UNION SELECT e.new_spec,e.new_plan FROM path p JOIN edges e ON e.old_spec=p.spec AND e.old_plan=p.plan)
 SELECT EXISTS(SELECT 1 FROM path WHERE spec=$2 AND plan=$3)
$$;

CREATE FUNCTION require_review_initial_guards() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='task_review_feedback' AND NEW.status<>'active' OR TG_TABLE_NAME='task_input_reconsiderations' AND NEW.status<>'pending' THEN RAISE EXCEPTION 'New review history must retain its initial unresolved guard' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='task_review_operations' THEN
  IF NEW.status<>'settling' OR NEW.version<>1 OR NOT NEW.settlement_pending OR NEW.source_id IS NOT NULL OR NEW.previous_source_id IS NOT NULL OR NEW.issue_id IS NOT NULL OR NEW.requirement_proposal_id IS NOT NULL OR NEW.replan_request_id IS NOT NULL THEN RAISE EXCEPTION 'New review operation requires initial settlement authority' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER review_feedback_initial_guard BEFORE INSERT ON task_review_feedback FOR EACH ROW EXECUTE FUNCTION require_review_initial_guards();
CREATE TRIGGER review_input_initial_guard BEFORE INSERT ON task_input_reconsiderations FOR EACH ROW EXECUTE FUNCTION require_review_initial_guards();
CREATE TRIGGER review_operation_initial_guard BEFORE INSERT ON task_review_operations FOR EACH ROW EXECUTE FUNCTION require_review_initial_guards();
