-- Complete multi-Node Replan; semantic choices remain exactly Owner-approved.
-- Preserve the review-origin and completion-applicability functions from migration25.
ALTER TABLE replan_node_applicability DROP CONSTRAINT replan_node_applicability_disposition_check;
ALTER TABLE replan_node_applicability ALTER COLUMN target_node_id DROP NOT NULL;
ALTER TABLE replan_node_applicability ALTER COLUMN target_node_activation DROP NOT NULL;
ALTER TABLE replan_node_applicability ADD CONSTRAINT replan_node_disposition CHECK (
 disposition IN ('refresh','carry','invalidate','remove') AND
 ((disposition='remove' AND target_node_id IS NULL AND target_node_activation IS NULL) OR
  (disposition<>'remove' AND target_node_id=node_id AND target_node_activation=node_activation+CASE WHEN disposition='invalidate' THEN 1 ELSE 0 END))
);
ALTER TABLE replan_guidance_applicability DROP CONSTRAINT replan_guidance_applicability_pkey;
ALTER TABLE replan_guidance_applicability ADD PRIMARY KEY(publication_id,guidance_id,node_id);
CREATE UNIQUE INDEX replan_hold_one_target_origin ON replan_control_holds(publication_id,node_id,node_activation,origin);

CREATE FUNCTION task_guidance_applies(tid text,gid text,nid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM task_guidance g JOIN tasks t ON t.id=g.task_id JOIN plan_nodes pn ON pn.task_id=t.id AND pn.plan_id=t.plan_id AND pn.node_id=nid
 WHERE g.task_id=tid AND g.id=gid AND g.status='active' AND CASE
 WHEN EXISTS(SELECT 1 FROM replan_guidance_applicability a JOIN replan_publications p ON p.id=a.publication_id WHERE a.task_id=tid AND a.guidance_id=gid AND p.new_plan_id=t.plan_id)
 THEN EXISTS(SELECT 1 FROM replan_guidance_applicability a JOIN replan_publications p ON p.id=a.publication_id WHERE a.task_id=tid AND a.guidance_id=gid AND a.node_id=nid AND p.new_plan_id=t.plan_id)
 ELSE g.node_id IS NULL OR g.node_id=nid END)
$$;

-- One deterministic snapshot of facts, with harmless default mappings for the
-- Planner to reconsider. This never authorizes a publication or a workspace open.
CREATE FUNCTION replan_source_impact(tid text,pid text,rid text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 WITH current_nodes AS (
  SELECT n.*,c.operation_id,m.content_digest FROM plan_nodes pn JOIN nodes n ON n.id=pn.node_id
  LEFT JOIN node_completions c ON c.node_id=n.id AND c.activation=n.activation
  LEFT JOIN completion_manifests m ON m.operation_id=c.operation_id WHERE pn.task_id=tid AND pn.plan_id=pid
 ), node_facts AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('node_id',n.id,'node_activation',n.activation,'source_id',n.execution_source_id,
   'completion_operation_id',n.operation_id,'completion_manifest_digest',n.content_digest,
   'disposition',CASE WHEN n.operation_id IS NULL THEN 'refresh' ELSE 'carry' END,'target_node_id',n.id,'target_node_activation',n.activation) ORDER BY n.id),'[]'::jsonb) body FROM current_nodes n
 ), mapped_guidance AS (
  SELECT g.*,(SELECT COALESCE(jsonb_agg(to_jsonb(n.id) ORDER BY n.id),'[]'::jsonb) FROM current_nodes n WHERE task_guidance_applies(tid,g.id,n.id)) targets
  FROM task_guidance g WHERE g.task_id=tid AND g.status='active'
 ), guidance_facts AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('guidance_id',id,'version',version,'disposition',CASE WHEN jsonb_array_length(targets)=0 THEN 'supersede' ELSE 'retain' END,'target_node_ids',targets) ORDER BY id),'[]'::jsonb) body FROM mapped_guidance
 ), inherited AS (
  SELECT h.origin,h.current_blocker_id,n.id node_id FROM replan_control_holds h JOIN replan_publications p ON p.id=h.publication_id
  JOIN current_nodes n ON n.id=h.node_id AND n.activation=h.node_activation WHERE h.task_id=tid AND h.resolved_by IS NULL AND p.new_plan_id=pid
 ), owner_stops AS (
  SELECT DISTINCT ON(n.id) n.id node_id,o.request_id FROM current_nodes n JOIN owner_command_receipts o ON o.scope_id=tid
  AND o.envelope_json::jsonb->>'name'='stop_node' AND o.envelope_json::jsonb->'payload'->>'node_id'=n.id AND (o.envelope_json::jsonb->'payload'->>'node_activation')::bigint=n.activation
  ORDER BY n.id,(o.response->>'control_version')::bigint DESC
 ), base_holds AS (
  SELECT origin,node_id FROM inherited
  UNION SELECT jsonb_build_object('blocker_id',b.id,'kind',b.kind,'reason',b.reason,'origin_node_id',n.id,'origin_node_activation',n.activation,
   'owner_request_id',CASE WHEN b.kind='owner_stopped' THEN s.request_id ELSE NULL END),n.id
  FROM current_nodes n JOIN node_blockers b ON b.id=n.blocker_id LEFT JOIN owner_stops s ON s.node_id=n.id
  WHERE b.id IS DISTINCT FROM (SELECT requester_blocker_id FROM replan_requests WHERE id=rid)
   AND NOT EXISTS(SELECT 1 FROM inherited h WHERE h.node_id=n.id AND h.current_blocker_id=b.id)
 ), complete_holds AS (
  SELECT origin,node_id FROM base_holds
  UNION SELECT jsonb_build_object('blocker_id',NULL,'kind','owner_stopped','reason','owner_stopped','origin_node_id',n.id,'origin_node_activation',n.activation,'owner_request_id',s.request_id),n.id
  FROM current_nodes n LEFT JOIN owner_stops s ON s.node_id=n.id WHERE n.guidance_paused
  AND NOT EXISTS(SELECT 1 FROM base_holds h WHERE h.node_id=n.id AND h.origin->>'kind'='owner_stopped')
 ), grouped_holds AS (
  SELECT origin,jsonb_agg(to_jsonb(node_id) ORDER BY node_id) targets FROM complete_holds GROUP BY origin
 ), hold_facts AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('origin',origin,'target_node_ids',targets) ORDER BY review_canonical_json(origin)),'[]'::jsonb) body FROM grouped_holds
 ), workspace_inputs AS (
  SELECT w.id,l.node_id,l.node_activation,l.checkpoint,jsonb_build_object('workspace_id',w.id,'task_id',w.task_id,'resource_id',w.resource_id,'runner_id',w.runner_id,
   'from_plan_id',a.plan_id,'from_node_id',l.node_id,'from_node_activation',l.node_activation,'from_attempt_id',l.attempt_id,'from_lease_id',l.id,
   'settle_operation_id',o.id,'kind',CASE WHEN l.checkpoint IS NULL THEN 'completed' ELSE 'checkpoint' END,'metadata',o.result->'workspace_metadata') ||
   CASE WHEN l.checkpoint IS NULL THEN jsonb_build_object('completion_operation_id',c.operation_id,'completion_manifest_digest',o.completion_manifest_digest,'finalized_tree',o.result->'git_tree') ELSE '{}'::jsonb END input
  FROM task_workspaces w JOIN LATERAL(SELECT * FROM workspace_leases WHERE workspace_id=w.id ORDER BY created_at DESC,id DESC LIMIT 1) l ON true
  JOIN attempts a ON a.id=l.attempt_id LEFT JOIN operations o ON o.id=COALESCE(l.checkpoint->>'operation_id',l.settle_operation_id) AND o.workspace_lease_id=l.id AND o.state='succeeded'
  LEFT JOIN node_completions c ON c.attempt_id=l.attempt_id WHERE w.task_id=tid AND w.ever_materialized
 ), workspace_facts AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('input',w.input,'target_nodes',CASE WHEN w.checkpoint IS NULL
   THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('node_id',n.id,'node_activation',n.activation) ORDER BY n.id),'[]'::jsonb) FROM current_nodes n)
   ELSE (SELECT COALESCE(jsonb_agg(jsonb_build_object('node_id',n.id,'node_activation',n.activation)),'[]'::jsonb) FROM
    (SELECT n.id,n.activation FROM current_nodes n WHERE (n.id=w.node_id) OR n.operation_id IS NULL
     ORDER BY (n.id=w.node_id) DESC,n.id LIMIT 1) n) END) ORDER BY w.id),'[]'::jsonb) body FROM workspace_inputs w
 ) SELECT jsonb_build_object('nodes',n.body,'guidance',g.body,'holds',h.body,'workspaces',w.body) FROM node_facts n,guidance_facts g,hold_facts h,workspace_facts w
