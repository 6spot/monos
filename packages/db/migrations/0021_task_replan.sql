-- Additive Replan authority. Historical migrations, revisions and receipts remain unchanged.
ALTER TABLE task_command_proposals DROP CONSTRAINT task_command_proposals_action_check;
ALTER TABLE task_command_proposals ADD CHECK(action IN ('apply_specification_revision','apply_rework','accept_delivery','publish_replan'));
CREATE TABLE replan_requests (
 id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), reason text NOT NULL,
 origin_attempt_id text NOT NULL REFERENCES attempts(id), origin_node_id text, origin_activation bigint,
 input_id text, origin_source_id text, base_plan_id text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','dismissed','cancelled')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), source_id text, proposal_id text, issue_id text,
 direction text, last_checked_at timestamptz NOT NULL DEFAULT 'epoch', created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(task_id,id), FOREIGN KEY(task_id,base_plan_id) REFERENCES plan_revisions(task_id,id),
 FOREIGN KEY(task_id,input_id) REFERENCES task_inputs(task_id,id),
 FOREIGN KEY(origin_node_id,origin_activation) REFERENCES node_activations(node_id,activation),
 CHECK((origin_node_id IS NULL)=(origin_activation IS NULL)), CHECK((input_id IS NULL)=(origin_source_id IS NULL)),
 CHECK((origin_node_id IS NOT NULL)<>(input_id IS NOT NULL))
);
CREATE UNIQUE INDEX one_pending_replan ON replan_requests(task_id) WHERE status='pending';
CREATE TABLE replan_live_attempts (
 task_id text NOT NULL, request_id text NOT NULL, attempt_id text NOT NULL REFERENCES attempts(id),
 source_id text NOT NULL REFERENCES node_execution_outbox(id), prior_control_version bigint NOT NULL, freeze_control_version bigint NOT NULL,
 PRIMARY KEY(request_id,attempt_id), FOREIGN KEY(task_id,request_id) REFERENCES replan_requests(task_id,id)
);
CREATE TABLE replan_sources (
 id text PRIMARY KEY, task_id text NOT NULL, request_id text NOT NULL, previous_source_id text,
 planned_attempt_id text NOT NULL UNIQUE, specification_id text NOT NULL, plan_id text NOT NULL,
 expected_version bigint NOT NULL, input_cutoff bigint NOT NULL, event_cutoff bigint NOT NULL,
 configuration_version bigint NOT NULL, context jsonb, prompt text, context_digest text NOT NULL,
 preparation_failure text, waiting_reason text, done boolean NOT NULL DEFAULT false,
 last_checked_at timestamptz NOT NULL DEFAULT 'epoch', created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(task_id,id), FOREIGN KEY(task_id,request_id) REFERENCES replan_requests(task_id,id),
 UNIQUE(request_id,id),
 FOREIGN KEY(request_id,previous_source_id) REFERENCES replan_sources(request_id,id),
 CHECK(previous_source_id IS DISTINCT FROM id),
 FOREIGN KEY(task_id,specification_id) REFERENCES specification_revisions(task_id,id),
 FOREIGN KEY(task_id,plan_id) REFERENCES plan_revisions(task_id,id)
);
CREATE UNIQUE INDEX replan_source_one_root ON replan_sources(request_id) WHERE previous_source_id IS NULL;
CREATE UNIQUE INDEX replan_source_one_successor ON replan_sources(previous_source_id) WHERE previous_source_id IS NOT NULL;
ALTER TABLE replan_requests ADD FOREIGN KEY(task_id,source_id) REFERENCES replan_sources(task_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE attempts ADD COLUMN replan_source_id text;
ALTER TABLE attempts ADD FOREIGN KEY(task_id,replan_source_id) REFERENCES replan_sources(task_id,id);
CREATE TABLE replan_issues (
 id text PRIMARY KEY, task_id text NOT NULL, request_id text NOT NULL, source_id text NOT NULL UNIQUE, reason text NOT NULL,
 FOREIGN KEY(task_id,request_id) REFERENCES replan_requests(task_id,id), FOREIGN KEY(task_id,source_id) REFERENCES replan_sources(task_id,id)
);
ALTER TABLE replan_requests ADD FOREIGN KEY(issue_id) REFERENCES replan_issues(id);
CREATE TABLE replan_decisions (
 task_id text NOT NULL, request_id text NOT NULL, owner_request_id text NOT NULL, kind text NOT NULL, body jsonb NOT NULL,
 PRIMARY KEY(request_id,owner_request_id), FOREIGN KEY(task_id,request_id) REFERENCES replan_requests(task_id,id),
 FOREIGN KEY(task_id,owner_request_id) REFERENCES owner_command_receipts(scope_id,request_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE replan_proposals (
 id text PRIMARY KEY REFERENCES task_command_proposals(id), task_id text NOT NULL, request_id text NOT NULL, source_id text NOT NULL UNIQUE,
 plan_id text NOT NULL UNIQUE, content jsonb NOT NULL, content_digest text NOT NULL, requirement_proposal_id text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(task_id,id),
 FOREIGN KEY(task_id,request_id) REFERENCES replan_requests(task_id,id), FOREIGN KEY(task_id,source_id) REFERENCES replan_sources(task_id,id),
 FOREIGN KEY(task_id,requirement_proposal_id) REFERENCES requirement_proposals(task_id,id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE replan_requests ADD FOREIGN KEY(task_id,proposal_id) REFERENCES replan_proposals(task_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE replan_authorization_commands (
 authorization_id text PRIMARY KEY REFERENCES authorization_receipts(id),task_id text NOT NULL,request_id text NOT NULL,
 FOREIGN KEY(task_id,request_id) REFERENCES owner_command_receipts(scope_id,request_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE replan_input_deferrals (
 task_id text NOT NULL, proposal_id text NOT NULL, input_id text NOT NULL,input_version bigint NOT NULL,request_id text NOT NULL,
 PRIMARY KEY(proposal_id,input_id,input_version),FOREIGN KEY(task_id,proposal_id) REFERENCES replan_proposals(task_id,id),
 FOREIGN KEY(task_id,input_id) REFERENCES task_inputs(task_id,id),
 FOREIGN KEY(task_id,request_id) REFERENCES owner_command_receipts(scope_id,request_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE replan_publications (
 id text PRIMARY KEY, task_id text NOT NULL, request_id text NOT NULL UNIQUE, proposal_id text NOT NULL UNIQUE,
 authorization_id text NOT NULL UNIQUE REFERENCES authorization_receipts(id),owner_request_id text NOT NULL,
 old_plan_id text NOT NULL,new_plan_id text NOT NULL UNIQUE,old_specification_id text NOT NULL,new_specification_id text NOT NULL,
 requirement_change_id text UNIQUE,created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(task_id,id),
 FOREIGN KEY(task_id,request_id) REFERENCES replan_requests(task_id,id),FOREIGN KEY(task_id,proposal_id) REFERENCES replan_proposals(task_id,id),
 FOREIGN KEY(task_id,old_plan_id) REFERENCES plan_revisions(task_id,id),FOREIGN KEY(task_id,new_plan_id) REFERENCES plan_revisions(task_id,id),
 FOREIGN KEY(task_id,old_specification_id) REFERENCES specification_revisions(task_id,id),FOREIGN KEY(task_id,new_specification_id) REFERENCES specification_revisions(task_id,id),
 FOREIGN KEY(task_id,requirement_change_id) REFERENCES requirement_changes(task_id,id),
 FOREIGN KEY(task_id,owner_request_id) REFERENCES owner_command_receipts(scope_id,request_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE replan_node_applicability (
 task_id text NOT NULL,publication_id text NOT NULL,node_id text NOT NULL,node_activation bigint NOT NULL,
 disposition text NOT NULL CHECK(disposition IN ('refresh','carry','invalidate','replace')),
 target_node_id text NOT NULL,target_node_activation bigint NOT NULL,
 completion_operation_id text REFERENCES node_completions(operation_id),completion_manifest_digest text,
 PRIMARY KEY(publication_id,node_id,node_activation),FOREIGN KEY(task_id,publication_id) REFERENCES replan_publications(task_id,id),
 FOREIGN KEY(node_id,node_activation) REFERENCES node_activations(node_id,activation),
 FOREIGN KEY(target_node_id,target_node_activation) REFERENCES node_activations(node_id,activation),
 CHECK((completion_operation_id IS NULL)=(completion_manifest_digest IS NULL))
);
CREATE TABLE replan_workspace_transfers (
 id text PRIMARY KEY,task_id text NOT NULL,publication_id text NOT NULL,workspace_id text NOT NULL REFERENCES task_workspaces(id),
 target_node_id text NOT NULL,target_node_activation bigint NOT NULL,descriptor jsonb NOT NULL,
 UNIQUE(publication_id,workspace_id),FOREIGN KEY(task_id,publication_id) REFERENCES replan_publications(task_id,id),
 FOREIGN KEY(target_node_id,target_node_activation) REFERENCES node_activations(node_id,activation)
);
CREATE TABLE replan_guidance_applicability (
 task_id text NOT NULL,publication_id text NOT NULL,guidance_id text NOT NULL REFERENCES task_guidance(id),node_id text NOT NULL,
 PRIMARY KEY(publication_id,guidance_id),FOREIGN KEY(task_id,publication_id) REFERENCES replan_publications(task_id,id),FOREIGN KEY(task_id,node_id) REFERENCES nodes(task_id,id)
);
-- The shared slot retains immutable typed ownership. Replan-only slots need no
-- long-lived lease; joint publication uses a genuine requirement change owner.
ALTER TABLE task_publication_slots DROP CONSTRAINT task_publication_slots_task_id_operation_id_fkey;
ALTER TABLE task_publication_slots ADD COLUMN owner_kind text NOT NULL DEFAULT 'requirement' CHECK(owner_kind IN ('requirement','replan'));
CREATE FUNCTION validate_typed_publication_owner() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.owner_kind='requirement' AND NOT EXISTS(SELECT 1 FROM requirement_changes c WHERE c.id=NEW.operation_id AND c.task_id=NEW.task_id) OR NEW.owner_kind='replan' AND NOT EXISTS(SELECT 1 FROM replan_requests r WHERE r.id=NEW.operation_id AND r.task_id=NEW.task_id) THEN RAISE EXCEPTION 'publication slot lacks exact typed owner' USING ERRCODE='23514'; END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER typed_publication_owner AFTER INSERT ON task_publication_slots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_typed_publication_owner();
ALTER TABLE requirement_proposals ADD COLUMN replan_source_id text;
ALTER TABLE requirement_proposals ADD FOREIGN KEY(task_id,replan_source_id) REFERENCES replan_sources(task_id,id);
ALTER TABLE requirement_proposals ADD CHECK(replan_source_id IS NULL OR (source_id IS NULL AND input_id IS NULL));
ALTER TABLE requirement_attachments ADD COLUMN replan_source_id text;
ALTER TABLE requirement_attachments ADD FOREIGN KEY(task_id,replan_source_id) REFERENCES replan_sources(task_id,id);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['replan_live_attempts','replan_issues','replan_decisions','replan_proposals','replan_authorization_commands','replan_input_deferrals','replan_publications','replan_node_applicability','replan_workspace_transfers','replan_guidance_applicability'] LOOP
 EXECUTE format('CREATE TRIGGER immutable_replan BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change()',t);
END LOOP; END $$;
CREATE FUNCTION protect_replan_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['done','waiting_reason','last_checked_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['done','waiting_reason','last_checked_at']) THEN RAISE EXCEPTION 'Replan source is immutable' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER immutable_replan_source BEFORE UPDATE OR DELETE ON replan_sources FOR EACH ROW EXECUTE FUNCTION protect_replan_source();
ALTER TABLE replan_requests ADD COLUMN reconciled boolean NOT NULL DEFAULT false;
-- A tuple edge never rewrites an activation's original basis. Only refresh/carry
-- creates a path; invalidation and replacement deliberately do not.
CREATE FUNCTION activation_applies(tid text,nid text,act bigint,sid text,pid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH RECURSIVE edges(old_spec,old_plan,new_spec,new_plan) AS (
  SELECT a.parent_id,a.plan_id,a.specification_id,a.plan_id FROM specification_node_applicability a WHERE a.task_id=tid AND a.node_id=nid AND a.node_activation=act AND a.disposition IN ('refresh','carry')
  UNION ALL SELECT p.old_specification_id,p.old_plan_id,p.new_specification_id,p.new_plan_id FROM replan_node_applicability a JOIN replan_publications p ON p.id=a.publication_id WHERE a.task_id=tid AND a.node_id=nid AND a.node_activation=act AND a.target_node_id=nid AND a.target_node_activation=act AND a.disposition IN ('refresh','carry')
 ), path(spec,plan) AS (
  SELECT specification_id,plan_id FROM node_activations WHERE task_id=tid AND node_id=nid AND activation=act
  UNION SELECT e.new_spec,e.new_plan FROM path p JOIN edges e ON e.old_spec=p.spec AND e.old_plan=p.plan
 ) SELECT EXISTS(SELECT 1 FROM path WHERE spec=sid AND plan=pid)
$$;
CREATE FUNCTION validate_joint_requirement(pid text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p requirement_proposals;g task_command_proposals;s replan_sources;rp replan_proposals;
BEGIN
 SELECT * INTO p FROM requirement_proposals WHERE id=pid;SELECT * INTO g FROM task_command_proposals WHERE id=pid;
 SELECT * INTO s FROM replan_sources WHERE id=p.replan_source_id;SELECT * INTO rp FROM replan_proposals WHERE requirement_proposal_id=p.id;
 IF s.task_id IS DISTINCT FROM p.task_id OR rp.task_id IS DISTINCT FROM p.task_id OR rp.source_id IS DISTINCT FROM s.id OR p.base_specification_id IS DISTINCT FROM s.specification_id OR p.base_plan_id IS DISTINCT FROM s.plan_id OR p.base_control_version IS DISTINCT FROM s.expected_version OR p.input_cutoff IS DISTINCT FROM s.input_cutoff OR p.impact->'graph_sufficient' IS DISTINCT FROM 'false'::jsonb OR p.impact->>'replan_request_id' IS DISTINCT FROM s.request_id OR p.impact->>'replan_proposal_id' IS DISTINCT FROM rp.id OR p.impact->'replan_impact' IS DISTINCT FROM rp.content->'impact' OR
 g.task_id IS DISTINCT FROM p.task_id OR g.action IS DISTINCT FROM 'apply_specification_revision' OR g.content_digest IS DISTINCT FROM p.content_digest OR g.content->>'specification' IS DISTINCT FROM p.specification OR g.content->>'summary' IS DISTINCT FROM p.summary OR g.content->'impact' IS DISTINCT FROM p.impact OR g.content->>'specification_digest' IS DISTINCT FROM p.specification_digest OR g.content->>'impact_digest' IS DISTINCT FROM p.impact_digest OR g.content->>'replan_source_id' IS DISTINCT FROM s.id OR g.basis IS DISTINCT FROM ((rp.content->'basis')-ARRAY['node_id','node_activation','source_id']) OR rp.content->>'requirement_content_digest' IS DISTINCT FROM p.content_digest OR rp.content->'requirement'->>'specification' IS DISTINCT FROM p.specification THEN RAISE EXCEPTION 'joint requirement lacks exact source/graph/content authority' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM requirement_attachments a WHERE a.proposal_id=p.id AND a.replan_source_id=s.id AND a.source_id IS NULL AND a.input_id IS NULL) THEN RAISE EXCEPTION 'joint requirement lacks terminal Replan attachment' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION validate_replan_records() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p replan_proposals;r replan_requests;s replan_sources;g task_command_proposals;pub replan_publications;a authorization_receipts;cmd jsonb;response jsonb;n jsonb;ar_id text;
BEGIN
 IF TG_TABLE_NAME='replan_proposals' THEN
  p:=NEW;SELECT * INTO r FROM replan_requests WHERE id=p.request_id;SELECT * INTO s FROM replan_sources WHERE id=p.source_id;SELECT * INTO g FROM task_command_proposals WHERE id=p.id;
  IF s.task_id IS DISTINCT FROM p.task_id OR s.request_id IS DISTINCT FROM p.request_id OR g.task_id IS DISTINCT FROM p.task_id OR g.action IS DISTINCT FROM 'publish_replan' OR g.content IS DISTINCT FROM p.content OR g.content_digest IS DISTINCT FROM p.content_digest OR p.content->>'source_id' IS DISTINCT FROM s.id OR p.content->>'replan_request_id' IS DISTINCT FROM r.id OR p.content->>'plan_id' IS DISTINCT FROM p.plan_id OR ((p.content->'basis')-ARRAY['node_id','node_activation','source_id']) IS DISTINCT FROM jsonb_build_object('control_version',s.expected_version,'specification_id',s.specification_id,'plan_id',s.plan_id) OR p.content->'input_cutoff' IS DISTINCT FROM to_jsonb(s.input_cutoff) OR p.content->'requirement'->>'proposal_id' IS DISTINCT FROM p.requirement_proposal_id OR jsonb_array_length(p.content->'nodes')<>1 THEN RAISE EXCEPTION 'Replan proposal source/envelope mismatch' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM command_receipts c WHERE c.attempt_id=s.planned_attempt_id AND c.scope_id=p.task_id AND c.command_name='prepare_replan' AND c.envelope_json::jsonb->'payload'=p.content-ARRAY['input_cutoff','requirement_content_digest'] AND c.response->'result'->'replan_outcome'->>'proposal_id'=p.id AND c.response->>'status'='committed') THEN RAISE EXCEPTION 'proposal lacks exact terminal command receipt' USING ERRCODE='23514'; END IF;
  IF s.context IS NULL OR r.source_id IS DISTINCT FROM s.id OR r.proposal_id IS DISTINCT FROM p.id OR r.status IS DISTINCT FROM 'pending' OR (p.content->'impact'->'node')-ARRAY['disposition','target_node_id','target_node_activation'] IS DISTINCT FROM (s.context->'impact'->'node')-ARRAY['disposition','target_node_id','target_node_activation'] OR p.content->'impact'->'workspaces' IS DISTINCT FROM s.context->'impact'->'workspaces' THEN RAISE EXCEPTION 'proposal must preserve its exact source evidence and workspace facts' USING ERRCODE='23514';END IF;
  IF jsonb_typeof(p.content->'impact'->'holds') IS DISTINCT FROM 'array' OR (SELECT jsonb_agg(h ORDER BY h::text) FROM jsonb_array_elements(p.content->'impact'->'holds') h) IS DISTINCT FROM (SELECT jsonb_agg(h ORDER BY h::text) FROM jsonb_array_elements(s.context->'impact'->'holds') h) THEN RAISE EXCEPTION 'proposal must preserve all source independent holds' USING ERRCODE='23514';END IF;
  IF jsonb_typeof(p.content->'impact'->'guidance') IS DISTINCT FROM 'array' OR jsonb_array_length(p.content->'impact'->'guidance') IS DISTINCT FROM jsonb_array_length(s.context->'impact'->'guidance') OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.content->'impact'->'guidance') guidance_item WHERE (guidance_item->>'disposition' IN ('retain','supersede')) IS NOT TRUE OR guidance_item->>'target_node_id' IS DISTINCT FROM p.content->'impact'->'node'->>'target_node_id' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s.context->'impact'->'guidance') old_g WHERE old_g->>'guidance_id'=guidance_item->>'guidance_id' AND old_g->'version'=guidance_item->'version')) OR (SELECT count(DISTINCT guidance_item->>'guidance_id') FROM jsonb_array_elements(p.content->'impact'->'guidance') guidance_item)<>jsonb_array_length(p.content->'impact'->'guidance') THEN RAISE EXCEPTION 'proposal must disposition every exact source guidance' USING ERRCODE='23514';END IF;
  IF p.requirement_proposal_id IS NOT NULL THEN PERFORM validate_joint_requirement(p.requirement_proposal_id); END IF;
 ELSIF TG_TABLE_NAME='replan_authorization_commands' THEN
  SELECT * INTO a FROM authorization_receipts WHERE id=NEW.authorization_id;SELECT * INTO p FROM replan_proposals WHERE id=a.proposal_id;
  SELECT envelope_json::jsonb,o.response INTO cmd,response FROM owner_command_receipts o WHERE scope_id=NEW.task_id AND request_id=NEW.request_id;
  IF p.task_id IS DISTINCT FROM NEW.task_id OR cmd->>'name' IS DISTINCT FROM 'confirm_replan' OR cmd->>'task_id' IS DISTINCT FROM NEW.task_id OR cmd->>'request_id' IS DISTINCT FROM NEW.request_id OR cmd->'payload' IS DISTINCT FROM jsonb_build_object('proposal_id',p.id,'content_digest',p.content_digest) OR response->>'confirmation_id' IS DISTINCT FROM a.id OR response->>'request_id' IS DISTINCT FROM NEW.request_id OR response->>'status' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION 'Replan confirmation lacks exact Owner receipt' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='replan_publications' THEN
  pub:=NEW;SELECT * INTO p FROM replan_proposals WHERE id=pub.proposal_id;SELECT * INTO r FROM replan_requests WHERE id=pub.request_id;SELECT * INTO a FROM authorization_receipts WHERE id=pub.authorization_id;
  SELECT envelope_json::jsonb,o.response INTO cmd,response FROM owner_command_receipts o WHERE scope_id=pub.task_id AND request_id=pub.owner_request_id;
  IF p.task_id IS DISTINCT FROM pub.task_id OR p.request_id IS DISTINCT FROM r.id OR r.status IS DISTINCT FROM 'published' OR a.proposal_id IS DISTINCT FROM p.id OR a.consumed_by IS DISTINCT FROM pub.owner_request_id OR NOT EXISTS(SELECT 1 FROM replan_authorization_commands WHERE authorization_id=a.id AND task_id=pub.task_id) OR p.plan_id IS DISTINCT FROM pub.new_plan_id OR p.content->'basis'->>'plan_id' IS DISTINCT FROM pub.old_plan_id OR p.content->'basis'->>'specification_id' IS DISTINCT FROM pub.old_specification_id OR cmd->>'name' IS DISTINCT FROM 'publish_replan' OR cmd->>'task_id' IS DISTINCT FROM pub.task_id OR cmd->>'request_id' IS DISTINCT FROM pub.owner_request_id OR cmd->'payload'->>'proposal_id' IS DISTINCT FROM p.id OR cmd->'payload'->>'confirmation_id' IS DISTINCT FROM a.id OR cmd->'payload'->'basis' IS DISTINCT FROM p.content->'basis' OR response->>'publication_id' IS DISTINCT FROM pub.id OR response->>'plan_id' IS DISTINCT FROM pub.new_plan_id OR response->>'specification_id' IS DISTINCT FROM pub.new_specification_id OR response->>'request_id' IS DISTINCT FROM pub.owner_request_id OR response->>'status' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION 'publication lacks exact graph authorization' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM tasks WHERE id=pub.task_id AND plan_id=pub.new_plan_id AND specification_id=pub.new_specification_id) OR NOT EXISTS(SELECT 1 FROM plan_revisions pr WHERE pr.id=pub.new_plan_id AND pr.task_id=pub.task_id AND pr.specification_id=pub.new_specification_id AND pr.content->'nodes'=p.content->'nodes') THEN RAISE EXCEPTION 'publication requires complete atomic effective graph' USING ERRCODE='23514'; END IF;
  IF (p.requirement_proposal_id IS NULL)<>(pub.requirement_change_id IS NULL) OR (pub.requirement_change_id IS NULL AND pub.old_specification_id<>pub.new_specification_id) THEN RAISE EXCEPTION 'joint publication is incomplete' USING ERRCODE='23514'; END IF;
  IF pub.requirement_change_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM requirement_changes c JOIN requirement_publications rp ON rp.change_id=c.id WHERE c.id=pub.requirement_change_id AND c.task_id=pub.task_id AND c.proposal_id=p.requirement_proposal_id AND c.authorization_id=cmd->'payload'->>'requirement_confirmation_id' AND c.admission_request_id=pub.owner_request_id AND c.status='published' AND rp.specification_id=pub.new_specification_id AND rp.parent_id=pub.old_specification_id AND rp.plan_id=pub.new_plan_id) THEN RAISE EXCEPTION 'joint publication lacks exact requirements consumption' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM attempts x WHERE x.task_id=pub.task_id AND (x.state='QUEUED' OR NOT x.process_released OR EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=x.id AND o.state NOT IN ('succeeded','cancelled')))) OR EXISTS(SELECT 1 FROM workspace_leases WHERE task_id=pub.task_id AND state<>'released') THEN RAISE EXCEPTION 'publication must be physically quiescent' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='replan_node_applicability' THEN
  SELECT * INTO pub FROM replan_publications WHERE id=NEW.publication_id;SELECT * INTO p FROM replan_proposals WHERE id=pub.proposal_id;n:=p.content->'impact'->'node';
  IF NEW.task_id IS DISTINCT FROM pub.task_id OR n IS DISTINCT FROM jsonb_build_object('node_id',NEW.node_id,'node_activation',NEW.node_activation,'source_id',n->'source_id','completion_operation_id',NEW.completion_operation_id,'completion_manifest_digest',NEW.completion_manifest_digest,'disposition',NEW.disposition,'target_node_id',NEW.target_node_id,'target_node_activation',NEW.target_node_activation) OR NOT activation_applies(NEW.task_id,NEW.node_id,NEW.node_activation,pub.old_specification_id,pub.old_plan_id) THEN RAISE EXCEPTION 'applicability differs from approved tuple path' USING ERRCODE='23514'; END IF;
  IF NEW.node_id=NEW.target_node_id AND NOT EXISTS(SELECT 1 FROM plan_nodes prior JOIN plan_nodes next ON next.node_id=prior.node_id WHERE prior.plan_id=pub.old_plan_id AND next.plan_id=pub.new_plan_id AND prior.node_id=NEW.node_id AND prior.definition=next.definition) THEN RAISE EXCEPTION 'retained Node definition changed' USING ERRCODE='23514'; END IF;
  IF NEW.completion_operation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM node_completions c JOIN completion_manifests m ON m.operation_id=c.operation_id WHERE c.node_id=NEW.node_id AND c.activation=NEW.node_activation AND c.operation_id=NEW.completion_operation_id AND m.content_digest=NEW.completion_manifest_digest) THEN RAISE EXCEPTION 'completion applicability lacks exact manifest' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='replan_workspace_transfers' THEN
  SELECT * INTO pub FROM replan_publications WHERE id=NEW.publication_id;SELECT * INTO p FROM replan_proposals WHERE id=pub.proposal_id;
  IF NEW.task_id IS DISTINCT FROM pub.task_id OR NEW.descriptor->>'publication_id' IS DISTINCT FROM pub.id OR NEW.descriptor->>'proposal_id' IS DISTINCT FROM p.id OR NEW.descriptor->>'to_plan_id' IS DISTINCT FROM pub.new_plan_id OR NEW.descriptor->>'workspace_id' IS DISTINCT FROM NEW.workspace_id OR NEW.descriptor->>'to_node_id' IS DISTINCT FROM NEW.target_node_id OR NEW.descriptor->'to_node_activation' IS DISTINCT FROM to_jsonb(NEW.target_node_activation) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.content->'impact'->'workspaces') w WHERE w=NEW.descriptor-ARRAY['publication_id','proposal_id','to_plan_id','to_node_id','to_node_activation']) THEN RAISE EXCEPTION 'workspace transfer exceeds exact approved disposition' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='replan_input_deferrals' THEN
  SELECT envelope_json::jsonb,o.response INTO cmd,response FROM owner_command_receipts o WHERE scope_id=NEW.task_id AND request_id=NEW.request_id;
  IF cmd->>'name' IS DISTINCT FROM 'defer_replan_inputs' OR cmd->>'task_id' IS DISTINCT FROM NEW.task_id OR cmd->>'request_id' IS DISTINCT FROM NEW.request_id OR response->>'request_id' IS DISTINCT FROM NEW.request_id OR response->>'status' IS DISTINCT FROM 'committed' OR response->>'proposal_id' IS DISTINCT FROM NEW.proposal_id OR cmd->'payload'->>'proposal_id' IS DISTINCT FROM NEW.proposal_id OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(cmd->'payload'->'inputs') i WHERE i=jsonb_build_object('input_id',NEW.input_id,'version',NEW.input_version)) THEN RAISE EXCEPTION 'Replan deferral lacks exact Owner decision' USING ERRCODE='23514'; END IF;
 END IF;RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['replan_proposals','replan_authorization_commands','replan_publications','replan_node_applicability','replan_workspace_transfers','replan_input_deferrals'] LOOP
 EXECUTE format('CREATE CONSTRAINT TRIGGER replan_exact AFTER INSERT ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_replan_records()',t);
END LOOP;END $$;

CREATE OR REPLACE FUNCTION validate_requirement_impact_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g jsonb; n jsonb;
BEGIN
 IF NEW.replan_source_id IS NOT NULL THEN RETURN NEW; END IF;
 IF NEW.predecessor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM requirement_proposals previous_proposal WHERE previous_proposal.id=NEW.predecessor_id AND previous_proposal.task_id=NEW.task_id AND previous_proposal.obligation_id=NEW.obligation_id) THEN RAISE EXCEPTION 'replacement must retain its originating obligation' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(NEW.impact->'guidance') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.impact->'nodes') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'complete impact arrays required' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(NEW.impact->'guidance'))<>(SELECT count(DISTINCT value->>'guidance_id') FROM jsonb_array_elements(NEW.impact->'guidance')) OR jsonb_array_length(NEW.impact->'guidance')<>(SELECT count(*) FROM task_guidance WHERE task_id=NEW.task_id AND status='active') THEN RAISE EXCEPTION 'impact must cover each active guidance exactly once' USING ERRCODE='23514'; END IF;
 FOR g IN SELECT value FROM jsonb_array_elements(NEW.impact->'guidance') LOOP
  IF jsonb_typeof(g->'guidance_id') IS DISTINCT FROM 'string' OR jsonb_typeof(g->'version') IS DISTINCT FROM 'number' OR jsonb_typeof(g->'disposition') IS DISTINCT FROM 'string' OR g->>'disposition' NOT IN ('retain','supersede') THEN RAISE EXCEPTION 'invalid guidance identity types' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM task_guidance actual WHERE actual.id=guidance_item->>'guidance_id' AND actual.task_id=NEW.task_id AND actual.status='active' AND to_jsonb(actual.version)=guidance_item->'version') THEN RAISE EXCEPTION 'impact guidance version differs' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=NEW.task_id AND t.specification_id=NEW.base_specification_id AND t.plan_id IS NOT DISTINCT FROM NEW.base_plan_id AND t.control_version=NEW.base_control_version) THEN RAISE EXCEPTION 'proposal current basis differs' USING ERRCODE='23514'; END IF;
 FOR n IN SELECT value FROM jsonb_array_elements(NEW.impact->'nodes') LOOP
  IF jsonb_typeof(n->'node_id') IS DISTINCT FROM 'string' OR jsonb_typeof(n->'node_activation') IS DISTINCT FROM 'number' OR COALESCE(jsonb_typeof(n->'source_id'),'missing') NOT IN ('null','string') OR COALESCE(jsonb_typeof(n->'completion_operation_id'),'missing') NOT IN ('null','string') OR COALESCE(jsonb_typeof(n->'completion_manifest_digest'),'missing') NOT IN ('null','string') THEN RAISE EXCEPTION 'invalid Node identity types' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM nodes actual LEFT JOIN node_completions c ON c.node_id=actual.id AND c.activation=actual.activation LEFT JOIN completion_manifests m ON m.operation_id=c.operation_id WHERE actual.id=n->>'node_id' AND actual.task_id=NEW.task_id AND to_jsonb(actual.activation)=n->'node_activation' AND actual.execution_source_id IS NOT DISTINCT FROM n->>'source_id' AND c.operation_id IS NOT DISTINCT FROM n->>'completion_operation_id' AND m.content_digest IS NOT DISTINCT FROM n->>'completion_manifest_digest') THEN RAISE EXCEPTION 'impact current source or completion differs' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION validate_requirement_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proposal_row requirement_proposals; change_row requirement_changes; activation_row node_activations; target jsonb; guidance_item jsonb; prior_spec text;
