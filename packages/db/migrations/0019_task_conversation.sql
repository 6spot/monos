-- Conversation authority is independent of execution control and append sequence.
ALTER TABLE tasks ADD COLUMN conversation_sequence bigint NOT NULL DEFAULT 0 CHECK(conversation_sequence BETWEEN 0 AND 9007199254740991);
ALTER TABLE tasks ADD COLUMN conversation_watermark bigint NOT NULL DEFAULT 0 CHECK(conversation_watermark BETWEEN 0 AND 9007199254740991);
ALTER TABLE tasks ADD COLUMN conversation_version bigint NOT NULL DEFAULT 1 CHECK(conversation_version BETWEEN 1 AND 9007199254740991);
ALTER TABLE tasks ADD COLUMN conversation_input_id text;
ALTER TABLE tasks ADD COLUMN conversation_source_id text;
-- Reserved for the later real Delivery admission transaction. No public setter.
ALTER TABLE tasks ADD COLUMN accepted_delivery_operation_id text;
ALTER TABLE tasks ADD COLUMN accepted_delivery_input_cutoff bigint;
ALTER TABLE tasks ADD CHECK((accepted_delivery_operation_id IS NULL)=(accepted_delivery_input_cutoff IS NULL));
ALTER TABLE tasks ADD CHECK(accepted_delivery_input_cutoff BETWEEN 0 AND 9007199254740991);
CREATE TABLE task_inputs (
 id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), message_id text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','failed','replied','withdrawn')),
 version bigint NOT NULL DEFAULT 1, accepted_delivery_operation_id text, parent_issue_id text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(task_id,id)
);
CREATE TABLE task_messages (
 id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), input_id text NOT NULL,
 sequence bigint NOT NULL, author text NOT NULL CHECK(author IN ('owner','assistant')),
 content text NOT NULL CHECK(char_length(content) BETWEEN 1 AND 65536 AND octet_length(content)<=262144),
 source_id text, source_watermark bigint, observed_control_version bigint, observed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(task_id,id), UNIQUE(task_id,sequence),
 FOREIGN KEY(task_id,input_id) REFERENCES task_inputs(task_id,id),
 CHECK((author='owner' AND source_id IS NULL AND source_watermark IS NULL) OR (author='assistant' AND source_id IS NOT NULL AND source_watermark IS NOT NULL AND observed_at IS NOT NULL))
);
CREATE UNIQUE INDEX task_one_reply ON task_messages(input_id) WHERE author='assistant';
ALTER TABLE task_inputs ADD FOREIGN KEY(task_id,message_id) REFERENCES task_messages(task_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER immutable_task_message BEFORE UPDATE OR DELETE ON task_messages FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TABLE task_conversation_outbox (
 id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), input_id text NOT NULL, previous_source_id text,
 planned_attempt_id text NOT NULL UNIQUE, expected_version bigint NOT NULL, source_watermark bigint NOT NULL,
 configuration_version bigint NOT NULL, reply_only boolean NOT NULL, context jsonb, prompt text,
 context_digest text NOT NULL CHECK(context_digest ~ '^[a-f0-9]{64}$'), preparation_failure text,
 done boolean NOT NULL DEFAULT false, waiting_reason text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), last_checked_at timestamptz NOT NULL DEFAULT 'epoch',
 UNIQUE(task_id,id), UNIQUE(id,planned_attempt_id,task_id), FOREIGN KEY(task_id,input_id) REFERENCES task_inputs(task_id,id),
 FOREIGN KEY(task_id,previous_source_id) REFERENCES task_conversation_outbox(task_id,id),
 CHECK((prompt IS NULL AND context IS NULL AND preparation_failure IS NOT NULL) OR (prompt IS NOT NULL AND context IS NOT NULL AND preparation_failure IS NULL))
);
CREATE UNIQUE INDEX task_one_pending_conversation ON task_conversation_outbox(task_id) WHERE NOT done;
CREATE TRIGGER immutable_task_conversation_source BEFORE UPDATE ON task_conversation_outbox FOR EACH ROW EXECUTE FUNCTION preserve_task_planning_intent();
CREATE TRIGGER retained_task_conversation_source BEFORE DELETE ON task_conversation_outbox FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
ALTER TABLE tasks ADD FOREIGN KEY(id,conversation_input_id) REFERENCES task_inputs(task_id,id);
ALTER TABLE tasks ADD FOREIGN KEY(id,conversation_source_id) REFERENCES task_conversation_outbox(task_id,id);
ALTER TABLE task_messages ADD FOREIGN KEY(task_id,source_id) REFERENCES task_conversation_outbox(task_id,id);
CREATE TABLE task_input_resolutions (
 input_id text PRIMARY KEY, task_id text NOT NULL, source_id text, reply_message_id text,
 disposition text NOT NULL CHECK(disposition IN ('replied','withdrawn')), routing jsonb,
 request_id text NOT NULL, attempt_id text REFERENCES attempts(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(task_id,input_id) REFERENCES task_inputs(task_id,id), FOREIGN KEY(task_id,source_id) REFERENCES task_conversation_outbox(task_id,id),
 FOREIGN KEY(task_id,reply_message_id) REFERENCES task_messages(task_id,id),
 CHECK((disposition='replied' AND source_id IS NOT NULL AND reply_message_id IS NOT NULL AND routing IS NOT NULL AND attempt_id IS NOT NULL) OR (disposition='withdrawn' AND reply_message_id IS NULL))
);
CREATE TRIGGER immutable_task_input_resolution BEFORE UPDATE OR DELETE ON task_input_resolutions FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
ALTER TABLE attempts ADD COLUMN task_conversation_source_id text;
ALTER TABLE attempts ADD FOREIGN KEY(task_conversation_source_id,id,task_id) REFERENCES task_conversation_outbox(id,planned_attempt_id,task_id);
CREATE FUNCTION preserve_task_conversation_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s task_conversation_outbox;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.task_conversation_source_id IS DISTINCT FROM OLD.task_conversation_source_id OR
  (OLD.task_conversation_source_id IS NOT NULL AND (NEW.specification_id,NEW.plan_id,NEW.launch-ARRAY['fencing_generation','mutation_allowed','process_released']) IS DISTINCT FROM (OLD.specification_id,OLD.plan_id,OLD.launch-ARRAY['fencing_generation','mutation_allowed','process_released']))) THEN
  RAISE EXCEPTION 'Conversation launch is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.task_conversation_source_id IS NOT NULL THEN
  SELECT * INTO s FROM task_conversation_outbox WHERE id=NEW.task_conversation_source_id;
  IF s.id IS NULL OR s.preparation_failure IS NOT NULL OR NEW.kind<>'planner' OR NEW.node_id IS NOT NULL OR NEW.todo_id IS NOT NULL OR NEW.node_activation<>0 OR NEW.planning_intent_id IS NOT NULL OR NEW.node_execution_source_id IS NOT NULL OR NEW.owner_key<>'planner:'||s.task_id OR
   NEW.launch->>'prompt' IS DISTINCT FROM s.prompt OR NEW.launch->'task_conversation_source' IS DISTINCT FROM jsonb_build_object('source_id',s.id,'input_id',s.input_id,'source_watermark',s.source_watermark,'conversation_version',s.expected_version,'context_digest',s.context_digest,'reply_only',s.reply_only) OR
   NEW.launch->'control_version' IS DISTINCT FROM to_jsonb(s.expected_version) OR NEW.launch->'source_watermark' IS DISTINCT FROM to_jsonb(s.source_watermark) OR NEW.launch->'workspace_reservations'->'resources' IS DISTINCT FROM '[]'::jsonb THEN
   RAISE EXCEPTION 'Conversation requires exact source scope' USING ERRCODE='23514'; END IF;
 ELSIF NEW.launch ? 'task_conversation_source' THEN RAISE EXCEPTION 'Conversation provenance missing' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER canonical_task_conversation_attempt BEFORE INSERT OR UPDATE ON attempts FOR EACH ROW EXECUTE FUNCTION preserve_task_conversation_attempt();