$$;

CREATE FUNCTION validate_replan_graph_impact(p replan_proposals) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s replan_sources; graph jsonb:=p.content->'nodes';impact jsonb:=p.content->'impact';item jsonb;workspace_target jsonb;prior jsonb;expected_activation bigint;
BEGIN
 SELECT * INTO s FROM replan_sources WHERE id=p.source_id;
 IF jsonb_typeof(graph) IS DISTINCT FROM 'array' OR jsonb_typeof(impact) IS DISTINCT FROM 'object' OR
  jsonb_typeof(impact->'nodes') IS DISTINCT FROM 'array' OR jsonb_typeof(impact->'guidance') IS DISTINCT FROM 'array' OR
  jsonb_typeof(impact->'holds') IS DISTINCT FROM 'array' OR jsonb_typeof(impact->'workspaces') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Replan requires complete graph and mapping arrays' USING ERRCODE='23514';END IF;
 IF jsonb_array_length(graph) NOT BETWEEN 1 AND 256 OR jsonb_array_length(impact->'nodes') NOT BETWEEN 1 AND 256 OR
  jsonb_array_length(impact->'guidance')>256 OR jsonb_array_length(impact->'holds')>256 OR jsonb_array_length(impact->'workspaces')>256 OR
  (impact-ARRAY['nodes','guidance','holds','workspaces'])<>'{}'::jsonb
 THEN RAISE EXCEPTION 'Replan complete graph exceeds contract' USING ERRCODE='23514';END IF;
 IF s.context IS NULL OR
  (SELECT jsonb_agg(n-ARRAY['disposition','target_node_id','target_node_activation'] ORDER BY ord) FROM jsonb_array_elements(impact->'nodes') WITH ORDINALITY x(n,ord)) IS DISTINCT FROM
  (SELECT jsonb_agg(n-ARRAY['disposition','target_node_id','target_node_activation'] ORDER BY ord) FROM jsonb_array_elements(s.context->'impact'->'nodes') WITH ORDINALITY x(n,ord))
 THEN RAISE EXCEPTION 'proposal must preserve every ordered source Node fact' USING ERRCODE='23514';END IF;
 IF (SELECT count(DISTINCT n->>'node_id') FROM jsonb_array_elements(graph) n)<>jsonb_array_length(graph)
 THEN RAISE EXCEPTION 'Replan graph Node IDs must be unique' USING ERRCODE='23514';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(graph) LOOP
  IF jsonb_typeof(item->'node_id') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'goal') IS DISTINCT FROM 'string' OR
   jsonb_typeof(item->'role_id') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'dependencies') IS DISTINCT FROM 'array' OR
   (item ? 'hard_requirements' AND jsonb_typeof(item->'hard_requirements') IS DISTINCT FROM 'array') OR
   (item ? 'consumes' AND jsonb_typeof(item->'consumes') IS DISTINCT FROM 'array') OR
   (item ? 'expected_outputs' AND jsonb_typeof(item->'expected_outputs') IS DISTINCT FROM 'array') OR
   item-ARRAY['node_id','goal','role_id','dependencies','hard_requirements','consumes','expected_outputs']<>'{}'::jsonb
  THEN RAISE EXCEPTION 'Replan graph definition is malformed' USING ERRCODE='23514';END IF;
  IF NOT EXISTS(SELECT 1 FROM tasks t JOIN project_roles pr ON pr.project_id=t.project_id JOIN roles r ON r.id=pr.role_id WHERE t.id=p.task_id AND r.id=item->>'role_id' AND NOT r.archived) OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(item->'dependencies') dep WHERE jsonb_typeof(dep)<>'string' OR dep=to_jsonb(item->>'node_id') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph) n WHERE n->'node_id'=dep)) OR
   (SELECT count(DISTINCT dep) FROM jsonb_array_elements(item->'dependencies') dep)<>jsonb_array_length(item->'dependencies')
  THEN RAISE EXCEPTION 'Replan graph needs selected Roles and exact internal dependencies' USING ERRCODE='23514';END IF;
  IF jsonb_array_length(COALESCE(item->'consumes','[]'::jsonb))>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(item->'hard_requirements','[]'::jsonb)) x WHERE jsonb_typeof(x)<>'string') OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(item->'consumes','[]'::jsonb)) x WHERE jsonb_typeof(x)<>'string') OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(item->'expected_outputs','[]'::jsonb)) x WHERE jsonb_typeof(x)<>'string')
  THEN RAISE EXCEPTION 'Replan Node constraints and references must be strings' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM plan_nodes old WHERE old.plan_id=s.plan_id AND old.node_id=item->>'node_id' AND old.definition IS DISTINCT FROM item) OR
   (NOT EXISTS(SELECT 1 FROM plan_nodes old WHERE old.plan_id=s.plan_id AND old.node_id=item->>'node_id') AND
    EXISTS(SELECT 1 FROM nodes old WHERE old.id=item->>'node_id' AND (old.task_id<>p.task_id OR EXISTS(SELECT 1 FROM node_activations a WHERE a.node_id=old.id AND a.plan_id<>p.plan_id))))
  THEN RAISE EXCEPTION 'retained definitions are immutable and new work needs a new Node identity' USING ERRCODE='23514';END IF;
 END LOOP;
 IF EXISTS(WITH RECURSIVE edges(n,d) AS (SELECT n->>'node_id',dep FROM jsonb_array_elements(graph) n CROSS JOIN LATERAL jsonb_array_elements_text(n->'dependencies') dep),reach(n,d) AS (SELECT n,d FROM edges UNION SELECT r.n,e.d FROM reach r JOIN edges e ON e.n=r.d) SELECT 1 FROM reach WHERE n=d)
 THEN RAISE EXCEPTION 'Replan graph must be acyclic' USING ERRCODE='23514';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(impact->'nodes') LOOP
  IF item->>'disposition'='remove' THEN
   IF item->'target_node_id' IS DISTINCT FROM 'null'::jsonb OR item->'target_node_activation' IS DISTINCT FROM 'null'::jsonb OR EXISTS(SELECT 1 FROM jsonb_array_elements(graph) n WHERE n->'node_id'=item->'node_id')
   THEN RAISE EXCEPTION 'removed Node cannot remain a graph member or target' USING ERRCODE='23514';END IF;
  ELSE
   IF (item->>'disposition' IN ('refresh','carry','invalidate')) IS NOT TRUE OR item->'target_node_id' IS DISTINCT FROM item->'node_id' OR
    item->'target_node_activation' IS DISTINCT FROM to_jsonb((item->>'node_activation')::bigint+CASE WHEN item->>'disposition'='invalidate' THEN 1 ELSE 0 END) OR
    NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph) n WHERE n->'node_id'=item->'node_id') OR
    ((item->>'disposition'='refresh') IS DISTINCT FROM (item->>'completion_operation_id' IS NULL)) OR
    (item->>'disposition'='carry' AND (item->>'completion_operation_id' IS NULL OR NOT review_completion_applies(item->>'completion_operation_id',s.specification_id,s.plan_id)))
   THEN RAISE EXCEPTION 'Node disposition does not authorize its exact activation/evidence' USING ERRCODE='23514';END IF;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(graph) n JOIN jsonb_array_elements(impact->'nodes') evidence ON evidence->'node_id'=n->'node_id'
  CROSS JOIN LATERAL jsonb_array_elements(n->'dependencies') dep WHERE evidence->>'disposition'='carry' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(impact->'nodes') upstream WHERE upstream->'node_id'=dep AND upstream->>'disposition'='carry'))
 THEN RAISE EXCEPTION 'carried Node requires carried dependency evidence' USING ERRCODE='23514';END IF;
 IF EXISTS(WITH RECURSIVE invalid(node_identity) AS (
  SELECT entry.value->>'node_id' FROM jsonb_array_elements(impact->'nodes') AS entry(value) WHERE entry.value->>'disposition'='invalidate'
  UNION
  SELECT entry.value->>'node_id' FROM invalid i CROSS JOIN jsonb_array_elements(graph) AS entry(value) WHERE entry.value->'dependencies' ? i.node_identity
 ) SELECT 1 FROM invalid i JOIN jsonb_array_elements(impact->'nodes') AS entry(value) ON entry.value->>'node_id'=i.node_identity WHERE entry.value->>'disposition'='carry')
 THEN RAISE EXCEPTION 'descendants of invalidated upstream evidence cannot carry completion' USING ERRCODE='23514';END IF;
 IF (SELECT COALESCE(jsonb_agg(g-ARRAY['disposition','target_node_ids'] ORDER BY g->>'guidance_id'),'[]'::jsonb) FROM jsonb_array_elements(impact->'guidance') g) IS DISTINCT FROM
    (SELECT COALESCE(jsonb_agg(g-ARRAY['disposition','target_node_ids'] ORDER BY g->>'guidance_id'),'[]'::jsonb) FROM jsonb_array_elements(s.context->'impact'->'guidance') g) OR
    (SELECT count(DISTINCT g->>'guidance_id') FROM jsonb_array_elements(impact->'guidance') g)<>jsonb_array_length(impact->'guidance')
 THEN RAISE EXCEPTION 'proposal must disposition each exact source guidance once' USING ERRCODE='23514';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(impact->'guidance') LOOP
  IF jsonb_typeof(item->'target_node_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'guidance targets required' USING ERRCODE='23514';END IF;
  IF (item->>'disposition' IN ('retain','supersede')) IS NOT TRUE OR ((item->>'disposition'='supersede') IS DISTINCT FROM (jsonb_array_length(item->'target_node_ids')=0)) OR
   (SELECT count(DISTINCT target) FROM jsonb_array_elements(item->'target_node_ids') target)<>jsonb_array_length(item->'target_node_ids') OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(item->'target_node_ids') target WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph) n WHERE n->'node_id'=target))
  THEN RAISE EXCEPTION 'guidance disposition targets must be unique current graph members' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(impact->'nodes') n WHERE n->>'disposition'='carry' AND item->'target_node_ids' ? (n->>'node_id') AND NOT EXISTS(SELECT 1 FROM task_guidance_obligations o WHERE o.task_id=p.task_id AND o.guidance_id=item->>'guidance_id' AND o.node_id=n->>'node_id' AND o.node_activation=(n->>'node_activation')::bigint AND o.status='handled' AND o.completion_operation_id=n->>'completion_operation_id'))
  THEN RAISE EXCEPTION 'carried completion cannot silently handle newly assigned guidance' USING ERRCODE='23514';END IF;
 END LOOP;
 IF (SELECT COALESCE(jsonb_agg(h->'origin' ORDER BY review_canonical_json(h->'origin')),'[]'::jsonb) FROM jsonb_array_elements(impact->'holds') h) IS DISTINCT FROM
    (SELECT COALESCE(jsonb_agg(h->'origin' ORDER BY review_canonical_json(h->'origin')),'[]'::jsonb) FROM jsonb_array_elements(s.context->'impact'->'holds') h) OR
    (SELECT count(DISTINCT h->'origin') FROM jsonb_array_elements(impact->'holds') h)<>jsonb_array_length(impact->'holds')
 THEN RAISE EXCEPTION 'proposal must preserve every source control origin once' USING ERRCODE='23514';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(impact->'holds') LOOP
  IF jsonb_typeof(item->'target_node_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'hold targets required' USING ERRCODE='23514';END IF;
  IF jsonb_array_length(item->'target_node_ids')=0 OR
   (SELECT count(DISTINCT target) FROM jsonb_array_elements(item->'target_node_ids') target)<>jsonb_array_length(item->'target_node_ids') OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(item->'target_node_ids') target WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph) n WHERE n->'node_id'=target)) OR item-ARRAY['origin','target_node_ids']<>'{}'::jsonb
  THEN RAISE EXCEPTION 'each independent control needs explicit unique graph targets' USING ERRCODE='23514';END IF;
 END LOOP;
 IF (SELECT COALESCE(jsonb_agg(w->'input' ORDER BY w->'input'->>'workspace_id'),'[]'::jsonb) FROM jsonb_array_elements(impact->'workspaces') w) IS DISTINCT FROM
    (SELECT COALESCE(jsonb_agg(w->'input' ORDER BY w->'input'->>'workspace_id'),'[]'::jsonb) FROM jsonb_array_elements(s.context->'impact'->'workspaces') w) OR
    (SELECT count(DISTINCT w->'input'->>'workspace_id') FROM jsonb_array_elements(impact->'workspaces') w)<>jsonb_array_length(impact->'workspaces')
 THEN RAISE EXCEPTION 'proposal must preserve every exact workspace input once' USING ERRCODE='23514';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(impact->'workspaces') LOOP
  IF jsonb_typeof(item->'target_nodes') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'workspace target set required' USING ERRCODE='23514';END IF;
  IF (item->'input'->>'kind'='checkpoint' AND jsonb_array_length(item->'target_nodes')<>1) OR
   (SELECT count(DISTINCT target->>'node_id') FROM jsonb_array_elements(item->'target_nodes') target)<>jsonb_array_length(item->'target_nodes') OR item-ARRAY['input','target_nodes']<>'{}'::jsonb
  THEN RAISE EXCEPTION 'private checkpoint needs one target; completed input permits unique approved targets' USING ERRCODE='23514';END IF;
  FOR workspace_target IN SELECT value FROM jsonb_array_elements(item->'target_nodes') LOOP
   SELECT n INTO prior FROM jsonb_array_elements(impact->'nodes') n WHERE n->'target_node_id'=workspace_target->'node_id';
   IF item->'input'->>'kind'='checkpoint' AND prior->>'disposition'='carry'
   THEN RAISE EXCEPTION 'private checkpoint requires an unfinished target' USING ERRCODE='23514';END IF;
   expected_activation:=CASE WHEN prior IS NULL THEN 1 ELSE (prior->>'target_node_activation')::bigint END;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph) n WHERE n->'node_id'=workspace_target->'node_id') OR workspace_target->'node_activation' IS DISTINCT FROM to_jsonb(expected_activation) OR workspace_target-ARRAY['node_id','node_activation']<>'{}'::jsonb
   THEN RAISE EXCEPTION 'workspace target must bind exact published activation' USING ERRCODE='23514';END IF;
  END LOOP;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION validate_replan_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM replan_requests r JOIN tasks t ON t.id=r.task_id WHERE r.id=NEW.request_id AND r.task_id=NEW.task_id AND r.status='pending' AND r.source_id=NEW.id AND t.state='REPLAN_REQUIRED' AND t.specification_id=NEW.specification_id AND t.plan_id=NEW.plan_id AND t.control_version=NEW.expected_version) THEN RAISE EXCEPTION 'generation requires exact active request/basis' USING ERRCODE='23514'; END IF;
 IF NEW.prompt IS NOT NULL AND (NEW.context IS DISTINCT FROM NEW.prompt::jsonb OR NEW.context_digest IS DISTINCT FROM encode(sha256(convert_to(NEW.prompt,'UTF8')),'hex') OR NEW.context->>'source_id' IS DISTINCT FROM NEW.id OR NEW.context->>'replan_request_id' IS DISTINCT FROM NEW.request_id OR NEW.context->'basis' IS DISTINCT FROM jsonb_build_object('control_version',NEW.expected_version,'specification_id',NEW.specification_id,'plan_id',NEW.plan_id) OR NEW.context->'input_cutoff' IS DISTINCT FROM to_jsonb(NEW.input_cutoff)) THEN RAISE EXCEPTION 'Replan context source digest differs' USING ERRCODE='23514'; END IF;
 IF NEW.prompt IS NOT NULL THEN
  IF NEW.context->'specification' IS DISTINCT FROM (SELECT content FROM specification_revisions WHERE task_id=NEW.task_id AND id=NEW.specification_id) OR NEW.context->'graph' IS DISTINCT FROM (SELECT content FROM plan_revisions WHERE task_id=NEW.task_id AND id=NEW.plan_id) THEN RAISE EXCEPTION 'Replan context must contain exact formal revisions' USING ERRCODE='23514';END IF;
  IF NEW.context->'impact' IS DISTINCT FROM replan_source_impact(NEW.task_id,NEW.plan_id,NEW.request_id) THEN RAISE EXCEPTION 'Replan context must preserve complete current graph, guidance, controls and workspace lineage' USING ERRCODE='23514';END IF;
 END IF;
 IF (NEW.prompt IS NULL)<>(NEW.preparation_failure IS NOT NULL) OR (NEW.prompt IS NULL)<>(NEW.context IS NULL) THEN RAISE EXCEPTION 'failed context cannot be executable' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM attempts a WHERE a.task_id=NEW.task_id AND (a.state='QUEUED' OR NOT a.process_released OR EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN ('succeeded','cancelled')))) OR EXISTS(SELECT 1 FROM workspace_leases WHERE task_id=NEW.task_id AND state<>'released') THEN RAISE EXCEPTION 'generation requires quiescent physical ownership' USING ERRCODE='23514'; END IF;RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION validate_replan_records() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p replan_proposals;r replan_requests;s replan_sources;generic_proposal task_command_proposals;pub replan_publications;auth authorization_receipts;cmd jsonb;response jsonb;approved_node jsonb;
