-- Enrollment secrets and Runner credentials remain outside canonical receipts.
-- Only their hashes and the exact consumed request identity are retained.
CREATE TABLE runner_enrollments (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,128}$'),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 32),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  request_id text UNIQUE CHECK (request_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  request_digest text CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  credential_hash text CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
  runner_id text UNIQUE REFERENCES runners(id),
  redeemed_at timestamptz,
  CHECK (expires_at - created_at BETWEEN interval '60 seconds' AND interval '3600 seconds'),
  CHECK (num_nonnulls(request_id,request_digest,credential_hash,runner_id,redeemed_at) IN (0,5)),
  CHECK (credential_hash IS NULL OR credential_hash <> token_hash),
  CHECK (redeemed_at IS NULL OR redeemed_at >= created_at AND redeemed_at < expires_at)
);

CREATE FUNCTION enforce_runner_enrollment_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Runner enrollment identity and receipt must be retained' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.request_id IS NOT NULL THEN
      RAISE EXCEPTION 'Runner enrollment must be issued before redemption' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id,NEW.token_hash,NEW.capacity,NEW.created_at,NEW.expires_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.token_hash,OLD.capacity,OLD.created_at,OLD.expires_at)
    OR OLD.request_id IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Runner enrollment identity and receipt are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.request_id IS NOT NULL AND OLD.request_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM runners WHERE id=NEW.runner_id AND credential_hash=NEW.credential_hash AND capacity=NEW.capacity
  ) THEN
    RAISE EXCEPTION 'Runner enrollment must bind its issued capacity and credential' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER runner_enrollment_identity BEFORE INSERT OR UPDATE OR DELETE ON runner_enrollments
  FOR EACH ROW EXECUTE FUNCTION enforce_runner_enrollment_identity();
