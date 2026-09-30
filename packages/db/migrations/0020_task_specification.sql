-- Requirement publication is additive; existing revisions and manifest hashes stay immutable.
ALTER TABLE operations DROP CONSTRAINT operations_settlement_purpose_check;
ALTER TABLE operations ADD CONSTRAINT operations_settlement_purpose_check CHECK(settlement_purpose IN ('correct','cancel_task','specification_change'));
CREATE TABLE requirement_obligations (
 id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), current_proposal_id text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','withdrawn','cancelled')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), source_issue_id text,
 UNIQUE(task_id,id), FOREIGN KEY(task_id,source_issue_id) REFERENCES task_input_issues(task_id,id)
);
CREATE TABLE requirement_proposals (
 id text PRIMARY KEY REFERENCES task_command_proposals(id), task_id text NOT NULL REFERENCES tasks(id),
 obligation_id text NOT NULL, predecessor_id text, source_id text, input_id text,
 specification text NOT NULL CHECK(char_length(specification) BETWEEN 1 AND 65536 AND octet_length(specification)<=262144),
 summary text NOT NULL CHECK(char_length(summary) BETWEEN 1 AND 4096), impact jsonb NOT NULL,
 specification_digest text NOT NULL CHECK(specification_digest ~ '^[a-f0-9]{64}$'), impact_digest text NOT NULL CHECK(impact_digest ~ '^[a-f0-9]{64}$'),
 content_digest text NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'),
 base_specification_id text NOT NULL, base_plan_id text, base_control_version bigint NOT NULL,
 input_cutoff bigint NOT NULL CHECK(input_cutoff>=0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(task_id,id), FOREIGN KEY(task_id,obligation_id) REFERENCES requirement_obligations(task_id,id),
 FOREIGN KEY(task_id,predecessor_id) REFERENCES requirement_proposals(task_id,id),
 FOREIGN KEY(task_id,source_id) REFERENCES task_conversation_outbox(task_id,id),
 FOREIGN KEY(task_id,input_id) REFERENCES task_inputs(task_id,id),
 FOREIGN KEY(task_id,base_specification_id) REFERENCES specification_revisions(task_id,id),
 FOREIGN KEY(task_id,base_plan_id) REFERENCES plan_revisions(task_id,id),
 CHECK((source_id IS NULL)=(input_id IS NULL)), CHECK(predecessor_id IS NULL OR predecessor_id<>id)
);
ALTER TABLE requirement_obligations ADD FOREIGN KEY(task_id,current_proposal_id) REFERENCES requirement_proposals(task_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE requirement_sources (
 task_id text NOT NULL, proposal_id text NOT NULL, input_id text NOT NULL,
 PRIMARY KEY(proposal_id,input_id), FOREIGN KEY(task_id,proposal_id) REFERENCES requirement_proposals(task_id,id),
 FOREIGN KEY(task_id,input_id) REFERENCES task_inputs(task_id,id)
);
CREATE TABLE requirement_attachments (
 task_id text NOT NULL, proposal_id text PRIMARY KEY, input_id text, source_id text,
 FOREIGN KEY(task_id,proposal_id) REFERENCES requirement_proposals(task_id,id),
 FOREIGN KEY(task_id,input_id) REFERENCES task_inputs(task_id,id),
 FOREIGN KEY(task_id,source_id) REFERENCES task_conversation_outbox(task_id,id)
);
CREATE TABLE requirement_changes (
 id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), proposal_id text NOT NULL UNIQUE,
 authorization_id text NOT NULL UNIQUE REFERENCES authorization_receipts(id),
 status text NOT NULL DEFAULT 'settling' CHECK(status IN ('settling','withdrawing','published','withdrawn','cancelled')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), admission_control_version bigint NOT NULL,
 specification_id text NOT NULL UNIQUE, attention text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_checked_at timestamptz NOT NULL DEFAULT 'epoch',
 UNIQUE(task_id,id), FOREIGN KEY(task_id,proposal_id) REFERENCES requirement_proposals(task_id,id)
);
-- Shared publication ownership seam; future Replan must acquire the same slot.
CREATE TABLE task_publication_slots (
 task_id text PRIMARY KEY REFERENCES tasks(id), operation_id text NOT NULL UNIQUE,
 FOREIGN KEY(task_id,operation_id) REFERENCES requirement_changes(task_id,id)
);
CREATE TABLE requirement_change_attempts (
 task_id text NOT NULL, change_id text NOT NULL, attempt_id text NOT NULL REFERENCES attempts(id),
 PRIMARY KEY(change_id,attempt_id), FOREIGN KEY(task_id,change_id) REFERENCES requirement_changes(task_id,id)
);
CREATE TABLE requirement_change_effects (
 task_id text NOT NULL, change_id text NOT NULL, operation_id text NOT NULL REFERENCES operations(id),
 PRIMARY KEY(change_id,operation_id), FOREIGN KEY(task_id,change_id) REFERENCES requirement_changes(task_id,id)
);
CREATE TABLE requirement_input_deferrals (
 task_id text NOT NULL, proposal_id text NOT NULL, input_id text NOT NULL, input_version bigint NOT NULL,
 request_id text NOT NULL, PRIMARY KEY(proposal_id,input_id,input_version),
 FOREIGN KEY(task_id,proposal_id) REFERENCES requirement_proposals(task_id,id),
 FOREIGN KEY(task_id,input_id) REFERENCES task_inputs(task_id,id),
 FOREIGN KEY(task_id,request_id) REFERENCES owner_command_receipts(scope_id,request_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE requirement_publications (
 task_id text NOT NULL, change_id text PRIMARY KEY, specification_id text NOT NULL UNIQUE,
 parent_id text NOT NULL, plan_id text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(task_id,change_id,specification_id), FOREIGN KEY(task_id,change_id) REFERENCES requirement_changes(task_id,id),
 FOREIGN KEY(task_id,specification_id) REFERENCES specification_revisions(task_id,id),
 FOREIGN KEY(task_id,parent_id) REFERENCES specification_revisions(task_id,id),
 FOREIGN KEY(task_id,plan_id) REFERENCES plan_revisions(task_id,id)
);
CREATE TABLE specification_node_applicability (
 task_id text NOT NULL, change_id text NOT NULL, specification_id text NOT NULL, parent_id text NOT NULL,
 plan_id text NOT NULL, node_id text NOT NULL, node_activation bigint NOT NULL,
 disposition text NOT NULL CHECK(disposition IN ('refresh','carry','invalidate')),
 completion_operation_id text REFERENCES node_completions(operation_id), completion_manifest_digest text,
 PRIMARY KEY(specification_id,node_id,node_activation),
 FOREIGN KEY(task_id,change_id,specification_id) REFERENCES requirement_publications(task_id,change_id,specification_id),
 FOREIGN KEY(node_id,node_activation) REFERENCES node_activations(node_id,activation),
 FOREIGN KEY(plan_id,node_id) REFERENCES plan_nodes(plan_id,node_id),
 CHECK((disposition='carry')=(completion_operation_id IS NOT NULL)),
 CHECK((completion_operation_id IS NULL)=(completion_manifest_digest IS NULL))
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['requirement_proposals','requirement_sources','requirement_attachments','requirement_change_attempts','requirement_change_effects','requirement_input_deferrals','requirement_publications','specification_node_applicability'] LOOP
 EXECUTE format('CREATE TRIGGER immutable_requirement BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change()',t);
END LOOP; END $$;
CREATE FUNCTION preserve_requirement_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 -- Scheduling observations do not advance the Owner-visible operation version.
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='requirement_changes' AND OLD.status IN ('settling','withdrawing') AND (to_jsonb(NEW)-'last_checked_at')=(to_jsonb(OLD)-'last_checked_at') THEN RETURN NEW; END IF;
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','version','attention','current_proposal_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','attention','current_proposal_id']) OR
 OLD.status IN ('published','withdrawn','cancelled') OR NEW.version<>OLD.version+1 THEN
 RAISE EXCEPTION 'requirement identity or terminal disposition is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER requirement_change_identity BEFORE UPDATE OR DELETE ON requirement_changes FOR EACH ROW EXECUTE FUNCTION preserve_requirement_projection();
CREATE TRIGGER requirement_obligation_identity BEFORE UPDATE OR DELETE ON requirement_obligations FOR EACH ROW EXECUTE FUNCTION preserve_requirement_projection();
CREATE FUNCTION validate_requirement_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p requirement_proposals; c requirement_changes; pub requirement_publications; activation_row node_activations;
BEGIN
 IF TG_TABLE_NAME='requirement_attachments' THEN
 SELECT * INTO p FROM requirement_proposals WHERE id=NEW.proposal_id;
 IF NEW.source_id IS DISTINCT FROM p.source_id OR NEW.input_id IS DISTINCT FROM p.input_id OR
 (p.source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM task_input_resolutions r WHERE r.input_id=p.input_id AND r.source_id=p.source_id AND r.routing->>'kind'='specification_proposal' AND r.routing->>'proposal_id'=p.id)) THEN
 RAISE EXCEPTION 'proposal attachment lacks canonical source reply' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='requirement_change_attempts' THEN
 IF NOT EXISTS(SELECT 1 FROM attempts WHERE id=NEW.attempt_id AND task_id=NEW.task_id AND task_conversation_source_id IS NULL) THEN RAISE EXCEPTION 'change Attempt outside execution scope' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='requirement_change_effects' THEN
 IF NOT EXISTS(SELECT 1 FROM operations o JOIN requirement_change_attempts a ON a.attempt_id=o.attempt_id AND a.change_id=NEW.change_id WHERE o.id=NEW.operation_id AND a.task_id=NEW.task_id) THEN RAISE EXCEPTION 'change effect outside settled ownership' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='requirement_publications' THEN
 SELECT * INTO c FROM requirement_changes WHERE id=NEW.change_id;
 SELECT * INTO p FROM requirement_proposals WHERE id=c.proposal_id;
 IF c.status<>'published' OR c.specification_id<>NEW.specification_id OR p.base_specification_id<>NEW.parent_id OR p.base_plan_id IS DISTINCT FROM NEW.plan_id OR NOT EXISTS(SELECT 1 FROM specification_revisions s WHERE s.id=NEW.specification_id AND s.parent_id=NEW.parent_id AND s.authorization_id=c.authorization_id AND s.content=to_jsonb(p.specification) AND s.content_digest=p.specification_digest) THEN RAISE EXCEPTION 'publication differs from exact admitted requirements' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='specification_node_applicability' THEN
 SELECT * INTO pub FROM requirement_publications WHERE change_id=NEW.change_id;
 SELECT * INTO activation_row FROM node_activations WHERE node_id=NEW.node_id AND activation=NEW.node_activation;
 IF activation_row.task_id<>NEW.task_id OR activation_row.plan_id<>NEW.plan_id OR pub.plan_id<>NEW.plan_id OR pub.parent_id<>NEW.parent_id OR
 (NEW.disposition='carry' AND NOT EXISTS(SELECT 1 FROM node_completions nc JOIN completion_manifests m ON m.operation_id=nc.operation_id WHERE nc.operation_id=NEW.completion_operation_id AND nc.node_id=NEW.node_id AND nc.activation=NEW.node_activation AND m.content_digest=NEW.completion_manifest_digest)) THEN RAISE EXCEPTION 'applicability identity differs from published evidence' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL; END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['requirement_attachments','requirement_change_attempts','requirement_change_effects','requirement_publications','specification_node_applicability'] LOOP
 EXECUTE format('CREATE CONSTRAINT TRIGGER requirement_attribution AFTER INSERT ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_requirement_links()',t);
END LOOP; END $$;
-- Validate the exact authorization/source/impact chain at COMMIT, after attachment
-- and publication have completed their atomic writes.
CREATE FUNCTION validate_requirement_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proposal_row requirement_proposals; change_row requirement_changes; activation_row node_activations; target jsonb; guidance_item jsonb; prior_spec text;
BEGIN
 IF TG_TABLE_NAME='requirement_proposals' THEN
  proposal_row:=NEW;
  IF NOT EXISTS(SELECT 1 FROM task_command_proposals g WHERE g.id=NEW.id AND g.task_id=NEW.task_id AND g.action='apply_specification_revision' AND g.content_digest=NEW.content_digest AND g.content->>'specification'=NEW.specification AND g.content->>'summary'=NEW.summary AND g.content->'impact'=NEW.impact AND g.content->>'source_id' IS NOT DISTINCT FROM NEW.source_id AND g.content->>'specification_digest'=NEW.specification_digest AND g.content->>'impact_digest'=NEW.impact_digest AND g.basis->>'specification_id'=NEW.base_specification_id AND g.basis->>'plan_id' IS NOT DISTINCT FROM NEW.base_plan_id AND (g.basis->>'control_version')::bigint=NEW.base_control_version AND (g.content->>'input_cutoff')::bigint=NEW.input_cutoff) THEN RAISE EXCEPTION 'proposal does not bind exact authorization envelope' USING ERRCODE='23514'; END IF;
  IF NEW.source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM task_conversation_outbox s WHERE s.id=NEW.source_id AND s.task_id=NEW.task_id AND s.input_id=NEW.input_id AND s.source_watermark=NEW.input_cutoff AND NOT s.reply_only) THEN RAISE EXCEPTION 'proposal canonical source attribution differs' USING ERRCODE='23514'; END IF;
  IF NEW.impact->'graph_sufficient' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(NEW.impact->'nodes') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.impact->'guidance') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'complete sufficient impact required' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM plan_nodes pn WHERE pn.plan_id=NEW.base_plan_id)<>jsonb_array_length(NEW.impact->'nodes') OR jsonb_array_length(NEW.impact->'nodes')>1 THEN RAISE EXCEPTION 'impact does not cover exact unchanged graph' USING ERRCODE='23514'; END IF;
  FOR target IN SELECT value FROM jsonb_array_elements(NEW.impact->'nodes') LOOP
   IF jsonb_typeof(target->'node_id')<>'string' OR jsonb_typeof(target->'node_activation')<>'number' OR jsonb_typeof(target->'disposition') IS DISTINCT FROM 'string' OR target->>'disposition' NOT IN ('refresh','invalidate','carry') THEN RAISE EXCEPTION 'invalid impact Node identity' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT 1 FROM node_activations na JOIN plan_nodes pn ON pn.node_id=na.node_id AND pn.plan_id=na.plan_id WHERE na.task_id=NEW.task_id AND na.plan_id=NEW.base_plan_id AND na.node_id=target->>'node_id' AND na.activation=(target->>'node_activation')::bigint) THEN RAISE EXCEPTION 'impact activation outside Task Plan' USING ERRCODE='23514'; END IF;
   IF target->>'source_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM node_execution_outbox ns WHERE ns.id=target->>'source_id' AND ns.task_id=NEW.task_id AND ns.node_id=target->>'node_id' AND ns.node_activation=(target->>'node_activation')::bigint) THEN RAISE EXCEPTION 'impact source outside activation' USING ERRCODE='23514'; END IF;
   IF target->>'disposition'='refresh' THEN
    IF target->>'completion_operation_id' IS NOT NULL OR target->>'completion_manifest_digest' IS NOT NULL THEN RAISE EXCEPTION 'refresh cannot carry completed evidence' USING ERRCODE='23514'; END IF;
   ELSIF NOT EXISTS(SELECT 1 FROM node_completions nc JOIN completion_manifests m ON m.operation_id=nc.operation_id WHERE nc.node_id=target->>'node_id' AND nc.activation=(target->>'node_activation')::bigint AND nc.operation_id=target->>'completion_operation_id' AND m.content_digest=target->>'completion_manifest_digest') THEN RAISE EXCEPTION 'impact completion attribution differs' USING ERRCODE='23514'; END IF;
  END LOOP;
  FOR guidance_item IN SELECT value FROM jsonb_array_elements(NEW.impact->'guidance') LOOP
   IF jsonb_typeof(guidance_item->'guidance_id')<>'string' OR jsonb_typeof(guidance_item->'version')<>'number' OR jsonb_typeof(guidance_item->'disposition') IS DISTINCT FROM 'string' OR guidance_item->>'disposition' NOT IN ('retain','supersede') OR NOT EXISTS(SELECT 1 FROM task_guidance g WHERE g.task_id=NEW.task_id AND g.id=guidance_item->>'guidance_id') THEN RAISE EXCEPTION 'impact guidance outside Task' USING ERRCODE='23514'; END IF;
  END LOOP;
 ELSIF TG_TABLE_NAME='requirement_changes' THEN
  SELECT * INTO proposal_row FROM requirement_proposals WHERE id=NEW.proposal_id;
  IF NOT EXISTS(SELECT 1 FROM authorization_receipts ar WHERE ar.id=NEW.authorization_id AND ar.proposal_id=NEW.proposal_id AND ar.consumed_by IS NOT NULL) OR NEW.admission_control_version<>proposal_row.base_control_version+1 THEN RAISE EXCEPTION 'change exact consumed authorization missing' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='requirement_sources' THEN
  SELECT * INTO proposal_row FROM requirement_proposals WHERE id=NEW.proposal_id;
  IF NOT EXISTS(SELECT 1 FROM task_inputs i JOIN task_messages m ON m.id=i.message_id JOIN task_command_proposals g ON g.id=NEW.proposal_id WHERE i.id=NEW.input_id AND i.task_id=NEW.task_id AND m.sequence<=proposal_row.input_cutoff AND g.content->'source_input_ids' ? NEW.input_id) THEN RAISE EXCEPTION 'source input exceeds authorized cutoff' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='specification_node_applicability' THEN
  SELECT * INTO change_row FROM requirement_changes WHERE id=NEW.change_id;
  SELECT * INTO proposal_row FROM requirement_proposals WHERE id=change_row.proposal_id;
  SELECT * INTO activation_row FROM node_activations WHERE node_id=NEW.node_id AND activation=NEW.node_activation;
  SELECT value INTO target FROM jsonb_array_elements(proposal_row.impact->'nodes') WHERE value->>'node_id'=NEW.node_id AND (value->>'node_activation')::bigint=NEW.node_activation;
  IF target IS NULL OR NOT (NEW.disposition=target->>'disposition' OR (NEW.disposition='invalidate' AND target->>'disposition'='refresh' AND EXISTS(SELECT 1 FROM node_completions WHERE node_id=NEW.node_id AND activation=NEW.node_activation))) OR (NEW.disposition='carry' AND (NEW.completion_operation_id IS DISTINCT FROM target->>'completion_operation_id' OR NEW.completion_manifest_digest IS DISTINCT FROM target->>'completion_manifest_digest')) THEN RAISE EXCEPTION 'applicability exceeds exact authorized impact' USING ERRCODE='23514'; END IF;
  IF activation_row.specification_id<>NEW.parent_id AND NOT EXISTS(SELECT 1 FROM specification_node_applicability prev WHERE prev.specification_id=NEW.parent_id AND prev.node_id=NEW.node_id AND prev.node_activation=NEW.node_activation AND prev.plan_id=NEW.plan_id AND prev.disposition IN ('refresh','carry') AND (NEW.disposition<>'carry' OR prev.completion_operation_id=NEW.completion_operation_id OR (prev.disposition='refresh' AND EXISTS(SELECT 1 FROM completion_manifests fresh WHERE fresh.operation_id=NEW.completion_operation_id AND fresh.specification_id=NEW.parent_id AND fresh.node_id=NEW.node_id AND fresh.node_activation=NEW.node_activation)))) THEN RAISE EXCEPTION 'applicability cannot cross an invalidated or missing basis' USING ERRCODE='23514'; END IF;
 END IF; RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['requirement_proposals','requirement_changes','requirement_sources','specification_node_applicability'] LOOP
 EXECUTE format('CREATE CONSTRAINT TRIGGER requirement_authority AFTER INSERT ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_requirement_authority()',t);