BEGIN
 IF TG_TABLE_NAME='requirement_proposals' THEN
  proposal_row:=NEW;
  IF NEW.replan_source_id IS NOT NULL THEN PERFORM validate_joint_requirement(NEW.id);RETURN NULL;END IF;
  IF NOT EXISTS(SELECT 1 FROM task_command_proposals g WHERE g.id=NEW.id AND g.task_id=NEW.task_id AND g.action='apply_specification_revision' AND g.content_digest=NEW.content_digest AND g.content->>'specification'=NEW.specification AND g.content->>'summary'=NEW.summary AND g.content->'impact'=NEW.impact AND g.content->>'source_id' IS NOT DISTINCT FROM NEW.source_id AND g.content->>'specification_digest'=NEW.specification_digest AND g.content->>'impact_digest'=NEW.impact_digest AND g.basis->>'specification_id'=NEW.base_specification_id AND g.basis->>'plan_id' IS NOT DISTINCT FROM NEW.base_plan_id AND (g.basis->>'control_version')::bigint=NEW.base_control_version AND (g.content->>'input_cutoff')::bigint=NEW.input_cutoff) THEN RAISE EXCEPTION 'proposal does not bind exact authorization envelope' USING ERRCODE='23514'; END IF;
  IF NEW.source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM task_conversation_outbox s WHERE s.id=NEW.source_id AND s.task_id=NEW.task_id AND s.input_id=NEW.input_id AND s.source_watermark=NEW.input_cutoff AND NOT s.reply_only) THEN RAISE EXCEPTION 'proposal canonical source attribution differs' USING ERRCODE='23514'; END IF;
  IF NEW.impact->'graph_sufficient' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(NEW.impact->'nodes') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.impact->'guidance') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'complete sufficient impact required' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM plan_nodes pn WHERE pn.plan_id=NEW.base_plan_id)<>jsonb_array_length(NEW.impact->'nodes') OR jsonb_array_length(NEW.impact->'nodes')>1 THEN RAISE EXCEPTION 'impact does not cover exact unchanged graph' USING ERRCODE='23514'; END IF;
  FOR target IN SELECT value FROM jsonb_array_elements(NEW.impact->'nodes') LOOP
   IF jsonb_typeof(target->'node_id')<>'string' OR jsonb_typeof(target->'node_activation')<>'number' OR jsonb_typeof(target->'disposition') IS DISTINCT FROM 'string' OR target->>'disposition' NOT IN ('refresh','invalidate','carry') THEN RAISE EXCEPTION 'invalid impact Node identity' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT 1 FROM node_activations na JOIN plan_nodes pn ON pn.node_id=na.node_id AND pn.plan_id=na.plan_id WHERE na.task_id=NEW.task_id AND activation_applies(NEW.task_id,na.node_id,na.activation,NEW.base_specification_id,NEW.base_plan_id) AND na.node_id=target->>'node_id' AND na.activation=(target->>'node_activation')::bigint) THEN RAISE EXCEPTION 'impact activation outside Task Plan' USING ERRCODE='23514'; END IF;
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
  IF NOT activation_applies(NEW.task_id,NEW.node_id,NEW.node_activation,NEW.parent_id,NEW.plan_id) AND NOT EXISTS(SELECT 1 FROM specification_node_applicability prev WHERE prev.specification_id=NEW.parent_id AND prev.node_id=NEW.node_id AND prev.node_activation=NEW.node_activation AND prev.plan_id=NEW.plan_id AND prev.disposition IN ('refresh','carry') AND (NEW.disposition<>'carry' OR prev.completion_operation_id=NEW.completion_operation_id OR (prev.disposition='refresh' AND EXISTS(SELECT 1 FROM completion_manifests fresh WHERE fresh.operation_id=NEW.completion_operation_id AND fresh.specification_id=NEW.parent_id AND fresh.node_id=NEW.node_id AND fresh.node_activation=NEW.node_activation)))) THEN RAISE EXCEPTION 'applicability cannot cross an invalidated or missing basis' USING ERRCODE='23514'; END IF;
 END IF; RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION validate_requirement_links() RETURNS trigger LANGUAGE plpgsql AS $$
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
 IF c.status<>'published' OR c.specification_id<>NEW.specification_id OR p.base_specification_id<>NEW.parent_id OR (p.base_plan_id IS DISTINCT FROM NEW.plan_id AND NOT EXISTS(SELECT 1 FROM replan_publications rp WHERE rp.requirement_change_id=c.id AND rp.new_plan_id=NEW.plan_id AND rp.old_plan_id=p.base_plan_id)) OR NOT EXISTS(SELECT 1 FROM specification_revisions s WHERE s.id=NEW.specification_id AND s.parent_id=NEW.parent_id AND s.authorization_id=c.authorization_id AND s.content=to_jsonb(p.specification) AND s.content_digest=p.specification_digest) THEN RAISE EXCEPTION 'publication differs from exact admitted requirements' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='specification_node_applicability' THEN
 SELECT * INTO pub FROM requirement_publications WHERE change_id=NEW.change_id;
 SELECT * INTO activation_row FROM node_activations WHERE node_id=NEW.node_id AND activation=NEW.node_activation;
 IF activation_row.task_id<>NEW.task_id OR NOT activation_applies(NEW.task_id,NEW.node_id,NEW.node_activation,NEW.parent_id,NEW.plan_id) OR pub.plan_id<>NEW.plan_id OR pub.parent_id<>NEW.parent_id OR
 (NEW.disposition='carry' AND NOT EXISTS(SELECT 1 FROM node_completions nc JOIN completion_manifests m ON m.operation_id=nc.operation_id WHERE nc.operation_id=NEW.completion_operation_id AND nc.node_id=NEW.node_id AND nc.activation=NEW.node_activation AND m.content_digest=NEW.completion_manifest_digest)) THEN RAISE EXCEPTION 'applicability identity differs from published evidence' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION validate_requirement_command_authority() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF p.replan_source_id IS NOT NULL THEN
   IF NEW.status<>'published' OR NOT EXISTS(SELECT 1 FROM replan_publications rp JOIN owner_command_receipts o ON o.scope_id=rp.task_id AND o.request_id=rp.owner_request_id WHERE rp.requirement_change_id=NEW.id AND rp.task_id=NEW.task_id AND rp.owner_request_id=NEW.admission_request_id AND ar.consumed_by=NEW.admission_request_id AND o.envelope_json::jsonb->>'name'='publish_replan' AND o.envelope_json::jsonb->'payload'->>'requirement_confirmation_id'=ar.id) THEN RAISE EXCEPTION 'joint requirements can only publish with exact graph command' USING ERRCODE='23514';END IF;
   RETURN NULL;
  END IF;
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
CREATE OR REPLACE FUNCTION preserve_requirement_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='task_command_proposals' THEN
  IF (EXISTS(SELECT 1 FROM requirement_proposals WHERE id=OLD.id) OR EXISTS(SELECT 1 FROM replan_proposals WHERE id=OLD.id)) THEN
   IF TG_OP='DELETE' OR (to_jsonb(NEW)-'revoked') IS DISTINCT FROM (to_jsonb(OLD)-'revoked') OR OLD.revoked THEN RAISE EXCEPTION 'exact requirement confirmation content is immutable' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  IF (EXISTS(SELECT 1 FROM requirement_proposals WHERE id=OLD.proposal_id) OR EXISTS(SELECT 1 FROM replan_proposals WHERE id=OLD.proposal_id)) THEN
   IF TG_OP='DELETE' OR (to_jsonb(NEW)-'consumed_by') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_by') OR (OLD.consumed_by IS NOT NULL AND NEW.consumed_by IS DISTINCT FROM OLD.consumed_by) THEN RAISE EXCEPTION 'requirement authorization is one-way' USING ERRCODE='23514'; END IF;
  END IF;
 END IF; RETURN NEW; END $$;