CREATE TABLE task_guidance (
 id text PRIMARY KEY, task_id text NOT NULL, input_id text NOT NULL, text text NOT NULL CHECK(octet_length(text)<=262144),
 content_digest text NOT NULL, node_id text, supersedes text,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','withdrawn','superseded','resolved','cancelled')),
 version bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(task_id,id),
 FOREIGN KEY(task_id,input_id) REFERENCES task_inputs(task_id,id), FOREIGN KEY(task_id,node_id) REFERENCES nodes(task_id,id), FOREIGN KEY(task_id,supersedes) REFERENCES task_guidance(task_id,id)
);
CREATE TABLE task_guidance_obligations (
 id text PRIMARY KEY, task_id text NOT NULL, guidance_id text NOT NULL, node_id text NOT NULL, node_activation bigint NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','handled','withdrawn','superseded','resolved','cancelled','carried')),
 version bigint NOT NULL DEFAULT 1, completion_operation_id text REFERENCES operations(id), reason text,
 UNIQUE(task_id,id), UNIQUE(guidance_id,node_id,node_activation),
 FOREIGN KEY(task_id,guidance_id) REFERENCES task_guidance(task_id,id), FOREIGN KEY(task_id,node_id) REFERENCES nodes(task_id,id), FOREIGN KEY(node_id,node_activation) REFERENCES node_activations(node_id,activation)
);
CREATE TABLE task_guidance_assignments (
 source_id text NOT NULL REFERENCES node_execution_outbox(id), obligation_id text NOT NULL REFERENCES task_guidance_obligations(id),
 guidance_id text NOT NULL REFERENCES task_guidance(id), PRIMARY KEY(source_id,guidance_id)
);
CREATE TRIGGER immutable_guidance_assignment BEFORE UPDATE OR DELETE ON task_guidance_assignments FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TABLE task_guidance_followups (
 obligation_id text PRIMARY KEY REFERENCES task_guidance_obligations(id), task_id text NOT NULL REFERENCES tasks(id), node_id text NOT NULL,
 node_activation bigint NOT NULL, source_id text REFERENCES node_execution_outbox(id),
 status text NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','done','cancelled')),
 FOREIGN KEY(task_id,node_id) REFERENCES nodes(task_id,id), FOREIGN KEY(node_id,node_activation) REFERENCES node_activations(node_id,activation)
);
CREATE TABLE task_input_issues (
 id text PRIMARY KEY, task_id text NOT NULL, input_id text NOT NULL, reason text NOT NULL CHECK(octet_length(reason)<=262144),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','withdrawn','retried','cancelled')), version bigint NOT NULL DEFAULT 1,
 UNIQUE(task_id,id), FOREIGN KEY(task_id,input_id) REFERENCES task_inputs(task_id,id)
);
ALTER TABLE task_inputs ADD FOREIGN KEY(task_id,parent_issue_id) REFERENCES task_input_issues(task_id,id);
CREATE TABLE task_input_answers (
 id text PRIMARY KEY, task_id text NOT NULL, input_id text NOT NULL, target_kind text NOT NULL, target_id text NOT NULL,
 answer text NOT NULL CHECK(octet_length(answer)<=262144), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(task_id,input_id) REFERENCES task_inputs(task_id,id)
);
CREATE TRIGGER immutable_task_input_answer BEFORE UPDATE OR DELETE ON task_input_answers FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE FUNCTION preserve_task_input_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['status','version','completion_operation_id','reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','completion_operation_id','reason']) THEN
 RAISE EXCEPTION 'Input provenance is immutable' USING ERRCODE='23514'; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER immutable_task_input_content BEFORE UPDATE ON task_inputs FOR EACH ROW EXECUTE FUNCTION preserve_task_input_content();