END LOOP; END $$;
CREATE FUNCTION preserve_requirement_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='task_command_proposals' THEN
  IF EXISTS(SELECT 1 FROM requirement_proposals WHERE id=OLD.id) THEN
   IF TG_OP='DELETE' OR (to_jsonb(NEW)-'revoked') IS DISTINCT FROM (to_jsonb(OLD)-'revoked') OR OLD.revoked THEN RAISE EXCEPTION 'exact requirement confirmation content is immutable' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM requirement_proposals WHERE id=OLD.proposal_id) THEN
   IF TG_OP='DELETE' OR (to_jsonb(NEW)-'consumed_by') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_by') OR (OLD.consumed_by IS NOT NULL AND NEW.consumed_by IS DISTINCT FROM OLD.consumed_by) THEN RAISE EXCEPTION 'requirement authorization is one-way' USING ERRCODE='23514'; END IF;
  END IF;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER requirement_confirmation_identity BEFORE UPDATE OR DELETE ON task_command_proposals FOR EACH ROW EXECUTE FUNCTION preserve_requirement_confirmation();
CREATE TRIGGER requirement_authorization_identity BEFORE UPDATE OR DELETE ON authorization_receipts FOR EACH ROW EXECUTE FUNCTION preserve_requirement_confirmation();
-- Fresh initial planning may be owned by a consumed durable change, not an Owner
-- request. Do not fabricate an Owner command receipt for a background transition.
ALTER TABLE task_planning_outbox ALTER COLUMN owner_request_id DROP NOT NULL;
ALTER TABLE task_planning_outbox ADD COLUMN requirement_change_id text;
ALTER TABLE task_planning_outbox ADD FOREIGN KEY(task_id,requirement_change_id) REFERENCES requirement_changes(task_id,id);
ALTER TABLE task_planning_outbox ADD CHECK((owner_request_id IS NULL)<>(requirement_change_id IS NULL));
ALTER TABLE requirement_proposals ADD UNIQUE(task_id,obligation_id,id);
ALTER TABLE requirement_obligations ADD FOREIGN KEY(task_id,id,current_proposal_id) REFERENCES requirement_proposals(task_id,obligation_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION validate_requirement_impact_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g jsonb; n jsonb;
BEGIN
 IF NEW.predecessor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM requirement_proposals previous_proposal WHERE previous_proposal.id=NEW.predecessor_id AND previous_proposal.task_id=NEW.task_id AND previous_proposal.obligation_id=NEW.obligation_id) THEN RAISE EXCEPTION 'replacement must retain its originating obligation' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(NEW.impact->'guidance') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.impact->'nodes') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'complete impact arrays required' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(NEW.impact->'guidance'))<>(SELECT count(DISTINCT value->>'guidance_id') FROM jsonb_array_elements(NEW.impact->'guidance')) OR jsonb_array_length(NEW.impact->'guidance')<>(SELECT count(*) FROM task_guidance WHERE task_id=NEW.task_id AND status='active') THEN RAISE EXCEPTION 'impact must cover each active guidance exactly once' USING ERRCODE='23514'; END IF;
 FOR g IN SELECT value FROM jsonb_array_elements(NEW.impact->'guidance') LOOP
  IF jsonb_typeof(g->'guidance_id') IS DISTINCT FROM 'string' OR jsonb_typeof(g->'version') IS DISTINCT FROM 'number' OR jsonb_typeof(g->'disposition') IS DISTINCT FROM 'string' OR g->>'disposition' NOT IN ('retain','supersede') THEN RAISE EXCEPTION 'invalid guidance identity types' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM task_guidance actual WHERE actual.id=g->>'guidance_id' AND actual.task_id=NEW.task_id AND actual.status='active' AND to_jsonb(actual.version)=g->'version') THEN RAISE EXCEPTION 'impact guidance version differs' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=NEW.task_id AND t.specification_id=NEW.base_specification_id AND t.plan_id IS NOT DISTINCT FROM NEW.base_plan_id AND t.control_version=NEW.base_control_version) THEN RAISE EXCEPTION 'proposal current basis differs' USING ERRCODE='23514'; END IF;
 FOR n IN SELECT value FROM jsonb_array_elements(NEW.impact->'nodes') LOOP
  IF jsonb_typeof(n->'node_id') IS DISTINCT FROM 'string' OR jsonb_typeof(n->'node_activation') IS DISTINCT FROM 'number' OR COALESCE(jsonb_typeof(n->'source_id'),'missing') NOT IN ('null','string') OR COALESCE(jsonb_typeof(n->'completion_operation_id'),'missing') NOT IN ('null','string') OR COALESCE(jsonb_typeof(n->'completion_manifest_digest'),'missing') NOT IN ('null','string') THEN RAISE EXCEPTION 'invalid Node identity types' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM nodes actual LEFT JOIN node_completions c ON c.node_id=actual.id AND c.activation=actual.activation LEFT JOIN completion_manifests m ON m.operation_id=c.operation_id WHERE actual.id=n->>'node_id' AND actual.task_id=NEW.task_id AND to_jsonb(actual.activation)=n->'node_activation' AND actual.execution_source_id IS NOT DISTINCT FROM n->>'source_id' AND c.operation_id IS NOT DISTINCT FROM n->>'completion_operation_id' AND m.content_digest IS NOT DISTINCT FROM n->>'completion_manifest_digest') THEN RAISE EXCEPTION 'impact current source or completion differs' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER requirement_impact_snapshot BEFORE INSERT ON requirement_proposals FOR EACH ROW EXECUTE FUNCTION validate_requirement_impact_snapshot();
