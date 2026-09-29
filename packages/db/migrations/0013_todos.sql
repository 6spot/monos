CREATE TABLE todos (
  id text PRIMARY KEY,
  original_capture text NOT NULL CHECK(char_length(original_capture) BETWEEN 1 AND 65536 AND octet_length(original_capture)<=262144),
  project_id text REFERENCES projects(id),
  archived boolean NOT NULL DEFAULT false,
  control_version bigint NOT NULL DEFAULT 1 CHECK(control_version BETWEEN 1 AND 9007199254740991),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  discussion_activity_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX todos_activity ON todos(archived,discussion_activity_at DESC,id DESC);
CREATE INDEX todos_project_activity ON todos(project_id,discussion_activity_at DESC,id DESC) WHERE NOT archived;

CREATE FUNCTION preserve_todo_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Todo history cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF NEW.id<>OLD.id OR NEW.original_capture<>OLD.original_capture OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Todo original capture and identity cannot be changed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_todo_capture BEFORE UPDATE OR DELETE ON todos FOR EACH ROW EXECUTE FUNCTION preserve_todo_capture();

CREATE TABLE todo_command_receipts (
  request_id text PRIMARY KEY,
  digest text NOT NULL,
  response jsonb NOT NULL
);
CREATE TRIGGER immutable_todo_receipt BEFORE UPDATE OR DELETE ON todo_command_receipts FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
