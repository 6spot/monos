#!/usr/bin/env python3
"""Runs inside the real OpenCode Attempt's native bash tool/cgroup.

No credentials/config are printed or retained. Formal actions use bundled
monos; root-side probe.py verifies database receipts independently.
"""
import argparse
import json
import os
import pathlib
import socket
import subprocess
import sys
import time


def command(args, timeout=40, env=None):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=env)
    try:
        body = json.loads(result.stdout)
    except (ValueError, TypeError):
        body = {}
    return result.returncode, body


def formal(name, request_id, payload_path=None):
    args = ["/usr/local/bin/monos", name, "--request-id", request_id, "--output", "json"]
    if payload_path is not None:
        args += ["--input", str(payload_path)]
    return command(args)


def settled(request_id, initial):
    result = initial
    for _ in range(90):
        if result.get("status") in ("committed", "error"):
            return result
        time.sleep(1)
        _, result = formal("command-status", request_id)
    raise RuntimeError("formal operation did not settle within bound")


def write_report(path, report):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(report, sort_keys=True) + "\n")
    temp.replace(path)


def local_request(request):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(15)
        client.connect("/run/monos-probe/command.sock")
        client.sendall(json.dumps(request).encode())
        client.shutdown(socket.SHUT_WR)
        chunks = []
        while True:
            data = client.recv(8192)
            if not data:
                break
            chunks.append(data)
    return json.loads(b"".join(chunks))


def forged_hints_denied(attempt):
    outcomes = []
    for hint in ({"attempt_id": attempt}, {"pid": 1}, {"scope_id": "task_" + attempt}):
        request = {"action": "retry", "request_id": "shared-open", **hint}
        response = local_request(request)
        # Run only after a successful no-hint request. An unrelated missing
        # journal entry or offline backend must not pass the negative control.
        outcomes.append("unknown field" in response.get("error", "") and not response.get("credential"))
    return all(outcomes)