CREATE FUNCTION validate_requirement_deferral() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE command_json jsonb;
BEGIN
 SELECT envelope_json::jsonb INTO command_json FROM owner_command_receipts WHERE scope_id=NEW.task_id AND request_id=NEW.request_id;
 IF command_json->>'name' IS DISTINCT FROM 'defer_specification_inputs' OR command_json->>'task_id' IS DISTINCT FROM NEW.task_id OR command_json->'payload'->>'proposal_id' IS DISTINCT FROM NEW.proposal_id OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(command_json->'payload'->'inputs') input WHERE input=jsonb_build_object('input_id',NEW.input_id,'version',NEW.input_version)) THEN RAISE EXCEPTION 'input deferral requires its exact Owner command' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER requirement_deferral_authority AFTER INSERT ON requirement_input_deferrals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_requirement_deferral();
CREATE FUNCTION validate_requirement_publication_slot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c requirement_changes; change_id text;
BEGIN
 IF TG_TABLE_NAME='requirement_changes' THEN change_id:=NEW.id;
 ELSIF TG_OP='DELETE' THEN change_id:=OLD.operation_id;
 ELSE change_id:=NEW.operation_id; END IF;
 SELECT * INTO c FROM requirement_changes WHERE id=change_id;
 IF c.status IN ('settling','withdrawing') AND NOT EXISTS(SELECT 1 FROM task_publication_slots s WHERE s.task_id=c.task_id AND s.operation_id=c.id) THEN RAISE EXCEPTION 'unsettled change must retain its publication slot' USING ERRCODE='23514'; END IF;
 IF c.status IN ('published','withdrawn','cancelled') AND EXISTS(SELECT 1 FROM task_publication_slots s WHERE s.operation_id=c.id) THEN RAISE EXCEPTION 'settled change must release its own slot' USING ERRCODE='23514'; END IF;
 IF (c.status='published') IS DISTINCT FROM EXISTS(SELECT 1 FROM requirement_publications p WHERE p.change_id=c.id) THEN RAISE EXCEPTION 'published status requires exact immutable publication' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER requirement_slot_owner AFTER INSERT OR UPDATE ON requirement_changes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_requirement_publication_slot();
