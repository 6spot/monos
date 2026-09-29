#!/usr/bin/env python3
"""Explicit root-side operations for the isolated Linux boundary probe.

Only task-owned units/paths/Compose services are targeted. Credentials go through
private reads and stdin/HTTPS headers, never argv, evidence or printed output.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import sqlite3
import ssl
import subprocess
import sys
import time
import urllib.request

ROOT = pathlib.Path("/var/lib/monos-probe")
CONFIG = pathlib.Path("/etc/monos-probe/runner.json")
MODEL = "opencode/longcat-2.5-preview-free"
ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
COMMON_CHECKS = {"bundled_help", "forged_hints_denied", "forged_environment_keeps_own_result", "workspace_command", "retry_ignores_changed_file", "same_id_changed_payload_conflicts", "long_payload_retained_before_send", "long_payload_changed_content_conflicts"}
KIND_CHECKS = {
    "node": {"workspace_lazy_before_open", "native_git_commit", "separate_worktree_common"},
    "planner": {"snapshot_readable", "snapshot_shell_write_denied", "snapshot_chmod_denied", "snapshot_root_rename_denied", "normal_shell_write"},
}


def checked_id(value):
    if not ID.fullmatch(value):
        raise ValueError("invalid probe ID")
    return value


def live_identity(ownership):
    pid = ownership.get("pid", 0)
    if not isinstance(pid, int) or pid <= 0:
        return {"present": False}
    root = pathlib.Path("/proc") / str(pid)
    try:
        first = root.joinpath("stat").read_text().rsplit(")", 1)[1].split()[19]
        groups = root.joinpath("cgroup").read_text().splitlines()
        cgroup = next(line[3:] for line in groups if line.startswith("0::"))
        second = root.joinpath("stat").read_text().rsplit(")", 1)[1].split()[19]
        if first != second:
            return {"present": False, "identity_changed": True}
        return {"present": True, "pid": pid, "birth": first, "cgroup": cgroup, "boot_id": pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip(), "uid": root.stat().st_uid}
    except FileNotFoundError:
        return {"present": False}


def boot_id():
    return pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip()


def verified_live_identity(ownership, observed):
    if observed.get("present") is not True or type(observed.get("pid")) is not int or observed["pid"] <= 0:
        return False
    if not all(isinstance(observed.get(key), str) and observed[key] for key in ("birth", "boot_id", "cgroup")):
        return False
    if not observed["birth"].isdigit() or not observed["cgroup"].startswith("/"):
        return False
    return all(observed[key] == ownership.get(key) for key in ("pid", "birth", "boot_id", "cgroup"))


def retained_live_identity(before, after):
    return all(verified_live_identity(state.get("ownership", {}), state.get("live_identity", {})) for state in (before, after)) and all(before["live_identity"][key] == after["live_identity"][key] for key in ("pid", "birth", "boot_id", "cgroup"))


def physical_state(ownership, scratch):
    cgroup = ownership.get("cgroup", "")
    population = None
    if re.fullmatch(r"/system.slice/monos-probe-[A-Za-z0-9_-]+\.service", cgroup):
        try:
            fields = dict(line.split() for line in (pathlib.Path("/sys/fs/cgroup" + cgroup) / "cgroup.events").read_text().splitlines())
            if fields.get("populated") in ("0", "1"):
                population = fields["populated"] == "1"
        except FileNotFoundError:
            population = False
    descendants = []
    for name in ("setsid", "double-fork"):
        path = scratch / (name + ".identity.json")
        if not path.exists():
            continue
        expected = json.loads(path.read_text())
        observed = live_identity(expected)
        alive = observed.get("present") is True and all(observed.get(key) == expected.get(key) for key in ("pid", "birth", "boot_id"))
        descendants.append({"name": name, "identity": expected, "alive": alive})
    return {"cgroup_populated": population, "descendants": descendants}


class Probe:
    def __init__(self, source, evidence):
        self.source = pathlib.Path(source).resolve()
        self.evidence = pathlib.Path(evidence).resolve()
        if self.source != pathlib.Path("/root/monos-boundary-probe-src"):
            raise ValueError("use the explicitly reviewed staging root")
        self.evidence.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.evidence, 0o700)
        self.compose = ["docker", "compose", "-f", str(self.source / "infra/compose/compose.yaml")]
        self.config = json.loads(CONFIG.read_text())
        self.runner = checked_id(self.config["runner_id"])

    def call(self, command, data=None, timeout=60, cwd=None):
        result = subprocess.run(command, input=data, capture_output=True, timeout=timeout, cwd=cwd or self.source)
        if result.returncode:
            # External stderr may contain supplied prompt/provider/config data.
            raise RuntimeError("subprocess failed: " + pathlib.Path(command[0]).name + " (exit " + str(result.returncode) + ")")
        return result.stdout.decode("utf-8")

    def admin(self, data):
        output = self.call(self.compose + ["exec", "-T", "server", "node", "--experimental-strip-types", "apps/server/src/admin.ts"], json.dumps(data).encode())
        return json.loads(output) if output.strip() else None

    def query(self, sql):
        output = self.call(self.compose + ["exec", "-T", "database", "psql", "-X", "-U", "monos", "-d", "monos", "-At", "-v", "ON_ERROR_STOP=1"], sql.encode())
        return json.loads(output)

    def save(self, name, value):
        path = self.evidence / (name + ".json")
        # Never overwrite an earlier trial with a rerun that hides its failure.
        with path.open("x") as output:
            json.dump(value, output, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.chmod(path, 0o600)
        directory = os.open(self.evidence, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        print(json.dumps({"evidence": str(path), "outcome": value.get("outcome", "recorded")}))

    def catalog(self):
        output = self.call(["runuser", "-u", "me", "--", "/home/linuxbrew/.linuxbrew/bin/opencode", "models", "opencode", "--pure", "--refresh", "--verbose"], timeout=60, cwd="/home/me")
        output = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", output)
        header = re.search(r"(?m)^" + re.escape(MODEL) + r"\s*$", output)
        if header is None:
            raise RuntimeError("approved free model unavailable")
        document = output[output.find("{", header.end()):]
        try:
            model, _ = json.JSONDecoder().raw_decode(document)
            cost = model["cost"]
        except (ValueError, KeyError):
            raise RuntimeError("free model catalog format requires inspection") from None
        costs = [cost.get("input"), cost.get("output"), cost.get("cache", {}).get("read"), cost.get("cache", {}).get("write")]
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or value != 0 for value in costs):
            raise RuntimeError("selected model is not verified zero-cost")
        if model.get("id") != MODEL.split("/", 1)[1] or model.get("status") != "active" or model.get("capabilities", {}).get("toolcall") is not True:
            raise RuntimeError("selected free model is not active with native tool calls")
        return {"model": MODEL, "cost": {"input": costs[0], "output": costs[1], "cache": {"read": costs[2], "write": costs[3]}}, "status": "active", "toolcall": True}

    def permissions(self, attempt):
        attempt = checked_id(attempt)
        def test(user, option, path):
            result = subprocess.run(["runuser", "-u", user, "--", "/usr/bin/test", option, str(path)], capture_output=True, timeout=10, cwd="/home/me")
            if result.returncode not in (0, 1):
                raise RuntimeError("permission probe could not execute")
            return result.returncode == 0
        checks = {"protected_files_exist": all(pathlib.Path(path).is_file() for path in (self.config["journal"], self.config["token_file"], ROOT / "cache/fixture.git/HEAD")),
                  "execution_cache_readable": test("me", "-r", ROOT / "cache/fixture.git/HEAD"),
                  "execution_cache_not_writable": not test("me", "-w", ROOT / "cache/fixture.git"),
                  "journal_private": not test("me", "-r", self.config["journal"]),
                  "control_credential_private": not test("me", "-r", self.config["token_file"]),
                  "service_result_readable": test("monos-probe", "-r", ROOT / "execution" / attempt / "workspace/probe-result.txt")}
        result = subprocess.run(["runuser", "-u", "me", "--", "/usr/local/bin/monos", "command-status", "--request-id", "shared-open"], capture_output=True, text=True, timeout=30, cwd="/home/me")
        try:
            body = json.loads(result.stdout)
        except ValueError:
            body = {}
        checks["same_uid_without_owned_cgroup_denied"] = result.returncode != 0 and "process not attributed" in body.get("error", {}).get("message", "")
        return {"outcome": "pass" if all(checks.values()) else "fail", "checks": checks}

    def install_driver(self):
        directory = ROOT / "probe-tools"
        if directory.is_symlink():
            raise RuntimeError("unsafe probe-tools symlink")
        directory.mkdir(exist_ok=True, mode=0o755)
        if directory.stat().st_uid != 0 or directory.stat().st_mode & 0o022:
            raise RuntimeError("probe-tools must be root-owned and non-writable")
        # mkdir modes are filtered by the invoking root shell's umask.
        directory.chmod(0o755)
        target = directory / "driver.py"
        source = self.source / "infra/probe/driver.py"
        if target.is_symlink() or target.exists() and (not target.is_file() or target.stat().st_uid != 0 or target.stat().st_mode & 0o022):
            raise RuntimeError("installed probe driver must be a root-owned non-writable regular file")
        if target.exists() and target.read_bytes() != source.read_bytes():
            raise RuntimeError("installed probe driver differs; review before replacing")
        if not target.exists():
            with target.open("xb") as output:
                output.write(source.read_bytes())
            os.chmod(target, 0o644)

    def start(self, attempt, kind, hold=False, peer_attempt=None, pre_plan=False):
        attempt = checked_id(attempt)
        if pre_plan and kind != "planner":
            raise ValueError("only Planner may use a pre-Plan fixture")
        catalog = self.catalog()  # Check free selection before every real trial.
        self.install_driver()
        command = "python3 /var/lib/monos-probe/probe-tools/driver.py --attempt " + attempt + " --kind " + kind + (" --hold" if hold else "")
        if peer_attempt:
            command += " --peer-attempt " + checked_id(peer_attempt)
        prompt = ("This is the authorized monos boundary test. Use your native bash tool to execute exactly the following command, with a 600000 ms tool timeout. "
                  "The root-owned test driver calls bundled monos --help, submits formal workspace and lifecycle commands using input files, tests retries and normal shell/Git. "
                  "Do not replace it with a text answer or skip failed cases. Completion can stop this process tree before a final answer; that is expected.\n" + command)
        hashes = {name: hashlib.sha256((self.source / "infra/probe" / name).read_bytes()).hexdigest() for name in ("driver.py", "probe.py")}
        trial = {"attempt_id": attempt, "kind": kind, "model": catalog, "hold": hold, "pre_plan": pre_plan, "prepared_at": time.time(), "harness_sha256": hashes}
        if peer_attempt:
            trial["peer_attempt"] = peer_attempt
        # Evidence is not dispatch authority. If admission loses its response,
        # inspect the backend using this ID; never infer that no launch occurred.
        self.save("prepared-" + attempt, trial)
        launch = self.admin({"action": "attempt", "runner_id": self.runner, "attempt_id": attempt,
                             "task_id": "task_" + attempt, "kind": kind, "resource_id": "fixture-repo", "prompt": prompt,
                             **({"pre_plan": True} if pre_plan else {})})
        trial.update(dispatch_id=launch["dispatch_id"], started_at=time.time())
        self.save("started-" + attempt, trial)
        return trial

    def snapshot(self, attempt):
        attempt = checked_id(attempt)
        # IDs are strictly validated; SQL itself contains only fixed selected fields.
        attempt_data = self.query("SELECT coalesce(jsonb_agg(jsonb_build_object('attempt_id',a.id,'dispatch_id',a.dispatch_id,'kind',a.kind,'started',a.started,'mutation_allowed',a.mutation_allowed,'process_absent',a.process_absent,'process_released',a.process_released,'task_state',t.state,'node_state',n.state)), '[]'::jsonb) FROM attempts a JOIN tasks t ON t.id=a.task_id LEFT JOIN nodes n ON n.id=a.node_id WHERE a.id='" + attempt + "';")
        receipts = self.query("SELECT coalesce(jsonb_agg(jsonb_build_object('request_id',request_id,'scope_id',scope_id,'command_name',command_name,'digest',digest,'schema_version',schema_version,'operation_id',operation_id,'status',response->>'status','reply_length',length(response->'result'->>'reply'),'long_value_length',greatest(length(envelope_json::jsonb->'payload'->>'summary'),length(envelope_json::jsonb->'payload'->>'reply')))), '[]'::jsonb) FROM command_receipts WHERE attempt_id='" + attempt + "';")
        operations = self.query("SELECT coalesce(jsonb_agg(jsonb_build_object('operation_id',id,'kind',kind,'state',state,'failure_kind',failure_kind,'created_epoch',extract(epoch FROM created_at),'git_commit',result->>'git_commit','git_tree',result->>'git_tree','writer_absent',result->'writer_absent')), '[]'::jsonb) FROM operations WHERE attempt_id='" + attempt + "';")
        events = self.query("SELECT coalesce(jsonb_agg(jsonb_build_object('stream_id',stream_id,'sequence',sequence,'kind',body->>'kind','text_length',length(body->>'text'))),'[]'::jsonb) FROM runtime_events WHERE attempt_id='" + attempt + "';")
        journal = sqlite3.connect("file:" + self.config["journal"] + "?mode=ro", uri=True)
        try:
            requests = [{"request_id": row[0], "digest": row[1], "digest_matches_bytes": hashlib.sha256(row[2]).hexdigest() == row[1], "bytes": len(row[2])}
                        for row in journal.execute("SELECT id,digest,envelope FROM requests WHERE attempt=?", (attempt,))]
            row = journal.execute("SELECT body FROM starts WHERE attempt=?", (attempt,)).fetchone()
            ownership = {}
            if row:
                record = json.loads(row[0])
                ownership = {key: record[key] for key in ("boot_id", "pid", "birth", "cgroup", "phase")}
                ownership["dispatch_id"] = record["dispatch"]["dispatch_id"]
        finally:
            journal.close()
        report_path = ROOT / "execution" / attempt / "scratch" / "probe-driver.json"
        driver = json.loads(report_path.read_text()) if report_path.exists() else None
        return {"attempts": attempt_data, "receipts": receipts, "operations": operations, "events": events, "journal_requests": requests, "ownership": ownership, "live_identity": live_identity(ownership), "driver": driver, "physical": physical_state(ownership, report_path.parent), "boot_id": boot_id()}

    def idle_restart(self, attempt):
        attempt = checked_id(attempt)
        unresolved = "SELECT coalesce(jsonb_agg(id),'[]'::jsonb) FROM attempts WHERE NOT process_released;"
        if self.query(unresolved):
            raise RuntimeError("idle restart requires no unresolved Attempts")
        before = self.snapshot(attempt)
        rows = before.get("attempts", [])
        if len(rows) != 1 or not rows[0].get("process_released") or rows[0].get("mutation_allowed"):
            raise RuntimeError("idle restart requires a released Attempt")
        previous = self.recovery(attempt, "probe-handoff")
        if previous.get("status") != "committed":
            raise RuntimeError("idle restart requires an existing committed handoff")
        self.save("before-idle-restart-" + attempt, {"state": before})
        self.call(["systemctl", "restart", "monos-probe-runner.service"])
        self.call(self.compose + ["restart", "server"])
        time.sleep(8)
        after = self.snapshot(attempt)
        recovered = self.recovery(attempt, "probe-handoff")
        fields = ("attempts", "receipts", "operations", "journal_requests", "ownership", "events")
        checks = {field + "_unchanged": before[field] == after[field] for field in fields}
        checks["no_claims_created"] = not self.query(unresolved)
        checks["existing_result_readable"] = recovered == previous
        checks["runner_active"] = self.call(["systemctl", "is-active", "monos-probe-runner.service"]).strip() == "active"
        result = {"outcome": "pass" if all(checks.values()) else "fail", "checks": checks, "state": after,
                  "limitation": "Completed Attempt recovery only; not live concurrent restart or host reboot."}
        self.save("after-idle-restart-" + attempt, result)
        return result

    def wait(self, attempt, ready_only=False, seconds=240):
        deadline = time.monotonic() + seconds
        last = {}
        while time.monotonic() < deadline:
            last = self.snapshot(attempt)
            driver = last.get("driver") or {}
            if ready_only and driver.get("stage") == "ready_for_handoff":
                return last
            if not ready_only and last["attempts"] and last["attempts"][0]["process_released"]:
                return last
            if any(op["state"] == "recovery" for op in last.get("operations", [])):
                return last
            time.sleep(2)
        return last

    def verify(self, attempt, state):
        rows = state.get("attempts", [])
        kind = rows[0].get("kind") if len(rows) == 1 else None
        driver = state.get("driver") or {}
        reported = driver.get("checks", {})
        checks = {key: reported.get(key) is True for key in COMMON_CHECKS | KIND_CHECKS.get(kind, set())}
        checks["complete_driver_evidence"] = kind in KIND_CHECKS and driver.get("kind") == kind and driver.get("attempt_id") == attempt and driver.get("stage") == "handoff_submitting" and driver.get("handoff_request_id") == "probe-handoff"
        checks["execution_identity"] = driver.get("execution_uid") == self.config["execution_uid"]
        handoffs = [r for r in state.get("receipts", []) if r["request_id"] == "probe-handoff"]
        expected_command = "complete_node" if kind == "node" else "commit_task_turn"
        checks["formal_handoff_receipt"] = len(handoffs) == 1 and handoffs[0]["command_name"] == expected_command and handoffs[0]["status"] == ("admitted" if kind == "node" else "committed")
        checks["large_payload_received"] = len(handoffs) == 1 and handoffs[0]["long_value_length"] == 160000
        receipts = {r["request_id"]: r for r in state.get("receipts", [])}
        checks["receipt_scope_matches_attempt_task"] = bool(receipts) and all(r["scope_id"] == "task_" + attempt for r in receipts.values())
        workspace = receipts.get("shared-open", {})
        checks["correct_workspace_receipt"] = workspace.get("command_name") == ("open_workspace" if kind == "node" else "inspect_repository") and any(op["operation_id"] == workspace.get("operation_id") and op["kind"] == workspace.get("command_name") and op["state"] == "succeeded" for op in state.get("operations", []))
        retained = state.get("journal_requests", [])
        checks["immutable_journal_backend_digest"] = {r["request_id"] for r in retained} == set(receipts) == {"shared-open", "probe-handoff"} and all(r["digest_matches_bytes"] and r["digest"] == receipts[r["request_id"]]["digest"] for r in retained)
        checks["process_released_after_absence"] = len(rows) == 1 and rows[0]["process_absent"] is True and rows[0]["process_released"] is True and rows[0]["mutation_allowed"] is False
        physical = state.get("physical", {})
        checks["physical_cgroup_absent"] = physical.get("cgroup_populated") is False
        if rows and rows[0]["kind"] == "node":
            completed = [op for op in state["operations"] if op["kind"] == "complete_node"]
            checks["finalized_exact_git_result"] = len(completed) == 1 and len(handoffs) == 1 and completed[0]["operation_id"] == handoffs[0].get("operation_id") and completed[0]["state"] == "succeeded" and completed[0]["writer_absent"] is True and bool(completed[0]["git_commit"]) and bool(driver.get("expected_git_tree")) and completed[0]["git_tree"] == driver["expected_git_tree"]
            checks["node_formal_result"] = rows[0]["node_state"] == "COMPLETED" and rows[0]["task_state"] == "REVIEW"
            descendants = physical.get("descendants", [])
            checks["detached_descendants_absent"] = len(descendants) == 2 and all(item["alive"] is False for item in descendants)
            scratch = ROOT / "execution" / attempt / "scratch"
            sentinel = [scratch / (name + ".sentinel") for name in ("setsid", "double-fork")]
            before = [p.stat().st_mtime_ns if p.exists() else None for p in sentinel]
            time.sleep(1)
            after = [p.stat().st_mtime_ns if p.exists() else None for p in sentinel]
            checks["detached_descendant_writes_stopped"] = all(value is not None for value in before) and before == after and checks["process_released_after_absence"]
        elif kind == "planner":
            stops = [op for op in state["operations"] if op["kind"] == "stop"]
            checks["planner_stop_succeeded"] = len(stops) == 1 and len(handoffs) == 1 and stops[0]["operation_id"] == handoffs[0].get("operation_id") and stops[0]["state"] == "succeeded" and stops[0]["writer_absent"] is True
            checks["planner_reply_committed"] = len(handoffs) == 1 and handoffs[0].get("reply_length") == 160000
        return {"outcome": "pass" if checks and all(checks.values()) else "fail", "checks": checks, "state": state}

    def recovery(self, attempt, request_id):
        token = pathlib.Path(self.config["token_file"]).read_text().strip()
        url = self.config["endpoint"].rstrip("/") + "/v1/recovery/attempts/" + checked_id(attempt) + "/commands/" + checked_id(request_id)
        request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
        context = ssl.create_default_context(cafile=self.config["ca_file"])
        with urllib.request.urlopen(request, context=context, timeout=15) as response:
            body = json.load(response)
        # Planner reply/large payloads are not included in evidence.
        return {key: body[key] for key in ("schema_version", "status", "request_id", "operation_id") if key in body}

    def hold_checks(self, attempt, state):
        rows = state.get("attempts", [])
        driver = state.get("driver") or {}
        identity = state.get("live_identity", {})
        ownership = state.get("ownership", {})
        receipts = state.get("receipts", [])
        retained = state.get("journal_requests", [])
        descendants = state.get("physical", {}).get("descendants", [])
        return {
            "driver_ready": driver.get("attempt_id") == attempt and driver.get("kind") == "node" and driver.get("stage") == "ready_for_handoff" and all(driver.get("checks", {}).get(key) is True for key in COMMON_CHECKS | KIND_CHECKS["node"]),
            "bounded_hold_active": (driver.get("hold_expires_at") or 0) - time.time() > 45,
            "live_owned_execution": verified_live_identity(ownership, identity) and identity.get("uid") == self.config["execution_uid"] and ownership.get("phase") == "running",
            "descendants_running": len(descendants) == 2 and all(item["alive"] is True and item["identity"].get("cgroup") == ownership.get("cgroup") for item in descendants),
            "claim_retained_before_reboot": len(rows) == 1 and rows[0]["started"] is True and rows[0]["mutation_allowed"] is True and rows[0]["process_released"] is False,
            "workspace_receipt_only": len(receipts) == 1 and receipts[0]["request_id"] == "shared-open" and receipts[0]["scope_id"] == "task_" + attempt and any(op["operation_id"] == receipts[0]["operation_id"] and op["state"] == "succeeded" for op in state.get("operations", [])),
            "long_request_retained_unsent": {item["request_id"] for item in retained} == {"shared-open", "probe-handoff"} and all(item["digest_matches_bytes"] for item in retained) and any(item["request_id"] == "probe-handoff" and item["bytes"] > 160000 for item in retained),
        }

    def reboot_hold(self, attempt):
        name = "reboot-before-" + checked_id(attempt)
        if (self.evidence / (name + ".json")).exists():
            raise RuntimeError("existing reboot checkpoint retained; use a new Attempt ID")
        trial = self.start(attempt, "node", hold=True)
        state = self.wait(attempt, ready_only=True)
        checks = self.hold_checks(attempt, state)
        result = {"outcome": "ready" if all(checks.values()) else "fail", "checks": checks, "trial": trial, "state": state, "reboot_executed": False}
        self.save(name, result)
        return result

    def reboot_verify(self, attempt, before, state):
        # Pure verification: never replay an unsent request, release the hold,
        # restart a service, revoke ownership or launch a replacement Runtime.
        previous = before.get("state", {})
        old = previous.get("ownership", {})
        current = state.get("ownership", {})
        rows = state.get("attempts", [])
        stopped = [op for op in state.get("operations", []) if op["kind"] == "stop"]
        descendants = state.get("physical", {}).get("descendants", [])
        by_id = lambda items: {item["request_id"]: item for item in items}
        checks = {
            "valid_live_checkpoint": before.get("outcome") == "ready" and bool(before.get("checks")) and all(value is True for value in before["checks"].values()) and before.get("trial", {}).get("attempt_id") == attempt,
            "boot_changed": bool(previous.get("boot_id")) and bool(state.get("boot_id")) and previous["boot_id"] != state["boot_id"],
            "retained_original_dispatch": bool(old.get("dispatch_id")) and all(old.get(key) == current.get(key) for key in ("dispatch_id", "boot_id", "pid", "birth", "cgroup")) and len(rows) == 1 and rows[0]["dispatch_id"] == old["dispatch_id"],
            "old_writers_absent": current.get("phase") == "absent" and state.get("physical", {}).get("cgroup_populated") is False and len(descendants) == 2 and all(item["alive"] is False for item in descendants),
            "claim_released_after_stop": len(rows) == 1 and rows[0]["process_absent"] is True and rows[0]["process_released"] is True and rows[0]["mutation_allowed"] is False and len(stopped) == 1 and stopped[0]["state"] == "succeeded" and stopped[0]["writer_absent"] is True,
            "interrupted_work_not_completed": len(rows) == 1 and rows[0]["task_state"] == "BLOCKED" and rows[0]["node_state"] == "BLOCKED" and not any(op["kind"] == "complete_node" for op in state.get("operations", [])),
            "immutable_requests_preserved": by_id(state.get("journal_requests", [])) == by_id(previous.get("journal_requests", [])) and len(state.get("journal_requests", [])) == 2,
            "receipts_preserved_no_unsent_admission": by_id(state.get("receipts", [])) == by_id(previous.get("receipts", [])) and {item["request_id"] for item in state.get("receipts", [])} == {"shared-open"},
            "no_replacement_start": [event for event in state.get("events", []) if event["kind"] == "started"] == [event for event in previous.get("events", []) if event["kind"] == "started"],
        }
        return {"outcome": "pass" if all(checks.values()) else "fail", "checks": checks, "state": state, "checkpoint": "reboot-before-" + attempt + ".json", "verification_read_only": True}

    def delayed_revoke(self, attempt):
        attempt = checked_id(attempt)
        pending = self.query("SELECT coalesce(jsonb_agg(id),'[]'::jsonb) FROM attempts WHERE runner_id='" + self.runner + "' AND NOT process_released;")
        if pending:
            raise RuntimeError("settle all existing probe ownership before this Runner interruption scenario")
        self.call(["systemctl", "is-active", "monos-probe-runner.service"])
        self.call(["systemctl", "stop", "monos-probe-runner.service"])
        before = None
        failure = None
        try:
            self.admin({"action": "attempt", "runner_id": self.runner, "attempt_id": attempt, "task_id": "task_" + attempt, "kind": "node", "resource_id": "fixture-repo", "prompt": "This test dispatch must be revoked before Runner delivery; do not launch the Runtime."})
            self.admin({"action": "revoke", "attempt_id": attempt})
            before = self.snapshot(attempt)
        except Exception as error:
            failure = type(error).__name__
        finally:
            # Restore only the task-owned Runner that this command stopped.
            self.call(["systemctl", "start", "monos-probe-runner.service"])
        after = self.wait(attempt, seconds=60)
        original = (before or {}).get("attempts", [])
        current = after.get("attempts", [])
        stops = [op for op in after.get("operations", []) if op["kind"] == "stop"]
        manifest_path = ROOT / "launch" / (attempt + ".json")
        marker = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
        checks = {
            "created_and_revoked_with_runner_stopped": failure is None and len(original) == 1 and original[0]["started"] is False and original[0]["mutation_allowed"] is False and not (before or {}).get("ownership"),
            "runtime_never_started": len(current) == 1 and current[0]["started"] is False and not any(event["kind"] == "started" for event in after.get("events", [])),
            "verified_stop_released_claim": len(current) == 1 and current[0]["process_released"] is True and current[0]["process_absent"] is True and len(stops) == 1 and stops[0]["state"] == "succeeded" and stops[0]["writer_absent"] is True,
            "retained_revocation_tombstone": after.get("ownership", {}).get("phase") == "revoked" and marker.get("revoked") is True,
            "no_attempt_unit": self.call(["systemctl", "show", "monos-probe-a-" + attempt + ".service", "--property=LoadState", "--value"]).strip() == "not-found",
        }
        return {"outcome": "pass" if all(checks.values()) else "fail", "checks": checks, "before": before, "after": after, "failure_category": failure}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="/root/monos-boundary-probe-src")
    parser.add_argument("--evidence", required=True)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("enroll")
    sub.add_parser("profile")
    for action in ("trial", "inspect", "recover", "checkpoint", "permissions", "delayed-revoke", "reboot-hold", "reboot-verify", "idle-restart"):
        item = sub.add_parser(action)
        item.add_argument("attempt")
        if action == "trial":
            item.add_argument("--kind", choices=("node", "planner"), required=True)
        if action == "recover":
            item.add_argument("--request", default="probe-handoff")
            item.add_argument("--require-expired", action="store_true")
    pair = sub.add_parser("restart-pair")
    pair.add_argument("prefix")
    args = parser.parse_args()
    if os.geteuid() != 0 or sys.platform != "linux":
        raise RuntimeError("run explicitly as root on the authorized Linux test host")
    probe = Probe(args.source, args.evidence)
    if args.action == "enroll":
        credential = pathlib.Path(probe.config["token_file"]).read_text().strip()
        probe.admin({"action": "enroll", "runner_id": probe.runner, "credential": credential, "capacity": 2})
        print(json.dumps({"enrolled": probe.runner}))
    elif args.action == "profile":
        version = probe.call(["runuser", "-u", "me", "--", "/home/linuxbrew/.linuxbrew/bin/opencode", "--version"], cwd="/home/me").strip()
        systemd = probe.call(["systemctl", "--version"]).splitlines()[0]
        files = sorted(p for folder in ("runner", "apps/server/src", "packages/protocol/schemas", "packages/protocol/generated/go", "packages/domain/src", "packages/db/migrations", "infra/probe", "infra/runner") for p in (probe.source / folder).rglob("*") if p.is_file() and p.suffix in (".go", ".ts", ".json", ".mod", ".sum", ".py", ".sh", ".sql"))
        hasher = hashlib.sha256()
        for path in files:
            hasher.update(str(path.relative_to(probe.source)).encode()); hasher.update(path.read_bytes())
        probe.save("profile", {"kernel": os.uname().release, "machine": os.uname().machine, "boot_id": pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip(), "systemd": systemd, "opencode": version, "catalog": probe.catalog(), "source_fingerprint": hasher.hexdigest(), "reboot": "not_run"})
    elif args.action == "trial":
        trial = probe.start(args.attempt, args.kind)
        result = probe.verify(args.attempt, probe.wait(args.attempt))
        result["trial"] = trial
        probe.save(args.attempt, result)
        if result["outcome"] != "pass":
            sys.exit(2)
    elif args.action in ("inspect", "checkpoint"):
        state = probe.snapshot(args.attempt)
        probe.save(args.action + "-" + checked_id(args.attempt), {"state": state, "boot_id": pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip(), "reboot_executed": False})
    elif args.action == "recover":
        state = probe.snapshot(args.attempt)
        admitted = [float(op["created_epoch"]) for op in state["operations"] if op["kind"] in ("complete_node", "stop")]
        expired = bool(admitted) and time.time() - max(admitted) > 65
        if args.require_expired and not expired:
            raise RuntimeError("wait at least 65 seconds after terminal admission before this expiry check")
        result = probe.recovery(args.attempt, args.request)
        result["after_attempt_grant_expiry"] = expired
        receipts = [item for item in state["receipts"] if item["request_id"] == args.request]
        result["outcome"] = "pass" if result.get("status") == "committed" and result.get("request_id") == args.request and len(receipts) == 1 and result.get("operation_id") == receipts[0]["operation_id"] and len(state["attempts"]) == 1 and state["attempts"][0]["mutation_allowed"] is False else "fail"
        probe.save("recovery-" + checked_id(args.attempt), result)
        if result["outcome"] != "pass":
            sys.exit(2)
    elif args.action == "permissions":
        result = probe.permissions(args.attempt)
        probe.save("permissions-" + checked_id(args.attempt), result)
        if result["outcome"] != "pass":
            sys.exit(2)
    elif args.action == "delayed-revoke":
        result = probe.delayed_revoke(args.attempt)
        probe.save("delayed-revoke-" + checked_id(args.attempt), result)
        if result["outcome"] != "pass":
            sys.exit(2)
    elif args.action == "reboot-hold":
        if probe.reboot_hold(args.attempt)["outcome"] != "ready":
            sys.exit(2)
    elif args.action == "reboot-verify":
        attempt = checked_id(args.attempt)
        before = json.loads((probe.evidence / ("reboot-before-" + attempt + ".json")).read_text())
        state = probe.wait(attempt, seconds=120)
        result = probe.reboot_verify(attempt, before, state)
        recovery = probe.recovery(attempt, "shared-open")
        unknown = probe.recovery(attempt, "probe-handoff")
        result["checks"]["existing_result_readable_unsent_unknown"] = recovery.get("status") == "committed" and recovery.get("request_id") == "shared-open" and unknown.get("status") == "unknown"
        result["outcome"] = "pass" if all(result["checks"].values()) else "fail"
        probe.save("reboot-after-" + attempt, result)
        if result["outcome"] != "pass":
            sys.exit(2)
    elif args.action == "idle-restart":
        if probe.idle_restart(args.attempt)["outcome"] != "pass":
            sys.exit(2)
    elif args.action == "restart-pair":
        prefix = checked_id(args.prefix)
        attempts = [checked_id(prefix + "-one"), checked_id(prefix + "-two")]
        trials = [probe.start(attempt, "node", hold=True, peer_attempt=attempts[1-index]) for index, attempt in enumerate(attempts)]
        before = [probe.wait(attempt, ready_only=True) for attempt in attempts]
        probe.save("before-restart-" + prefix, {"trials": trials, "state": before})
        if not all((item.get("driver") or {}).get("stage") == "ready_for_handoff" for item in before):
            probe.save(prefix, {"outcome": "fail", "reason": "concurrent Attempts did not reach explicit hold", "state": before})
            sys.exit(2)
        probe.call(["systemctl", "restart", "monos-probe-runner.service"])
        probe.call(probe.compose + ["restart", "server"])
        time.sleep(8)
        after = [probe.snapshot(attempt) for attempt in attempts]
        probe.save("after-restart-" + prefix, {"trials": trials, "state": after})
        identity_retained = all(retained_live_identity(a, b) for a, b in zip(before, after))
        for attempt in attempts:
            (ROOT / "execution" / attempt / "scratch" / "probe-release").touch(exist_ok=False)
        results = [probe.verify(attempt, probe.wait(attempt)) for attempt in attempts]
        same_uid = all(item["live_identity"].get("uid") == probe.config["execution_uid"] for item in before + after)
        result = {"outcome": "pass" if identity_retained and same_uid and all(r["outcome"] == "pass" for r in results) else "fail", "same_process_after_service_restarts": identity_retained, "same_execution_uid": same_uid, "restart_identities": [{"before": a["live_identity"], "after": b["live_identity"]} for a, b in zip(before, after)], "output_before_handoff": all(any(event["kind"] == "output" for event in item["events"]) for item in before), "trials": trials, "results": results, "host_reboot": "not_run"}
        probe.save(prefix, result)
        if result["outcome"] != "pass":
            sys.exit(2)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"probe": "failed", "category": type(error).__name__, "message": str(error)[:200]}))
        sys.exit(1)