BEGIN
 IF TG_TABLE_NAME='replan_proposals' THEN
  p:=NEW;SELECT * INTO r FROM replan_requests WHERE id=p.request_id;SELECT * INTO s FROM replan_sources WHERE id=p.source_id;SELECT * INTO generic_proposal FROM task_command_proposals WHERE id=p.id;
  IF s.task_id IS DISTINCT FROM p.task_id OR s.request_id IS DISTINCT FROM p.request_id OR generic_proposal.task_id IS DISTINCT FROM p.task_id OR generic_proposal.action IS DISTINCT FROM 'publish_replan' OR generic_proposal.content IS DISTINCT FROM p.content OR generic_proposal.content_digest IS DISTINCT FROM p.content_digest OR p.content->>'source_id' IS DISTINCT FROM s.id OR p.content->>'replan_request_id' IS DISTINCT FROM r.id OR p.content->>'plan_id' IS DISTINCT FROM p.plan_id OR ((p.content->'basis')-ARRAY['node_id','node_activation','source_id']) IS DISTINCT FROM jsonb_build_object('control_version',s.expected_version,'specification_id',s.specification_id,'plan_id',s.plan_id) OR p.content->'input_cutoff' IS DISTINCT FROM to_jsonb(s.input_cutoff) OR p.content->'requirement'->>'proposal_id' IS DISTINCT FROM p.requirement_proposal_id OR jsonb_array_length(p.content->'nodes') NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'Replan proposal source/envelope mismatch' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM command_receipts c WHERE c.attempt_id=s.planned_attempt_id AND c.scope_id=p.task_id AND c.command_name='prepare_replan' AND c.envelope_json::jsonb->'payload'=p.content-ARRAY['input_cutoff','requirement_content_digest'] AND c.response->'result'->'replan_outcome'->>'proposal_id'=p.id AND c.response->>'status'='committed') THEN RAISE EXCEPTION 'proposal lacks exact terminal command receipt' USING ERRCODE='23514'; END IF;
  IF s.context IS NULL OR r.source_id IS DISTINCT FROM s.id OR r.proposal_id IS DISTINCT FROM p.id OR r.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'proposal must bind its current source/request' USING ERRCODE='23514';END IF;
  PERFORM validate_replan_graph_impact(p);
  IF p.requirement_proposal_id IS NOT NULL THEN PERFORM validate_joint_requirement(p.requirement_proposal_id); END IF;
 ELSIF TG_TABLE_NAME='replan_authorization_commands' THEN
  SELECT * INTO auth FROM authorization_receipts WHERE id=NEW.authorization_id;SELECT * INTO p FROM replan_proposals WHERE id=auth.proposal_id;
  SELECT envelope_json::jsonb,o.response INTO cmd,response FROM owner_command_receipts o WHERE scope_id=NEW.task_id AND request_id=NEW.request_id;
  IF p.task_id IS DISTINCT FROM NEW.task_id OR cmd->>'name' IS DISTINCT FROM 'confirm_replan' OR cmd->>'task_id' IS DISTINCT FROM NEW.task_id OR cmd->>'request_id' IS DISTINCT FROM NEW.request_id OR cmd->'payload' IS DISTINCT FROM jsonb_build_object('proposal_id',p.id,'content_digest',p.content_digest) OR response->>'confirmation_id' IS DISTINCT FROM auth.id OR response->>'request_id' IS DISTINCT FROM NEW.request_id OR response->>'status' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION 'Replan confirmation lacks exact Owner receipt' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='replan_publications' THEN
  pub:=NEW;SELECT * INTO p FROM replan_proposals WHERE id=pub.proposal_id;SELECT * INTO r FROM replan_requests WHERE id=pub.request_id;SELECT * INTO auth FROM authorization_receipts WHERE id=pub.authorization_id;
  SELECT envelope_json::jsonb,o.response INTO cmd,response FROM owner_command_receipts o WHERE scope_id=pub.task_id AND request_id=pub.owner_request_id;
  IF p.task_id IS DISTINCT FROM pub.task_id OR p.request_id IS DISTINCT FROM r.id OR r.status IS DISTINCT FROM 'published' OR auth.proposal_id IS DISTINCT FROM p.id OR auth.consumed_by IS DISTINCT FROM pub.owner_request_id OR NOT EXISTS(SELECT 1 FROM replan_authorization_commands WHERE authorization_id=auth.id AND task_id=pub.task_id) OR p.plan_id IS DISTINCT FROM pub.new_plan_id OR p.content->'basis'->>'plan_id' IS DISTINCT FROM pub.old_plan_id OR p.content->'basis'->>'specification_id' IS DISTINCT FROM pub.old_specification_id OR cmd->>'name' IS DISTINCT FROM 'publish_replan' OR cmd->>'task_id' IS DISTINCT FROM pub.task_id OR cmd->>'request_id' IS DISTINCT FROM pub.owner_request_id OR cmd->'payload'->>'proposal_id' IS DISTINCT FROM p.id OR cmd->'payload'->>'confirmation_id' IS DISTINCT FROM auth.id OR cmd->'payload'->'basis' IS DISTINCT FROM p.content->'basis' OR response->>'publication_id' IS DISTINCT FROM pub.id OR response->>'plan_id' IS DISTINCT FROM pub.new_plan_id OR response->>'specification_id' IS DISTINCT FROM pub.new_specification_id OR response->>'request_id' IS DISTINCT FROM pub.owner_request_id OR response->>'status' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION 'publication lacks exact graph authorization' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM tasks WHERE id=pub.task_id AND plan_id=pub.new_plan_id AND specification_id=pub.new_specification_id) OR NOT EXISTS(SELECT 1 FROM plan_revisions pr WHERE pr.id=pub.new_plan_id AND pr.task_id=pub.task_id AND pr.specification_id=pub.new_specification_id AND pr.content->'nodes'=p.content->'nodes') THEN RAISE EXCEPTION 'publication requires complete atomic effective graph' USING ERRCODE='23514'; END IF;
  IF (p.requirement_proposal_id IS NULL)<>(pub.requirement_change_id IS NULL) OR (pub.requirement_change_id IS NULL AND pub.old_specification_id<>pub.new_specification_id) THEN RAISE EXCEPTION 'joint publication is incomplete' USING ERRCODE='23514'; END IF;
  IF pub.requirement_change_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM requirement_changes c JOIN requirement_publications rp ON rp.change_id=c.id WHERE c.id=pub.requirement_change_id AND c.task_id=pub.task_id AND c.proposal_id=p.requirement_proposal_id AND c.authorization_id=cmd->'payload'->>'requirement_confirmation_id' AND c.admission_request_id=pub.owner_request_id AND c.status='published' AND rp.specification_id=pub.new_specification_id AND rp.parent_id=pub.old_specification_id AND rp.plan_id=pub.new_plan_id) THEN RAISE EXCEPTION 'joint publication lacks exact requirements consumption' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM attempts x WHERE x.task_id=pub.task_id AND (x.state='QUEUED' OR NOT x.process_released OR EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=x.id AND o.state NOT IN ('succeeded','cancelled')))) OR EXISTS(SELECT 1 FROM workspace_leases WHERE task_id=pub.task_id AND state<>'released') THEN RAISE EXCEPTION 'publication must be physically quiescent' USING ERRCODE='23514'; END IF;
  PERFORM validate_replan_graph_impact(p);
  IF (SELECT count(*) FROM replan_node_applicability x WHERE x.publication_id=pub.id)<>jsonb_array_length(p.content->'impact'->'nodes') OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(p.content->'impact'->'nodes') n WHERE NOT EXISTS(SELECT 1 FROM replan_node_applicability x WHERE x.publication_id=pub.id AND x.node_id=n->>'node_id' AND x.node_activation=(n->>'node_activation')::bigint))
  THEN RAISE EXCEPTION 'publication requires every old applicability row' USING ERRCODE='23514';END IF;
  IF (SELECT count(*) FROM plan_nodes WHERE plan_id=pub.new_plan_id)<>jsonb_array_length(p.content->'nodes') OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(p.content->'nodes') item WHERE NOT EXISTS(
    SELECT 1 FROM plan_nodes pn JOIN nodes node ON node.id=pn.node_id JOIN node_activations act ON act.node_id=node.id AND act.activation=node.activation
    LEFT JOIN replan_node_applicability edge ON edge.publication_id=pub.id AND edge.target_node_id=node.id
    WHERE pn.task_id=pub.task_id AND pn.plan_id=pub.new_plan_id AND pn.node_id=item->>'node_id' AND pn.definition=item
     AND node.activation=COALESCE(edge.target_node_activation,1) AND activation_applies(pub.task_id,node.id,node.activation,pub.new_specification_id,pub.new_plan_id)
     AND (edge.disposition IN ('refresh','carry') OR act.specification_id=pub.new_specification_id AND act.plan_id=pub.new_plan_id)
     AND (edge.disposition IS DISTINCT FROM 'carry' OR node.state='COMPLETED' OR node.state='BLOCKED' AND EXISTS(
      SELECT 1 FROM replan_control_holds hold WHERE hold.publication_id=pub.id AND hold.node_id=node.id AND hold.node_activation=node.activation
       AND hold.resolved_by IS NULL AND hold.current_blocker_id=node.blocker_id))
   )) THEN RAISE EXCEPTION 'publication requires every exact new graph member and activation' USING ERRCODE='23514';END IF;
  IF (SELECT count(*) FROM replan_guidance_applicability x WHERE x.publication_id=pub.id)<>(SELECT COALESCE(sum(jsonb_array_length(g->'target_node_ids')),0) FROM jsonb_array_elements(p.content->'impact'->'guidance') g) OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(p.content->'impact'->'guidance') g CROSS JOIN LATERAL jsonb_array_elements_text(g->'target_node_ids') target WHERE NOT EXISTS(SELECT 1 FROM replan_guidance_applicability x WHERE x.publication_id=pub.id AND x.guidance_id=g->>'guidance_id' AND x.node_id=target)) OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(p.content->'impact'->'guidance') g JOIN task_guidance actual ON actual.id=g->>'guidance_id' WHERE g->>'disposition'='supersede' AND actual.status='active')
  THEN RAISE EXCEPTION 'publication requires every complete guidance disposition' USING ERRCODE='23514';END IF;
  IF (SELECT count(*) FROM replan_control_holds x WHERE x.publication_id=pub.id)<>(SELECT COALESCE(sum(jsonb_array_length(h->'target_node_ids')),0) FROM jsonb_array_elements(p.content->'impact'->'holds') h) OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(p.content->'impact'->'holds') h CROSS JOIN LATERAL jsonb_array_elements_text(h->'target_node_ids') target WHERE NOT EXISTS(SELECT 1 FROM replan_control_holds x WHERE x.publication_id=pub.id AND x.origin=h->'origin' AND x.node_id=target))
  THEN RAISE EXCEPTION 'publication requires every independent hold target' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='replan_node_applicability' THEN
  SELECT * INTO pub FROM replan_publications WHERE id=NEW.publication_id;SELECT * INTO p FROM replan_proposals WHERE id=pub.proposal_id;SELECT item INTO approved_node FROM jsonb_array_elements(p.content->'impact'->'nodes') x(item) WHERE item->>'node_id'=NEW.node_id AND (item->>'node_activation')::bigint=NEW.node_activation;
  IF NEW.task_id IS DISTINCT FROM pub.task_id OR approved_node IS DISTINCT FROM jsonb_build_object('node_id',NEW.node_id,'node_activation',NEW.node_activation,'source_id',approved_node->'source_id','completion_operation_id',NEW.completion_operation_id,'completion_manifest_digest',NEW.completion_manifest_digest,'disposition',NEW.disposition,'target_node_id',NEW.target_node_id,'target_node_activation',NEW.target_node_activation) OR NOT activation_applies(NEW.task_id,NEW.node_id,NEW.node_activation,pub.old_specification_id,pub.old_plan_id) THEN RAISE EXCEPTION 'applicability differs from approved tuple path' USING ERRCODE='23514'; END IF;
  IF NEW.node_id=NEW.target_node_id AND NOT EXISTS(SELECT 1 FROM plan_nodes prior JOIN plan_nodes next ON next.node_id=prior.node_id WHERE prior.plan_id=pub.old_plan_id AND next.plan_id=pub.new_plan_id AND prior.node_id=NEW.node_id AND prior.definition=next.definition) THEN RAISE EXCEPTION 'retained Node definition changed' USING ERRCODE='23514'; END IF;
  IF NEW.completion_operation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM node_completions c JOIN completion_manifests m ON m.operation_id=c.operation_id WHERE c.node_id=NEW.node_id AND c.activation=NEW.node_activation AND c.operation_id=NEW.completion_operation_id AND m.content_digest=NEW.completion_manifest_digest) THEN RAISE EXCEPTION 'completion applicability lacks exact manifest' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='replan_workspace_transfers' THEN
  SELECT * INTO pub FROM replan_publications WHERE id=NEW.publication_id;SELECT * INTO p FROM replan_proposals WHERE id=pub.proposal_id;
  IF NEW.task_id IS DISTINCT FROM pub.task_id OR NEW.descriptor->>'publication_id' IS DISTINCT FROM pub.id OR NEW.descriptor->>'proposal_id' IS DISTINCT FROM p.id OR NEW.descriptor->>'to_plan_id' IS DISTINCT FROM pub.new_plan_id OR NEW.descriptor->>'workspace_id' IS DISTINCT FROM NEW.workspace_id OR NEW.descriptor->>'to_node_id' IS DISTINCT FROM NEW.target_node_id OR NEW.descriptor->'to_node_activation' IS DISTINCT FROM to_jsonb(NEW.target_node_activation) OR NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(p.content->'impact'->'workspaces') w CROSS JOIN LATERAL jsonb_array_elements(w->'target_nodes') target JOIN tasks t ON t.id=pub.task_id
   JOIN nodes node ON node.task_id=t.id AND node.id=NEW.target_node_id JOIN node_execution_outbox source ON source.id=node.execution_source_id
   WHERE w->'input'=NEW.descriptor-ARRAY['publication_id','proposal_id','to_plan_id','to_node_id','to_node_activation'] AND target->>'node_id'=NEW.target_node_id
    AND t.plan_id=pub.new_plan_id AND node.activation=NEW.target_node_activation AND source.task_id=t.id AND source.node_id=node.id AND source.node_activation=node.activation AND source.plan_id=t.plan_id AND source.specification_id=t.specification_id
    AND (target->'node_activation'=to_jsonb(NEW.target_node_activation) OR w->'input'->>'kind'='completed' AND NEW.target_node_activation>(target->>'node_activation')::bigint AND activation_applies(t.id,node.id,(target->>'node_activation')::bigint,t.specification_id,t.plan_id))
  ) THEN RAISE EXCEPTION 'workspace transfer exceeds exact approved target/code disposition' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM operations o JOIN attempts a ON a.id=o.attempt_id JOIN nodes node ON node.id=a.node_id
   WHERE o.kind='open_workspace' AND o.workspace_descriptor->'transfer'=NEW.descriptor AND o.workspace_descriptor->>'workspace_id'=NEW.workspace_id AND a.task_id=NEW.task_id AND a.node_id=NEW.target_node_id AND a.node_activation=NEW.target_node_activation AND a.node_execution_source_id=node.execution_source_id)
  THEN RAISE EXCEPTION 'workspace claim requires the exact first canonical open' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='replan_guidance_applicability' THEN
  SELECT * INTO pub FROM replan_publications WHERE id=NEW.publication_id;SELECT * INTO p FROM replan_proposals WHERE id=pub.proposal_id;
  IF NEW.task_id IS DISTINCT FROM pub.task_id OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.content->'impact'->'guidance') g WHERE g->>'guidance_id'=NEW.guidance_id AND g->>'disposition'='retain' AND g->'target_node_ids' ? NEW.node_id)
  THEN RAISE EXCEPTION 'guidance applicability exceeds exact approved mapping' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='replan_input_deferrals' THEN
  SELECT envelope_json::jsonb,o.response INTO cmd,response FROM owner_command_receipts o WHERE scope_id=NEW.task_id AND request_id=NEW.request_id;
  IF cmd->>'name' IS DISTINCT FROM 'defer_replan_inputs' OR cmd->>'task_id' IS DISTINCT FROM NEW.task_id OR cmd->>'request_id' IS DISTINCT FROM NEW.request_id OR response->>'request_id' IS DISTINCT FROM NEW.request_id OR response->>'status' IS DISTINCT FROM 'committed' OR response->>'proposal_id' IS DISTINCT FROM NEW.proposal_id OR cmd->'payload'->>'proposal_id' IS DISTINCT FROM NEW.proposal_id OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(cmd->'payload'->'inputs') i WHERE i=jsonb_build_object('input_id',NEW.input_id,'version',NEW.input_version)) THEN RAISE EXCEPTION 'Replan deferral lacks exact Owner decision' USING ERRCODE='23514'; END IF;
 END IF;RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION validate_replan_hold() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cmd jsonb;response jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM replan_publications pub JOIN replan_proposals p ON p.id=pub.proposal_id WHERE pub.id=NEW.publication_id AND pub.task_id=NEW.task_id
  AND NEW.node_activation=COALESCE((SELECT (n->>'target_node_activation')::bigint FROM jsonb_array_elements(p.content->'impact'->'nodes') n WHERE n->>'target_node_id'=NEW.node_id),1)
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.content->'impact'->'holds') h WHERE h->'origin'=NEW.origin AND h->'target_node_ids' ? NEW.node_id))
 THEN RAISE EXCEPTION 'hold must match approved independent control target' USING ERRCODE='23514'; END IF;
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

CREATE CONSTRAINT TRIGGER replan_guidance_exact AFTER INSERT ON replan_guidance_applicability DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_replan_records();
