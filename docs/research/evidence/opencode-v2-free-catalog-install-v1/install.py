#!/usr/bin/env python3
"""Prepared, not executed: once-only Runner binary replacement for the final trial.

Requires an independently reviewed, hash-bound build receipt. This entrypoint
does not build, migrate, enroll, configure, launch a model, or replay work.
"""
import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import time
import types

WORK = Path('/root/monos-free-catalog-install-v2')
PRIOR_FAILURE = Path('/root/monos-free-catalog-install-v1/failure.json')
PRIOR_FAILURE_SHA = '697f46a8378847330ea91a02da41647185592196741e6d96cd62b7e518538de4'
RELEASE = Path('/root/monos-free-catalog-release-v2')
BUILD_RESULT = RELEASE / 'result.json'
PRIMITIVES = Path('/root/monos-optional-transport-release-v1/optional-transport-install.py')
PRIMITIVES_SHA = 'e4e29961f8fcd58ee4980140b278599f462785af855cccc078f1b29c7d190c73'
SERVER_SOURCE = 'acff7663209949929c11d7543eb6453e19cee6ea'
SERVER = 'cbb5b4213ff702cc6af5eb944bb8eeff2b0a686d3abd6d0a7e70b9b3fbf1dec7'
SERVER_IMAGE = 'sha256:17b4a92c74067892685fe2b126578a0132335d1610bf7c1f87ad66409e84b92c'
SERVER_STARTED = '2026-10-09T05:29:17.844056497Z'
OLD_RUNNER_SOURCE = 'e2cbca97d529692c61f18aa60a6c7f45981d2592'
RUNNER = 'delivery-fresh-runner-v1'
BOOT = 'eb12bbe6-c63c-4e2e-8463-82b3e780aca1'
OLD_IDENTITY = {'pid': 3469381, 'birth_ticks': 82651813,
                'invocation_id': '9448e517cbe249d1b7f61c650b988909'}
INCARNATION = 27
CONNECTION = '1fe527d9-d7ec-406a-a0ce-e600585193e2'
TASKS = {'b5fa877d-7e24-4472-a13f-9c53944157a4': ('COMPLETED', 14),
         'a53d17f3-451b-4616-82f5-559f2ef29f59': ('CANCELLED', 6)}
