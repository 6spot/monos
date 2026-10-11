import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, validate } from '../../../packages/protocol/src/index.ts';
import type { ExecutionPlanNode, ReplanHold, ReplanImpact, ReplanWorkspaceInput } from '../../../packages/protocol/src/index.ts';
import type { SpecificationTask } from './task-specification-state.ts';
import { assertCurrentNode, validatePlan } from './task-records.ts';
import { effectiveGuidanceTargets } from './task-guidance.ts';

type Member = {
  id: string; activation: string; execution_source_id: string | null; blocker_id: string | null;
  guidance_paused: boolean; operation_id: string | null; content_digest: string | null;
};

/** Complete immutable source facts. Targets here describe the current scope;
 * the prepared proposal explicitly selects the replacement graph's scope. */
export async function replanImpact(tx: Transaction, task: SpecificationTask): Promise<ReplanImpact> {
  const members = (await tx.query<Member>(`SELECT n.*,c.operation_id,m.content_digest FROM nodes n
    JOIN plan_nodes p ON p.node_id=n.id
    LEFT JOIN node_completions c ON c.node_id=n.id AND c.activation=n.activation
    LEFT JOIN completion_manifests m ON m.operation_id=c.operation_id
    WHERE p.plan_id=$1 ORDER BY n.id`, [task.plan_id])).rows;
  if (!members.length || members.length > 256) throw new CommandError('unmet_precondition', 'Replan requires complete bounded Plan membership');
  const request = (await tx.query<{ requester_blocker_id: string | null }>("SELECT requester_blocker_id FROM replan_requests WHERE task_id=$1 AND status='pending'", [task.id])).rows[0];
  const holds = new Map<string, { origin: ReplanHold; target_node_ids: string[] }>();
  function addHold(origin: ReplanHold, nodeId: string) {
    const key = canonicalJSON(origin), row = holds.get(key) ?? { origin, target_node_ids: [] };
    if (!row.target_node_ids.includes(nodeId)) row.target_node_ids.push(nodeId);
    holds.set(key, row);
  }
  for (const node of members) {
    const inherited = (await tx.query<{ origin: ReplanHold; current_blocker_id: string | null }>(`SELECT h.origin,h.current_blocker_id
      FROM replan_control_holds h JOIN replan_publications p ON p.id=h.publication_id
      WHERE h.task_id=$1 AND h.node_id=$2 AND h.node_activation=$3 AND h.resolved_by IS NULL
        AND p.new_plan_id=$4 ORDER BY h.id`, [task.id, node.id, node.activation, task.plan_id])).rows;
    for (const hold of inherited) addHold(hold.origin, node.id);
    const blocker = node.blocker_id ? (await tx.query<{ id: string; kind: ReplanHold['kind']; reason: string }>('SELECT id,kind,reason FROM node_blockers WHERE id=$1', [node.blocker_id])).rows[0] : undefined;
    const ownerStop = (await tx.query<{ request_id: string }>(`SELECT request_id FROM owner_command_receipts
      WHERE scope_id=$1 AND envelope_json::jsonb->>'name'='stop_node'
        AND envelope_json::jsonb->'payload'->>'node_id'=$2
        AND (envelope_json::jsonb->'payload'->>'node_activation')::bigint=$3
      ORDER BY (response->>'control_version')::bigint DESC LIMIT 1`, [task.id, node.id, node.activation])).rows[0]?.request_id ?? null;
    const provenance = { origin_node_id: node.id, origin_node_activation: Number(node.activation) };
    if (blocker && blocker.id !== request?.requester_blocker_id && !inherited.some(h => h.current_blocker_id === blocker.id)) {
      addHold({ blocker_id: blocker.id, kind: blocker.kind, reason: blocker.reason, ...provenance,
        owner_request_id: blocker.kind === 'owner_stopped' ? ownerStop : null }, node.id);
    }
    if (node.guidance_paused && ![...holds.values()].some(h => h.target_node_ids.includes(node.id) && h.origin.kind === 'owner_stopped')) {
      addHold({ blocker_id: null, kind: 'owner_stopped', reason: 'owner_stopped', ...provenance, owner_request_id: ownerStop }, node.id);
    }
  }
  if (holds.size > 256) throw new CommandError('unmet_precondition', 'Independent holds exceed complete impact budget');
  const guidance = await effectiveGuidanceTargets(tx, task.id);
  if (guidance.length > 256) throw new CommandError('unmet_precondition', 'Guidance exceeds complete impact budget');
  const workspaces: ReplanImpact['workspaces'] = [];
  for (const row of (await tx.query<{ input: ReplanWorkspaceInput }>('SELECT input FROM replan_workspace_input_rows($1) ORDER BY workspace_id,from_lease_id', [task.id])).rows) {
    const input = row.input;
    const targetMembers = input.kind === 'completed' ? members : [members.find(n => n.id === input.from_node_id) ?? members.find(n => !n.operation_id)].filter((n): n is Member => !!n);
    if (input.kind === 'checkpoint' && !targetMembers.length) throw new CommandError('unmet_precondition', 'Private work needs an explicit unfinished target');
    workspaces.push({ input, target_nodes: targetMembers.map(n => ({ node_id: n.id, node_activation: Number(n.activation) })) });
  }
  return validate<ReplanImpact>('ReplanImpact', {
    nodes: members.map(n => ({ node_id: n.id, node_activation: Number(n.activation), source_id: n.execution_source_id,
      completion_operation_id: n.operation_id ?? null, completion_manifest_digest: n.content_digest ?? null,
      disposition: n.operation_id ? 'carry' : 'refresh', target_node_id: n.id, target_node_activation: Number(n.activation) })),
    guidance: guidance.map(g => ({ guidance_id: g.guidance_id, version: Number(g.version), disposition: g.target_node_ids.length ? 'retain' : 'supersede', target_node_ids: g.target_node_ids })),
    holds: [...holds.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, h]) => ({ ...h, target_node_ids: h.target_node_ids.sort() })),
    workspaces,
  });
}