CREATE CONSTRAINT TRIGGER requirement_slot_retained AFTER INSERT OR UPDATE OR DELETE ON task_publication_slots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_requirement_publication_slot();
CREATE FUNCTION validate_requirement_source_completeness() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p requirement_proposals; envelope jsonb; source_row jsonb;
BEGIN
 IF TG_TABLE_NAME='requirement_proposals' THEN p:=NEW; ELSE SELECT * INTO p FROM requirement_proposals WHERE id=NEW.proposal_id; END IF;
 SELECT content INTO envelope FROM task_command_proposals WHERE id=p.id;
 IF envelope->>'task_id' IS DISTINCT FROM p.task_id OR envelope->>'proposal_id' IS DISTINCT FROM p.id OR
 envelope->'basis'->>'specification_id' IS DISTINCT FROM p.base_specification_id OR envelope->'basis'->>'plan_id' IS DISTINCT FROM p.base_plan_id OR envelope->'basis'->'control_version' IS DISTINCT FROM to_jsonb(p.base_control_version) OR jsonb_typeof(envelope->'source_input_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'proposal envelope scope and basis must match' USING ERRCODE='23514'; END IF;
 FOR source_row IN SELECT value FROM jsonb_array_elements(envelope->'source_input_ids') LOOP
  IF jsonb_typeof(source_row) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'source IDs must be strings' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF jsonb_array_length(envelope->'source_input_ids')<>(SELECT count(DISTINCT value) FROM jsonb_array_elements(envelope->'source_input_ids')) OR jsonb_array_length(envelope->'source_input_ids')<>(SELECT count(*) FROM requirement_sources WHERE proposal_id=p.id) OR
 (p.input_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM requirement_sources WHERE proposal_id=p.id AND input_id=p.input_id)) THEN RAISE EXCEPTION 'normalized proposal sources must be complete and unique' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER requirement_source_complete AFTER INSERT ON requirement_proposals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_requirement_source_completeness();