ATTEMPTS = {
    '0470064c-b8ea-4e18-a4bb-b3baaa631637', '18af0e33-33d1-456e-99a4-405c09a10359',
    '27cc61cc-d683-4ce8-9b0a-553044cd1a48', '5a3d1a2d-fae9-477b-8a5d-3b9ab2821e1a',
    '9d76a0e4-ec98-4bff-b3a3-8003c75d77f2', 'a19218c5-2c9c-4166-b38a-ffbb2cb61146',
    'a31478df-df17-482e-b7d9-93499443b0f0', 'af4fb360-0650-473a-ab7a-084d54f700eb',
    'c7bffec8-dc07-450f-a174-ab0e638acebc', 'd3deea6f-297d-4d6a-8b9d-cf0d04478f0b',
    'd5706933-fe21-4781-a10f-4feb496bfade', 'dc81ef63-55d3-4031-aebc-c065e9faa514',
    'f9a27671-19dc-4f0a-a320-efd52689f437',
}
OLD_BINARIES = {
    'monos': '02843de0bd084d6d622ef19cfc577efb548014bce657e981806979da4c26c2fa',
    'monos-runner': '544dc7db0faec8fea342904f66e3a729eb8db8a99a9739b5e42773cef573ae3b',
    'monos-probe-launch': '19accbb0692122a4d943e4f171e05f2a9b3efda052ea6cb68b3417d29b9b4bfe',
    'monos-probe-exec': '1b028398326a89329b3d26400077313203f053ad12e2c734d890fdb2b6464fc5',
}
# Only connection/inventory/session bookkeeping may vary. All public business,
# policy, receipt, Task/Attempt, event and operation tables are fingerprinted.
VOLATILE_TABLES = {'runners', 'runtime_installations', 'owner_sessions'}
COUNTS = {
    'held_attempts': "SELECT count(*) FROM attempts WHERE NOT process_absent OR NOT process_released OR mutation_allowed OR state NOT IN ('SUCCEEDED','FAILED','CANCELLED')",
    'leases': "SELECT count(*) FROM workspace_leases WHERE state<>'released'",
    'operations': "SELECT count(*) FROM operations WHERE state NOT IN ('succeeded','cancelled')",
    'outbox': 'SELECT count(*) FROM outbox WHERE NOT done',
    'delivery': "SELECT count(*) FROM delivery_operations WHERE state='pending' AND dispatch_active",
    'remote': "SELECT count(*) FROM remote_preparation_operations o WHERE active OR effect_owned OR (may_have_mutated AND state NOT IN ('settled','revoked')) OR state IN ('pending','started','unknown') OR (claim_id IS NOT NULL AND (state<>'settled' OR kind<>'push' OR result->>'status' IS DISTINCT FROM 'published' OR claim_expires_at IS NULL OR claim_expires_at>clock_timestamp() OR NOT EXISTS(SELECT 1 FROM remote_preparation_observations p WHERE p.operation_id=o.id AND p.kind='published'))) OR (state='settled' AND result->>'status'='reconciliation_required' AND NOT EXISTS(SELECT 1 FROM remote_preparation_observations p WHERE p.operation_id=o.id AND p.kind='published'))",
    'merge': "SELECT count(*) FROM owner_delivery_merge_operations WHERE effect_owned OR claim IS NOT NULL OR status IN ('pending','started','unknown')",
    'batch': "SELECT count(*) FROM owner_delivery_batches WHERE status NOT IN ('completed','cancelled','revoked') OR checkpoint ? 'claim'",
    'review': "SELECT count(*) FROM task_review_operations WHERE settlement_pending OR status IN ('settling','queued','running')",
    'publication_slots': 'SELECT count(*) FROM task_publication_slots',
    'todo_sources': 'SELECT count(*) FROM todo_discussion_outbox WHERE NOT done',
    'planning_sources': 'SELECT count(*) FROM task_planning_outbox WHERE NOT done',
    'node_sources': 'SELECT count(*) FROM node_execution_outbox WHERE NOT done',
    'conversation_sources': 'SELECT count(*) FROM task_conversation_outbox WHERE NOT done',
    'review_sources': 'SELECT count(*) FROM task_review_sources WHERE NOT done',
}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=True).encode()).hexdigest()


