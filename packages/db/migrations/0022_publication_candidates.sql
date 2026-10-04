ALTER TABLE task_command_proposals DROP CONSTRAINT task_command_proposals_action_check;
ALTER TABLE task_command_proposals ADD CHECK(action IN ('apply_specification_revision','apply_rework','accept_delivery','publish_replan','override_publication_findings'));
ALTER TABLE runners ADD COLUMN publication_supported boolean NOT NULL DEFAULT false;
-- Delivery system work is independent of Attempt operation/outbox ownership.
CREATE TABLE delivery_items (
 id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), resource_id text NOT NULL REFERENCES project_resources(id),
 workspace_id text NOT NULL REFERENCES task_workspaces(id), runner_id text NOT NULL REFERENCES runners(id),
 repository_identity text NOT NULL, target_branch text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(task_id,resource_id), UNIQUE(id,task_id)
);
CREATE TABLE delivery_operations (
 id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), resource_id text NOT NULL REFERENCES project_resources(id),
 workspace_id text NOT NULL REFERENCES task_workspaces(id), runner_id text NOT NULL REFERENCES runners(id),
 item_id text, source_operation_id text NOT NULL REFERENCES operations(id), construction_id text NOT NULL,
 candidate_id text NOT NULL, scan_run_id text NOT NULL UNIQUE, admission_digest text NOT NULL UNIQUE CHECK(admission_digest ~ '^[0-9a-f]{64}$'),
 request jsonb NOT NULL, request_digest text NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','terminal')), dispatch_active boolean NOT NULL DEFAULT true,
 result jsonb, result_digest text, sent_incarnation bigint, last_sent_at timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(item_id,task_id) REFERENCES delivery_items(id,task_id), UNIQUE(id,task_id),
 CHECK((state='terminal')=(result IS NOT NULL AND result_digest IS NOT NULL)),
 CHECK(request->>'operation_id'=id AND request->>'scan_run_id'=scan_run_id),
 CHECK(request->'source'->>'operation_id'=source_operation_id AND request->'source'->>'task_id'=task_id),
 CHECK(request->'source'->>'runner_id'=runner_id AND request->'source'->>'resource_id'=resource_id AND request->'source'->>'workspace_id'=workspace_id),
 CHECK(request->'construction'->>'construction_id'=construction_id AND request->'construction'->>'candidate_id'=candidate_id)
);
CREATE UNIQUE INDEX one_pending_delivery_owner ON delivery_operations(task_id,resource_id) WHERE state='pending' AND dispatch_active;
CREATE TABLE publication_result_pages (
 operation_id text NOT NULL REFERENCES delivery_operations(id), page_index integer NOT NULL CHECK(page_index>=0 AND page_index<4096),
 page jsonb NOT NULL, page_digest text NOT NULL CHECK(page_digest ~ '^[0-9a-f]{64}$'), PRIMARY KEY(operation_id,page_index)
);
CREATE TABLE publication_candidates (
 id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), item_id text NOT NULL,
 construction_id text NOT NULL UNIQUE, construction jsonb NOT NULL, construction_digest text NOT NULL,
 source_operation_id text NOT NULL REFERENCES operations(id), source_digest text NOT NULL,
 manifest jsonb NOT NULL, manifest_digest text NOT NULL CHECK(manifest_digest ~ '^[0-9a-f]{64}$'),
 prepared_operation_id text NOT NULL UNIQUE REFERENCES delivery_operations(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(item_id,task_id) REFERENCES delivery_items(id,task_id), UNIQUE(id,task_id),
 CHECK(manifest->>'candidate_id'=id AND manifest->>'construction_id'=construction_id AND manifest->>'source_digest'=source_digest)
);
CREATE TABLE publication_scans (
 id text PRIMARY KEY, candidate_id text NOT NULL REFERENCES publication_candidates(id), operation_id text NOT NULL UNIQUE REFERENCES delivery_operations(id),
 summary jsonb NOT NULL, digest text NOT NULL UNIQUE CHECK(digest ~ '^[0-9a-f]{64}$'),
 configuration jsonb NOT NULL, configuration_digest text NOT NULL, effective_basis jsonb NOT NULL, effective_basis_digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,candidate_id),
 CHECK(summary->>'scan_id'=id AND summary->>'configuration_digest'=configuration_digest)
);
CREATE TABLE publication_findings (
 scan_id text NOT NULL REFERENCES publication_scans(id), ordinal integer NOT NULL CHECK(ordinal>=0 AND ordinal<4096),
 id text NOT NULL CHECK(id ~ '^[0-9a-f]{64}$'), finding jsonb NOT NULL, PRIMARY KEY(scan_id,id), UNIQUE(scan_id,ordinal),
 CHECK(finding->>'finding_id'=id)
);
CREATE TABLE publication_override_receipts (
 id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), candidate_id text NOT NULL,
 scan_id text NOT NULL, request_id text NOT NULL, confirmation_id text NOT NULL UNIQUE REFERENCES authorization_receipts(id),
 selection jsonb NOT NULL, selection_digest text NOT NULL CHECK(selection_digest ~ '^[0-9a-f]{64}$'), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(candidate_id,task_id) REFERENCES publication_candidates(id,task_id),
 FOREIGN KEY(scan_id,candidate_id) REFERENCES publication_scans(id,candidate_id), UNIQUE(task_id,request_id)
);
CREATE TABLE publication_command_receipts (
 task_id text NOT NULL REFERENCES tasks(id), request_id text NOT NULL, digest text NOT NULL, envelope jsonb NOT NULL, response jsonb NOT NULL,
 PRIMARY KEY(task_id,request_id)
);
CREATE FUNCTION preserve_delivery_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.task_id,NEW.resource_id,NEW.workspace_id,NEW.runner_id,NEW.source_operation_id,NEW.construction_id,NEW.candidate_id,NEW.scan_run_id,NEW.admission_digest,NEW.request,NEW.request_digest,NEW.created_at)
  IS DISTINCT FROM (OLD.id,OLD.task_id,OLD.resource_id,OLD.workspace_id,OLD.runner_id,OLD.source_operation_id,OLD.construction_id,OLD.candidate_id,OLD.scan_run_id,OLD.admission_digest,OLD.request,OLD.request_digest,OLD.created_at)
  OR (OLD.state='terminal' AND NEW IS DISTINCT FROM OLD)
  OR (OLD.item_id IS NOT NULL AND NEW.item_id IS DISTINCT FROM OLD.item_id) THEN
  RAISE EXCEPTION 'Delivery operation identity or terminal result is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER immutable_delivery_operation BEFORE UPDATE ON delivery_operations FOR EACH ROW EXECUTE FUNCTION preserve_delivery_operation();
CREATE TRIGGER immutable_delivery_operation_delete BEFORE DELETE ON delivery_operations FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER immutable_publication_pages BEFORE UPDATE OR DELETE ON publication_result_pages FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER immutable_publication_candidates BEFORE UPDATE OR DELETE ON publication_candidates FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER immutable_publication_scans BEFORE UPDATE OR DELETE ON publication_scans FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER immutable_publication_findings BEFORE UPDATE OR DELETE ON publication_findings FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER immutable_publication_overrides BEFORE UPDATE OR DELETE ON publication_override_receipts FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER immutable_publication_command_receipts BEFORE UPDATE OR DELETE ON publication_command_receipts FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();

CREATE TRIGGER immutable_delivery_item BEFORE DELETE ON delivery_items FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
