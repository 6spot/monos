"""Single-use, no-inference OpenCode v2 catalog observation; run as root supervisor."""

import base64
import ctypes
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import pwd
import queue
import re
import secrets
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
import urllib.parse


BINARY = "/home/linuxbrew/.linuxbrew/Cellar/opencode/2.0.20/bin/opencode"
EXPECTED_SHA = "90e905f6e9b6babd60e6bb1ad3b87e8405421cb84a64b088550620f8e9011051"
SELECTED = "opencode/longcat-2.5-preview-free"
LIMIT = 4 << 20
START = time.monotonic()
DEADLINE = START + 30
report = {"schema": 1, "host": "100.120.14.84", "model": SELECTED,
          "trial": "one_no_model_catalog_observation", "snapshots": [], "events": [],
          "requests": [], "inference_requests": 0, "result": "failed",
          "source_version": "v2.0.20", "supervisor_uid": os.getuid()}
events = queue.Queue(maxsize=512)
stopping = threading.Event()
connections = []
proc = None
root = None
scratch = None
threads = []


def elapsed():
    return round(time.monotonic() - START, 4)


def remaining():
    value = DEADLINE - time.monotonic()
    if value <= 0:
        raise RuntimeError("discovery_deadline")
    return value


def emit(kind, value=None):
    try:
        events.put_nowait((kind, value))
    except queue.Full:
        stopping.set()


def process_table():
    rows = {}
    for item in Path("/proc").iterdir():
        if not item.name.isdigit():
            continue
        try:
            fields = (item / "stat").read_text().rsplit(") ", 1)[1].split()
            rows[int(item.name)] = {"ppid": int(fields[1]), "pgid": int(fields[2]),
                                    "state": fields[0], "birth": int(fields[19])}
        except FileNotFoundError:
            continue
    return rows


def owned_processes():
    rows = process_table()
    owned = {os.getpid()}
    while True:
        added = {pid for pid, row in rows.items() if row["ppid"] in owned}
        if added <= owned:
            break
        owned.update(added)
    owned.discard(os.getpid())
    if proc:
        owned.update(pid for pid, row in rows.items() if row["pgid"] == proc.pid)
    return {pid: rows[pid] for pid in owned if pid in rows}


def stdout_reader():
    total = 0
    pending = b""
    ready = False
    try:
        while not stopping.is_set():
            chunk = os.read(proc.stdout.fileno(), 65536)
            if not chunk:
                if not stopping.is_set():
                    emit("error", "native_stdout_eof")
                return
            total += len(chunk)
            report["stdout_bytes"] = total
            if total > LIMIT:
                emit("error", "native_stdout_limit")
                return
            if not ready:
                pending += chunk
                if len(pending) > 65536:
                    emit("error", "handshake_limit")
                    return
                if b"\n" in pending:
                    line = pending.split(b"\n", 1)[0]
                    emit("ready", json.loads(line))
                    ready = True
        report["stdout_bytes"] = total
    except Exception:
        if not stopping.is_set():
            emit("error", "native_stdout_invalid")


def open_get(url, path, accept):
    parsed = urllib.parse.urlsplit(url)
    conn = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=remaining())
    connections.append(conn)
    report["requests"].append({"method": "GET", "path": path.split("?", 1)[0], "at_s": elapsed()})
    conn.request("GET", path, headers={"Authorization": authorization, "Accept": accept})
    response = conn.getresponse()
    if response.status != 200:
        raise RuntimeError("http_status_" + str(response.status))
    return conn, response


