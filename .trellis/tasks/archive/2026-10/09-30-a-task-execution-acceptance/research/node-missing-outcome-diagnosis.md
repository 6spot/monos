# First native Node Attempt: missing formal outcome

Read-only diagnosis of Attempt `374ee8e5-29f4-4e7d-b5fe-8623308521dc`, durable Node
`179a7f54-56a9-47f5-97d7-cb59b38c7b85`, Task
`7d51dfb7-3ce9-4258-bb76-b91248a60c8b`. No host change, Owner command, model trial
or product-code change was performed by this worker.

## What actually happened

All53 canonical ordered log positions are contiguous. The reconstructed stdout
and stderr match the actual retained host spool byte-for-byte by SHA256. Parsed
OpenCode output shows the Agent read `monos --help`, then repeatedly supplied a
JSON literal to `monos open_workspace --input`. `--input` accepts a filename or
`-` for stdin; CLI parsing calls `os.Open` for anything besides `-`
(`runner/cmd/monos/main.go:167`). Every attempted open therefore failed locally
with `open {…}: no such file or directory`, before a formal request was retained
or sent. `command-status` returned unknown and `retry` found no retained request.
The Agent subsequently inspected directories/configuration instead of correcting
its CLI invocation. It never opened a managed repository or implemented/tested
`duration.py`.

The final tool loop at order49 repeats this malformed invocation. Order50
(stdout sequence49) records actual provider HTTP429 `FreeUsageLimitError`, marked
retryable by OpenCode. Order51 is stderr `exit status 1`; order52 records process
exit1; order53 records verified whole-tree absence. This supports two distinct
facts: Agent CLI misuse prevented any productive work, and a provider rate/quota
error terminated the invocation without its required formal outcome. It does not
prove a control-service outage, completed code, or the provider's quota reset time.

## Canonical and physical facts

The retained source snapshot is `/tmp/monos-execution-native-v1/task-attention-1.json`,
SHA256 `0c0240f2f1f7a21c500d5cd6c5ca65d64399c58db5aba382e0e5caf2a9a032e7`.
A fresh read-only host observation confirmed Task/Node BLOCKED, control version4,
activation1, source `0be7021f-a53c-4a5c-92c4-421bdf00227f`, factual blocker
`c1af4901-72a4-41ee-b40e-4a025884e7b2` with reason `missing_formal_outcome`.
Attempt is FAILED, mutation authority false, process absent/released true.
Its systemd unit has MainPID/ControlPID0, empty ControlGroup and no kernel cgroup;
launch journal phase is absent for original PID438388/birth28331451.

There are zero native CLI journal requests, zero canonical Agent receipts,
zero Task workspace records/leases and no admitted completion. The reservation's
`worktree` and `common` directories exist but are empty; its trusted materialized
workspace manifest is absent. A succeeded Stop operation records writer absence.
This is settled failure evidence, not a successful workspace or Git result.

## Supported recovery

The actual installed UI offers **Retry work** for a factual blocker; its command
is `retry_node`, not Continue and not completion recovery. NodeControls binds the
freshly read control version, Node ID/activation, source ID and exact blocker ID.
For the observed snapshot these are version4, Node `179a7f54…`, activation1,
source `0be7021f…`, blocker `c1af4901…`. Root must use the current status if it has
changed, plus the actual browser session header and retained command identity.
No semantic answer is required for this factual blocker. There is no completion
operation to recover and no successful tool request to replay from the old Attempt.

The backend creates a fresh execution source/Attempt for the same Node after exact
Retry, resolving current Role configuration. Root's proposed explicit Role usage
clarification is therefore appropriate: JSON goes in a file or stdin with
`--input -`; it must not be passed as the filename argument. This is operational
Tool Protocol guidance, not supplied implementation. Record that Owner intervention
and freshly verify the intended free model before Retry; catalog availability alone
cannot establish that provider quota has reset. Root owns actual admission/recovery.

## Retained private evidence

Directory `/tmp/monos-execution-native-v1/node-missing-outcome-diagnosis-v1/` is0700;
all six new files are exclusive0600. Existing snapshots/evidence were preserved.

| File | SHA256 |
| --- | --- |
| `ordered-log-rows.json` | `36cd2ec170915b46861c30f3bcb02a72ccd17cdd8a6f084d4db73aa7754fb25e` |
| `stdout.raw` | `eedc995d801417994c6ad4f43d7605533b7c5d872d0ee63773c2fe4d4b340b43` |
| `stderr.raw` | `bf05a2ed1e6ff1ca52a9863bab4a8833d5068953dd57362001f6462ff43f7cfc` |
| `parsed-opencode-events.json` | `d90e8d16d46048176d48a82616667685b8574110c313822ca9539e06a1e75e80` |
| `host-read-only.json` | `19bcc6e6bdefd06fd7e1a9709d04201ba12b5ec4700dc2124efdffbfe5ef3d34` |
| `summary.json` | `dbd0025f1a22fbb892f938ddc6d4bd5017f08139559d2ef4f8def7a3ef25b1d4` |

Host observation used read-only PostgreSQL, SQLite mode=ro, systemctl show and
file reads; probe allocation bypassed constructors, and no save/admission/control
method ran. Raw logs remain private. The note describes this failed Attempt only;
no retry success, subsequent result or final acceptance is inferred.
