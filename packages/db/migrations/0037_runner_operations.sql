-- Infrastructure observations and credential changes never release execution
-- ownership. A new connection must reconcile the retained inventory.
ALTER TABLE runners ADD COLUMN resource_observation jsonb;
ALTER TABLE runners ADD COLUMN resource_observed_at timestamptz;
ALTER TABLE runners ADD COLUMN resource_incarnation bigint;
ALTER TABLE runners ADD COLUMN credential_generation bigint NOT NULL DEFAULT 1 CHECK (credential_generation > 0);
ALTER TABLE runners ADD COLUMN credential_revoked boolean NOT NULL DEFAULT false;
ALTER TABLE runners ADD CONSTRAINT runner_resource_observation_pair CHECK (
  (resource_observation IS NULL AND resource_observed_at IS NULL AND resource_incarnation IS NULL)
  OR (resource_observation IS NOT NULL AND resource_observed_at IS NOT NULL AND resource_incarnation IS NOT NULL));

CREATE TABLE backend_storage_observations (
  instance_id text PRIMARY KEY,
  observation jsonb NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE runner_credential_rotations (
  id text PRIMARY KEY,
  runner_id text NOT NULL REFERENCES runners(id),
  credential_generation bigint NOT NULL CHECK (credential_generation > 0),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  request_id text UNIQUE,
  request_digest text,
  credential_hash text,
  redeemed_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK ((request_id IS NULL AND request_digest IS NULL AND credential_hash IS NULL AND redeemed_at IS NULL)
    OR (request_id IS NOT NULL AND request_digest IS NOT NULL AND credential_hash IS NOT NULL AND redeemed_at IS NOT NULL))
);

CREATE FUNCTION preserve_runner_rotation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Runner rotation receipt must be retained' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.request_id IS NOT NULL THEN RAISE EXCEPTION 'Rotation must be issued before redemption' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id,NEW.runner_id,NEW.credential_generation,NEW.token_hash,NEW.created_at,NEW.expires_at)
      IS DISTINCT FROM (OLD.id,OLD.runner_id,OLD.credential_generation,OLD.token_hash,OLD.created_at,OLD.expires_at)
    OR OLD.request_id IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Runner rotation identity and receipt are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_runner_rotation BEFORE INSERT OR UPDATE OR DELETE ON runner_credential_rotations
  FOR EACH ROW EXECUTE FUNCTION preserve_runner_rotation();

-- One bounded observation predicate is shared by queue promotion and readiness.
-- Missing instrumentation is reported as unverified, never as measured space.
CREATE FUNCTION runner_storage_attention(r runners, as_of timestamptz DEFAULT clock_timestamp()) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT r.resource_observation IS NOT NULL AND (
    r.resource_incarnation <> r.incarnation
    OR r.resource_observed_at <= as_of - interval '15 seconds'
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(r.resource_observation->'storage') s WHERE s->>'status' <> 'ok'));
$$;

CREATE FUNCTION database_storage_attention(backend_instance text, as_of timestamptz DEFAULT clock_timestamp()) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM backend_storage_observations s WHERE s.instance_id=backend_instance
    AND (s.observation->>'status'<>'ok' OR s.observed_at <= as_of - interval '15 seconds'));
$$;