ALTER TABLE replan_requests ADD COLUMN requester_blocker_id text REFERENCES node_blockers(id);
CREATE TABLE replan_control_holds (
 id text PRIMARY KEY,task_id text NOT NULL,publication_id text NOT NULL,node_id text NOT NULL,node_activation bigint NOT NULL,
 origin jsonb NOT NULL,current_blocker_id text REFERENCES node_blockers(id),resolved_by text,
 FOREIGN KEY(task_id,publication_id) REFERENCES replan_publications(task_id,id),
 FOREIGN KEY(node_id,node_activation) REFERENCES node_activations(node_id,activation),
 FOREIGN KEY(task_id,resolved_by) REFERENCES owner_command_receipts(scope_id,request_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE FUNCTION protect_replan_hold() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['current_blocker_id','resolved_by']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['current_blocker_id','resolved_by']) OR (OLD.resolved_by IS NOT NULL AND NEW.resolved_by IS DISTINCT FROM OLD.resolved_by) THEN RAISE EXCEPTION 'inherited control provenance is immutable' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER immutable_replan_hold BEFORE UPDATE OR DELETE ON replan_control_holds FOR EACH ROW EXECUTE FUNCTION protect_replan_hold();
CREATE FUNCTION validate_replan_heads() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r replan_requests;s replan_sources;
BEGIN
 IF TG_TABLE_NAME='replan_requests' THEN
  SELECT * INTO r FROM replan_requests WHERE id=NEW.id;
  IF r.source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM replan_sources x WHERE x.id=r.source_id AND x.request_id=r.id) OR r.proposal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM replan_proposals x WHERE x.id=r.proposal_id AND x.request_id=r.id) OR r.issue_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM replan_issues x WHERE x.id=r.issue_id AND x.request_id=r.id) THEN RAISE EXCEPTION 'Replan current head belongs to another request' USING ERRCODE='23514';END IF;
  IF (r.status='published') IS DISTINCT FROM EXISTS(SELECT 1 FROM replan_publications WHERE request_id=r.id) THEN RAISE EXCEPTION 'Replan terminal publication mismatch' USING ERRCODE='23514';END IF;
  IF r.requester_blocker_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM node_blockers b WHERE b.id=r.requester_blocker_id AND b.task_id=r.task_id AND b.node_id=r.origin_node_id AND b.node_activation=r.origin_activation AND b.attempt_id=r.origin_attempt_id) THEN RAISE EXCEPTION 'request blocker attribution differs' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='attempts' AND NEW.replan_source_id IS NOT NULL THEN
  SELECT * INTO s FROM replan_sources WHERE id=NEW.replan_source_id;
  IF s.task_id IS DISTINCT FROM NEW.task_id OR s.planned_attempt_id IS DISTINCT FROM NEW.id OR NEW.kind<>'planner' OR NEW.node_id IS NOT NULL OR NEW.planning_intent_id IS NOT NULL OR NEW.task_conversation_source_id IS NOT NULL OR NEW.node_execution_source_id IS NOT NULL OR NEW.launch->'source_watermark' IS DISTINCT FROM '0'::jsonb OR NEW.launch->'task_replan_source' IS DISTINCT FROM jsonb_build_object('request_id',s.request_id,'source_id',s.id,'specification_id',s.specification_id,'plan_id',s.plan_id,'control_version',s.expected_version,'context_digest',s.context_digest) THEN RAISE EXCEPTION 'Replan Attempt source mismatch' USING ERRCODE='23514';END IF;
 END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER replan_heads AFTER INSERT OR UPDATE ON replan_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_replan_heads();