CREATE TRIGGER immutable_guidance_content BEFORE UPDATE ON task_guidance FOR EACH ROW EXECUTE FUNCTION preserve_task_input_content();
CREATE TRIGGER immutable_guidance_obligation BEFORE UPDATE ON task_guidance_obligations FOR EACH ROW EXECUTE FUNCTION preserve_task_input_content();
CREATE TRIGGER retained_task_input BEFORE DELETE ON task_inputs FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER retained_guidance BEFORE DELETE ON task_guidance FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
ALTER TABLE completion_manifests ADD COLUMN manifest_version integer NOT NULL DEFAULT 1 CHECK(manifest_version IN (1,2));
ALTER TABLE completion_manifests ADD COLUMN handled_guidance_ids jsonb NOT NULL DEFAULT '[]';
-- Old version 1 hashes and operation identities stay byte-for-byte unchanged.
CREATE FUNCTION validate_guidance_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE value text;
BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.handled_guidance_ids) x WHERE jsonb_typeof(x)<>'string') OR jsonb_typeof(NEW.handled_guidance_ids)<>'array' OR jsonb_array_length(NEW.handled_guidance_ids)>256 OR (NEW.manifest_version=1 AND NEW.handled_guidance_ids<>'[]'::jsonb) OR
 (SELECT count(*)<>count(DISTINCT item) FROM jsonb_array_elements(NEW.handled_guidance_ids) item) THEN
 RAISE EXCEPTION 'Invalid handling manifest' USING ERRCODE='23514'; END IF;
 FOR value IN SELECT jsonb_array_elements_text(NEW.handled_guidance_ids) LOOP
  IF NOT EXISTS(SELECT 1 FROM task_guidance_assignments a JOIN task_guidance_obligations o ON o.id=a.obligation_id WHERE a.source_id=NEW.source_id AND a.guidance_id=value AND o.guidance_id=a.guidance_id AND o.task_id=NEW.task_id AND o.node_id=NEW.node_id AND o.node_activation=NEW.node_activation) THEN
   RAISE EXCEPTION 'Handling assignment differs' USING ERRCODE='23514'; END IF;
 END LOOP; RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER guidance_manifest_ownership AFTER INSERT ON completion_manifests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_guidance_manifest();
