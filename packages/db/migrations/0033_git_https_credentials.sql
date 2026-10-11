-- Tokens never enter resource settings, configuration snapshots or receipts.
CREATE TABLE git_https_credentials (
  resource_id text PRIMARY KEY REFERENCES project_resources(id),
  repository_identity text NOT NULL,
  remote_url text NOT NULL,
  username text NOT NULL CHECK(char_length(username) BETWEEN 1 AND 256 AND username !~ E'[:\\r\\n]'),
  generation text NOT NULL CHECK(generation ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  scope_digest text NOT NULL CHECK(scope_digest ~ '^[0-9a-f]{64}$'),
  encrypted_token text NOT NULL CHECK(char_length(encrypted_token) BETWEEN 41 AND 5510 AND encrypted_token ~ '^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'),
  configuration_request_id text NOT NULL REFERENCES configuration_receipts(request_id) DEFERRABLE INITIALLY DEFERRED
);

-- The generation is optional only for historical same-scope observations. The
-- current material always checks its exact save generation as well.
CREATE FUNCTION git_https_credential_receipt_matches(request text, resource text, account text, scope text, material text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM configuration_receipts r WHERE r.request_id=request
      AND r.response->'request_id'=to_jsonb(request)
      AND r.response @> '{"schema_version":1,"status":"committed","entity_id":"save_git_https_credential"}'::jsonb
      AND jsonb_typeof(r.response->'control_version')='number'
      AND r.response->'credential_change'=jsonb_build_object('action','saved','resource_id',resource,'username',account,
        'scope_digest',scope,'generation',r.response->'credential_change'->>'generation')
      AND r.response->'credential_change'->>'generation' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND (material IS NULL OR r.response->'credential_change'->>'generation'=material)
      AND (r.response - ARRAY['schema_version','request_id','status','control_version','entity_id','credential_change']::text[])='{}'::jsonb
  );
$$;

CREATE FUNCTION enforce_git_https_credential_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.resource_id<>OLD.resource_id OR NEW.repository_identity<>OLD.repository_identity OR NEW.remote_url<>OLD.remote_url) THEN
    RAISE EXCEPTION 'HTTPS credential resource binding is immutable' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM project_resources p WHERE p.id=NEW.resource_id AND p.active
      AND p.repository_identity=NEW.repository_identity AND p.remote_url=NEW.remote_url
      AND p.repository_identity NOT LIKE 'github.com/%' AND p.remote_url LIKE 'https://%'
      AND NOT (p.settings ? 'provider') AND NOT (p.settings ? 'provider_repo_id'))
    OR NOT git_https_credential_receipt_matches(NEW.configuration_request_id,NEW.resource_id,NEW.username,NEW.scope_digest,NEW.generation) THEN
    RAISE EXCEPTION 'HTTPS credential requires its exact resource and safe configuration receipt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER git_https_credential_authority AFTER INSERT OR UPDATE ON git_https_credentials
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_git_https_credential_authority();
