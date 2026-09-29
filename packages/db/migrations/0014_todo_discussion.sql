ALTER TABLE todos ADD COLUMN project_context_version bigint NOT NULL DEFAULT 0 CHECK(project_context_version BETWEEN 0 AND 9007199254740991);
CREATE FUNCTION advance_todo_project_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN NEW.project_context_version=OLD.project_context_version+1;
  ELSE NEW.project_context_version=OLD.project_context_version;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER todo_project_context BEFORE UPDATE ON todos FOR EACH ROW EXECUTE FUNCTION advance_todo_project_context();
ALTER TABLE execution_policies ADD COLUMN planner_guidance text NOT NULL DEFAULT '';

ALTER TABLE attempts ALTER COLUMN task_id DROP NOT NULL;
ALTER TABLE attempts ADD COLUMN todo_id text REFERENCES todos(id);
ALTER TABLE attempts ADD COLUMN discussion_context jsonb;
ALTER TABLE attempts ADD CHECK ((task_id IS NOT NULL) <> (todo_id IS NOT NULL));
ALTER TABLE attempts ADD CHECK (todo_id IS NULL OR (kind='planner' AND node_id IS NULL AND node_activation=0 AND specification_id IS NULL AND plan_id IS NULL AND owner_key='todo-planner:'||todo_id));
ALTER TABLE attempts ADD COLUMN scope_id text GENERATED ALWAYS AS (COALESCE(task_id,todo_id)) STORED;
ALTER TABLE attempts ADD UNIQUE(id,scope_id);
ALTER TABLE command_receipts DROP CONSTRAINT command_receipts_scope_id_fkey;
ALTER TABLE command_receipts ADD FOREIGN KEY(attempt_id,scope_id) REFERENCES attempts(id,scope_id);
CREATE FUNCTION preserve_attempt_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.task_id IS DISTINCT FROM OLD.task_id OR NEW.todo_id IS DISTINCT FROM OLD.todo_id OR NEW.owner_key<>OLD.owner_key OR NEW.dispatch_id<>OLD.dispatch_id OR NEW.runner_id<>OLD.runner_id THEN
    RAISE EXCEPTION 'Attempt ownership is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_attempt_scope BEFORE UPDATE ON attempts FOR EACH ROW EXECUTE FUNCTION preserve_attempt_scope();
ALTER TABLE operations ALTER COLUMN resource_id DROP NOT NULL;
ALTER TABLE operations ADD CHECK (kind='stop' OR resource_id IS NOT NULL);

CREATE TABLE todo_discussion_controls (
  todo_id text PRIMARY KEY REFERENCES todos(id),
  version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
  sequence bigint NOT NULL DEFAULT 0 CHECK(sequence BETWEEN 0 AND 9007199254740991),
  resolved_watermark bigint NOT NULL DEFAULT 0 CHECK(resolved_watermark BETWEEN 0 AND 9007199254740991),
  source_message_id text,
  desired_attempt_id text,
  waiting_reason text
);
CREATE TABLE todo_discussion_messages (
  id text PRIMARY KEY, todo_id text NOT NULL REFERENCES todos(id),
  sequence bigint NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),
  author text NOT NULL CHECK(author IN ('owner','assistant')),
  content text NOT NULL CHECK(char_length(content) BETWEEN 1 AND 65536 AND octet_length(content)<=262144),
  source_message_id text, source_watermark bigint,
  project_id text REFERENCES projects(id), project_context_version bigint,
  task_preview jsonb, requirement_state text,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(todo_id,id), UNIQUE(todo_id,sequence),
  FOREIGN KEY(todo_id,source_message_id) REFERENCES todo_discussion_messages(todo_id,id),
  CHECK ((author='owner' AND source_message_id IS NULL AND source_watermark IS NULL AND task_preview IS NULL AND requirement_state IS NULL)
    OR (author='assistant' AND source_message_id IS NOT NULL AND source_watermark IS NOT NULL AND requirement_state IS NOT NULL))
);
CREATE UNIQUE INDEX one_discussion_reply ON todo_discussion_messages(source_message_id) WHERE author='assistant';
CREATE TRIGGER immutable_discussion_message BEFORE UPDATE OR DELETE ON todo_discussion_messages FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
ALTER TABLE todo_discussion_controls ADD FOREIGN KEY(todo_id,source_message_id) REFERENCES todo_discussion_messages(todo_id,id);
CREATE TABLE todo_discussion_resolutions (
  todo_id text NOT NULL REFERENCES todos(id), source_message_id text PRIMARY KEY,
  disposition text NOT NULL CHECK(disposition IN ('replied','withdrawn')),
  reply_message_id text, attempt_id text REFERENCES attempts(id), request_id text NOT NULL,
  FOREIGN KEY(todo_id,source_message_id) REFERENCES todo_discussion_messages(todo_id,id),
  FOREIGN KEY(todo_id,reply_message_id) REFERENCES todo_discussion_messages(todo_id,id),
  CHECK ((disposition='replied' AND reply_message_id IS NOT NULL AND attempt_id IS NOT NULL) OR (disposition='withdrawn' AND reply_message_id IS NULL))
);
CREATE TRIGGER immutable_discussion_resolution BEFORE UPDATE OR DELETE ON todo_discussion_resolutions FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TABLE todo_requirement_cache (
  todo_id text PRIMARY KEY REFERENCES todos(id), content text NOT NULL,
  resolved_watermark bigint NOT NULL, project_context_version bigint NOT NULL,
  project_context_digest text NOT NULL
);
-- Scheduling delivery bookkeeping only: no process/Attempt exists until selection.
CREATE TABLE todo_discussion_outbox (
  id text PRIMARY KEY, todo_id text NOT NULL REFERENCES todos(id), source_message_id text NOT NULL,
  planned_attempt_id text NOT NULL UNIQUE, expected_version bigint NOT NULL,
  context jsonb, done boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), last_checked_at timestamptz NOT NULL DEFAULT 'epoch',
  FOREIGN KEY(todo_id,source_message_id) REFERENCES todo_discussion_messages(todo_id,id)
);
CREATE UNIQUE INDEX one_pending_discussion_intent ON todo_discussion_outbox(todo_id) WHERE NOT done;
CREATE TABLE discussion_command_receipts (
  request_id text PRIMARY KEY, digest text NOT NULL, response jsonb NOT NULL
);
CREATE TRIGGER immutable_discussion_receipt BEFORE UPDATE OR DELETE ON discussion_command_receipts FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
