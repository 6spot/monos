import { transaction } from "../../../packages/db/src/index.ts";
import type { Database } from "../../../packages/db/src/index.ts";
import { CommandError } from "../../../packages/domain/src/commands.ts";
import {
  canonicalJSON,
  MAX_BODY_BYTES,
  validate,
} from "../../../packages/protocol/src/index.ts";
import type {
  NodeCounts,
  TaskAttention,
  TaskListItem,
  TaskListPage,
  TaskListQuery,
} from "../../../packages/protocol/src/index.ts";
import { authenticateOwner } from "./owner-commands.ts";

type Filters = {
  project_id: string | null;
  column: string | null;
  attention: string;
  history: string;
};
type Position = { created_at: string; task_id: string };
const initial: Position = { created_at: "", task_id: "" };
function cursorFor(filters: Filters, position: Position): string {
  return Buffer.from(
    canonicalJSON({ version: 1, kind: "task_board", filters, ...position }),
  ).toString("base64url");
}
function positionFor(filters: Filters, cursor?: string): Position {
  if (!cursor) return initial;
  try {
    validate("TaskListCursor", cursor);
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !value ||
      value.version !== 1 ||
      value.kind !== "task_board" ||
      typeof value.created_at !== "string" ||
      typeof value.task_id !== "string"
    )
      throw new Error();
    if (value.task_id) validate("Id", value.task_id);
    if (
      Boolean(value.task_id) !== Boolean(value.created_at) ||
      (value.created_at &&
        (!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?[+-]\d\d(?::[0-5]\d){0,2}$/.test(
          value.created_at,
        ) ||
          !Number.isFinite(Date.parse(value.created_at.replace(/([+-]\d\d:[0-5]\d):[0-5]\d$/, "$1")))))
    )
      throw new Error();
    if (
      cursorFor(value.filters, {
        created_at: value.created_at,
        task_id: value.task_id,
      }) !== cursor
    )
      throw new Error();
    if (canonicalJSON(value.filters) !== canonicalJSON(filters))
      throw new CommandError(
        "denied_scope",
        "Board cursor belongs to different filters",
      );
    return { created_at: value.created_at, task_id: value.task_id };
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError("invalid_input", "Invalid Board cursor");
  }
}

// Each reason retains the canonical target. Queue capacity is normal waiting, not attention.
// The lateral UNION remains one snapshot with the counts and state; it never invokes a planner.
const attentionSQL = `
 SELECT 'planning_issue' kind,t.id target_id,COALESCE(e.body->>'reason','Planning needs an answer') reason
 FROM task_events e WHERE t.plan_id IS NULL AND t.state='RUNNING' AND e.task_id=t.id AND e.sequence=t.planning_issue_sequence AND e.kind='planning_issue_raised'
 UNION ALL SELECT 'planning_interrupted',s.id,COALESCE(s.preparation_failure,a.end_reason,'Initial planning interrupted')
 FROM task_planning_outbox s LEFT JOIN attempts a ON a.id=s.planned_attempt_id
 WHERE t.plan_id IS NULL AND t.state='RUNNING' AND s.id=t.initial_planning_intent_id AND t.planning_issue_sequence IS NULL AND (s.preparation_failure IS NOT NULL OR (a.state IN ('FAILED','CANCELLED') AND NOT a.mutation_allowed))
 UNION ALL SELECT 'node_blocker',b.id,b.reason FROM nodes n JOIN plan_nodes pn ON pn.node_id=n.id JOIN node_blockers b ON b.id=n.blocker_id AND b.node_activation=n.activation
 WHERE pn.plan_id=t.plan_id AND n.task_id=t.id AND n.state='BLOCKED' AND t.state NOT IN ('COMPLETED','CANCELLED')
 UNION ALL SELECT 'operation_recovery',o.id,COALESCE(o.failure_kind,'Execution cleanup needs recovery') FROM operations o JOIN attempts a ON a.id=o.attempt_id WHERE a.task_id=t.id AND o.state='recovery'
 UNION ALL SELECT 'input_issue',i.id,i.reason FROM task_input_issues i WHERE i.task_id=t.id AND i.status='open' AND t.state NOT IN ('COMPLETED','CANCELLED')
 UNION ALL SELECT 'input_interrupted',i.id,COALESCE(s.preparation_failure,a.end_reason,'Conversation input needs retry') FROM task_inputs i LEFT JOIN task_conversation_outbox s ON s.id=t.conversation_source_id AND s.input_id=i.id LEFT JOIN attempts a ON a.id=s.planned_attempt_id
 WHERE i.task_id=t.id AND (i.status='failed' OR (i.status='pending' AND (s.preparation_failure IS NOT NULL OR (s.done AND (a.id IS NULL OR NOT a.mutation_allowed)) OR a.state IN ('FAILED','CANCELLED'))))
 UNION ALL SELECT 'guidance_paused',n.id,'Guidance follow-up is paused' FROM nodes n JOIN plan_nodes pn ON pn.node_id=n.id WHERE n.task_id=t.id AND pn.plan_id=t.plan_id AND n.guidance_paused AND t.state NOT IN ('COMPLETED','CANCELLED')
 UNION ALL SELECT 'requirement_proposal',p.id,p.summary FROM requirement_obligations r JOIN requirement_proposals p ON p.id=r.current_proposal_id JOIN requirement_attachments ra ON ra.proposal_id=p.id
 WHERE r.task_id=t.id AND r.status='pending' AND t.state NOT IN ('COMPLETED','CANCELLED') AND NOT EXISTS(SELECT 1 FROM requirement_changes c WHERE c.proposal_id=p.id AND c.status IN ('settling','withdrawing'))
 UNION ALL SELECT 'requirement_recovery',c.id,c.attention FROM requirement_changes c WHERE c.task_id=t.id AND c.status IN ('settling','withdrawing') AND c.attention IS NOT NULL
 UNION ALL SELECT 'replan_request',r.id,r.reason FROM replan_requests r WHERE r.task_id=t.id AND r.status='pending'
 UNION ALL SELECT 'replan_issue',i.id,i.reason FROM replan_requests r JOIN replan_issues i ON i.id=r.issue_id WHERE r.task_id=t.id AND r.status='pending'`;

