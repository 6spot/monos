-- Remote preparation is Delivery-owned work, never an Attempt or accepted batch.
ALTER TABLE runners ADD COLUMN remote_preparation_supported boolean NOT NULL DEFAULT false;
CREATE TABLE publication_permission_observations (
 id text PRIMARY KEY, resource_id text NOT NULL REFERENCES project_resources(id), repository_identity text NOT NULL,
 repository_id text NOT NULL CHECK(repository_id ~ '^[1-9][0-9]{0,15}$'), configuration_fingerprint text NOT NULL CHECK(configuration_fingerprint ~ '^[0-9a-f]{64}$'),
 permission_fingerprint text NOT NULL CHECK(permission_fingerprint ~ '^[0-9a-f]{64}$'), proof jsonb NOT NULL,
 proof_digest text NOT NULL UNIQUE CHECK(proof_digest ~ '^[0-9a-f]{64}$'), observed_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 CHECK(expires_at>observed_at), CHECK(proof->>'observation_id'=id AND proof->>'resource_id'=resource_id AND proof->>'repository_id'=repository_id)
);
CREATE INDEX permission_scope_latest ON publication_permission_observations(resource_id,configuration_fingerprint,observed_at DESC,id DESC);
CREATE TABLE remote_preparation_items (
 item_id text PRIMARY KEY REFERENCES delivery_items(id), task_id text NOT NULL REFERENCES tasks(id), resource_id text NOT NULL REFERENCES project_resources(id),
 runner_id text NOT NULL REFERENCES runners(id), storage_id text NOT NULL, repository_identity text NOT NULL,
 repository_id text NOT NULL CHECK(repository_id ~ '^[1-9][0-9]{0,15}$'), remote_url text NOT NULL, delivery_ref text NOT NULL,
 target_branch text NOT NULL, marker text NOT NULL, pr_id text, pr_number bigint CHECK(pr_number BETWEEN 1 AND 9007199254740991),
 last_published_proof jsonb, last_published_digest text CHECK(last_published_digest ~ '^[0-9a-f]{64}$'),
 cancel_requested boolean NOT NULL DEFAULT false, cleanup_state text NOT NULL DEFAULT 'none' CHECK(cleanup_state IN ('none','pending','attention','closed','not_needed','externally_merged')),
 next_poll_at timestamptz NOT NULL DEFAULT now(), poll_progress jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(item_id,task_id) REFERENCES delivery_items(id,task_id), UNIQUE(item_id,task_id), UNIQUE(repository_id,delivery_ref),
 CHECK(delivery_ref='refs/heads/monos/task/'||task_id||'/'||resource_id), CHECK(marker='<!-- monos-delivery-item:'||item_id||' -->'),
 CHECK((pr_id IS NULL)=(pr_number IS NULL)), CHECK((last_published_proof IS NULL)=(last_published_digest IS NULL))
);
CREATE TABLE remote_preparation_operations (
 id text PRIMARY KEY, item_id text NOT NULL, task_id text NOT NULL REFERENCES tasks(id), resource_id text NOT NULL REFERENCES project_resources(id),
 runner_id text NOT NULL REFERENCES runners(id), kind text NOT NULL CHECK(kind IN ('push','create_pr','update_pr','close_pr')),
 request jsonb NOT NULL, request_digest text NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
 version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991), state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','started','unknown','failed','settled','revoked')),
 active boolean NOT NULL DEFAULT true, effect_owned boolean NOT NULL DEFAULT false, may_have_mutated boolean NOT NULL DEFAULT false,
 worker_absent boolean NOT NULL DEFAULT true, reconcile_only boolean NOT NULL DEFAULT false,
 claim_id text, claim_expires_at timestamptz, sent_incarnation bigint, claim_instance text,
 result jsonb, result_digest text CHECK(result_digest ~ '^[0-9a-f]{64}$'), reason text,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), last_sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(item_id,task_id) REFERENCES remote_preparation_items(item_id,task_id), UNIQUE(id,item_id), UNIQUE(id,task_id),
 CHECK(request->>'operation_id'=id AND request->>'item_id'=item_id AND request->>'task_id'=task_id AND request->>'resource_id'=resource_id AND request->>'runner_id'=runner_id),
 CHECK((state='settled')=(result IS NOT NULL AND result_digest IS NOT NULL)), CHECK(state NOT IN ('settled','revoked') OR NOT effect_owned),
 CHECK(NOT effect_owned OR active), CHECK(NOT may_have_mutated OR state<>'revoked')
);
CREATE UNIQUE INDEX one_remote_mutation_owner ON remote_preparation_operations(item_id) WHERE active AND state NOT IN ('settled','revoked');
CREATE INDEX remote_due ON remote_preparation_operations(next_attempt_at,id) WHERE active AND state NOT IN ('settled','revoked');
CREATE TABLE remote_preparation_observations (
 id text PRIMARY KEY, item_id text NOT NULL, task_id text NOT NULL REFERENCES tasks(id), operation_id text,
 kind text NOT NULL CHECK(kind IN ('ref','review','checks','published','cleanup')), observation jsonb NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(item_id,task_id) REFERENCES remote_preparation_items(item_id,task_id), FOREIGN KEY(operation_id,item_id) REFERENCES remote_preparation_operations(id,item_id), UNIQUE(id,item_id)
);
CREATE TABLE published_result_mappings (
 operation_id text PRIMARY KEY REFERENCES delivery_operations(id), mapping_id text NOT NULL UNIQUE, item_id text NOT NULL,
 task_id text NOT NULL REFERENCES tasks(id), candidate_id text NOT NULL, source_operation_id text NOT NULL REFERENCES operations(id),
 source_digest text NOT NULL CHECK(source_digest ~ '^[0-9a-f]{64}$'), effective_basis_digest text NOT NULL CHECK(effective_basis_digest ~ '^[0-9a-f]{64}$'),
 mapping jsonb NOT NULL, mapping_digest text NOT NULL UNIQUE CHECK(mapping_digest ~ '^[0-9a-f]{64}$'), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(item_id,task_id) REFERENCES delivery_items(id,task_id), FOREIGN KEY(candidate_id,task_id) REFERENCES publication_candidates(id,task_id),
 CHECK(mapping->>'operation_id'=operation_id AND mapping->>'mapping_id'=mapping_id AND mapping->>'item_id'=item_id AND mapping->'source'->>'operation_id'=source_operation_id)
);
CREATE TABLE remote_published_exposures (
 id text PRIMARY KEY CHECK(id ~ '^[0-9a-f]{64}$'), item_id text NOT NULL, task_id text NOT NULL REFERENCES tasks(id),
 operation_id text NOT NULL, scan_id text NOT NULL REFERENCES publication_scans(id), finding_id text NOT NULL,
 published_proof_digest text NOT NULL CHECK(published_proof_digest ~ '^[0-9a-f]{64}$'), exposure jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(item_id,task_id) REFERENCES remote_preparation_items(item_id,task_id),
 FOREIGN KEY(operation_id,item_id) REFERENCES remote_preparation_operations(id,item_id), FOREIGN KEY(scan_id,finding_id) REFERENCES publication_findings(scan_id,id),
 UNIQUE(item_id,published_proof_digest,finding_id), CHECK(exposure->>'exposure_id'=id AND exposure->>'item_id'=item_id AND exposure->>'task_id'=task_id AND exposure->>'finding_id'=finding_id)
);
CREATE TABLE remote_preparation_command_receipts (
 task_id text NOT NULL REFERENCES tasks(id), request_id text NOT NULL, digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 envelope jsonb NOT NULL, response jsonb NOT NULL, PRIMARY KEY(task_id,request_id),
 CHECK(envelope->>'task_id'=task_id AND envelope->>'request_id'=request_id AND response->>'task_id'=task_id AND response->>'request_id'=request_id)
);
CREATE TABLE github_remote_cooldowns (
 installation_id text PRIMARY KEY, next_request_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL CHECK(reason IN ('spacing','primary_rate_limit','secondary_rate_limit','transient'))
);
CREATE FUNCTION preserve_remote_item_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.item_id,NEW.task_id,NEW.resource_id,NEW.runner_id,NEW.storage_id,NEW.repository_identity,NEW.repository_id,NEW.remote_url,NEW.delivery_ref,NEW.target_branch,NEW.marker,NEW.created_at)
 IS DISTINCT FROM (OLD.item_id,OLD.task_id,OLD.resource_id,OLD.runner_id,OLD.storage_id,OLD.repository_identity,OLD.repository_id,OLD.remote_url,OLD.delivery_ref,OLD.target_branch,OLD.marker,OLD.created_at)
 OR (OLD.pr_id IS NOT NULL AND (NEW.pr_id,NEW.pr_number) IS DISTINCT FROM (OLD.pr_id,OLD.pr_number))
 OR (OLD.cancel_requested AND NOT NEW.cancel_requested) THEN RAISE EXCEPTION 'Remote item identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER immutable_remote_item_identity BEFORE UPDATE ON remote_preparation_items FOR EACH ROW EXECUTE FUNCTION preserve_remote_item_identity();
