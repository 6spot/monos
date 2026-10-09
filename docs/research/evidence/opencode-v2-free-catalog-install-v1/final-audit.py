#!/usr/bin/env python3
"""Read-only reconciliation after the recorded single Runner start."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import types

RESUME = Path('/root/monos-free-catalog-resume.py')
RESUME_SHA = 'd6c47f9eaa07d1df930372c0dfed0c4e3e00d26baa682c96cfd7a533776f63d5'
WORK = Path('/root/monos-free-catalog-final-audit-v2')
IDENTITY = {'pid': 972670, 'invocation_id': 'ef43b5da1d5f4d4285907cb8792d6259'}
EXPECTED = {
    ('0470064c-b8ea-4e18-a4bb-b3baaa631637', 'runtime', 2): 'e1ea1e0b99fc29fdcad18b3f5c9f9199d7e47036cf1d0cdd78026de96458f0fa',
    ('d5706933-fe21-4781-a10f-4feb496bfade', 'runtime', 2): 'ade71a79e06b112bbd9dc082956368b2108a752d8f8b58fab80f97eb093c98b0',
}
PROJECTION_LIMIT = ('Original complete Attempt rows were retained as hashes only. '
                    'The recorded identity/state/ownership projection is equal; '
                    'full prior equality of other Attempt columns is not established.')


def history(i, m, before, after):
    excluded = {'remote_preparation_items', 'github_remote_cooldowns', 'attempts',
                'runtime_events', 'attempt_log_entries'}
    for table in excluded:
        added = 2 if table in {'runtime_events', 'attempt_log_entries'} else 0
        assert after['fingerprints'][table]['count'] == before['fingerprints'][table]['count'] + added
    def stable(value):
        return dict(value, fingerprints={k: v for k, v in value['fingerprints'].items() if k not in excluded})
    i.same_business(m, stable(before), stable(after))
    for table, sequence in [('runtime_events', 'sequence'), ('attempt_log_entries', 'stream_sequence')]:
        query = "BEGIN READ ONLY; SELECT json_build_object('count',count(*),'sha256',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex')) FROM public.%s t WHERE NOT (attempt_id IN ('0470064c-b8ea-4e18-a4bb-b3baaa631637','d5706933-fe21-4781-a10f-4feb496bfade') AND stream_id='runtime' AND %s=2); COMMIT;" % (table, sequence)
        assert i.sql(m, query) == before['fingerprints'][table]


def main():
    os.umask(0o077)
    raw = RESUME.read_bytes()
    assert RESUME.stat().st_uid == 0 and not RESUME.is_symlink()
    assert hashlib.sha256(raw).hexdigest() == RESUME_SHA
    r = types.ModuleType('reviewed_resume'); r.__file__ = str(RESUME)
    exec(compile(raw, str(RESUME), 'exec'), r.__dict__)
    i = r.load_installer(); m = i.load_primitives()
    before = r.bound_json(m, r.PRIOR / 'before.json', r.BEFORE_SHA)
    reference = r.bound_json(m, r.POLLING, r.POLLING_SHA)
    original_physical = json.loads(m.read(r.PRIOR / 'before-physical.json'))
    assert m.sha(m.read(r.PRIOR / 'before-physical.json')) == '3935e63d343fa6d49d118afa2847fc53e9cd84cfbda943c78d8dcacd642f21a2'
    historical = {u['unit']: {k: u[k] for k in ('identifier', 'dispatch_id', 'invocation_id', 'ActiveState', 'SubState', 'exec_main_pid')}
                  for u in original_physical['physical']['units'] if u['unit'] != m.UNIT}
    args = argparse.Namespace(build_sha256='d104602e4540b8b455433ff64af3c17b7cea4612a1a783f50cf610f8ceacd677',
                              candidate_commit='a93f3002ae0127098063bc08006a854af547d160')
    build, _ = i.build(m, args)
    WORK.mkdir(mode=0o700); i.WORK = m.WORK = WORK
    observer = m.read(m.OBSERVER); assert m.sha(observer) == m.OBSERVER_SHA
    m.OBS = types.ModuleType('reviewed_observer'); m.OBS.__file__ = str(m.OBSERVER)
    exec(compile(observer, str(m.OBSERVER), 'exec'), m.OBS.__dict__)
    m.BASE_DB = m.db_guard()
    current = i.canonical(m); history(i, m, before['canonical'], current)
    runner = current['runner']
    assert runner['incarnation'] == runner['report'] == 28
    assert runner['ready'] and runner['connected'] and runner['recent']
    assert runner['boot'] == i.BOOT and runner['connection'] == i.CONNECTION
    assert r.stable_polling(m, r.polling(i, m)) == r.stable_polling(m, reference)
    assert m.private_files() == before['private_sha256']
    assert m.sha(m.read(m.CONFIG, 997, 986, 0o640)) == before['config_sha256']
    assert i.digest(i.container_binding(m, i.SERVER)) == before['server_binding_sha256']
    assert i.digest(m.db_guard()) == before['database_binding_sha256']
    assert all(m.sha(m.read(dest, 0, 0, 0o755)) == build['binaries'][name]['sha256'] for name, dest in m.BINS.items())
    dispatches = {a['id']: a['dispatch_id'] for a in current['attempts']}
    _, identity = i.physical(m, 'final-ready', dispatches, IDENTITY, historical)
    journal = i.journal(m, False)
    assert set(journal) == set(before['journal'])
    assert all(journal[k] == before['journal'][k] for k in journal if k != 'events')
    assert journal['events']['schema_sha256'] == before['journal']['events']['schema_sha256']
    old = sqlite3.connect((r.PRIOR / 'old-journal.sqlite').as_uri() + '?mode=ro&immutable=1', uri=True)
    new = sqlite3.connect((m.DATA / 'service/journal.sqlite').as_uri() + '?mode=ro', uri=True)
    try:
        for db in (old, new):
            db.execute('PRAGMA query_only=ON'); db.execute('BEGIN')
        def events(db):
            return {tuple(row[:3]): tuple(row) for row in db.execute('SELECT attempt,stream,seq,body,acked,order_seq FROM events')}
        encoded = sorted(json.dumps([{'blob_hex': value.hex()} if isinstance(value, bytes) else value for value in row],
                                    separators=(',', ':'), ensure_ascii=True)
                         for row in old.execute('SELECT * FROM events'))
        assert i.digest(encoded) == before['journal']['events']['sha256']
        prior, final = events(old), events(new)
        assert len(prior) == 178 and len(final) == 180
        assert all(final.get(key) == row for key, row in prior.items())
        assert final.keys() - prior.keys() == EXPECTED.keys()
        backend = i.sql(m, "BEGIN READ ONLY; SELECT json_agg(to_jsonb(t)) FROM runtime_events t WHERE attempt_id IN ('0470064c-b8ea-4e18-a4bb-b3baaa631637','d5706933-fe21-4781-a10f-4feb496bfade') AND stream_id='runtime' AND sequence=2; COMMIT;")
        backend = {(x['attempt_id'], x['stream_id'], x['sequence']): x for x in backend}
        added = []
        for key, sha in EXPECTED.items():
            row = final[key]; event = json.loads(row[3])
            assert m.sha(row[3]) == sha and row[4] == 1
            assert event['kind'] == 'exited' and event['boot_id'] == i.BOOT and event['dispatch_id'] == dispatches[key[0]]
            assert key[2] == max(k[2] for k in prior if k[:2] == key[:2]) + 1
            assert row[5] == max(x[5] for x in prior.values() if x[0] == key[0]) + 1
            assert event['order_sequence'] == row[5] and backend[key]['body'] == event
            canonical = json.dumps(event, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
            assert backend[key]['digest'] == m.sha(canonical)
            added.append({'key': key, 'event': event, 'raw_sha256': sha, 'backend_digest': backend[key]['digest']})
    finally:
        old.close(); new.close()
    latest = i.canonical(m); history(i, m, before['canonical'], latest)
    assert latest['runner'] == runner and latest['runtimes'] == current['runtimes']
    assert r.stable_polling(m, r.polling(i, m)) == r.stable_polling(m, reference)
    assert i.journal(m, False) == journal
    result = {'outcome': 'pass', 'candidate_commit': args.candidate_commit, 'runner': runner,
              'identity': identity, 'binaries': build['binaries'], 'runtime': latest['runtimes'],
              'original_tables_except_polling_and_attempt_projection_preserved': True,
              'recorded_attempt_identity_state_ownership_preserved': True,
              'attempt_projection_evidence_limit': PROJECTION_LIMIT,
              'original_backend_event_rows_preserved_by_hash': 178,
              'original_local_event_rows_byte_preserved': 178, 'local_events_after': 180,
              'late_exit_events': added,
              'other_journal_tables_preserved': True, 'historical_physical_identities_preserved': True,
              'polling_stable_fields_preserved_since_reference': True, 'polling_evidence_limit': r.LIMIT,
              'private_configuration_and_containers_preserved': True, 'counts': latest['counts'],
              'model_invocation': False, 'service_actions': []}
    m.save(WORK / 'result.json', result)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