CREATE CONSTRAINT TRIGGER requirement_source_set_complete AFTER INSERT ON requirement_sources DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_requirement_source_completeness();
CREATE TRIGGER immutable_publication_slot BEFORE UPDATE ON task_publication_slots FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TABLE requirement_authorization_commands (
 authorization_id text PRIMARY KEY REFERENCES authorization_receipts(id), task_id text NOT NULL REFERENCES tasks(id),
 request_id text NOT NULL, FOREIGN KEY(task_id,request_id) REFERENCES owner_command_receipts(scope_id,request_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER immutable_requirement_authorization_command BEFORE UPDATE OR DELETE ON requirement_authorization_commands FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
ALTER TABLE requirement_changes ADD COLUMN admission_request_id text NOT NULL;
ALTER TABLE requirement_changes ADD COLUMN admission_attempt_id text REFERENCES attempts(id);
CREATE FUNCTION validate_requirement_command_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p requirement_proposals; command_row jsonb; response_row jsonb; ar authorization_receipts; envelope jsonb; expected_payload jsonb;
BEGIN
 IF TG_TABLE_NAME='requirement_authorization_commands' THEN
  SELECT * INTO ar FROM authorization_receipts WHERE id=NEW.authorization_id;
  SELECT * INTO p FROM requirement_proposals WHERE id=ar.proposal_id;
  SELECT content INTO envelope FROM task_command_proposals WHERE id=p.id;
  expected_payload:=jsonb_build_object('proposal_id',p.id,'specification',p.specification,'summary',p.summary,'impact',p.impact,'basis',envelope->'basis','source_input_ids',envelope->'source_input_ids') || CASE WHEN p.predecessor_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('supersedes',p.predecessor_id) END;
  SELECT envelope_json::jsonb,response INTO command_row,response_row FROM owner_command_receipts WHERE scope_id=NEW.task_id AND request_id=NEW.request_id;
  IF p.task_id IS DISTINCT FROM NEW.task_id OR (CASE WHEN command_row->>'name'='confirm_proposal' THEN command_row->>'scope_id' ELSE command_row->>'task_id' END) IS DISTINCT FROM NEW.task_id OR command_row->>'request_id' IS DISTINCT FROM NEW.request_id OR response_row->>'request_id' IS DISTINCT FROM NEW.request_id OR (response_row->>'status' IN ('committed','admitted')) IS NOT TRUE OR response_row->>'confirmation_id' IS DISTINCT FROM ar.id OR command_row->'payload'->>'proposal_id' IS DISTINCT FROM p.id OR (
   (command_row->>'name' IN ('confirm_specification','confirm_proposal') AND response_row->>'status'='committed' AND command_row->'payload'=jsonb_build_object('proposal_id',p.id,'content_digest',p.content_digest) AND (command_row->>'name'<>'confirm_proposal' OR command_row->'expected_control_version'=to_jsonb(p.base_control_version))) OR
   (command_row->>'name'='edit_specification' AND command_row->'payload'=expected_payload)
  ) IS NOT TRUE THEN RAISE EXCEPTION 'requirement authorization lacks exact Owner confirmation command' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='requirement_changes' THEN
  SELECT * INTO p FROM requirement_proposals WHERE id=NEW.proposal_id;
  SELECT content INTO envelope FROM task_command_proposals WHERE id=p.id;
  expected_payload:=jsonb_build_object('proposal_id',p.id,'specification',p.specification,'summary',p.summary,'impact',p.impact,'basis',envelope->'basis','source_input_ids',envelope->'source_input_ids') || CASE WHEN p.predecessor_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('supersedes',p.predecessor_id) END;
  SELECT * INTO ar FROM authorization_receipts WHERE id=NEW.authorization_id;
  IF ar.consumed_by IS DISTINCT FROM NEW.admission_request_id OR NOT EXISTS(SELECT 1 FROM requirement_authorization_commands WHERE authorization_id=ar.id AND task_id=NEW.task_id) THEN RAISE EXCEPTION 'change lacks confirmed Owner authorization provenance' USING ERRCODE='23514'; END IF;
  IF NEW.admission_attempt_id IS NULL THEN
   SELECT envelope_json::jsonb,response INTO command_row,response_row FROM owner_command_receipts WHERE scope_id=NEW.task_id AND request_id=NEW.admission_request_id;
   IF command_row->>'task_id' IS DISTINCT FROM NEW.task_id OR command_row->>'request_id' IS DISTINCT FROM NEW.admission_request_id OR command_row->'payload'->>'proposal_id' IS DISTINCT FROM p.id OR response_row->>'request_id' IS DISTINCT FROM NEW.admission_request_id OR response_row->>'status' IS DISTINCT FROM 'admitted' OR response_row->>'operation_id' IS DISTINCT FROM NEW.id OR (
    (command_row->>'name'='apply_specification_revision' AND command_row->'payload'->>'confirmation_id'=ar.id AND command_row->'payload'->'basis'->'control_version'=to_jsonb(p.base_control_version) AND command_row->'payload'->'basis'->>'specification_id'=p.base_specification_id AND command_row->'payload'->'basis'->>'plan_id' IS NOT DISTINCT FROM p.base_plan_id) OR
    (command_row->>'name'='edit_specification' AND command_row->'payload'=expected_payload AND response_row->>'confirmation_id'=ar.id)
   ) IS NOT TRUE THEN RAISE EXCEPTION 'change lacks exact Owner admission command' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT envelope_json::jsonb,response INTO command_row,response_row FROM command_receipts WHERE attempt_id=NEW.admission_attempt_id AND scope_id=NEW.task_id AND request_id=NEW.admission_request_id;
   IF command_row->>'scope_id' IS DISTINCT FROM NEW.task_id OR command_row->>'request_id' IS DISTINCT FROM NEW.admission_request_id OR command_row->>'name' IS DISTINCT FROM 'apply_specification_revision' OR command_row->'payload'->>'proposal_id' IS DISTINCT FROM p.id OR command_row->'payload'->>'confirmation_id' IS DISTINCT FROM ar.id OR command_row->'payload'->'basis'->'control_version' IS DISTINCT FROM to_jsonb(p.base_control_version) OR command_row->'payload'->'basis'->>'specification_id' IS DISTINCT FROM p.base_specification_id OR command_row->'payload'->'basis'->>'plan_id' IS DISTINCT FROM p.base_plan_id OR response_row->>'request_id' IS DISTINCT FROM NEW.admission_request_id OR response_row->>'status' IS DISTINCT FROM 'committed' OR response_row->'result'->>'requirement_operation_id' IS DISTINCT FROM NEW.id OR NOT EXISTS(SELECT 1 FROM attempts a WHERE a.id=NEW.admission_attempt_id AND a.task_id=NEW.task_id AND a.task_conversation_source_id IS NOT NULL) THEN RAISE EXCEPTION 'change lacks exact source-scoped Agent admission command' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER requirement_authorization_command_exact AFTER INSERT ON requirement_authorization_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_requirement_command_authority();
CREATE CONSTRAINT TRIGGER requirement_admission_command_exact AFTER INSERT ON requirement_changes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_requirement_command_authority();
CREATE FUNCTION require_requirement_authorization_origin() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM requirement_proposals WHERE id=NEW.proposal_id) AND NOT EXISTS(SELECT 1 FROM requirement_authorization_commands WHERE authorization_id=NEW.id) THEN RAISE EXCEPTION 'requirement authorization needs an exact Owner command origin' USING ERRCODE='23514'; END IF;
 RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER requirement_authorization_origin AFTER INSERT ON authorization_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_requirement_authorization_origin();
CREATE FUNCTION retain_requirement_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='owner_command_receipts' THEN
  IF EXISTS(SELECT 1 FROM requirement_authorization_commands WHERE task_id=OLD.scope_id AND request_id=OLD.request_id) OR EXISTS(SELECT 1 FROM requirement_changes WHERE task_id=OLD.scope_id AND admission_request_id=OLD.request_id AND admission_attempt_id IS NULL) OR EXISTS(SELECT 1 FROM requirement_input_deferrals WHERE task_id=OLD.scope_id AND request_id=OLD.request_id) THEN RAISE EXCEPTION 'requirement Owner receipt is immutable' USING ERRCODE='23514'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM requirement_changes WHERE admission_attempt_id=OLD.attempt_id AND admission_request_id=OLD.request_id) THEN RAISE EXCEPTION 'requirement Agent receipt is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER requirement_owner_receipt_retained BEFORE UPDATE OR DELETE ON owner_command_receipts FOR EACH ROW EXECUTE FUNCTION retain_requirement_receipt();
CREATE TRIGGER requirement_agent_receipt_retained BEFORE UPDATE OR DELETE ON command_receipts FOR EACH ROW EXECUTE FUNCTION retain_requirement_receipt();
CREATE FUNCTION require_requirement_consumption_operation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.consumed_by IS NOT NULL AND EXISTS(SELECT 1 FROM requirement_proposals WHERE id=NEW.proposal_id) AND NOT EXISTS(SELECT 1 FROM requirement_changes WHERE authorization_id=NEW.id AND admission_request_id=NEW.consumed_by) THEN RAISE EXCEPTION 'consumed requirement authorization must own its exact change operation' USING ERRCODE='23514'; END IF;
 RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER requirement_consumption_owned AFTER INSERT OR UPDATE ON authorization_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_requirement_consumption_operation();