ALTER TABLE nodes ADD COLUMN guidance_paused boolean NOT NULL DEFAULT false;
-- Exact provenance checks supplement composite same-owner foreign keys.
CREATE FUNCTION validate_task_input_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s task_conversation_outbox; m task_messages;
BEGIN
 IF TG_TABLE_NAME='task_input_resolutions' THEN
  IF NEW.source_id IS NOT NULL THEN SELECT * INTO s FROM task_conversation_outbox WHERE id=NEW.source_id;
   IF s.input_id IS DISTINCT FROM NEW.input_id OR s.task_id IS DISTINCT FROM NEW.task_id OR (NEW.attempt_id IS NOT NULL AND s.planned_attempt_id IS DISTINCT FROM NEW.attempt_id) THEN RAISE EXCEPTION 'Input resolution source differs' USING ERRCODE='23514'; END IF; END IF;
  IF NEW.reply_message_id IS NOT NULL THEN SELECT * INTO m FROM task_messages WHERE id=NEW.reply_message_id;
   IF (m.task_id,m.input_id,m.source_id,m.author) IS DISTINCT FROM (NEW.task_id,NEW.input_id,NEW.source_id,'assistant'::text) THEN RAISE EXCEPTION 'Reply provenance differs' USING ERRCODE='23514'; END IF; END IF;
 ELSE
  IF NEW.author='assistant' THEN SELECT * INTO s FROM task_conversation_outbox WHERE id=NEW.source_id;
   IF (s.task_id,s.input_id,s.source_watermark) IS DISTINCT FROM (NEW.task_id,NEW.input_id,NEW.source_watermark) THEN RAISE EXCEPTION 'Message source differs' USING ERRCODE='23514'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM task_inputs WHERE id=NEW.input_id AND task_id=NEW.task_id AND message_id=NEW.id) THEN RAISE EXCEPTION 'Owner input identity differs' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER task_input_resolution_links AFTER INSERT ON task_input_resolutions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_task_input_links();
CREATE CONSTRAINT TRIGGER task_message_links AFTER INSERT ON task_messages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_task_input_links();
CREATE FUNCTION validate_guidance_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o task_guidance_obligations; s node_execution_outbox;
BEGIN
 SELECT * INTO o FROM task_guidance_obligations WHERE id=NEW.obligation_id;
 IF TG_TABLE_NAME='task_guidance_assignments' THEN
  SELECT * INTO s FROM node_execution_outbox WHERE id=NEW.source_id;
  IF (s.task_id,s.node_id,s.node_activation,NEW.guidance_id) IS DISTINCT FROM (o.task_id,o.node_id,o.node_activation,o.guidance_id) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(s.context->'guidance'->'items','[]')) item WHERE item->>'guidance_id'=NEW.guidance_id AND item->>'obligation_id'=NEW.obligation_id) THEN RAISE EXCEPTION 'Guidance assignment differs' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.task_id,NEW.node_id,NEW.node_activation) IS DISTINCT FROM (o.task_id,o.node_id,o.node_activation) THEN RAISE EXCEPTION 'Guidance followup differs' USING ERRCODE='23514'; END IF;
  IF NEW.source_id IS NOT NULL THEN SELECT * INTO s FROM node_execution_outbox WHERE id=NEW.source_id;
   IF (s.task_id,s.node_id,s.node_activation) IS DISTINCT FROM (o.task_id,o.node_id,o.node_activation) THEN RAISE EXCEPTION 'Guidance followup source differs' USING ERRCODE='23514'; END IF; END IF;
 END IF; RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER guidance_assignment_links AFTER INSERT ON task_guidance_assignments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_guidance_links();