def event_reader(url):
    try:
        conn, response = open_get(url, "/api/event", "text/event-stream")
        if response.getheader("Content-Type", "").split(";", 1)[0] != "text/event-stream":
            raise RuntimeError("sse_content_type")
        total = 0
        frame = []
        while not stopping.is_set():
            line = response.readline(65537)
            if not line:
                raise RuntimeError("sse_eof")
            total += len(line)
            if total > LIMIT or len(line) > 65536:
                raise RuntimeError("sse_limit")
            if line in (b"\n", b"\r\n"):
                if frame:
                    emit("event", json.loads(b"\n".join(frame)))
                    frame = []
            elif line.startswith(b"data:"):
                frame.append(line[5:].strip())
            if sum(map(len, frame)) > 65536:
                raise RuntimeError("sse_frame_limit")
    except RuntimeError as error:
        if not stopping.is_set():
            emit("error", str(error))
    except Exception:
        if not stopping.is_set():
            emit("error", "sse_transport_or_decode_failure")


def catalog(url):
    path = "/api/model?" + urllib.parse.urlencode({"location[directory]": str(scratch)})
    conn, response = open_get(url, path, "application/json")
    declared = response.getheader("Content-Length")
    if declared and int(declared) > LIMIT:
        raise RuntimeError("catalog_limit")
    raw = response.read(LIMIT + 1)
    conn.close()
    if len(raw) > LIMIT:
        raise RuntimeError("catalog_limit")
    value = json.loads(raw)
    if value.get("location", {}).get("directory") != str(scratch):
        raise RuntimeError("catalog_location_mismatch")
    data = value.get("data")
    if not isinstance(data, list):
        raise RuntimeError("catalog_shape")
    selected = [m for m in data if isinstance(m, dict) and m.get("providerID") == "opencode"
                and m.get("id") == "longcat-2.5-preview-free"]
    snapshot = {"at_s": elapsed(), "bytes": len(raw), "entry_count": len(data),
                "location": str(scratch), "selected_count": len(selected), "selected": []}
    qualifies = len(selected) == 1
    for model in selected:
        costs = model.get("cost")
        safe_costs = []
        free = isinstance(costs, list) and bool(costs)
        if isinstance(costs, list):
            for cost in costs:
                if not isinstance(cost, dict):
                    free = False
                    continue
                cache = cost.get("cache")
                numbers = [cost.get("input"), cost.get("output")]
                numbers += [cache.get("read"), cache.get("write")] if isinstance(cache, dict) else [None, None]
                zero = all(type(n) in (int, float) and math.isfinite(n) and n == 0 for n in numbers)
                free = free and zero and set(cost) <= {"input", "output", "cache", "tier"}
                free = free and isinstance(cache, dict) and set(cache) <= {"read", "write"}
                safe_costs.append({"input": numbers[0], "output": numbers[1],
                                   "cache": {"read": numbers[2], "write": numbers[3]},
                                   "tier_present": "tier" in cost})
                safe_costs[-1] = {"input": numbers[0] if type(numbers[0]) in (int, float) else None,
                                  "output": numbers[1] if type(numbers[1]) in (int, float) else None,
                                  "cache": {"read": numbers[2] if type(numbers[2]) in (int, float) else None,
                                            "write": numbers[3] if type(numbers[3]) in (int, float) else None},
                                  "tier_present": "tier" in cost}
        tools = model.get("capabilities", {}).get("tools") is True
        active = model.get("status") == "active"
        enabled = model.get("enabled") is True
        qualifies = qualifies and free and tools and active and enabled
        snapshot["selected"].append({"providerID": "opencode", "id": "longcat-2.5-preview-free",
                                     "active": active, "enabled": enabled, "tools": tools,
                                     "cost": safe_costs, "explicit_all_tier_zero": free})
    snapshot["qualifies"] = qualifies
    report["snapshots"].append(snapshot)
    return qualifies


def deadline_signal(_signum, _frame):
    raise RuntimeError("discovery_deadline")


