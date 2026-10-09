"""Root-owned isolated test supervisor. Native/test executables run as UID 1000."""

import ctypes
import json
import os
from pathlib import Path
import signal
import subprocess
import threading
import time


ROOT = Path("/root/monos-free-catalog-release-v2")
intent = json.loads((ROOT / "verification-intent.json").read_text())
FIXTURE = Path(intent["fixture"])
assert FIXTURE == Path("/var/lib/monos-probe/execution") / intent["attempt_id"]
assert ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0


def table():
    found = {}
    for item in Path("/proc").iterdir():
        if not item.name.isdigit():
            continue
        try:
            fields = (item / "stat").read_text().rsplit(") ", 1)[1].split()
            found[int(item.name)] = {"ppid": int(fields[1]), "group": int(fields[2]), "birth": int(fields[19]), "state": fields[0]}
        except FileNotFoundError:
            continue
    return found


def owned():
    rows = table()
    descendants = {os.getpid()}
    while True:
        added = {pid for pid, row in rows.items() if row["ppid"] in descendants}
        if added <= descendants:
            break
        descendants.update(added)
    descendants.discard(os.getpid())
    return {pid: rows[pid] for pid in descendants if pid in rows}


def drop_identity():
    os.setgroups([1000])
    os.setgid(1000)
    os.setuid(1000)


stopping = threading.Event()
observed = {}
observation_lock = threading.Lock()
signals = []
result = {"outcome": "failed", "uid": 1000, "gid": 1000, "groups": [1000], "inference_calls": 0, "attempt_id": intent["attempt_id"]}
process = None
reaper = None


def reap_adopted():
    # Do not steal subprocess.Popen's wait for the main test executable.
    for pid, row in table().items():
        if row["ppid"] == os.getpid() and (process is None or pid != process.pid):
            try:
                os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                pass


def observe_and_reap():
    while not stopping.wait(0.01):
        rows = owned()
        with observation_lock:
            observed.update(rows)
        reap_adopted()


try:
    env = {"HOME": str(FIXTURE / "scratch"), "TMPDIR": str(FIXTURE / "test-tmp"), "PATH": "/usr/local/bin:/home/linuxbrew/.linuxbrew/bin:/usr/bin:/bin", "LANG": "C.UTF-8", "USER": "me", "LOGNAME": "me", "MONOS_NATIVE_FREE_CATALOG_ATTEMPT": intent["attempt_id"]}
    with (ROOT / "adapter-linux-native.log").open("xb") as log:
        process = subprocess.Popen([str(FIXTURE / "adapter.test"), "-test.v", "-test.timeout=90s"], cwd=FIXTURE / "scratch", env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, preexec_fn=drop_identity)
        result["test_pid"] = process.pid
        result["test_identity"] = table().get(process.pid)
        reaper = threading.Thread(target=observe_and_reap)
        reaper.start()
        try:
            result["test_exit"] = process.wait(timeout=100)
        except subprocess.TimeoutExpired:
            result["failure"] = "test_supervision_deadline"
finally:
    # Cleanup is confined to birth-checked descendants of this subreaper.
    deadline = time.monotonic() + 6
    while time.monotonic() < deadline:
        rows = owned()
        if not rows:
            break
        for pid, identity in rows.items():
            fresh = table().get(pid)
            if fresh and fresh["birth"] == identity["birth"] and fresh["state"] != "Z":
                try:
                    os.kill(pid, signal.SIGKILL)
                    signals.append({"pid": pid, "birth": identity["birth"]})
                except ProcessLookupError:
                    pass
        reap_adopted()
        if process:
            process.poll()
        time.sleep(0.02)
    stopping.set()
    if reaper:
        reaper.join(timeout=1)
    remaining = owned()
    result["cleanup"] = {"process_tree_absent": not remaining, "remaining": remaining, "interventions": signals, "reaper_joined": not reaper or not reaper.is_alive()}
    with observation_lock:
        result["observed_processes"] = observed
    if result.get("test_exit") == 0 and not remaining and not signals and result["cleanup"]["reaper_joined"]:
        result["outcome"] = "pass"
    (ROOT / "verification-result.json").write_text(json.dumps(result, indent=2) + "\n")

raise SystemExit(0 if result["outcome"] == "pass" else 1)
