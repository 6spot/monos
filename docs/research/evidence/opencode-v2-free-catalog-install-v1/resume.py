#!/usr/bin/env python3
"""Single-use continuation after verified v2 binary replacement; start only.

Original full hashes cannot establish the old contents of the two polling tables.
Their stable fields are bound to the separately reviewed post-replacement rows.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
import types

WORK = Path('/root/monos-free-catalog-resume-v1')
PRIOR = Path('/root/monos-free-catalog-install-v2')
INSTALLER = Path('/root/monos-free-catalog-install-v2.py')
INSTALLER_SHA = '71fe39ceeeb68dc8a802f1502e7b6468a83826ed4706fcb37bccd04284cd52a5'
FAILURE_SHA = '95c4ae2f516ed7aa7471557ac0ad0f6b7ebf59879bc4e47083dabd5af5f46d00'
BEFORE_SHA = 'a158013a9c2dc9519bf8d1a6d73e0fb1df8f0e0c3848adb84b419650c52a26c2'
PHYSICAL_SHA = '3935e63d343fa6d49d118afa2847fc53e9cd84cfbda943c78d8dcacd642f21a2'
POLLING = Path('/root/monos-free-catalog-post-replacement-polling.json')
POLLING_SHA = 'facee8aa789e40f5da0d0392f3f4988d35466b9889dfb01a83bfdbb1e2ff38fb'
POLLING_TABLES = {'remote_preparation_items', 'github_remote_cooldowns'}
LIMIT = 'Original polling rows were retained only as full hashes; their prior stable-field equality is not established.'


def load_installer():
    for parent in INSTALLER.parents:
        s = parent.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
            raise RuntimeError('unsafe_installer_parent')
    s = INSTALLER.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
        raise RuntimeError('unsafe_installer_source')
    with os.fdopen(os.open(INSTALLER, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as f:
        raw = f.read((128 << 20) + 1)
    if hashlib.sha256(raw).hexdigest() != INSTALLER_SHA:
        raise RuntimeError('installer_hash_changed')
    i = types.ModuleType('pinned_runner_installer')
    i.__file__ = str(INSTALLER)
    exec(compile(raw, str(INSTALLER), 'exec'), i.__dict__)
    return i


def bound_json(m, path, expected):
    raw = m.read(path)
    m.need(m.sha(raw) == expected, 'retained_input_changed')
    return json.loads(raw)


def same_history(i, m, before, after):
    for table in POLLING_TABLES:
        m.need(after['fingerprints'][table]['count'] == before['fingerprints'][table]['count'],
               'polling_inventory_changed')
    def compared(value):
        return dict(value, fingerprints={k: v for k, v in value['fingerprints'].items()
                                        if k not in POLLING_TABLES})
    i.same_business(m, compared(before), compared(after))


def stable_polling(m, value):
    m.need(set(value) == {'items', 'cooldowns'} and len(value['items']) == 2
           and len(value['cooldowns']) == 1, 'polling_reference_shape_changed')
    m.need(value['cooldowns'][0]['reason'] == 'spacing', 'provider_cooldown_reason_changed')
    stable = {}
    for key, clock, identity in (('items', 'next_poll_at', 'item_id'),
                                 ('cooldowns', 'next_request_at', 'installation_id')):
        m.need(all(clock in row and identity in row for row in value[key]), 'polling_field_missing')
        stable[key] = sorted(({k: v for k, v in row.items() if k != clock} for row in value[key]),
                             key=lambda row: row[identity])
    return stable


def polling(i, m):
    return i.sql(m, """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s';
