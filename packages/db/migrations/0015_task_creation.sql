CREATE TABLE task_creation_confirmations (
  id text PRIMARY KEY, todo_id text NOT NULL REFERENCES todos(id),
  proposal_message_id text NOT NULL, project_id text NOT NULL REFERENCES projects(id),
  content_digest text NOT NULL CHECK(content_digest ~ '^[0-9a-f]{64}$'),
  content jsonb NOT NULL, request_id text NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(proposal_message_id,content_digest), UNIQUE(id,todo_id,proposal_message_id,project_id),
  FOREIGN KEY(todo_id,proposal_message_id) REFERENCES todo_discussion_messages(todo_id,id)
);
CREATE TRIGGER immutable_creation_confirmation BEFORE UPDATE OR DELETE ON task_creation_confirmations FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();

ALTER TABLE tasks ADD COLUMN title text CHECK(char_length(title) BETWEEN 1 AND 256);
ALTER TABLE tasks ADD COLUMN todo_id text REFERENCES todos(id);
ALTER TABLE tasks ADD COLUMN initial_specification_id text;
ALTER TABLE tasks ADD COLUMN creation_confirmation_id text;
ALTER TABLE tasks ADD COLUMN source_proposal_message_id text UNIQUE;
ALTER TABLE tasks ADD COLUMN created_at timestamptz(3);
ALTER TABLE tasks ADD FOREIGN KEY(id,initial_specification_id) REFERENCES specification_revisions(task_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE tasks ADD FOREIGN KEY(creation_confirmation_id,todo_id,source_proposal_message_id,project_id) REFERENCES task_creation_confirmations(id,todo_id,proposal_message_id,project_id);
ALTER TABLE tasks ADD UNIQUE(id,todo_id,source_proposal_message_id,creation_confirmation_id);
ALTER TABLE tasks ADD CHECK (
  (creation_confirmation_id IS NULL AND title IS NULL AND todo_id IS NULL AND initial_specification_id IS NULL AND source_proposal_message_id IS NULL AND created_at IS NULL)
  OR (creation_confirmation_id IS NOT NULL AND title IS NOT NULL AND todo_id IS NOT NULL AND initial_specification_id IS NOT NULL AND source_proposal_message_id IS NOT NULL AND created_at IS NOT NULL AND project_id IS NOT NULL)
);
CREATE INDEX tasks_todo ON tasks(todo_id,created_at DESC,id DESC);
CREATE FUNCTION preserve_created_task_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.creation_confirmation_id IS NOT NULL OR NEW.creation_confirmation_id IS NOT NULL THEN
    IF (NEW.id,NEW.title,NEW.todo_id,NEW.project_id,NEW.initial_specification_id,NEW.creation_confirmation_id,NEW.source_proposal_message_id,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.title,OLD.todo_id,OLD.project_id,OLD.initial_specification_id,OLD.creation_confirmation_id,OLD.source_proposal_message_id,OLD.created_at) THEN
      RAISE EXCEPTION 'Task creation identity is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_created_task_identity BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION preserve_created_task_identity();

CREATE TABLE task_preview_resolutions (
  proposal_message_id text PRIMARY KEY, todo_id text NOT NULL REFERENCES todos(id),
  disposition text NOT NULL CHECK(disposition IN ('created','cancelled')),
  task_id text UNIQUE, confirmation_id text, request_id text NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(todo_id,proposal_message_id) REFERENCES todo_discussion_messages(todo_id,id),
  FOREIGN KEY(task_id,todo_id,proposal_message_id,confirmation_id) REFERENCES tasks(id,todo_id,source_proposal_message_id,creation_confirmation_id),
  CHECK ((disposition='created' AND task_id IS NOT NULL AND confirmation_id IS NOT NULL) OR (disposition='cancelled' AND task_id IS NULL AND confirmation_id IS NULL))
);
CREATE TRIGGER immutable_task_preview_resolution BEFORE UPDATE OR DELETE ON task_preview_resolutions FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TABLE task_preview_command_receipts (
  request_id text PRIMARY KEY, digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'), response jsonb NOT NULL
);
CREATE TRIGGER immutable_task_preview_receipt BEFORE UPDATE OR DELETE ON task_preview_command_receipts FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
ALTER TABLE task_events ALTER COLUMN attempt_id DROP NOT NULL;