CREATE CONSTRAINT TRIGGER replan_attempt_source AFTER INSERT OR UPDATE ON attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_replan_heads();
CREATE FUNCTION preserve_replan_request() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['source_id','proposal_id','issue_id','status','version','direction','last_checked_at','reconciled','requester_blocker_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['source_id','proposal_id','issue_id','status','version','direction','last_checked_at','reconciled','requester_blocker_id']) OR (OLD.status<>'pending' AND NEW.status IS DISTINCT FROM OLD.status) OR (OLD.requester_blocker_id IS NOT NULL AND NEW.requester_blocker_id IS DISTINCT FROM OLD.requester_blocker_id) THEN RAISE EXCEPTION 'Replan identity or terminal outcome is immutable' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER replan_request_identity BEFORE UPDATE OR DELETE ON replan_requests FOR EACH ROW EXECUTE FUNCTION preserve_replan_request();

CREATE OR REPLACE FUNCTION validate_requirement_publication_slot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c requirement_changes; change_id text;
BEGIN
 IF TG_TABLE_NAME='requirement_changes' THEN change_id:=NEW.id;
 ELSIF TG_OP='DELETE' THEN change_id:=OLD.operation_id;
 ELSE change_id:=NEW.operation_id; END IF;
 SELECT * INTO c FROM requirement_changes WHERE id=change_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF c.status IN ('settling','withdrawing') AND NOT EXISTS(SELECT 1 FROM task_publication_slots s WHERE s.task_id=c.task_id AND s.operation_id=c.id) THEN RAISE EXCEPTION 'unsettled change must retain its publication slot' USING ERRCODE='23514'; END IF;
 IF c.status IN ('published','withdrawn','cancelled') AND EXISTS(SELECT 1 FROM task_publication_slots s WHERE s.operation_id=c.id) THEN RAISE EXCEPTION 'settled change must release its own slot' USING ERRCODE='23514'; END IF;
 IF (c.status='published') IS DISTINCT FROM EXISTS(SELECT 1 FROM requirement_publications p WHERE p.change_id=c.id) THEN RAISE EXCEPTION 'published status requires exact immutable publication' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION validate_replan_hold() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cmd jsonb;response jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM replan_publications pub JOIN replan_proposals p ON p.id=pub.proposal_id WHERE pub.id=NEW.publication_id AND pub.task_id=NEW.task_id AND p.content->'impact'->'node'->>'target_node_id'=NEW.node_id AND (p.content->'impact'->'node'->>'target_node_activation')::bigint=NEW.node_activation AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.content->'impact'->'holds') h WHERE h=NEW.origin)) THEN RAISE EXCEPTION 'hold must match approved independent control' USING ERRCODE='23514'; END IF;
 IF NEW.origin->>'blocker_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM node_blockers b WHERE b.id=NEW.origin->>'blocker_id' AND b.task_id=NEW.task_id AND b.node_id=NEW.origin->>'origin_node_id' AND b.node_activation=(NEW.origin->>'origin_node_activation')::bigint AND b.kind=NEW.origin->>'kind' AND b.reason=NEW.origin->>'reason') THEN RAISE EXCEPTION 'hold original blocker differs' USING ERRCODE='23514'; END IF;
 IF NEW.origin->>'kind'='owner_stopped' THEN
  SELECT envelope_json::jsonb,o.response INTO cmd,response FROM owner_command_receipts o WHERE o.scope_id=NEW.task_id AND o.request_id=NEW.origin->>'owner_request_id';
  IF cmd->>'name' IS DISTINCT FROM 'stop_node' OR cmd->>'scope_id' IS DISTINCT FROM NEW.task_id OR cmd->>'request_id' IS DISTINCT FROM NEW.origin->>'owner_request_id' OR cmd->'payload'->>'node_id' IS DISTINCT FROM NEW.origin->>'origin_node_id' OR cmd->'payload'->'node_activation' IS DISTINCT FROM NEW.origin->'origin_node_activation' OR response->>'request_id' IS DISTINCT FROM NEW.origin->>'owner_request_id' OR response->>'task_id' IS DISTINCT FROM NEW.task_id OR (response->>'status' IN ('committed','admitted')) IS NOT TRUE OR response->>'source_id' IS DISTINCT FROM cmd->'payload'->>'source_id' OR jsonb_typeof(cmd->'expected_control_version') IS DISTINCT FROM 'number' OR jsonb_typeof(response->'control_version') IS DISTINCT FROM 'number' OR response->'control_version' IS DISTINCT FROM to_jsonb((cmd->>'expected_control_version')::bigint+1) OR NOT EXISTS(SELECT 1 FROM node_execution_outbox source WHERE source.id=cmd->'payload'->>'source_id' AND source.task_id=NEW.task_id AND source.node_id=NEW.origin->>'origin_node_id' AND to_jsonb(source.node_activation)=NEW.origin->'origin_node_activation') OR (NEW.origin->>'blocker_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM node_blockers b WHERE b.id=NEW.origin->>'blocker_id' AND b.source_id=cmd->'payload'->>'source_id')) THEN RAISE EXCEPTION 'Owner Stop hold lacks exact successful Owner decision' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.current_blocker_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM node_blockers b WHERE b.id=NEW.current_blocker_id AND b.task_id=NEW.task_id AND b.node_id=NEW.node_id AND b.node_activation=NEW.node_activation AND b.kind=NEW.origin->>'kind' AND b.reason=NEW.origin->>'reason') THEN RAISE EXCEPTION 'current inherited blocker differs' USING ERRCODE='23514'; END IF;
 IF NEW.resolved_by IS NOT NULL THEN
  SELECT envelope_json::jsonb,o.response INTO cmd,response FROM owner_command_receipts o WHERE scope_id=NEW.task_id AND request_id=NEW.resolved_by;
  IF (cmd->>'name' IN ('continue_node','retry_node')) IS NOT TRUE OR cmd->>'scope_id' IS DISTINCT FROM NEW.task_id OR cmd->>'request_id' IS DISTINCT FROM NEW.resolved_by OR cmd->'payload'->>'blocker_id' IS DISTINCT FROM NEW.current_blocker_id OR cmd->'payload'->>'node_id' IS DISTINCT FROM NEW.node_id OR cmd->'payload'->'node_activation' IS DISTINCT FROM to_jsonb(NEW.node_activation) OR ((NEW.origin->>'kind'='owner_stopped') IS DISTINCT FROM (cmd->>'name'='continue_node')) OR response->>'request_id' IS DISTINCT FROM NEW.resolved_by OR response->>'task_id' IS DISTINCT FROM NEW.task_id OR response->>'status' IS DISTINCT FROM 'committed' OR jsonb_typeof(cmd->'expected_control_version') IS DISTINCT FROM 'number' OR jsonb_typeof(response->'control_version') IS DISTINCT FROM 'number' OR response->'control_version' IS DISTINCT FROM to_jsonb((cmd->>'expected_control_version')::bigint+1) OR NOT EXISTS(SELECT 1 FROM node_blockers b WHERE b.id=NEW.current_blocker_id AND b.source_id=cmd->'payload'->>'source_id') OR NOT EXISTS(SELECT 1 FROM node_execution_outbox source WHERE source.id=response->>'source_id' AND source.task_id=NEW.task_id AND source.node_id=NEW.node_id AND source.node_activation=NEW.node_activation AND (source.owner_request_id=NEW.resolved_by OR (source.id=cmd->'payload'->>'source_id' AND EXISTS(SELECT 1 FROM node_completions c WHERE c.node_id=NEW.node_id AND c.activation=NEW.node_activation)))) THEN RAISE EXCEPTION 'hold resolution requires its exact successful Owner action' USING ERRCODE='23514'; END IF;
 END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER replan_hold_exact AFTER INSERT OR UPDATE ON replan_control_holds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_replan_hold();
CREATE FUNCTION validate_replan_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a attempts;r replan_requests;
BEGIN
 SELECT * INTO r FROM replan_requests WHERE id=NEW.id;SELECT * INTO a FROM attempts WHERE id=r.origin_attempt_id;
 IF a.task_id IS DISTINCT FROM r.task_id OR (r.origin_node_id IS NOT NULL AND (a.node_id IS DISTINCT FROM r.origin_node_id OR a.node_activation IS DISTINCT FROM r.origin_activation OR a.node_execution_source_id IS NULL OR r.requester_blocker_id IS NULL OR NOT EXISTS(SELECT 1 FROM command_receipts c WHERE c.attempt_id=a.id AND c.scope_id=r.task_id AND c.command_name='request_replan' AND c.envelope_json::jsonb->'payload'->>'reason'=r.reason AND c.response->'result'->'replan_outcome'->>'replan_request_id'=r.id))) OR (r.input_id IS NOT NULL AND (a.task_conversation_source_id IS DISTINCT FROM r.origin_source_id OR NOT EXISTS(SELECT 1 FROM task_input_resolutions x WHERE x.task_id=r.task_id AND x.input_id=r.input_id AND x.source_id=r.origin_source_id AND x.attempt_id=a.id AND x.routing->>'kind'='replan' AND x.routing->>'text'=r.reason))) THEN RAISE EXCEPTION 'Replan request lacks exact terminal source outcome' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER replan_request_origin AFTER INSERT ON replan_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_replan_origin();
CREATE FUNCTION protect_replan_authorizations() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM replan_proposals WHERE id=NEW.proposal_id) THEN
  IF NOT EXISTS(SELECT 1 FROM replan_authorization_commands WHERE authorization_id=NEW.id) OR (NEW.consumed_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM replan_publications WHERE authorization_id=NEW.id AND owner_request_id=NEW.consumed_by)) THEN RAISE EXCEPTION 'Replan authorization lacks exact owner or consumption' USING ERRCODE='23514'; END IF;
 END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER replan_authorization_exact AFTER INSERT OR UPDATE ON authorization_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION protect_replan_authorizations();
