-- Explicit context references never create graph edges or grant completion validity.
CREATE FUNCTION assert_node_consumes(task_identity text,definition jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE ids jsonb:=COALESCE(definition->'consumes','[]'::jsonb);
BEGIN
 IF jsonb_typeof(ids) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Node consumes must be an Artifact ID array' USING ERRCODE='23514';
 END IF;
 IF jsonb_array_length(ids)>256 OR
  (SELECT count(DISTINCT value) FROM jsonb_array_elements(ids))<>jsonb_array_length(ids) OR
  EXISTS(SELECT 1 FROM jsonb_array_elements(ids) value WHERE jsonb_typeof(value)<>'string' OR
   NOT EXISTS(SELECT 1 FROM artifacts a WHERE a.id=value#>>'{}' AND a.task_id=task_identity))
 THEN RAISE EXCEPTION 'Consumed Artifacts must already exist in this Task' USING ERRCODE='23514';END IF;
END $$;

CREATE FUNCTION validate_plan_node_consumes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM assert_node_consumes(NEW.task_id,NEW.definition);
 RETURN NEW;
END $$;
CREATE TRIGGER valid_plan_node_consumes BEFORE INSERT ON plan_nodes
 FOR EACH ROW EXECUTE FUNCTION validate_plan_node_consumes();

-- Retain all existing graph, evidence, hold and workspace authority checks.
CREATE OR REPLACE FUNCTION validate_replan_graph_impact(p replan_proposals) RETURNS void LANGUAGE plpgsql AS $$
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
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(item->'hard_requirements','[]'::jsonb)) x WHERE jsonb_typeof(x)<>'string') OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(item->'consumes','[]'::jsonb)) x WHERE jsonb_typeof(x)<>'string') OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(item->'expected_outputs','[]'::jsonb)) x WHERE jsonb_typeof(x)<>'string')
  THEN RAISE EXCEPTION 'Replan Node constraints and references must be strings' USING ERRCODE='23514';END IF;
  PERFORM assert_node_consumes(p.task_id,item);
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
 IF (SELECT COALESCE(jsonb_agg(w->'input' ORDER BY w->'input'->>'workspace_id',w->'input'->>'from_lease_id'),'[]'::jsonb) FROM jsonb_array_elements(impact->'workspaces') w) IS DISTINCT FROM
    (SELECT COALESCE(jsonb_agg(w->'input' ORDER BY w->'input'->>'workspace_id',w->'input'->>'from_lease_id'),'[]'::jsonb) FROM jsonb_array_elements(s.context->'impact'->'workspaces') w) OR
    (SELECT count(DISTINCT w->'input'->>'from_lease_id') FROM jsonb_array_elements(impact->'workspaces') w)<>jsonb_array_length(impact->'workspaces')
 THEN RAISE EXCEPTION 'proposal must preserve every exact workspace input once' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(impact->'workspaces') w CROSS JOIN LATERAL jsonb_array_elements(w->'target_nodes') target
  WHERE w->'input'->>'kind'='checkpoint' GROUP BY target->>'node_id',target->>'node_activation',w->'input'->>'resource_id' HAVING count(*)>1)
 THEN RAISE EXCEPTION 'multiple private checkpoints cannot share one target resource' USING ERRCODE='23514';END IF;
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