signal.signal(signal.SIGALRM, deadline_signal)
signal.setitimer(signal.ITIMER_REAL, remaining())
try:
    if os.getuid() != 0 or pwd.getpwnam("me").pw_uid != 1000 or pwd.getpwnam("me").pw_gid != 1000:
        raise RuntimeError("execution_identity_mismatch")
    if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
        raise RuntimeError("subreaper_unavailable")
    actual_sha = hashlib.sha256(Path(BINARY).read_bytes()).hexdigest()
    report["binary"] = {"path": BINARY, "sha256": actual_sha}
    if actual_sha != EXPECTED_SHA:
        raise RuntimeError("binary_hash_mismatch")
    root = Path(tempfile.mkdtemp(prefix="monos-opencode-free-catalog-v1-", dir="/tmp"))
    root.chmod(0o711)
    for name in ["scratch", "tmp", "data", "cache", "config", "state"]:
        path = root / name
        path.mkdir(mode=0o700)
        os.chown(path, 1000, 1000)
    scratch = root / "scratch"
    fixed = {"model": SELECTED}
    managed = {"model": SELECTED, "share": "disabled", "shell": "/bin/bash", "formatter": False,
               "snapshots": False, "update": "disable", "lsp": False,
               "agents": {"monos-probe": {"mode": "primary", "model": SELECTED,
                          "system": "No-model catalog observation. Never run a session or infer.",
                          "permissions": [{"action": "*", "resource": "*", "effect": "allow"},
                                          {"action": "edit", "resource": "*", "effect": "deny"},
                                          {"action": "question", "resource": "*", "effect": "deny"},
                                          {"action": "subagent", "resource": "*", "effect": "deny"},
                                          {"action": "skill", "resource": "*", "effect": "deny"}]},
                          "title": fixed, "summary": fixed, "compaction": fixed}}
    config = json.dumps(managed, separators=(",", ":"), sort_keys=True)
    env = {"HOME": str(scratch), "PWD": str(scratch), "USER": "me", "LOGNAME": "me",
           "PATH": "/usr/local/bin:/home/linuxbrew/.linuxbrew/bin:/usr/bin:/bin", "LANG": "C.UTF-8",
           "SHELL": "/bin/bash", "TMPDIR": str(root / "tmp"), "XDG_DATA_HOME": str(root / "data"),
           "XDG_CACHE_HOME": str(root / "cache"), "XDG_CONFIG_HOME": str(root / "config"),
           "XDG_STATE_HOME": str(root / "state"), "OPENCODE_CONFIG": "/home/me/.config/opencode/opencode.json",
           "OPENCODE_CONFIG_CONTENT": config, "OPENCODE_DISABLE_PROJECT_CONFIG": "1"}
    report["environment"] = {k: v for k, v in env.items() if k != "OPENCODE_CONFIG_CONTENT"}
    report["managed_config"] = managed
    report["managed_config_sha256"] = hashlib.sha256(config.encode()).hexdigest()
    report["execution_uid_gid"] = [1000, 1000]
    argv = [BINARY, "serve", "--stdio", "--hostname", "127.0.0.1", "--port", "0"]
    report["argv"] = argv
    (root / "intent.json").write_text(json.dumps(report))
    (root / "intent.json").chmod(0o600)
    password = secrets.token_urlsafe(32)
    env["OPENCODE_PASSWORD"] = password
    authorization = "Basic " + base64.b64encode(("opencode:" + password).encode()).decode()
    proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            env=env, cwd=scratch, start_new_session=True, user=1000, group=1000, extra_groups=[])
    report["native_pid"] = proc.pid
    report["native_identity"] = process_table().get(proc.pid)
    report["native_start_s"] = elapsed()
    threads.append(threading.Thread(target=stdout_reader, daemon=True))
    threads[-1].start()
    subscribed = False
    while True:
        if stopping.is_set():
            raise RuntimeError("event_queue_overflow")
        kind, value = events.get(timeout=remaining())
        if kind == "error":
            raise RuntimeError(value)
        if kind == "ready":
            url = value.get("url") if isinstance(value, dict) else None
            if not isinstance(url, str):
                raise RuntimeError("handshake_shape")
            endpoint = urllib.parse.urlsplit(url)
            if endpoint.scheme != "http" or endpoint.hostname != "127.0.0.1" or not endpoint.port \
                    or endpoint.username or endpoint.password or endpoint.path not in ("", "/") \
                    or endpoint.query or endpoint.fragment:
                raise RuntimeError("nonloopback_or_invalid_endpoint")
            report["endpoint"] = url
            report["handshake_s"] = elapsed()
            threads.append(threading.Thread(target=event_reader, args=(url,), daemon=True))
            threads[-1].start()
        elif kind == "event":
            event_type = value.get("type", "")
            if not isinstance(event_type, str) or not re.fullmatch(r"[a-z][a-z0-9_.-]{0,100}", event_type):
                raise RuntimeError("event_shape")
            location = value.get("location", {}).get("directory")
            report["events"].append({"type": event_type, "at_s": elapsed(),
                                     "location_matches": location == str(scratch),
                                     "location": str(scratch) if location == str(scratch) else None})
            if len(report["events"]) > 512:
                raise RuntimeError("event_count_limit")
            if event_type == "server.connected":
                if subscribed:
                    raise RuntimeError("duplicate_connected")
                subscribed = True
                if catalog(url):
                    break
            elif subscribed and event_type == "model.updated" and location == str(scratch):
                if catalog(url):
                    break
    report["result"] = "selected_snapshot_passed"