interface BoardRow {
  id: string;
  title: string | null;
  project_id: string | null;
  todo_id: string | null;
  created_at: Date | null;
  created_cursor: string;
  state: TaskListItem["state"];
  control_version: string;
  specification_id: string;
  plan_id: string | null;
  nodes: NodeCounts;
  queued: string;
  running: string;
  held: string;
  open_operations: string;
  attention: TaskAttention[];
  planning_status: TaskListItem["planning_status"];
  planning_reason: string | null;
  canonical_execution: boolean;
}

export async function taskBoard(
  db: Database,
  token: string,
  input: unknown,
): Promise<TaskListPage> {
  const query = validate<TaskListQuery>("TaskListQuery", input);
  const filters: Filters = {
    project_id: query.project_id ?? null,
    column: query.column ?? null,
    attention: query.attention ?? "all",
    history: query.history ?? "active",
  };
  return transaction(db, async (tx) => {
    await authenticateOwner(tx, token);
    const position = positionFor(filters, query.cursor);
    if (
      filters.project_id &&
      !(
        await tx.query("SELECT id FROM projects WHERE id=$1", [
          filters.project_id,
        ])
      ).rowCount
    )
      throw new CommandError("denied_scope", "Unknown Project");
    const states: Record<string, string[]> = {
      ready: ["PLANNING"],
      running: ["RUNNING", "BLOCKED", "REPLAN_REQUIRED"],
      review: ["REVIEW"],
      done: ["COMPLETED"],
      cancelled: ["CANCELLED"],
    };
    const rows = (
      await tx.query<BoardRow>(
        `SELECT t.id,t.title,t.project_id,t.todo_id,t.created_at,COALESCE(t.created_at,'epoch'::timestamptz)::text created_cursor,t.state,t.control_version,t.specification_id,t.plan_id,
      (SELECT jsonb_build_object('pending',count(*) FILTER(WHERE n.state='PENDING'),'running',count(*) FILTER(WHERE n.state='RUNNING'),'blocked',count(*) FILTER(WHERE n.state='BLOCKED'),'completed',count(*) FILTER(WHERE n.state='COMPLETED'),'cancelled',count(*) FILTER(WHERE n.state='CANCELLED')) FROM nodes n JOIN plan_nodes pn ON pn.node_id=n.id WHERE pn.plan_id=t.plan_id AND n.task_id=t.id) nodes,
      a.queued,a.running,a.held,a.open_operations,
      COALESCE(att.items,'[]'::jsonb) attention,
      CASE WHEN t.plan_id IS NOT NULL THEN 'published' WHEN t.state='CANCELLED' THEN 'cancelled'
        WHEN t.state='PLANNING' THEN CASE WHEN p.id IS NULL THEN 'not_started' ELSE 'stopped' END
        WHEN p.id IS NULL THEN NULL WHEN t.planning_issue_sequence IS NOT NULL THEN 'issue'
        WHEN pa.state='RUNNING' AND pa.mutation_allowed THEN 'processing' WHEN pa.state='QUEUED' THEN 'queued'
        WHEN pa.id IS NOT NULL AND (NOT pa.process_released OR EXISTS(SELECT 1 FROM operations WHERE attempt_id=pa.id AND state NOT IN ('succeeded','cancelled'))) THEN 'settling'
        WHEN pa.id IS NOT NULL THEN 'interrupted' WHEN p.waiting_reason IS NOT NULL THEN 'unavailable' ELSE 'pending' END planning_status,
      CASE WHEN t.plan_id IS NULL THEN left(COALESCE(p.preparation_failure,p.waiting_reason,pa.end_reason),1024) ELSE NULL END planning_reason,
      COALESCE((EXISTS(SELECT 1 FROM specification_revisions sr WHERE sr.id=t.specification_id AND sr.task_id=t.id AND jsonb_typeof(sr.content)='string') AND (t.plan_id IS NULL OR (pr.specification_id IS NOT NULL AND pr.content_digest IS NOT NULL AND jsonb_typeof(pr.content->'nodes')='array'))),false) canonical_execution
      FROM tasks t LEFT JOIN task_planning_outbox p ON p.id=t.initial_planning_intent_id LEFT JOIN attempts pa ON pa.id=p.planned_attempt_id LEFT JOIN plan_revisions pr ON pr.id=t.plan_id
      CROSS JOIN LATERAL (SELECT count(*) FILTER(WHERE state='QUEUED') queued,count(*) FILTER(WHERE state='RUNNING' AND started AND NOT process_absent) running,count(*) FILTER(WHERE NOT process_released) held,
       (SELECT count(*) FROM operations o JOIN attempts oa ON oa.id=o.attempt_id WHERE oa.task_id=t.id AND o.state NOT IN ('succeeded','cancelled')) open_operations FROM attempts WHERE task_id=t.id) a
      CROSS JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('kind',kind,'target_id',target_id,'reason',left(reason,1024)) ORDER BY kind,target_id) items FROM (SELECT * FROM (${attentionSQL}) reasons ORDER BY kind,target_id LIMIT 17) bounded) att
      WHERE ($1::text IS NULL OR t.project_id=$1) AND ($2::text[] IS NULL OR t.state=ANY($2)) AND ($3='all' OR t.state NOT IN ('COMPLETED','CANCELLED'))
        AND ($4='all' OR jsonb_array_length(COALESCE(att.items,'[]'::jsonb))>0)
        AND ($5='' OR (COALESCE(t.created_at,'epoch'::timestamptz),t.id)<(NULLIF($5,'')::timestamptz,$6))
      ORDER BY COALESCE(t.created_at,'epoch'::timestamptz) DESC,t.id DESC LIMIT 33`,
        [
          filters.project_id,
          filters.column ? states[filters.column] : null,
          filters.history,
          filters.attention,
          position.created_at,
          position.task_id,
        ],
      )
    ).rows;
    const items: TaskListItem[] = [];
    let bytes = 8192;
    let last = position;
    for (const row of rows) {
      if (items.length === 32) break;
      const item = validate<TaskListItem>("TaskListItem", {
        task_id: row.id,
        title: row.title,
        project_id: row.project_id,
        todo_id: row.todo_id,
        created_at: row.created_at?.toISOString() ?? null,
        state: row.state,
        control_version: Number(row.control_version),
        specification_id: row.specification_id,
        plan_id: row.plan_id,
        nodes: row.nodes,
        queued_attempts: Number(row.queued),
        running_attempts: Number(row.running),
        held_attempts: Number(row.held),
        open_operations: Number(row.open_operations),
        attention: row.attention.slice(0, 16),
        attention_has_more: row.attention.length > 16,
        planning_status: row.planning_status,
        planning_reason: row.planning_reason,
        canonical_execution: row.canonical_execution,
      });
      const size = Buffer.byteLength(JSON.stringify(item)) + 1;
      if (bytes + size >= MAX_BODY_BYTES) {
        if (!items.length)
          throw new CommandError(
            "unmet_precondition",
            "Board item exceeds response budget",
          );
        break;
      }
      items.push(item);
      bytes += size;
      last = { task_id: row.id, created_at: row.created_cursor };
    }
    return validate<TaskListPage>("TaskListPage", {
      schema_version: 1,
      items,
      cursor: cursorFor(filters, last),
      has_more: rows.length > items.length,
    });
  });
}