CREATE TRIGGER immutable_remote_item_delete BEFORE DELETE ON remote_preparation_items FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE FUNCTION preserve_remote_operation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.item_id,NEW.task_id,NEW.resource_id,NEW.runner_id,NEW.kind,NEW.request,NEW.request_digest,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.item_id,OLD.task_id,OLD.resource_id,OLD.runner_id,OLD.kind,OLD.request,OLD.request_digest,OLD.created_at)
 OR (OLD.state IN ('settled','revoked') AND NEW IS DISTINCT FROM OLD)
 OR (OLD.may_have_mutated AND NOT NEW.may_have_mutated) THEN RAISE EXCEPTION 'Remote operation identity or terminal result is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER immutable_remote_operation_identity BEFORE UPDATE ON remote_preparation_operations FOR EACH ROW EXECUTE FUNCTION preserve_remote_operation_identity();
CREATE TRIGGER immutable_remote_operation_delete BEFORE DELETE ON remote_preparation_operations FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER immutable_permission_observation BEFORE UPDATE OR DELETE ON publication_permission_observations FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER immutable_remote_observation BEFORE UPDATE OR DELETE ON remote_preparation_observations FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER immutable_published_mapping BEFORE UPDATE OR DELETE ON published_result_mappings FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER immutable_published_exposure BEFORE UPDATE OR DELETE ON remote_published_exposures FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER immutable_remote_command_receipt BEFORE UPDATE OR DELETE ON remote_preparation_command_receipts FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