CREATE FUNCTION retain_replan_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='owner_command_receipts' AND (EXISTS(SELECT 1 FROM replan_authorization_commands WHERE task_id=OLD.scope_id AND request_id=OLD.request_id) OR EXISTS(SELECT 1 FROM replan_publications WHERE task_id=OLD.scope_id AND owner_request_id=OLD.request_id) OR EXISTS(SELECT 1 FROM replan_decisions WHERE task_id=OLD.scope_id AND owner_request_id=OLD.request_id) OR EXISTS(SELECT 1 FROM replan_input_deferrals WHERE task_id=OLD.scope_id AND request_id=OLD.request_id) OR EXISTS(SELECT 1 FROM replan_control_holds WHERE task_id=OLD.scope_id AND (resolved_by=OLD.request_id OR origin->>'owner_request_id'=OLD.request_id))) THEN RAISE EXCEPTION 'Replan Owner receipt is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='command_receipts' THEN
  IF EXISTS(SELECT 1 FROM replan_requests WHERE origin_attempt_id=OLD.attempt_id UNION ALL SELECT 1 FROM replan_sources WHERE planned_attempt_id=OLD.attempt_id) THEN RAISE EXCEPTION 'Replan Agent receipt is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END $$;
CREATE TRIGGER replan_owner_receipt BEFORE UPDATE OR DELETE ON owner_command_receipts FOR EACH ROW EXECUTE FUNCTION retain_replan_receipt();
CREATE TRIGGER replan_agent_receipt BEFORE UPDATE OR DELETE ON command_receipts FOR EACH ROW EXECUTE FUNCTION retain_replan_receipt();
CREATE FUNCTION validate_replan_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM replan_requests r JOIN tasks t ON t.id=r.task_id WHERE r.id=NEW.request_id AND r.task_id=NEW.task_id AND r.status='pending' AND r.source_id=NEW.id AND t.state='REPLAN_REQUIRED' AND t.specification_id=NEW.specification_id AND t.plan_id=NEW.plan_id AND t.control_version=NEW.expected_version) THEN RAISE EXCEPTION 'generation requires exact active request/basis' USING ERRCODE='23514'; END IF;
 IF NEW.prompt IS NOT NULL AND (NEW.context IS DISTINCT FROM NEW.prompt::jsonb OR NEW.context_digest IS DISTINCT FROM encode(sha256(convert_to(NEW.prompt,'UTF8')),'hex') OR NEW.context->>'source_id' IS DISTINCT FROM NEW.id OR NEW.context->>'replan_request_id' IS DISTINCT FROM NEW.request_id OR NEW.context->'basis' IS DISTINCT FROM jsonb_build_object('control_version',NEW.expected_version,'specification_id',NEW.specification_id,'plan_id',NEW.plan_id) OR NEW.context->'input_cutoff' IS DISTINCT FROM to_jsonb(NEW.input_cutoff)) THEN RAISE EXCEPTION 'Replan context source digest differs' USING ERRCODE='23514'; END IF;
 IF NEW.prompt IS NOT NULL THEN
  IF NEW.context->'specification' IS DISTINCT FROM (SELECT content FROM specification_revisions WHERE task_id=NEW.task_id AND id=NEW.specification_id) OR NEW.context->'graph' IS DISTINCT FROM (SELECT content FROM plan_revisions WHERE task_id=NEW.task_id AND id=NEW.plan_id) THEN RAISE EXCEPTION 'Replan context must contain exact formal revisions' USING ERRCODE='23514';END IF;
  IF NEW.context->'impact'->'node' IS DISTINCT FROM (SELECT jsonb_build_object('node_id',n.id,'node_activation',n.activation,'source_id',n.execution_source_id,'completion_operation_id',c.operation_id,'completion_manifest_digest',m.content_digest,'disposition',CASE WHEN c.operation_id IS NULL THEN 'refresh' ELSE 'carry' END,'target_node_id',n.id,'target_node_activation',n.activation) FROM plan_nodes pn JOIN nodes n ON n.id=pn.node_id LEFT JOIN node_completions c ON c.node_id=n.id AND c.activation=n.activation LEFT JOIN completion_manifests m ON m.operation_id=c.operation_id WHERE pn.plan_id=NEW.plan_id) THEN RAISE EXCEPTION 'Replan context must contain current exact Node evidence' USING ERRCODE='23514';END IF;
  IF NEW.context->'impact'->'guidance' IS DISTINCT FROM (SELECT COALESCE(jsonb_agg(jsonb_build_object('guidance_id',g.id,'version',g.version,'disposition','retain','target_node_id',pn.node_id) ORDER BY g.id),'[]'::jsonb) FROM task_guidance g CROSS JOIN plan_nodes pn WHERE g.task_id=NEW.task_id AND g.status='active' AND pn.plan_id=NEW.plan_id) THEN RAISE EXCEPTION 'Replan context must contain all active guidance' USING ERRCODE='23514';END IF;
  IF NEW.context->'impact'->'workspaces' IS DISTINCT FROM (
   SELECT COALESCE(jsonb_agg(jsonb_build_object('workspace_id',w.id,'task_id',w.task_id,'resource_id',w.resource_id,'runner_id',w.runner_id,'from_plan_id',a.plan_id,'from_node_id',l.node_id,'from_node_activation',l.node_activation,'from_attempt_id',l.attempt_id,'from_lease_id',l.id,'settle_operation_id',o.id,'kind',CASE WHEN l.checkpoint IS NULL THEN 'completed' ELSE 'checkpoint' END,'metadata',o.result->'workspace_metadata') || CASE WHEN l.checkpoint IS NULL THEN jsonb_build_object('completion_operation_id',c.operation_id,'completion_manifest_digest',o.completion_manifest_digest,'finalized_tree',o.result->'git_tree') ELSE '{}'::jsonb END ORDER BY w.id),'[]'::jsonb)
   FROM task_workspaces w JOIN LATERAL(SELECT * FROM workspace_leases WHERE workspace_id=w.id ORDER BY created_at DESC,id DESC LIMIT 1) l ON true JOIN attempts a ON a.id=l.attempt_id LEFT JOIN operations o ON o.id=COALESCE(l.checkpoint->>'operation_id',l.settle_operation_id) AND o.workspace_lease_id=l.id AND o.state='succeeded' LEFT JOIN node_completions c ON c.attempt_id=l.attempt_id WHERE w.task_id=NEW.task_id AND w.ever_materialized
  ) THEN RAISE EXCEPTION 'Replan context must contain latest settled workspace lineage' USING ERRCODE='23514';END IF;
  IF jsonb_typeof(NEW.context->'impact'->'holds') IS DISTINCT FROM 'array' OR (SELECT COALESCE(jsonb_agg(h ORDER BY h::text),'[]'::jsonb) FROM jsonb_array_elements(NEW.context->'impact'->'holds') h) IS DISTINCT FROM (
   WITH current_node AS (SELECT n.* FROM nodes n JOIN plan_nodes pn ON pn.node_id=n.id WHERE pn.plan_id=NEW.plan_id),
   inherited AS (SELECT h.origin,h.current_blocker_id FROM replan_control_holds h JOIN current_node n ON n.id=h.node_id AND n.activation=h.node_activation WHERE h.resolved_by IS NULL),
   owner_stop AS (SELECT o.request_id FROM owner_command_receipts o JOIN current_node n ON o.envelope_json::jsonb->'payload'->>'node_id'=n.id WHERE o.scope_id=NEW.task_id AND o.envelope_json::jsonb->>'name'='stop_node' ORDER BY (o.response->>'control_version')::bigint DESC LIMIT 1),
   base_holds AS (SELECT origin h FROM inherited UNION ALL SELECT jsonb_build_object('blocker_id',b.id,'kind',b.kind,'reason',b.reason,'origin_node_id',n.id,'origin_node_activation',n.activation,'owner_request_id',CASE WHEN b.kind='owner_stopped' THEN (SELECT request_id FROM owner_stop) ELSE NULL END) FROM current_node n JOIN node_blockers b ON b.id=n.blocker_id JOIN replan_requests r ON r.id=NEW.request_id WHERE b.id IS DISTINCT FROM r.requester_blocker_id AND NOT EXISTS(SELECT 1 FROM inherited WHERE current_blocker_id=b.id)),
   complete_holds AS (SELECT h FROM base_holds UNION ALL SELECT jsonb_build_object('blocker_id',NULL,'kind','owner_stopped','reason','owner_stopped','origin_node_id',n.id,'origin_node_activation',n.activation,'owner_request_id',(SELECT request_id FROM owner_stop)) FROM current_node n WHERE n.guidance_paused AND NOT EXISTS(SELECT 1 FROM base_holds WHERE h->>'kind'='owner_stopped'))
   SELECT COALESCE(jsonb_agg(h ORDER BY h::text),'[]'::jsonb) FROM complete_holds
  ) THEN RAISE EXCEPTION 'Replan context must preserve every independent hold' USING ERRCODE='23514';END IF;
 END IF;
 IF (NEW.prompt IS NULL)<>(NEW.preparation_failure IS NOT NULL) OR (NEW.prompt IS NULL)<>(NEW.context IS NULL) THEN RAISE EXCEPTION 'failed context cannot be executable' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM attempts a WHERE a.task_id=NEW.task_id AND (a.state='QUEUED' OR NOT a.process_released OR EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN ('succeeded','cancelled')))) OR EXISTS(SELECT 1 FROM workspace_leases WHERE task_id=NEW.task_id AND state<>'released') THEN RAISE EXCEPTION 'generation requires quiescent physical ownership' USING ERRCODE='23514'; END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER replan_source_exact AFTER INSERT ON replan_sources DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_replan_source();