CREATE CONSTRAINT TRIGGER guidance_followup_links AFTER INSERT OR UPDATE ON task_guidance_followups DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_guidance_links();
ALTER TABLE task_inputs ADD CHECK(version BETWEEN 1 AND 9007199254740991);
ALTER TABLE task_guidance ADD CHECK(version BETWEEN 1 AND 9007199254740991);
ALTER TABLE task_guidance_obligations ADD CHECK(version BETWEEN 1 AND 9007199254740991);
CREATE TRIGGER retained_guidance_obligation BEFORE DELETE ON task_guidance_obligations FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER retained_input_issue BEFORE DELETE ON task_input_issues FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();

CREATE FUNCTION require_frozen_guidance_assignments() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item jsonb;
BEGIN
 FOR item IN SELECT jsonb_array_elements(COALESCE(NEW.context->'guidance'->'items','[]')) LOOP
  IF NOT EXISTS(SELECT 1 FROM task_guidance_assignments WHERE source_id=NEW.id AND guidance_id=item->>'guidance_id' AND obligation_id=item->>'obligation_id') THEN
   RAISE EXCEPTION 'Frozen guidance assignment missing' USING ERRCODE='23514'; END IF;
 END LOOP; RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER node_source_guidance_assignments AFTER INSERT ON node_execution_outbox DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_frozen_guidance_assignments();
ALTER TABLE task_conversation_outbox ADD CHECK(expected_version BETWEEN 1 AND 9007199254740991 AND source_watermark BETWEEN 1 AND 9007199254740991);
ALTER TABLE task_messages ADD CHECK(sequence BETWEEN 1 AND 9007199254740991);
CREATE FUNCTION preserve_resolved_task_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status IN ('replied','withdrawn') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Resolved input is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER terminal_task_input BEFORE UPDATE ON task_inputs FOR EACH ROW EXECUTE FUNCTION preserve_resolved_task_input();

CREATE FUNCTION preserve_task_issue_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['status','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version']) THEN RAISE EXCEPTION 'Issue content is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER immutable_task_input_issue BEFORE UPDATE ON task_input_issues FOR EACH ROW EXECUTE FUNCTION preserve_task_issue_content();

-- Completed obligation dispositions are historical evidence. Later withdrawal,
-- supersession and reactivation affect pending obligations, never these records.
ALTER TABLE task_guidance_obligations ADD CHECK((status='handled')=(completion_operation_id IS NOT NULL));
CREATE FUNCTION preserve_terminal_guidance_obligation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status<>'pending' AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'Guidance disposition is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER terminal_guidance_obligation BEFORE UPDATE ON task_guidance_obligations FOR EACH ROW EXECUTE FUNCTION preserve_terminal_guidance_obligation();

CREATE FUNCTION validate_handled_guidance_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='handled' AND NOT EXISTS(
  SELECT 1 FROM completion_manifests m
  JOIN operations op ON op.id=m.operation_id AND op.attempt_id=m.attempt_id
  JOIN node_completions c ON c.operation_id=op.id AND c.attempt_id=m.attempt_id
   AND c.node_id=m.node_id AND c.activation=m.node_activation
  JOIN task_guidance_assignments a ON a.source_id=m.source_id
   AND a.obligation_id=NEW.id AND a.guidance_id=NEW.guidance_id
  WHERE m.operation_id=NEW.completion_operation_id AND m.task_id=NEW.task_id
   AND m.node_id=NEW.node_id AND m.node_activation=NEW.node_activation
   AND m.manifest_version=2 AND m.handled_guidance_ids ? NEW.guidance_id
   AND op.kind='complete_node' AND op.state='succeeded'
   AND op.completion_manifest_digest=m.content_digest
 ) THEN
  RAISE EXCEPTION 'Handled guidance requires its exact successful completion' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
-- Completion projection settles guidance before inserting node_completions in
-- the same transaction, so validate the complete committed evidence set.
CREATE CONSTRAINT TRIGGER handled_guidance_completion AFTER INSERT OR UPDATE ON task_guidance_obligations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_handled_guidance_completion();
