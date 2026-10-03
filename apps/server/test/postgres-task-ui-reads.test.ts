import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { database, transaction } from "../../../packages/db/src/index.ts";
import { initializeTask } from "../src/task-records.ts";
import { taskBoard } from "../src/task-board-reads.ts";
import { taskResults } from "../src/task-result-reads.ts";
import { attemptWorkspace } from "../src/task-workspace-reads.ts";
import { createApp } from "../src/app.ts";
import { OwnerAccess } from "../src/owner-access.ts";
import {
  issueOwnerSession,
  revokeOwnerSession,
} from "../src/owner-commands.ts";
import { Configuration } from "../src/configuration.ts";
import { replanFixture } from "./fixtures/task-replan-fixture.ts";
import { conversationFixture } from "./fixtures/task-conversation-fixture.ts";

const suite =
  process.env.MONOS_TEST_DATABASE === "1" ? describe : describe.skip;
suite("Execution UI canonical reads", () => {
  it("paginates per-column with exact filter-bound tied positions and legacy records", async () => {
    const x = await conversationFixture();
    try {
      const ids = Array.from({ length: 35 }, () => randomUUID());
      for (const task_id of ids)
        await transaction(x.db, (tx) =>
          initializeTask(tx, {
            task_id,
            specification_id: randomUUID(),
            specification: task_id === ids[1] ? {} : "A visible task",
            project_id: x.f.project,
          }),
        );
      const first = await taskBoard(x.db, x.token, {
        column: "ready",
        project_id: x.f.project,
      });
      expect(first.items).toHaveLength(32);
      expect(first.has_more).toBe(true);
      expect(
        first.items.every(
          (i) =>
            i.state === "PLANNING" &&
            i.running_attempts === 0 &&
            i.nodes.pending === 0,
        ),
      ).toBe(true);
      const second = await taskBoard(x.db, x.token, {
        column: "ready",
        project_id: x.f.project,
        cursor: first.cursor,
      });
      expect(second.has_more).toBe(false);
      expect(
        new Set([...first.items, ...second.items].map((i) => i.task_id)).size,
      ).toBe(36);
      expect(
        await taskBoard(x.db, x.token, {
          column: "ready",
          project_id: x.f.project,
          cursor: first.cursor,
        }),
      ).toEqual(second);
      for (const changed of [
        { column: "running", project_id: x.f.project },
        { column: "ready" },
        { column: "ready", project_id: x.f.project, attention: "needed" },
        { column: "ready", project_id: x.f.project, history: "all" },
      ]) {
        await expect(
          taskBoard(x.db, x.token, { ...changed, cursor: first.cursor }),
        ).rejects.toMatchObject({ detail: { code: "denied_scope" } });
      }
      await x.db.pool.query("UPDATE tasks SET state='COMPLETED' WHERE id=$1", [
        ids[0],
      ]);
      await x.db.pool.query(
        "UPDATE tasks SET state='CANCELLED',initial_specification_id=NULL,title=NULL,created_at=NULL WHERE id=$1",
        [ids[1]],
      );
      expect(
        (await taskBoard(x.db, x.token, { column: "done" })).items,
      ).toHaveLength(0);
      expect(
        (await taskBoard(x.db, x.token, { column: "done", history: "all" }))
          .items[0]?.task_id,
      ).toBe(ids[0]);
      expect(
        (
          await taskBoard(x.db, x.token, {
            column: "cancelled",
            history: "all",
          })
        ).items[0],
      ).toMatchObject({
        task_id: ids[1],
        canonical_execution: false,
        title: null,
        created_at: null,
      });
    } finally {
      await x.close();
    }
  }, 60000);

  it("paginates legacy epoch records in Singapore's historical minute offset", async () => {
    const x=await conversationFixture();
    const url=new URL(x.databaseUrl);
    url.searchParams.set('options', `${url.searchParams.get('options')} -c timezone=Asia/Singapore`);
    const scoped=database(url.toString());
    try {
      for(let i=0;i<34;i++) await transaction(x.db, tx=>initializeTask(tx,{task_id:randomUUID(),specification_id:randomUUID(),project_id:x.f.project,specification:'Legacy epoch fixture'}));
      const first=await taskBoard(scoped,x.token,{column:'ready'});
      expect(JSON.parse(Buffer.from(first.cursor,'base64url').toString()).created_at).toBe('1970-01-01 07:30:00+07:30');
      const last=await taskBoard(scoped,x.token,{column:'ready',cursor:first.cursor});
      expect(new Set([...first.items,...last.items].map(r=>r.task_id)).size).toBe(35);
      expect(last.has_more).toBe(false);
    }finally {await scoped.pool.end();await x.close();}
  });

  it("keeps normal unavailable planning out of attention, but exposes exact issue and independent request reasons", async () => {
    const x = await replanFixture();
    try {
      await x.owner("start_task", { specification_id: x.f.spec });
      const waiting = await taskBoard(x.db, x.token, { column: "running" });
      expect(waiting.items[0]).toMatchObject({
        planning_status: "pending",
        nodes: { pending: 0, running: 0 },
        running_attempts: 0,
        attention: [],
      });
      await x.planning.pump();
      const planner = await x.promote();
      const issue = await x.agent(planner, "raise_planning_issue", {
        planning_intent_id: planner.dispatch.task_planning_source!.intent_id,
        reason: "Choose the intended behavior",
      });
      await x.finish(issue.operation_id!, planner.dispatch.attempt_id);
      const needs = await taskBoard(x.db, x.token, { attention: "needed" });
      expect(needs.items[0]?.attention).toEqual([
        {
          kind: "planning_issue",
          target_id: x.f.task,
          reason: "Choose the intended behavior",
        },
      ]);
      expect(needs.items[0]?.planning_status).toBe("issue");
    } finally {
      await x.close();
    }
  }, 60000);

  it("lists independent blockers, input issues and Replan requests without deriving semantics from logs", async () => {
    const x = await replanFixture();
    try {
      const request = await x.request();
      await x.send("A separate clarification");
      const turn = await x.turn();
      const result = await x.reply(turn, {
        kind: "issue",
        text: "Which independently requested detail?",
        basis: await x.basis(),
      });
      await x.finish(result.operation_id!, turn.dispatch.attempt_id);
      const page = await taskBoard(x.db, x.token, { attention: "needed" });
      expect(page.items[0]?.attention).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "replan_request",
            target_id: request,
          }),
          expect.objectContaining({ kind: "node_blocker" }),
          expect.objectContaining({ kind: "input_issue" }),
        ]),
      );
      expect(page.items[0]?.running_attempts).toBe(0);
      expect(page.items[0]?.nodes.completed).toBe(0);
    } finally {
      await x.close();
    }
  }, 60000);

  it("bounds independent attention without hiding that more exact exits exist", async () => {
    const x = await conversationFixture();
    try {
      // Synthetic unresolved input records only. This verifies read bounds, not Runtime behavior.
      for (let i = 0; i < 19; i++) {
        const r = await x.send("Read-bound input " + i);
        await x.db.pool.query(
          "UPDATE task_inputs SET status='failed' WHERE id=$1",
          [r.input_id],
        );
      }
      const p = await taskBoard(x.db, x.token, { attention: "needed" });
      expect(p.items[0]?.attention).toHaveLength(16);
      expect(p.items[0]?.attention_has_more).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThan(
        2 * 1024 * 1024,
      );
    } finally {
      await x.close();
    }
  }, 60000);

  it("cuts a UTF-8 heavy Board page by encoded bytes and resumes without skipping a card", async () => {
    const x = await conversationFixture();
    try {
      const ids = Array.from({ length: 34 }, () => randomUUID());
      for (const task_id of ids)
        await transaction(x.db, (tx) =>
          initializeTask(tx, {
            task_id,
            specification_id: randomUUID(),
            specification: "Budget fixture",
          }),
        );
      await transaction(x.db, async (tx) => {
        await tx.query(
          "INSERT INTO task_inputs(id,task_id,message_id) SELECT 'input-'||id,id,'message-'||id FROM tasks WHERE id=ANY($1)",
          [ids],
        );
        await tx.query(
          "INSERT INTO task_messages(id,task_id,input_id,sequence,author,content) SELECT 'message-'||id,id,'input-'||id,1,'owner','Synthetic read budget' FROM tasks WHERE id=ANY($1)",
          [ids],
        );
        await tx.query(
          "INSERT INTO task_input_issues(id,task_id,input_id,reason) SELECT 'issue-'||t.id||'-'||n,t.id,'input-'||t.id,$2 FROM tasks t CROSS JOIN generate_series(1,16) n WHERE t.id=ANY($1)",
          [ids, "🙂".repeat(1024)],
        );
      });
      const first = await taskBoard(x.db, x.token, { attention: "needed" });
      expect(first.items.length).toBeLessThan(32);
      expect(first.items.length).toBeGreaterThan(0);
      expect(first.has_more).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(
        2 * 1024 * 1024,
      );
      const second = await taskBoard(x.db, x.token, {
        attention: "needed",
        cursor: first.cursor,
      });
      expect(second.has_more).toBe(false);
      expect(
        new Set([...first.items, ...second.items].map((i) => i.task_id)).size,
      ).toBe(34);
    } finally {
      await x.close();
    }
  }, 60000);

  it("rejects invalid/authless reads and session replacement before a previously prepared command or receipt", async () => {
    const x = await conversationFixture(),
      app = createApp(x.service);
    try {
      const original = await new OwnerAccess(x.db).session(x.token),
        replacement = await issueOwnerSession(x.db);
      expect(original.session_id).not.toBe(replacement.session_id);
      expect((await app.inject({ url: "/v1/owner/tasks" })).statusCode).toBe(
        401,
      );
      expect(
        (
          await app.inject({
            url: "/v1/owner/tasks",
            headers: { "x-monos-session": original.session_id },
          })
        ).statusCode,
      ).toBe(401);
      const auth = { authorization: `Bearer ${x.token}` };
      for (const suffix of [
        "?column=invalid",
        "?unknown=true",
        "?cursor=not-canonical",
        "?column=ready&column=running",
      ])
        expect(
          (await app.inject({ url: "/v1/owner/tasks" + suffix, headers: auth }))
            .statusCode,
        ).toBe(409);
      expect(
        (
          await app.inject({
            url: "/v1/owner/tasks?project_id=missing",
            headers: auth,
          })
        ).statusCode,
      ).toBe(403);
      const request_id = randomUUID(),
        payload = {
          schema_version: 1,
          task_id: x.f.task,
          request_id,
          name: "submit_task_message",
          payload: {
            message_id: randomUUID(),
            content: "Exact old session intent",
          },
        };
      const cookie = {
        host: "monos.test",
        origin: "http://monos.test",
        cookie: `__Host-monos=${replacement.token}`,
        "x-monos-session": original.session_id,
      };
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/owner/tasks/conversation/commands",
            headers: cookie,
            payload,
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await x.db.pool.query(
            "SELECT 1 FROM owner_command_receipts WHERE request_id=$1",
            [request_id],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await app.inject({
            url: `/v1/owner/tasks/${x.f.task}/conversation/commands/${request_id}`,
            headers: cookie,
          })
        ).statusCode,
      ).toBe(401);
      const matched = { ...cookie, "x-monos-session": replacement.session_id };
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/owner/tasks/conversation/commands",
            headers: matched,
            payload,
          })
        ).statusCode,
      ).toBe(200);
      await revokeOwnerSession(x.db, replacement.session_id);
      expect(
        (await app.inject({ url: "/v1/owner/tasks", headers: matched }))
          .statusCode,
      ).toBe(401);
    } finally {
      await app.close();
      await x.close();
    }
  }, 60000);

  it("exposes repository-free exact result, carry applicability and retained historical manifest on replacement", async () => {
    const x = await replanFixture();
    try {
      await x.start();
      const node = await x.node();
      const done = await x.agent(node, "complete_node", {
        summary: "Exact completed local result",
      });
      await x.finish(done.operation_id!, node.dispatch.attempt_id);
      const before = await taskResults(x.db, x.token, x.f.task);
      expect(before.items).toHaveLength(1);
      expect(before.items[0]).toMatchObject({
        current: true,
        repository_free: true,
        git: null,
        manifest: {
          operation_id: done.operation_id,
          specification_id: x.f.spec,
          plan_id: x.f.plan,
        },
      });
      await x.send("Preserve result while replacing the Plan");
      const turn = await x.turn();
      const routed = await x.reply(turn, {
        kind: "replan",
        basis: await x.basis(),
        text: "Retain exact same work",
      });
      await x.finish(routed.operation_id!, turn.dispatch.attempt_id);
      const carry = await x.prepare(false, false);
      await x.publish(carry);
      const carried = await taskResults(x.db, x.token, x.f.task);
      expect(carried.items[0]?.current).toBe(true);
      expect(carried.items[0]?.manifest).toEqual(before.items[0]?.manifest);
      expect(carried.items[0]?.current_plan_id).toBe(carry.payload.plan_id);
      await x.send("Replace completed work with a different definition");
      const turn2 = await x.turn();
      const routed2 = await x.reply(turn2, {
        kind: "replan",
        basis: await x.basis(),
        text: "Replace formal goal",
      });
      await x.finish(routed2.operation_id!, turn2.dispatch.attempt_id);
      const replacement = await x.prepare(true, true);
      await x.publish(replacement);
      const historical = await taskResults(x.db, x.token, x.f.task);
      expect(historical.items[0]?.current).toBe(false);
      expect(historical.items[0]?.manifest).toEqual(before.items[0]?.manifest);
      expect(
        (await taskResults(x.db, x.token, x.f.task, historical.cursor)).items,
      ).toEqual([]);
      const other = randomUUID();
      await transaction(x.db, (tx) =>
        initializeTask(tx, {
          task_id: other,
          specification_id: randomUUID(),
          specification: "Other",
        }),
      );
      await expect(
        taskResults(x.db, x.token, other, before.cursor),
      ).rejects.toMatchObject({ detail: { code: "denied_scope" } });
      await expect(
        taskResults(x.db, x.token, x.f.task, "invalid"),
      ).rejects.toMatchObject({ detail: { code: "invalid_input" } });
    } finally {
      await x.close();
    }
  }, 60000);

  it("reads exact in-progress workspace snapshots and finalized Git without relabeling a later workspace head", async () => {
    const x = await replanFixture();
    try {
      const resource = randomUUID(),
        config = new Configuration(x.db);
      await config.save(x.token, {
        schema_version: 1,
        request_id: randomUUID(),
        expected_control_version: (await config.read(x.token)).control_version,
        name: "save_project",
        payload: {
          id: x.f.project,
          name: "Project",
          context: "Task project",
          resources: [
            {
              id: resource,
              remote_url: "https://github.com/example/ui.git",
              remote_preparation: "after_acceptance",
              default_branch: "main",
            },
          ],
          role_ids: [x.f.role],
          archived: false,
        },
      });
      await x.start();
      const node = await x.node(),
        opened = await x.agent(node, "open_workspace", {
          resource_id: resource,
        }),
        op = await x.service.recoverOperation(x.f.runner, opened.operation_id!),
        w = op.workspace!;
      expect(
        (
          await attemptWorkspace(
            x.db,
            x.token,
            x.f.task,
            node.dispatch.attempt_id,
          )
        ).workspaces[0],
      ).toMatchObject({
        lease_id: w.lease_id,
        lease_state: "held",
        open_state: "admitted",
        metadata: null,
        metadata_operation_id: null,
      });
      const metadata = {
        generation: 1,
        storage_id: "ui-result-storage",
        lease_id: w.lease_id,
        repository_identity: w.resource.repository_identity,
        provider_metadata: { github: { repository_id: "42" } },
        base_commit: "a".repeat(40),
        target_branch: "main",
        target_commit: "b".repeat(40),
        finalized_commit: "a".repeat(40),
      };
      await x.service.finishOperation(x.f.runner, x.f.incarnation, {
        operation_id: op.operation_id,
        attempt_id: node.dispatch.attempt_id,
        success: true,
        result: {
          workspace_id: w.workspace_id,
          path: "/runner/private/worktree",
          instruction_files: [],
          workspace_metadata: metadata,
        },
      });
      const live = await attemptWorkspace(
        x.db,
        x.token,
        x.f.task,
        node.dispatch.attempt_id,
      );
      expect(live.execution).toEqual({
        runtime_id: node.dispatch.runtime_id,
        model_id: node.dispatch.model,
        thinking_level: null,
      });
      expect(Object.keys(live).sort()).toEqual([
        "attempt_id",
        "execution",
        "schema_version",
        "task_id",
        "workspaces",
      ]);
      expect(JSON.stringify(live)).not.toContain(node.dispatch.prompt);
      expect(live.workspaces[0]).toMatchObject({
        metadata_operation_id: op.operation_id,
        metadata,
        lease_state: "held",
      });
      expect(JSON.stringify(live)).not.toContain("/runner/private");
      const done = await x.agent(node, "complete_node", {
        summary: "Finalized local files",
      });
      await x.service.finishOperation(x.f.runner, x.f.incarnation, {
        operation_id: done.operation_id!,
        attempt_id: node.dispatch.attempt_id,
        success: true,
        result: {
          writer_absent: true,
          workspace_id: w.workspace_id,
          workspace_metadata: { ...metadata, finalized_commit: "c".repeat(40) },
          git_commit: "c".repeat(40),
          git_tree: "d".repeat(40),
        },
      });
      const result = (await taskResults(x.db, x.token, x.f.task)).items[0]!;
      expect(result).toMatchObject({
        current: true,
        repository_free: false,
        git: {
          workspace_id: w.workspace_id,
          resource_id: resource,
          runner_id: x.f.runner,
          git_commit: "c".repeat(40),
          git_tree: "d".repeat(40),
        },
      });
      expect(JSON.stringify(result)).not.toContain("/runner/private");
      const finalized = await attemptWorkspace(
        x.db,
        x.token,
        x.f.task,
        node.dispatch.attempt_id,
      );
      expect(finalized.workspaces[0]).toMatchObject({
        lease_state: "released",
        metadata_operation_id: done.operation_id,
        metadata: { finalized_commit: "c".repeat(40) },
      });
      // A synthetic later mutable workspace observation must never relabel the
      // historical Attempt's immutable operation snapshot as its own result.
      await x.db.pool.query(
        "UPDATE task_workspaces SET finalized_commit=$2 WHERE id=$1",
        [w.workspace_id, "e".repeat(40)],
      );
      expect(
        await attemptWorkspace(
          x.db,
          x.token,
          x.f.task,
          node.dispatch.attempt_id,
        ),
      ).toEqual(finalized);
      expect((await taskResults(x.db, x.token, x.f.task)).items[0]).toEqual(
        result,
      );
      const other = randomUUID();
      await transaction(x.db, (tx) =>
        initializeTask(tx, {
          task_id: other,
          specification_id: randomUUID(),
          specification: "Another scope",
        }),
      );
      await expect(
        attemptWorkspace(x.db, x.token, other, node.dispatch.attempt_id),
      ).rejects.toMatchObject({ detail: { code: "denied_scope" } });
      const app = createApp(x.service);
      try {
        expect(
          (
            await app.inject({
              url: `/v1/owner/tasks/${x.f.task}/attempts/${node.dispatch.attempt_id}/workspace`,
            })
          ).statusCode,
        ).toBe(401);
        expect(
          (
            await app.inject({
              url: `/v1/owner/tasks/${x.f.task}/attempts/${node.dispatch.attempt_id}/workspace?unexpected=1`,
              headers: { authorization: `Bearer ${x.token}` },
            })
          ).statusCode,
        ).toBe(409);
        expect(
          (
            await app.inject({
              url: `/v1/owner/tasks/${x.f.task}/attempts/${node.dispatch.attempt_id}/workspace`,
              headers: { authorization: `Bearer ${x.token}` },
            })
          ).json(),
        ).toEqual(finalized);
      } finally {
        await app.close();
      }
    } finally {
      await x.close();
    }
  }, 60000);
});