except queue.Empty:
    report["failure"] = "discovery_deadline"
except RuntimeError as error:
    report["failure"] = str(error)
except Exception as error:
    report["failure"] = "probe_" + type(error).__name__
finally:
    signal.setitimer(signal.ITIMER_REAL, 0)
    report["discovery_end_s"] = elapsed()
    stopping.set()
    for conn in connections:
        try:
            if conn.sock:
                conn.sock.shutdown(socket.SHUT_RDWR)
            conn.close()
        except Exception:
            pass
    cleanup = {"started_s": elapsed(), "mechanism": "stdin_eof_then_owned_identity_term_kill", "signals": []}
    try:
        if proc:
            proc.stdin.close()
            phases = [(None, 2), (signal.SIGTERM, 3), (signal.SIGKILL, 3)]
            for sig, duration in phases:
                until = time.monotonic() + duration
                while True:
                    proc.poll()
                    if proc.returncode is not None:
                        while True:
                            try:
                                child, _ = os.waitpid(-1, os.WNOHANG)
                                if child == 0:
                                    break
                            except ChildProcessError:
                                break
                    owned = owned_processes()
                    if not owned or time.monotonic() >= until:
                        break
                    if sig:
                        for pid, identity in owned.items():
                            fresh = process_table().get(pid)
                            if fresh and fresh["birth"] == identity["birth"]:
                                try:
                                    os.kill(pid, sig)
                                    if [pid, int(sig)] not in cleanup["signals"]:
                                        cleanup["signals"].append([pid, int(sig)])
                                except ProcessLookupError:
                                    pass
                    time.sleep(0.05)
                if not owned:
                    break
            cleanup["remaining"] = owned_processes()
            cleanup["process_tree_absent"] = not cleanup["remaining"] and proc.poll() is not None
            cleanup["native_returncode"] = proc.returncode
            if proc.stdout:
                proc.stdout.close()
        else:
            cleanup["process_tree_absent"] = True
            cleanup["native_never_launched"] = True
        if cleanup["process_tree_absent"] and root:
            shutil.rmtree(root)
            cleanup["isolated_directory_removed"] = not root.exists()
        for thread in threads:
            thread.join(timeout=0.2)
        cleanup["reader_threads_stopped"] = all(not thread.is_alive() for thread in threads)
    except Exception as error:
        cleanup["failure"] = type(error).__name__
        cleanup["process_tree_absent"] = False
    if not cleanup.get("process_tree_absent"):
        report["result"] = "cleanup_unconfirmed"
    cleanup["completed_s"] = elapsed()
    report["cleanup"] = cleanup
    print(json.dumps(report, sort_keys=True))