def load_primitives():
    # Verify before executing module definitions; importing it never runs install().
    for parent in PRIMITIVES.parents:
        s = parent.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
            raise RuntimeError('unsafe_primitive_parent')
    s = PRIMITIVES.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
        raise RuntimeError('unsafe_primitive_source')
    with os.fdopen(os.open(PRIMITIVES, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as f:
        raw = f.read((128 << 20) + 1)
    if hashlib.sha256(raw).hexdigest() != PRIMITIVES_SHA:
        raise RuntimeError('primitive_hash_changed')
    module = types.ModuleType('pinned_install_primitives')
    module.__file__ = str(PRIMITIVES)
    exec(compile(raw, str(PRIMITIVES), 'exec'), module.__dict__)
    module.WORK = WORK
    module.SERIAL = 0
    return module


def sql(m, text):
    return json.loads(m.command(['docker', 'exec', '-i', m.DATABASE, 'psql', '-X',
                                 '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'monos',
                                 '-d', 'monos'], text.encode(), timeout=45))


def canonical(m):
    tables = sql(m, "BEGIN READ ONLY; SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]') FROM pg_tables WHERE schemaname='public'; COMMIT;")
    m.need(set(tables) >= {'tasks', 'attempts', 'execution_policies', 'schema_migrations'},
           'canonical_schema_missing')
    m.need(all(re.fullmatch('[a-z][a-z0-9_]*', t) for t in tables), 'unsafe_table_name')
    parts = []
    for table in sorted(set(tables) - VOLATILE_TABLES):
        parts.append("SELECT '%s' name,json_build_object('count',count(*),'sha256',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex')) fact FROM public.%s t" % (table, table))
    counts = ','.join("'%s',(%s)" % pair for pair in COUNTS.items())
    token_sha = m.sha(m.read(m.CONFIG.parent / 'runner-token', 997, 986, 0o600).strip())
    query = """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s';
SELECT json_build_object(
'tables',(SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]') FROM pg_tables WHERE schemaname='public'),
'fingerprints',(SELECT json_object_agg(name,fact) FROM (%s) facts),
'counts',json_build_object(%s),
'tasks',(SELECT coalesce(json_agg(json_build_object('id',id,'state',state,'control_version',control_version) ORDER BY id),'[]') FROM tasks),
'attempts',(SELECT coalesce(json_agg(json_build_object('id',id,'dispatch_id',dispatch_id,'task_id',task_id,'state',state,'process_absent',process_absent,'process_released',process_released,'mutation_allowed',mutation_allowed) ORDER BY id),'[]') FROM attempts),
'runner_count',(SELECT count(*) FROM runners),
'runner',(SELECT json_build_object('id',id,'capacity',capacity,'incarnation',incarnation,'report',runtime_report_incarnation,'ready',ready,'connected',connected,'recent',last_seen>clock_timestamp()-interval '15 seconds','boot',boot_id,'connection',connection_instance,'credential_matches',credential_hash='%s') FROM runners WHERE id='delivery-fresh-runner-v1'),
'runtimes',(SELECT coalesce(json_agg(json_build_object('runner',runner_id,'incarnation',incarnation,'observation',observation) ORDER BY runner_id,runtime_id),'[]') FROM runtime_installations));
COMMIT;""" % (' UNION ALL '.join(parts), counts, token_sha)
    result = sql(m, query)
    m.need(result['tables'] == tables, 'schema_changed_during_snapshot')
    m.need({t['id']: (t['state'], t['control_version']) for t in result['tasks']} == TASKS
           and len(result['tasks']) == 2, 'terminal_tasks_changed')
    m.need({a['id'] for a in result['attempts']} == ATTEMPTS and len(result['attempts']) == 13,
           'attempt_inventory_changed')
    m.need(all(isinstance(a['dispatch_id'], str) and re.fullmatch('[A-Za-z0-9_-]{1,128}', a['dispatch_id'])
               for a in result['attempts'])
           and len({a['dispatch_id'] for a in result['attempts']}) == 13,
           'dispatch_inventory_changed')
    discussion = {'a31478df-df17-482e-b7d9-93499443b0f0', 'f9a27671-19dc-4f0a-a320-efd52689f437'}
    task_b = {'5a3d1a2d-fae9-477b-8a5d-3b9ab2821e1a', 'dc81ef63-55d3-4031-aebc-c065e9faa514'}
    for attempt in result['attempts']:
        expected_task = (None if attempt['id'] in discussion else
                         'a53d17f3-451b-4616-82f5-559f2ef29f59' if attempt['id'] in task_b else
                         'b5fa877d-7e24-4472-a13f-9c53944157a4')
        expected_state = 'FAILED' if attempt['id'] == 'a19218c5-2c9c-4166-b38a-ffbb2cb61146' else 'SUCCEEDED'
        m.need(attempt['task_id'] == expected_task and attempt['state'] == expected_state
               and attempt['process_absent'] is True and attempt['process_released'] is True
               and attempt['mutation_allowed'] is False, 'historical_attempt_facts_changed')
    m.need(all(type(n) is int and n == 0 for n in result['counts'].values()),
           'current_work_or_effect_ownership')
    m.need(result['runner_count'] == 1 and result['runner']['id'] == RUNNER
           and result['runner']['capacity'] == 2
           and result['runner']['credential_matches'] is True, 'runner_enrollment_changed')
    return result


def same_business(m, before, after):
    for key in ('tables', 'fingerprints', 'tasks', 'attempts', 'counts', 'runner_count'):
        m.need(after[key] == before[key], 'canonical_%s_changed' % key)


def container_binding(m, identity):
    row = m.inspect(identity)
    m.need(row['State']['Running'] and not row['State']['Paused']
           and not row['State']['Restarting'], 'container_not_running')
    result = {k: row[k] for k in ('Id', 'Image', 'Name', 'Created', 'Config',
                                 'HostConfig', 'Mounts', 'RestartCount')}
    result['started_at'] = row['State']['StartedAt']
    return result


def physical(m, label, dispatches, expected=None, historical=None):
    m.OBS.UNKNOWN.clear()
    namespace_before = m.namespace()
    report = m.OBS.observe()
    namespace_after = m.namespace()
    m.save(WORK / (label + '-physical.json'),
           {'before': namespace_before, 'physical': report, 'after': namespace_after})
    m.need(report['boot_id'] == BOOT and report['processes']['complete']
           and not report['jobs'] and report['unexpected_target_name_count'] == 0,
           'physical_observation_unknown')
    m.need(report['current_accounts'] == {'service_uid': 997, 'execution_uid': 1000,
                                        'read_group_gid': 986}, 'account_identity_changed')
    units = report['units']
    old_units = [u for u in units if u['unit'] != m.UNIT]
    m.need(set(dispatches) == ATTEMPTS and len(old_units) == 13
           and {u['identifier'] for u in old_units} == ATTEMPTS,
           'historical_unit_inventory_changed')
    historical_now = {}
    for u in old_units:
        m.need(u['kind'] == 'attempt' and u['dispatch_id'] == dispatches[u['identifier']]
               and u['unit'] == 'monos-probe-a-' + u['identifier'] + '.service'
               and u['main_pid'] == 0 and u.get('main_pid_current_identity') is None
               and u.get('exec_main_pid_current_identity') is None
               and u['ActiveState'] in ('inactive', 'failed')
               and u['cgroup']['status'] == 'missing' and u['cgroup']['two_reads_equal'],
               'historical_attempt_not_proven_absent')
        historical_now[u['unit']] = {k: u[k] for k in ('identifier', 'dispatch_id',
                                                       'invocation_id', 'ActiveState',
                                                       'SubState', 'exec_main_pid')}
    if historical is not None:
        m.need(historical_now == historical, 'historical_units_changed')
    allowed_missing = set(historical_now) | ({m.UNIT} if expected is None else set())
    m.need(all(set(w) == {'code', 'unit'} and w['code'] == 'cgroup_missing_not_empty_proof'
               and w['unit'] in allowed_missing for w in report['unknown']),
           'unexplained_physical_warning')
    runner_units = [u for u in units if u['unit'] == m.UNIT]
    m.need(len(runner_units) == 1, 'runner_unit_unknown')
    unit, processes = runner_units[0], report['processes']['selected']
    socket = report['selected_files']['command_socket']
    if expected is None:
        m.need(namespace_before == namespace_after == [] and not processes
               and not report['selected_socket_inodes'] and socket == {'status': 'missing'}
               and unit['main_pid'] == 0 and unit['ActiveState'] == 'inactive'
               and unit['SubState'] == 'dead' and (unit['cgroup']['status'] == 'missing'
                                                  or unit['cgroup'].get('empty_proven') is True),
               'stopped_runner_not_absent')
    else:
        m.need(namespace_before == namespace_after == [m.UNIT]
               and unit['ActiveState'] == 'active' and unit['SubState'] == 'running'
               and unit['main_pid'] == expected['pid']
               and unit['invocation_id'] == expected['invocation_id']
               and unit['cgroup'].get('two_reads_equal') is True and len(processes) == 1,
               'live_runner_identity_changed')
        proc = processes[0]
        m.need(proc['pid'] == expected['pid'] and proc['unit'] == m.UNIT
               and proc['birth_ticks'] > 0 and proc['uid'] == [997] * 4
               and proc['gid'] == [986] * 4
               and proc['executable']['selected_binary'] == 'monos-runner'
               and proc['executable']['installed_inode_matches']
               and not proc['executable']['deleted'], 'additional_or_wrong_live_process')
        if 'birth_ticks' in expected:
            m.need(proc['birth_ticks'] == expected['birth_ticks'], 'runner_pid_reused')
        m.need(unit['cgroup'].get('nodes') and all(all(pid == expected['pid'] for pid in n.get('pids', []))
               for n in unit['cgroup']['nodes']), 'additional_cgroup_writer')
        m.need(socket.get('socket') and not socket.get('symlink') and socket.get('uid') == 997
               and socket.get('gid') == 986 and socket.get('mode') == '0o660'
               and len(report['selected_socket_inodes']) == 1
               and report['selected_socket_inodes'][0]['listener']
               and 'selected_socket_fd' in proc['references'], 'command_socket_unknown')
        expected = dict(expected, birth_ticks=proc['birth_ticks'])
    return historical_now, expected


def journal(m, stopped):
    path = m.DATA / 'service/journal.sqlite'
    m.read(path, 997, 986, 0o600)
    sides = [Path(str(path) + x) for x in ('-wal', '-shm', '-journal')]
    if stopped:
        m.need(not any(os.path.lexists(p) for p in sides), 'stopped_journal_sidecars')
    else:
        m.need(not os.path.lexists(sides[2]), 'journal_rollback_sidecar')
        for p in sides[:2]:
            m.read(p, 997, 986, 0o600)  # Refuse to create root-owned WAL/SHM.
    facts = {}
    uri = path.as_uri() + ('?mode=ro&immutable=1' if stopped else '?mode=ro')
    with closing(sqlite3.connect(uri, uri=True)) as db:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        schema = db.execute("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
        for name, definition in schema:
            m.need(re.fullmatch('[a-z][a-z0-9_]*', name), 'unknown_journal_table')
            rows = db.execute('SELECT * FROM "' + name + '"').fetchmany(100001)
            m.need(len(rows) <= 100000, 'journal_row_bound')
            encoded = sorted(json.dumps([{'blob_hex': v.hex()} if isinstance(v, bytes) else v for v in row],
                                        separators=(',', ':'), ensure_ascii=True) for row in rows)
            facts[name] = {'count': len(rows), 'sha256': digest(encoded), 'schema_sha256': digest(definition)}
        db.rollback()
    if stopped:
        m.need(not any(os.path.lexists(p) for p in sides), 'stopped_journal_sidecars_changed')
    else:
        for p in sides[:2]:
            m.read(p, 997, 986, 0o600)
    m.need(set(facts) >= {'starts', 'requests', 'effects', 'events', 'log_offsets'},
           'journal_schema_missing')
    return facts


def build(m, args):
    raw = m.read(BUILD_RESULT)
    m.need(m.sha(raw) == args.build_sha256, 'build_receipt_changed')
    value = json.loads(raw)
    m.need(value['outcome'] == 'pass' and value['candidate_commit'] == args.candidate_commit
           and set(value['binaries']) == set(m.BINS), 'build_not_approved_candidate')
    for field, expected in (('server_source_commit', SERVER_SOURCE), ('image_id', SERVER_IMAGE)):
        m.need(field not in value or value[field] == expected, 'runner_only_build_binding_changed')
    manifest_path = Path(value['source_manifest_path'])
    m.need(manifest_path.parent == RELEASE and manifest_path.name != 'result.json',
           'source_manifest_location_changed')
    raw_manifest = m.read(manifest_path)
    m.need(m.sha(raw_manifest) == value['source_manifest_sha256'], 'source_manifest_changed')
    manifest = json.loads(raw_manifest)
    m.need(manifest['candidate_commit'] == args.candidate_commit and manifest.get('files'),
           'source_manifest_candidate_changed')
    m.need(all(not Path(p).is_absolute() and '..' not in Path(p).parts
               and re.fullmatch('[0-9a-f]{64}', h) for p, h in manifest['files'].items()),
           'invalid_source_manifest')
    binaries = {}
    for name in m.BINS:
        item = value['binaries'][name]
        m.need(Path(item['path']) == RELEASE / 'bin' / name
               and re.fullmatch('[0-9a-f]{64}', item['sha256']), 'binary_path_changed')
        binary = m.read(item['path'])
        m.need(binary[:4] == b'\x7fELF' and m.sha(binary) == item['sha256'], 'binary_build_changed')
        binaries[name] = binary
    return value, binaries


def install(m, args, progress):
    m.need(os.geteuid() == 0 and os.uname().sysname == 'Linux', 'linux_root_required')
    m.need(args.execute and re.fullmatch('[0-9a-f]{64}', args.build_sha256)
           and re.fullmatch('[0-9a-f]{40}', args.candidate_commit), 'explicit_exact_execution_required')
    m.need(m.sha(m.read(PRIOR_FAILURE)) == PRIOR_FAILURE_SHA, 'prior_failed_preflight_changed')
    os.mkdir(WORK, 0o700)  # Exists, including prior failure: never retry it.
    progress['claimed'] = True
    m.sync_directory(WORK.parent)
    m.save(WORK / 'intent.json', {'helper_sha256': m.sha(m.read(Path(__file__).absolute())),
           'build_result': str(BUILD_RESULT), 'build_sha256': args.build_sha256,
           'prior_failure': str(PRIOR_FAILURE), 'prior_failure_sha256': PRIOR_FAILURE_SHA,
           'candidate_commit': args.candidate_commit, 'component': 'runner_binaries_only',
           'server_source': SERVER_SOURCE, 'old_runner_source': OLD_RUNNER_SOURCE,
           'expected_runner': OLD_IDENTITY, 'expected_incarnation': INCARNATION,
           'automatic_retry': False, 'automatic_rollback': False})
    value, binaries = build(m, args)
    observer = m.read(m.OBSERVER)
    m.need(m.sha(observer) == m.OBSERVER_SHA, 'observer_hash_changed')
    m.OBS = types.ModuleType('pinned_ownership_observer')
    m.OBS.__file__ = str(m.OBSERVER)
    exec(compile(observer, str(m.OBSERVER), 'exec'), m.OBS.__dict__)
    m.need(Path('/proc/sys/kernel/random/boot_id').read_text().strip() == BOOT, 'host_boot_changed')
    server = container_binding(m, SERVER)
    m.need(server['Image'] == SERVER_IMAGE and server['started_at'] == SERVER_STARTED
           and server['RestartCount'] == 0, 'server_baseline_changed')
    m.BASE_DB = m.db_guard()
    private, config = m.private_files(), m.read(m.CONFIG, 997, 986, 0o640)
    before = canonical(m)
    dispatches = {a['id']: a['dispatch_id'] for a in before['attempts']}
    r = before['runner']
    m.need(r['incarnation'] == r['report'] == INCARNATION and r['connection'] == CONNECTION
           and r['boot'] == BOOT and r['ready'] and r['connected'] and r['recent'],
           'preflight_runner_changed')
    historical, _ = physical(m, 'before', dispatches, OLD_IDENTITY)
    original_journal = journal(m, False)
    for name, dest in m.BINS.items():
        raw = m.read(dest, 0, 0, 0o755)
        m.need(m.sha(raw) == OLD_BINARIES[name], 'installed_old_binary_changed')
        m.need(not os.path.lexists(dest.with_name(dest.name + '.http-install-v1')),
               'primitive_replacement_collision')
        m.save(WORK / ('old-' + name), raw, mode=0o755)
    m.save(WORK / 'before.json', {'canonical': before, 'journal': original_journal,
           'private_sha256': private, 'config_sha256': m.sha(config),
           'server_binding_sha256': digest(server), 'database_binding_sha256': digest(m.BASE_DB)})
    before_stop = canonical(m)
    same_business(m, before, before_stop)
    m.need(before_stop['runner'] == before['runner'], 'pre_stop_runner_changed')
    physical(m, 'before-stop', dispatches, OLD_IDENTITY, historical)
    m.need(build(m, args)[0] == value and m.private_files() == private
           and m.read(m.CONFIG, 997, 986, 0o640) == config
           and container_binding(m, SERVER) == server, 'pre_effect_inputs_changed')
    progress['stop_attempted'] = True
    m.command(['/usr/bin/systemctl', 'stop', m.UNIT], effect='runner-stop', timeout=45)
    progress['stop_returned'] = True
    physical(m, 'stopped', dispatches, historical=historical)
    same_business(m, before, canonical(m))
    m.need(journal(m, True) == original_journal, 'journal_changed_during_stop')
    m.save(WORK / 'old-journal.sqlite', m.read(m.DATA / 'service/journal.sqlite', 997, 986, 0o600))
    for name, dest in m.BINS.items():
        m.need(m.sha(m.read(dest, 0, 0, 0o755)) == OLD_BINARIES[name], 'binary_changed_before_replace')
    for name, dest in m.BINS.items():
        m.replace(dest, binaries[name])
        progress['replaced'].append(name)
    m.need(m.private_files() == private and m.read(m.CONFIG, 997, 986, 0o640) == config
           and container_binding(m, SERVER) == server and m.db_guard() == m.BASE_DB,
           'preserved_inputs_changed_before_start')
    same_business(m, before, canonical(m))
    physical(m, 'before-start', dispatches, historical=historical)
    progress['start_attempted'] = True
    m.command(['/usr/bin/systemctl', 'start', m.UNIT], effect='runner-start', timeout=45)
    progress['start_returned'] = True
    unit = m.OBS.show(m.UNIT)
    identity = {'pid': int(unit['MainPID']), 'invocation_id': unit['InvocationID']}
    m.need(identity['pid'] > 0 and identity['pid'] != OLD_IDENTITY['pid']
           and re.fullmatch('[0-9a-f]{32}', identity['invocation_id'])
           and identity['invocation_id'] != OLD_IDENTITY['invocation_id'], 'new_runner_identity_unknown')
    progress['new_runner'] = identity
    deadline = time.monotonic() + 60
    while True:
        after = canonical(m)
        same_business(m, before, after)
        r = after['runner']
        m.need(r['incarnation'] in (INCARNATION, INCARNATION + 1), 'unexpected_reconnection')
        if r['incarnation'] == r['report'] == INCARNATION + 1 and r['ready'] and r['connected'] and r['recent']:
            break
        m.need(time.monotonic() < deadline, 'runner_readiness_timeout')
        time.sleep(0.5)
    # Runner process identity changes; backend connection_instance does not,
    # because this procedure deliberately preserves the running backend.
    m.need(r['boot'] == BOOT and r['connection'] == CONNECTION, 'backend_connection_changed')
    m.need(len(after['runtimes']) == 1, 'runtime_inventory_changed')
    runtime = after['runtimes'][0]
    observation = runtime['observation']
    m.need(runtime['runner'] == RUNNER and runtime['incarnation'] == INCARNATION + 1
           and observation['runtime_id'] == 'opencode' and observation['availability'] == 'detected'
           and observation['executable'] == '/home/linuxbrew/.linuxbrew/bin/opencode'
           and observation['version'] == '2.0.20', 'version_discovery_not_ready')
    _, identity = physical(m, 'after-start-ready', dispatches, identity, historical)
    m.need(not Path('/proc/%d' % OLD_IDENTITY['pid']).exists(), 'old_runner_pid_still_exists')
    m.need(journal(m, False) == original_journal, 'journal_history_changed_after_start')
    m.need(container_binding(m, SERVER) == server and m.db_guard() == m.BASE_DB
           and m.private_files() == private and m.read(m.CONFIG, 997, 986, 0o640) == config,
           'preserved_inputs_changed_after_start')
    m.need(all(m.sha(m.read(dest, 0, 0, 0o755)) == value['binaries'][name]['sha256']
               for name, dest in m.BINS.items()), 'installed_binary_mismatch')
    final = canonical(m)
    same_business(m, before, final)
    m.need(final['runner'] == after['runner'] and final['runtimes'] == after['runtimes'],
           'readiness_changed_during_final_audit')
    m.save(WORK / 'after.json', {'canonical': final, 'journal': original_journal,
                               'runner_identity': identity})
    return {'outcome': 'pass', 'component': 'runner_binaries_only',
            'candidate_commit': args.candidate_commit, 'build_sha256': args.build_sha256,
            'server_source_commit': SERVER_SOURCE, 'server_image': SERVER_IMAGE,
            'server': [SERVER, SERVER_STARTED, 0], 'database': m.DATABASE, 'storage': m.STORAGE,
            'runner_before': OLD_IDENTITY, 'runner_after': identity,
            'incarnation_before': INCARNATION, 'incarnation_after': INCARNATION + 1,
            'binaries': value['binaries'], 'canonical_business_preserved': True,
            'journal_history_preserved': True, 'automatic_retry': False,
            'model_invocation': False, 'free_catalog_native_acceptance': 'not performed'}


def main():
    sys.dont_write_bytecode = True
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--build-sha256', required=True)
    parser.add_argument('--candidate-commit', required=True)
    args = parser.parse_args()
    progress = {'claimed': False, 'replaced': [], 'stop_attempted': False,
                'stop_returned': False, 'start_attempted': False, 'start_returned': False}
    m = None
    try:
        m = load_primitives()
        result = install(m, args, progress)
        m.save(WORK / 'result.json', result)
    except Exception as error:
        result = {'outcome': 'failed', 'reason': str(error) if m and isinstance(error, m.Stop)
                  else type(error).__name__, 'progress': progress, 'automatic_retry': False,
                  'automatic_rollback': False, 'canonical_release': 'not claimed'}
        if m and progress['claimed']:
            m.save(WORK / 'failure.json', result)
        # No old installer contain(): it can stop the backend. No replay or
        # rollback after uncertain effects. Root reconciles this exact intent.
    print(json.dumps(result, sort_keys=True))
    return 0 if result['outcome'] == 'pass' else 1


if __name__ == '__main__':
    raise SystemExit(main())
