import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../packages/db/src/index.ts';
import type { WorkspaceReservation, WorkspaceReservations } from '../../../packages/protocol/src/index.ts';
import { taskCompletionPending } from './completion-boundary.ts';

type Isolation = WorkspaceReservation['isolation'];

export function reservationsIsolated(reservations: WorkspaceReservations | undefined): boolean {
  return !!reservations && reservations.resources.every(resource => !!resource.isolation);
}

/** Task control is locked before choosing placement. A stopped allocation belongs
 * to its exact continuation or approved recipient, never the newest sibling. */
export async function workspaceIsolation(tx: Transaction, taskId: string, nodeId: string, activation: string, resourceId: string): Promise<Isolation> {
  const retained = (await tx.query<{ allocation_id: string | null }>(`SELECT l.allocation_id FROM workspace_leases l
    JOIN tasks t ON t.id=l.task_id JOIN task_workspaces repository ON repository.id=l.workspace_id
    WHERE l.task_id=$1 AND repository.resource_id=$4 AND l.checkpoint IS NOT NULL AND l.state='released'
      AND NOT EXISTS(SELECT 1 FROM workspace_leases later WHERE later.workspace_id=l.workspace_id
        AND later.allocation_id IS NOT DISTINCT FROM l.allocation_id AND (later.created_at,later.id)>(l.created_at,l.id))
      AND (EXISTS(SELECT 1 FROM replan_publications p JOIN replan_proposals proposal ON proposal.id=p.proposal_id,
        jsonb_array_elements(proposal.content->'impact'->'workspaces') w,
        jsonb_array_elements(w->'target_nodes') target
        WHERE p.new_plan_id=t.plan_id AND w->'input'->>'from_lease_id'=l.id
          AND target->>'node_id'=$2 AND (target->>'node_activation')::bigint=$3)
      OR (l.node_id=$2 AND l.node_activation=$3 AND NOT EXISTS(
        SELECT 1 FROM replan_publications p JOIN replan_proposals proposal ON proposal.id=p.proposal_id,
          jsonb_array_elements(proposal.content->'impact'->'workspaces') w
        WHERE p.new_plan_id=t.plan_id AND w->'input'->>'from_lease_id'=l.id)))
    ORDER BY l.created_at DESC,l.id DESC LIMIT 1`, [taskId, nodeId, activation, resourceId])).rows[0];
  if (retained) return retained.allocation_id ? { allocation_id: retained.allocation_id } : undefined;
  const directPrivate = await tx.query(`SELECT 1 FROM workspace_leases l WHERE task_id=$1 AND allocation_id IS NULL
    AND checkpoint IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workspace_leases later WHERE later.workspace_id=l.workspace_id
      AND later.allocation_id IS NULL AND (later.created_at,later.id)>(l.created_at,l.id)) LIMIT 1`, [taskId]);
  if (directPrivate.rowCount) return;
  const isolated = await tx.query(`SELECT 1 FROM workspace_leases WHERE task_id=$1 AND allocation_id IS NOT NULL
    UNION ALL SELECT 1 FROM node_execution_outbox s, jsonb_array_elements(s.context->'workspace_reservations'->'resources') resource
      WHERE task_id=$1 AND resource ? 'isolation' LIMIT 1`, [taskId]);
  if (isolated.rowCount) return { allocation_id: randomUUID() };
  const ready = await tx.query(`SELECT n.id FROM nodes n JOIN tasks t ON t.id=n.task_id
    JOIN plan_nodes p ON p.plan_id=t.plan_id AND p.node_id=n.id
    WHERE t.id=$1 AND n.state='PENDING' AND n.blocker_id IS NULL AND NOT n.guidance_paused
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p.definition->'dependencies') dep WHERE NOT EXISTS(
        SELECT 1 FROM nodes parent JOIN node_completions c ON c.node_id=parent.id AND c.activation=parent.activation
        WHERE parent.id=dep.value AND parent.state='COMPLETED'
          AND activation_applies(t.id,parent.id,parent.activation,t.specification_id,t.plan_id))) LIMIT 2`, [taskId]);
  return (ready.rowCount ?? 0) > 1 ? { allocation_id: randomUUID() } : undefined;
}

/** Includes queued direct Attempts: late repository access cannot defeat the
 * exclusivity promised by their immutable launch reservation. */
export async function nodeWorkspaceReady(tx: Transaction, taskId: string, nodeId: string, sourceId?: string): Promise<boolean> {
  if (await taskCompletionPending(tx, taskId)) return false;
  let isolated: boolean;
  if (sourceId) {
    const current = (await tx.query<{ reservations: WorkspaceReservations }>(
      "SELECT context->'workspace_reservations' reservations FROM node_execution_outbox WHERE id=$1", [sourceId])).rows[0];
    isolated = reservationsIsolated(current?.reservations);
  } else {
    const current = (await tx.query<{ activation: string; resource_id: string | null }>(`SELECT n.activation,r.id resource_id FROM nodes n
      JOIN tasks t ON t.id=n.task_id LEFT JOIN project_resources r ON r.project_id=t.project_id AND r.active WHERE n.id=$1 ORDER BY r.id`, [nodeId])).rows;
    isolated = true;
    for (const resource of current) if (resource.resource_id && !await workspaceIsolation(tx, taskId, nodeId, resource.activation, resource.resource_id)) isolated = false;
  }
  const held = await tx.query(`SELECT 1 FROM attempts a WHERE a.task_id=$1 AND a.kind='node'
      AND (a.node_id=$2 OR NOT $4::boolean OR NOT workspace_reservations_isolated(a.launch->'workspace_reservations'))
      AND (NOT a.process_released OR a.state='QUEUED' OR EXISTS(
        SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN('succeeded','cancelled')))
    UNION ALL SELECT 1 FROM workspace_leases l WHERE l.task_id=$1 AND l.state<>'released'
      AND (l.node_id=$2 OR NOT $4::boolean OR l.allocation_id IS NULL)
    UNION ALL SELECT 1 FROM node_execution_outbox s JOIN nodes n ON n.execution_source_id=s.id
      JOIN tasks t ON t.id=s.task_id WHERE s.task_id=$1 AND s.node_id<>$2 AND NOT s.done AND n.state='PENDING'
        AND n.activation=s.node_activation AND t.specification_id=s.specification_id AND t.plan_id=s.plan_id
        AND (NOT $4::boolean OR NOT workspace_reservations_isolated(s.context->'workspace_reservations'))
        AND ($3::text IS NULL OR (s.created_at,s.id)<(SELECT current.created_at,current.id FROM node_execution_outbox current WHERE current.id=$3))
    LIMIT 1`, [taskId, nodeId, sourceId ?? null, isolated]);
  return !held.rowCount;
}