SELECT json_build_object(
'items',(SELECT coalesce(json_agg(to_jsonb(t) ORDER BY item_id),'[]') FROM remote_preparation_items t),
'cooldowns',(SELECT coalesce(json_agg(to_jsonb(t) ORDER BY installation_id),'[]') FROM github_remote_cooldowns t));
COMMIT;""")


def resume(i, m, args, progress):
    m.need(os.geteuid() == 0 and os.uname().sysname == 'Linux', 'linux_root_required')
    m.need(args.execute and re.fullmatch('[0-9a-f]{64}', args.build_sha256)
           and args.candidate_commit == 'a93f3002ae0127098063bc08006a854af547d160',
           'explicit_exact_execution_required')
    failure = bound_json(m, PRIOR / 'failure.json', FAILURE_SHA)
    m.need(failure['outcome'] == 'failed' and failure['reason'] == 'canonical_fingerprints_changed'
           and failure['progress'] == {'claimed': True, 'replaced': list(m.BINS),
                'stop_attempted': True, 'stop_returned': True,
                'start_attempted': False, 'start_returned': False}, 'wrong_resume_boundary')
    before = bound_json(m, PRIOR / 'before.json', BEFORE_SHA)
    old_physical = bound_json(m, PRIOR / 'before-physical.json', PHYSICAL_SHA)['physical']
    reference = bound_json(m, POLLING, POLLING_SHA)
    reference_stable = stable_polling(m, reference)
    intent = json.loads(m.read(PRIOR / 'intent.json'))
    m.need(intent['helper_sha256'] == INSTALLER_SHA and intent['build_sha256'] == args.build_sha256
           and intent['candidate_commit'] == args.candidate_commit, 'original_build_binding_changed')
    build, _ = i.build(m, args)
    os.mkdir(WORK, 0o700)
    progress['claimed'] = True
    m.sync_directory(WORK.parent)
    m.save(WORK / 'intent.json', {'helper_sha256': m.sha(m.read(Path(__file__).absolute())),
           'installer_sha256': INSTALLER_SHA, 'failure_sha256': FAILURE_SHA,
           'before_sha256': BEFORE_SHA, 'polling_reference_sha256': POLLING_SHA,
           'before_physical_sha256': PHYSICAL_SHA,
           'build_sha256': args.build_sha256, 'candidate_commit': args.candidate_commit,
           'action': 'start_already_replaced_runner_once', 'evidence_limit': LIMIT,
           'automatic_retry': False, 'automatic_rollback': False})
    observer = m.read(m.OBSERVER)
    m.need(m.sha(observer) == m.OBSERVER_SHA, 'observer_hash_changed')
    m.OBS = types.ModuleType('pinned_ownership_observer')
    m.OBS.__file__ = str(m.OBSERVER)
    exec(compile(observer, str(m.OBSERVER), 'exec'), m.OBS.__dict__)
    m.BASE_DB = m.db_guard()
    dispatches = {a['id']: a['dispatch_id'] for a in before['canonical']['attempts']}

    def audit(stopped):
        current = i.canonical(m)
        same_history(i, m, before['canonical'], current)
        polled = polling(i, m)
        m.need(stable_polling(m, polled) == reference_stable, 'polling_stable_fields_changed')
        m.need(i.journal(m, stopped) == before['journal'], 'journal_history_changed')
        m.need(m.private_files() == before['private_sha256']
               and m.sha(m.read(m.CONFIG, 997, 986, 0o640)) == before['config_sha256']
               and i.digest(i.container_binding(m, i.SERVER)) == before['server_binding_sha256']
               and i.digest(m.db_guard()) == before['database_binding_sha256'],
               'preserved_inputs_changed')
        m.need(all(m.sha(m.read(dest, 0, 0, 0o755)) == build['binaries'][name]['sha256']
                   for name, dest in m.BINS.items()), 'installed_binary_mismatch')
        return current, polled

    current, polled = audit(True)
    r = current['runner']
    m.need(r['incarnation'] == r['report'] == i.INCARNATION and r['boot'] == i.BOOT
           and r['connection'] == i.CONNECTION and not r['ready'] and not r['connected'],
           'stopped_runner_state_changed')
    historical = {u['unit']: {k: u[k] for k in ('identifier', 'dispatch_id', 'invocation_id',
                   'ActiveState', 'SubState', 'exec_main_pid')}
                  for u in old_physical['units'] if u['unit'] != m.UNIT}
    i.physical(m, 'resume-stopped', dispatches, historical=historical)
    m.save(WORK / 'before.json', {'canonical': current, 'polling': polled,
                                'evidence_limit': LIMIT})
    same_history(i, m, before['canonical'], i.canonical(m))
    m.need(stable_polling(m, polling(i, m)) == reference_stable, 'polling_stable_fields_changed')
    i.physical(m, 'before-start', dispatches, historical=historical)
    progress['start_attempted'] = True
    m.command(['/usr/bin/systemctl', 'start', m.UNIT], effect='runner-start', timeout=45)
    progress['start_returned'] = True
    unit = m.OBS.show(m.UNIT)
    identity = {'pid': int(unit['MainPID']), 'invocation_id': unit['InvocationID']}
    m.need(identity['pid'] > 0 and identity['pid'] != i.OLD_IDENTITY['pid']
           and re.fullmatch('[0-9a-f]{32}', identity['invocation_id'])
           and identity['invocation_id'] != i.OLD_IDENTITY['invocation_id'], 'new_runner_identity_unknown')
    progress['new_runner'] = identity
    deadline = time.monotonic() + 60
    while True:
        after = i.canonical(m)
        same_history(i, m, before['canonical'], after)
        r = after['runner']
        m.need(r['incarnation'] in (i.INCARNATION, i.INCARNATION + 1), 'unexpected_reconnection')
        if r['incarnation'] == r['report'] == i.INCARNATION + 1 and r['ready'] and r['connected'] and r['recent']:
            break
        m.need(time.monotonic() < deadline, 'runner_readiness_timeout')
        time.sleep(0.5)
    m.need(r['boot'] == i.BOOT and r['connection'] == i.CONNECTION, 'backend_connection_changed')
    m.need(len(after['runtimes']) == 1, 'runtime_inventory_changed')
    runtime = after['runtimes'][0]
    observed = runtime['observation']
    m.need(runtime['runner'] == i.RUNNER and runtime['incarnation'] == i.INCARNATION + 1
           and observed['runtime_id'] == 'opencode' and observed['availability'] == 'detected'
           and observed['executable'] == '/home/linuxbrew/.linuxbrew/bin/opencode'
           and observed['version'] == '2.0.20', 'version_discovery_not_ready')
    _, identity = i.physical(m, 'after-start-ready', dispatches, identity, historical)
    m.need(not Path('/proc/%d' % i.OLD_IDENTITY['pid']).exists(), 'old_runner_pid_still_exists')
    final, final_polling = audit(False)
    m.need(final['runner'] == after['runner'] and final['runtimes'] == after['runtimes'],
           'readiness_changed_during_final_audit')
    m.save(WORK / 'after.json', {'canonical': final, 'polling': final_polling,
           'runner_identity': identity, 'journal': before['journal'], 'evidence_limit': LIMIT})
    return {'outcome': 'pass', 'action': 'start_already_replaced_runner_once',
            'candidate_commit': args.candidate_commit, 'build_sha256': args.build_sha256,
            'runner_after': identity, 'incarnation_before': i.INCARNATION,
            'incarnation_after': i.INCARNATION + 1, 'binaries': build['binaries'],
            'original_other_table_fingerprints_preserved': True,
            'original_tasks_attempts_counts_preserved': True,
            'polling_reference_stable_fields_preserved': True, 'journal_history_preserved': True,
            'evidence_limit': LIMIT, 'automatic_retry': False, 'automatic_rollback': False,
            'model_invocation': False, 'free_catalog_native_acceptance': 'not performed'}


def main():
    sys.dont_write_bytecode = True
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--build-sha256', required=True)
    parser.add_argument('--candidate-commit', required=True)
    args = parser.parse_args()
    progress = {'claimed': False, 'start_attempted': False, 'start_returned': False}
    m = None
    try:
        i = load_installer()
        m = i.load_primitives()
        i.WORK = m.WORK = WORK
        result = resume(i, m, args, progress)
        m.save(WORK / 'result.json', result)
    except Exception as error:
        result = {'outcome': 'failed', 'reason': str(error) if m and isinstance(error, m.Stop)
                  else type(error).__name__, 'progress': progress, 'evidence_limit': LIMIT,
                  'automatic_retry': False, 'automatic_rollback': False}
        if m and progress['claimed']:
            m.save(WORK / 'failure.json', result)
    print(json.dumps(result, sort_keys=True))
    return 0 if result['outcome'] == 'pass' else 1


if __name__ == '__main__':
    raise SystemExit(main())