export function replanTargetActivations(impact: ReplanImpact, nodes: ExecutionPlanNode[]): Map<string, number> {
  const old = new Map(impact.nodes.map(n => [n.node_id, n]));
  return new Map(nodes.map(n => [n.node_id, old.get(n.node_id)?.target_node_activation ?? 1]));
}

export async function checkReplanImpact(tx: Transaction, task: SpecificationTask, impact: ReplanImpact, nodes: ExecutionPlanNode[]): Promise<void> {
  validate('ReplanImpact', impact); validatePlan(nodes);
  if (nodes.some(n => n.consumes?.length)) throw new CommandError('unmet_precondition', 'unsupported_artifact_consumption: Artifact consumption is unavailable in this stage');
  const actual = await replanImpact(tx, task), previous = new Map(actual.nodes.map(n => [n.node_id, n]));
  const graph = new Map(nodes.map(n => [n.node_id, n]));
  const dispositions = new Map(impact.nodes.map(n => [n.node_id, n]));
  if (dispositions.size !== impact.nodes.length || dispositions.size !== previous.size) throw new CommandError('invalid_input', 'Every old Node needs exactly one disposition');
  if (canonicalJSON(impact.nodes.map(n => n.node_id)) !== canonicalJSON(actual.nodes.map(n => n.node_id))) throw new CommandError('invalid_input', 'Node dispositions must preserve canonical source order');
  const facts = (n: ReplanImpact['nodes'][number]) => ({ node_id: n.node_id, node_activation: n.node_activation, source_id: n.source_id,
    completion_operation_id: n.completion_operation_id, completion_manifest_digest: n.completion_manifest_digest });
  for (const n of impact.nodes) {
    const a = previous.get(n.node_id);
    if (!a || canonicalJSON(facts(a)) !== canonicalJSON(facts(n))) throw new CommandError('version_conflict', 'Exact Node activation/source/completion changed');
    await assertCurrentNode(tx, { task_id: task.id, node_id: n.node_id, node_activation: n.node_activation });
    if (n.disposition === 'remove') {
      if (graph.has(n.node_id) || n.target_node_id !== null || n.target_node_activation !== null) throw new CommandError('invalid_input', 'Removed work cannot remain a target or graph member');
    } else {
      if (!graph.has(n.node_id) || n.target_node_id !== n.node_id || n.target_node_activation !== n.node_activation + (n.disposition === 'invalidate' ? 1 : 0)) throw new CommandError('invalid_input', 'Retained work needs its exact identity and activation disposition');
      if ((n.disposition === 'refresh') !== !n.completion_operation_id) throw new CommandError('invalid_input', 'Completed work requires carry or invalidation; unfinished work requires refresh');
    }
  }
  for (const node of nodes) {
    const old = (await tx.query<{ definition: ExecutionPlanNode }>('SELECT definition FROM plan_nodes WHERE plan_id=$1 AND node_id=$2', [task.plan_id, node.node_id])).rows[0];
    if (old && canonicalJSON(old.definition) !== canonicalJSON(node)) throw new CommandError('invalid_input', 'Changed formal definition requires a new Node ID');
    if (!old && (await tx.query('SELECT 1 FROM nodes WHERE id=$1', [node.node_id])).rowCount) throw new CommandError('payload_conflict', 'New Node ID already exists');
    if (!(await tx.query('SELECT 1 FROM tasks t JOIN project_roles p ON p.project_id=t.project_id JOIN roles r ON r.id=p.role_id WHERE t.id=$1 AND r.id=$2 AND NOT r.archived', [task.id, node.role_id])).rowCount) throw new CommandError('unmet_precondition', 'Node Role must remain Project-selected');
    if (dispositions.get(node.node_id)?.disposition === 'carry' && node.dependencies.some(id => dispositions.get(id)?.disposition !== 'carry')) throw new CommandError('invalid_input', 'Carried completion requires current carried dependency evidence');
  }
  const validTargets = (ids: string[], allowEmpty: boolean) => (allowEmpty || !!ids.length) && new Set(ids).size === ids.length && ids.every(id => graph.has(id));
  const guidance = new Map(actual.guidance.map(g => [g.guidance_id, g]));
  if (impact.guidance.length !== guidance.size || new Set(impact.guidance.map(g => g.guidance_id)).size !== guidance.size) throw new CommandError('version_conflict', 'Complete guidance membership changed');
  for (const g of impact.guidance) {
    if (guidance.get(g.guidance_id)?.version !== g.version) throw new CommandError('version_conflict', 'Guidance version changed');
    if (g.disposition === 'supersede' ? g.target_node_ids.length !== 0 : !validTargets(g.target_node_ids, false)) throw new CommandError('invalid_input', 'Guidance needs exact replacement graph recipients');
    for (const id of g.target_node_ids) if (dispositions.get(id)?.disposition === 'carry' && !(await tx.query(`SELECT 1 FROM task_guidance_obligations
      WHERE guidance_id=$1 AND node_id=$2 AND node_activation=$3 AND status='handled' AND completion_operation_id=$4`,
    [g.guidance_id, id, dispositions.get(id)!.node_activation, dispositions.get(id)!.completion_operation_id])).rowCount) throw new CommandError('invalid_input', 'New guidance recipients cannot carry unhandled completion evidence');
  }
  const holdFacts = (rows: ReplanImpact['holds']) => rows.map(h => canonicalJSON(h.origin)).sort();
  if (canonicalJSON(holdFacts(actual.holds)) !== canonicalJSON(holdFacts(impact.holds)) || new Set(holdFacts(impact.holds)).size !== impact.holds.length) throw new CommandError('version_conflict', 'Every independent control must be preserved');
  if (impact.holds.some(h => !validTargets(h.target_node_ids, false))) throw new CommandError('invalid_input', 'Independent holds need exact replacement graph recipients');
  const workspaces = new Map(actual.workspaces.map(w => [w.input.from_lease_id, w.input]));
  const activations = replanTargetActivations(impact, nodes);
  if (impact.workspaces.length !== workspaces.size || new Set(impact.workspaces.map(w => w.input.from_lease_id)).size !== workspaces.size) throw new CommandError('version_conflict', 'Complete workspace membership changed');
  const checkpointTargets = new Set<string>();
  for (const w of impact.workspaces) {
    if (w.input.kind === 'checkpoint') {
      for (const target of w.target_nodes) {
        if (checkpointTargets.has(target.node_id)) throw new CommandError('invalid_input', 'Multiple private checkpoints cannot be assigned to the same Node');
        checkpointTargets.add(target.node_id);
      }
    }
    const actualInput = workspaces.get(w.input.from_lease_id);
    if (!actualInput || canonicalJSON(w.input) !== canonicalJSON(actualInput)) throw new CommandError('version_conflict', 'Exact workspace predecessor changed');
    if (!validTargets(w.target_nodes.map(n => n.node_id), w.input.kind === 'completed') || w.target_nodes.some(n => activations.get(n.node_id) !== n.node_activation)
      || w.input.kind === 'checkpoint' && (w.target_nodes.length !== 1 || dispositions.get(w.target_nodes[0]!.node_id)?.disposition === 'carry')) throw new CommandError('invalid_input', 'Workspace disposition requires exact eligible target activations');
  }
}
