-- Requirements may retain a complete unchanged graph of up to 256 Nodes.
-- A carried result never retains implicit validity after its dependency changes.
CREATE FUNCTION assert_specification_graph_impact(task_identity text,plan_identity text,impact jsonb)
 RETURNS void LANGUAGE plpgsql AS $$
DECLARE members jsonb:=impact->'nodes';
BEGIN
 IF jsonb_typeof(members) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'complete impact Node array required' USING ERRCODE='23514';
 END IF;
 IF jsonb_array_length(members)>256 OR
  (SELECT count(*) FROM plan_nodes pn WHERE pn.task_id=task_identity AND pn.plan_id=plan_identity)<>jsonb_array_length(members) OR
  (SELECT count(DISTINCT n->>'node_id') FROM jsonb_array_elements(members) n)<>jsonb_array_length(members) OR
  EXISTS(SELECT 1 FROM jsonb_array_elements(members) n WHERE NOT EXISTS(
   SELECT 1 FROM plan_nodes pn WHERE pn.task_id=task_identity AND pn.plan_id=plan_identity AND pn.node_id=n->>'node_id'))
 THEN RAISE EXCEPTION 'impact must cover every unchanged graph Node exactly once' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(members) n
  JOIN plan_nodes pn ON pn.task_id=task_identity AND pn.plan_id=plan_identity AND pn.node_id=n->>'node_id'
  CROSS JOIN LATERAL jsonb_array_elements_text(pn.definition->'dependencies') dep
  WHERE n->>'disposition'='carry' AND NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(members) upstream WHERE upstream->>'node_id'=dep AND upstream->>'disposition'='carry'))
 THEN RAISE EXCEPTION 'carried completion requires carried dependency evidence' USING ERRCODE='23514';END IF;
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
  PERFORM assert_specification_graph_impact(NEW.task_id,NEW.base_plan_id,NEW.impact);
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

CREATE FUNCTION validate_specification_publication_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p requirement_proposals;
BEGIN
 SELECT proposal.* INTO p FROM requirement_changes c JOIN requirement_proposals proposal ON proposal.id=c.proposal_id WHERE c.id=NEW.change_id;
 IF p.replan_source_id IS NOT NULL THEN RETURN NULL;END IF;
 IF (SELECT count(*) FROM specification_node_applicability a WHERE a.change_id=NEW.change_id)<>jsonb_array_length(p.impact->'nodes') OR
  EXISTS(SELECT 1 FROM jsonb_array_elements(p.impact->'nodes') n WHERE NOT EXISTS(
   SELECT 1 FROM specification_node_applicability a WHERE a.change_id=NEW.change_id AND a.node_id=n->>'node_id'
    AND to_jsonb(a.node_activation)=n->'node_activation'))
 THEN RAISE EXCEPTION 'Specification publication requires every authorized Node applicability' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER specification_publication_complete AFTER INSERT ON requirement_publications
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_specification_publication_membership();
