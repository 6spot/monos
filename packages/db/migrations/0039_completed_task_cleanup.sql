CREATE TABLE maintenance_configuration (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  retention jsonb NOT NULL DEFAULT '{"enabled":true,"completed_task_days":7}'::jsonb,
  CHECK(jsonb_typeof(retention->'enabled')='boolean'
    AND (retention->>'completed_task_days')::integer BETWEEN 1 AND 3650)
);
INSERT INTO maintenance_configuration(singleton) VALUES(true);

ALTER TABLE tasks ADD COLUMN completed_at timestamptz;
-- Existing development rows start a conservative new retention interval. This
-- does not change their canonical acceptance or manufacture an earlier time.
UPDATE tasks SET completed_at=clock_timestamp() WHERE state='COMPLETED';
CREATE FUNCTION stamp_task_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.completed_at IS NOT NULL THEN
    IF NEW.completed_at IS DISTINCT FROM OLD.completed_at OR NEW.state<>'COMPLETED' THEN
      RAISE EXCEPTION 'Completed Task identity and retention time are final' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.state='COMPLETED' THEN
    NEW.completed_at=clock_timestamp();
  ELSE
    NEW.completed_at=NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER task_completion_time BEFORE INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION stamp_task_completion();

ALTER TABLE task_workspaces ADD COLUMN cleaned_at timestamptz;
CREATE TABLE task_cleanup_jobs (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id),
  runner_id text NOT NULL REFERENCES runners(id),
  request jsonb,
  request_digest text CHECK(request_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','blocked','completed')),
  reason text,
  result jsonb,
  last_sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(task_id,runner_id),
  CHECK ((request IS NULL)=(request_digest IS NULL)),
  CHECK (request IS NOT NULL OR status='blocked'),
  CHECK (request IS NULL OR (request->>'cleanup_id'=id AND request->>'task_id'=task_id AND request->>'runner_id'=runner_id)),
  CHECK ((status='completed')=(completed_at IS NOT NULL)),
  CHECK (status<>'completed' OR result->>'status'='completed' AND result->>'request_digest'=request_digest)
);
CREATE FUNCTION preserve_task_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cleanup receipt must be retained' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND ((NEW.id,NEW.task_id,NEW.runner_id,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.task_id,OLD.runner_id,OLD.created_at)
    OR OLD.request IS NOT NULL AND (NEW.request,NEW.request_digest) IS DISTINCT FROM (OLD.request,OLD.request_digest)
    OR OLD.status='completed' AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Cleanup identity or completed receipt is immutable' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id=NEW.task_id AND t.state='COMPLETED' AND t.completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Only a completed Task can release disposable storage' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER task_cleanup_identity BEFORE INSERT OR UPDATE OR DELETE ON task_cleanup_jobs
  FOR EACH ROW EXECUTE FUNCTION preserve_task_cleanup();