def spawn_descendants(scratch):
    code = """import json,os,pathlib,time,signal,sys
signal.signal(signal.SIGTERM,signal.SIG_IGN)
if sys.argv[2]=='double':
    if os.fork(): sys.exit(0)
    os.setsid()
    if os.fork(): sys.exit(0)
path=pathlib.Path(sys.argv[1]);pid=os.getpid();proc=pathlib.Path('/proc')/str(pid)
birth=(proc/'stat').read_text().rsplit(')',1)[1].split()[19]
cgroup=next(line[3:] for line in (proc/'cgroup').read_text().splitlines() if line.startswith('0::'))
path.with_suffix('.identity.json').write_text(json.dumps({'pid':pid,'birth':birth,'boot_id':pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'cgroup':cgroup}))
while True:
    path.write_text(str(time.monotonic_ns()));time.sleep(.1)
"""
    for label, mode in (("setsid", "direct"), ("double-fork", "double")):
        subprocess.Popen([sys.executable, "-c", code, str(scratch / (label + ".sentinel")), mode],
                         start_new_session=True, stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(.5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--attempt", required=True)
    parser.add_argument("--kind", choices=("node", "planner"), required=True)
    parser.add_argument("--resource", default="fixture-repo")
    parser.add_argument("--hold", action="store_true")
    parser.add_argument("--omit-handoff", action="store_true")
    parser.add_argument("--peer-attempt", default="different-attempt")
    args = parser.parse_args()
    if not args.attempt.replace("-", "").replace("_", "").isalnum():
        raise RuntimeError("invalid attempt")
    scratch = pathlib.Path("/var/lib/monos-probe/execution") / args.attempt / "scratch"
    report_path = scratch / "probe-driver.json"
    report = {"schema_version": 1, "attempt_id": args.attempt, "kind": args.kind, "execution_uid": os.getuid(), "stage": "starting", "checks": {}}
    # A model retry must not overwrite the evidence of its first invocation.
    with report_path.open("x") as output:
        json.dump(report, output)
    help_result = subprocess.run(["/usr/local/bin/monos", "--help"], capture_output=True, text=True, timeout=10)
    report["checks"]["bundled_help"] = help_result.returncode == 0 and "command-status" in help_result.stdout
    expected_workspace = scratch.parent / "workspace"
    report["checks"]["workspace_lazy_before_open"] = not (expected_workspace / ".git").exists()
    payload = scratch / "open.json"
    payload.write_text(json.dumps({"resource_id": args.resource}))
    open_name = "open_workspace" if args.kind == "node" else "inspect_repository"
    code, result = formal(open_name, "shared-open", payload)
    if code or result.get("status") == "error":
        raise RuntimeError("formal workspace admission failed")
    result = settled("shared-open", result)
    if result.get("status") != "committed":
        raise RuntimeError("formal workspace materialization failed")
    path = pathlib.Path(result["result"]["path"])
    expected = expected_workspace if args.kind == "node" else pathlib.Path("/var/lib/monos-probe/inspection") / args.attempt
    if path != expected:
        raise RuntimeError("unexpected workspace path")
    report["checks"]["workspace_command"] = True
    report["checks"]["forged_hints_denied"] = forged_hints_denied(args.peer_attempt)
    environment = dict(os.environ, MONOS_ATTEMPT_ID=args.peer_attempt, MONOS_SCOPE_ID="task_" + args.peer_attempt, MONOS_PID="1")
    hint_code, hint_result = command(["/usr/local/bin/monos", "command-status", "--request-id", "shared-open", "--output", "json"], env=environment)
    report["checks"]["forged_environment_keeps_own_result"] = hint_code == 0 and hint_result.get("status") == "committed" and hint_result.get("result", {}).get("path") == str(path)
    payload.write_text(json.dumps({"resource_id": "changed-input-resource"}))
    retry_code, retry = formal("retry", "shared-open")
    report["checks"]["retry_ignores_changed_file"] = retry_code == 0 and retry.get("result", {}).get("path") == str(path)
    conflict_code, conflict = formal(open_name, "shared-open", payload)
    report["checks"]["same_id_changed_payload_conflicts"] = conflict_code != 0 and "payload_conflict" in conflict.get("error", {}).get("message", "")
    if args.kind == "node":
        (path / "probe-result.txt").write_text("monos real OpenCode boundary probe\n")
        commit = subprocess.run(["/usr/bin/git", "-C", str(path), "-c", "user.name=monos probe", "-c", "user.email=probe@monos.invalid", "-c", "core.hooksPath=/dev/null", "add", "probe-result.txt"], capture_output=True, timeout=20)
        if commit.returncode:
            raise RuntimeError("Node git add failed")
        commit = subprocess.run(["/usr/bin/git", "-C", str(path), "-c", "user.name=monos probe", "-c", "user.email=probe@monos.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-m", "Real CLI private probe change"], capture_output=True, timeout=20)
        report["checks"]["native_git_commit"] = commit.returncode == 0
        tree = subprocess.run(["/usr/bin/git", "-C", str(path), "rev-parse", "HEAD^{tree}"], capture_output=True, text=True, timeout=10)
        if tree.returncode:
            raise RuntimeError("Node Git tree inspection failed")
        report["expected_git_tree"] = tree.stdout.strip()
        common = subprocess.run(["/usr/bin/git", "-C", str(path), "rev-parse", "--git-common-dir"], capture_output=True, text=True, timeout=10)
        report["checks"]["separate_worktree_common"] = common.returncode == 0 and pathlib.Path(common.stdout.strip()) == scratch.parent / "common"
        spawn_descendants(scratch)
    else:
        report["checks"]["snapshot_readable"] = (path / ".git" / "HEAD").read_text().strip() != ""
        denied = False
        try:
            (path / "forbidden-planner-write.txt").write_text("must not happen")
        except PermissionError:
            denied = True
        report["checks"]["snapshot_shell_write_denied"] = denied
        mode = path.stat().st_mode & 0o777
        chmod_denied = False
        try:
            path.chmod(0o777)
        except PermissionError:
            chmod_denied = True
        else:
            path.chmod(mode)
        report["checks"]["snapshot_chmod_denied"] = chmod_denied
        renamed = path.with_name(path.name + "-probe-rename")
        if renamed.exists():
            raise RuntimeError("snapshot rename negative-control collision")
        rename_denied = False
        try:
            path.rename(renamed)
        except PermissionError:
            rename_denied = True
        else:
            renamed.rename(path)
        report["checks"]["snapshot_root_rename_denied"] = rename_denied
        positive = scratch / "planner-scratch-positive.txt"
        positive.write_text("normal shell is writable here")
        report["checks"]["normal_shell_write"] = positive.read_text() == "normal shell is writable here"
    if args.omit_handoff:
        if args.kind != "node":
            raise RuntimeError("missing-handoff probe requires a Node")
        report["stage"] = "no_formal_handoff"
        write_report(report_path, report)
        return
    long_value = "x" * 160000
    payload = scratch / "handoff.json"
    handoff = {"summary": long_value} if args.kind == "node" else {"reply": long_value, "source_watermark": 1, "routing": {"kind": "reply_only"}}
    payload.write_text(json.dumps(handoff))
    handoff_name = "complete_node" if args.kind == "node" else "commit_task_turn"
    # Retain the long envelope without sending HTTPS yet. The credential in
    # this private socket reply is discarded, never written into evidence.
    prepared = local_request({"action": "prepare", "name": handoff_name, "request_id": "probe-handoff", "payload": handoff})
    retained = json.loads(prepared.get("envelope_json", "{}"))
    report["checks"]["long_payload_retained_before_send"] = not prepared.get("error") and retained.get("payload") == handoff
    del prepared, retained
    changed = {**handoff, "summary" if args.kind == "node" else "reply": "changed-after-retention"}
    payload.write_text(json.dumps(changed))
    conflict_code, conflict = formal(handoff_name, "probe-handoff", payload)
    report["checks"]["long_payload_changed_content_conflicts"] = conflict_code != 0 and "payload_conflict" in conflict.get("error", {}).get("message", "")
    report["stage"] = "ready_for_handoff"
    report["hold_expires_at"] = time.time() + 300 if args.hold else None
    write_report(report_path, report)
    if args.hold:
        deadline = time.monotonic() + 300
        while not (scratch / "probe-release").exists():
            if time.monotonic() > deadline:
                raise RuntimeError("explicit probe hold expired")
            time.sleep(.5)
    report["stage"] = "handoff_submitting"
    report["handoff_request_id"] = "probe-handoff"
    report["handoff_value_length"] = len(long_value)
    write_report(report_path, report)
    # Admitted completion can kill this process before the response. Root-side
    # receipt and cgroup evidence, not this return code, establishes success.
    deadline = time.monotonic() + 90
    retries = 0
    while True:
        code, result = formal("retry", "probe-handoff")
        if code == 0:
            break
        error = result.get("error") if isinstance(result.get("error"), dict) else {}
        if error.get("code") != "control_unavailable" or time.monotonic() >= deadline:
            break
        retries += 1
        time.sleep(1)
    if code != 0:
        report["stage"] = "handoff_rejected"
        error = result.get("error") if isinstance(result.get("error"), dict) else {}
        report["handoff_error_code"] = error.get("code", "unknown")
        report["handoff_error_message"] = str(error.get("message", "unknown"))[:240]
        report["handoff_retries"] = retries
        write_report(report_path, report)
        raise RuntimeError("formal handoff was rejected")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Do not dump raw subprocess/provider responses or credential-bearing data.
        print(json.dumps({"probe_driver": "failed", "category": type(error).__name__, "message": str(error)[:200]}))
        sys.exit(1)
