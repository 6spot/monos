"""Local-only regression checks; never invoke Docker, systemd or the host observer."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('install_http', Path(__file__).with_name('optional-transport-install.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)

    def test_compose_delta_handles_environment_and_secret_order(self):
        old = {'services': {'server': {'image': 'old', 'environment': ['B=2', 'MONOS_TLS_KEY_FILE=key', 'A=1', 'MONOS_TLS_CERT_FILE=cert'],
                                      'secrets': [{'source': 'signing_key'}, {'source': 'tls_key'}, {'source': 'database_url'}, {'source': 'tls_cert'}]},
                            'database': {'image': 'unchanged'}}, 'secrets': {n: {'file': n} for n in ('database_url', 'signing_key', 'tls_key', 'tls_cert')}}
        original = copy.deepcopy(old)
        with patch.object(m, 'BUILD', {'image_id': 'new'}):
            after = m.http_recipe(old)
        self.assertEqual(old, original)
        reordered = copy.deepcopy(after)
        reordered['services']['server']['environment'] = ['A=1', 'B=2']
        reordered['services']['server']['secrets'].reverse()
        self.assertEqual(m.semantic(after), m.semantic(reordered))
        self.assertEqual(after['services']['database'], old['services']['database'])
        self.assertEqual(set(after['secrets']), {'database_url', 'signing_key'})
        reordered['services']['database']['image'] = 'foreign'
        self.assertNotEqual(m.semantic(after), m.semantic(reordered))

    def test_wrong_receipt_hash_never_inspects_or_mutates_host(self):
        with patch.object(m, 'read', return_value=b'{}'), patch.object(m, 'command') as call:
            with self.assertRaisesRegex(m.Stop, 'build_receipt_changed'):
                m.build_inputs(self.root / 'build.json', '0' * 64)
        call.assert_not_called()

    def test_immutable_journal_closes_connection_without_sidecars(self):
        service = self.root / 'service'
        service.mkdir()
        path = service / 'journal.sqlite'
        con = sqlite3.connect(path)
        for table in ('starts', 'requests', 'effects', 'events', 'log_offsets'):
            con.execute('CREATE TABLE ' + table + '(id INTEGER)')
        con.commit()
        con.close()
        before, closed, uris = path.read_bytes(), [], []
        original_connect = sqlite3.connect

        class TrackedConnection(sqlite3.Connection):
            def close(self):
                closed.append(True)
                return super().close()

        def connect(database, **kwargs):
            uris.append(database)
            return original_connect(database, factory=TrackedConnection, **kwargs)

        with patch.object(m, 'DATA', self.root), patch.object(m, 'read', side_effect=lambda p, *a: p.read_bytes()), patch.object(m.sqlite3, 'connect', side_effect=connect):
            self.assertEqual(sum(m.journal().values()), 0)
        self.assertEqual(closed, [True])
        self.assertTrue(uris[0].endswith('?mode=ro&immutable=1'))
        self.assertEqual(before, path.read_bytes())
        self.assertEqual(list(service.iterdir()), [path])

    def test_effect_timeout_retains_unknown_and_never_retries(self):
        saved = []
        with patch.object(m, 'WORK', self.root), patch.object(m, 'save', side_effect=lambda p, v: saved.append((str(p), v))), patch.object(m.subprocess, 'run', side_effect=subprocess.TimeoutExpired('docker', 1)) as run:
            with self.assertRaisesRegex(m.Stop, 'command_completion_unknown'):
                m.command(['docker', 'compose', 'up'], effect='server-up', timeout=1)
        self.assertEqual(run.call_count, 1)
        self.assertEqual(len(saved), 2)
        self.assertIn('intent', saved[0][0])
        self.assertEqual(saved[1][1]['outcome'], 'unknown; no automatic retry')

    def test_exclusive_evidence_refuses_overwrite(self):
        target = self.root / 'intent.json'
        m.save(target, {'original': True}, os.getuid(), os.getgid())
        before = target.read_bytes()
        with self.assertRaises(FileExistsError):
            m.save(target, {'replacement': True}, os.getuid(), os.getgid())
        self.assertEqual(target.read_bytes(), before)
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def stopped_report(self):
        return {'boot_id': 'boot', 'current_accounts': {'service_uid': 997, 'execution_uid': 1000, 'read_group_gid': 986},
                'jobs': [], 'unexpected_target_name_count': 0,
                'units': [{'unit': m.UNIT, 'main_pid': 0, 'ActiveState': 'inactive', 'SubState': 'dead', 'cgroup': {'status': 'missing'}}],
                'processes': {'selected': [], 'complete': True}, 'selected_socket_inodes': [],
                'selected_files': {'command_socket': {'status': 'missing'}},
                'unknown': [{'code': 'cgroup_missing_not_empty_proof', 'unit': m.UNIT}]}

    def test_positive_writer_saved_then_stops_without_reobserve(self):
        report = self.stopped_report()
        report['processes']['selected'] = [{'pid': 123}]
        observed = types.SimpleNamespace(UNKNOWN=[], observe=lambda: report)
        saved = []
        with patch.object(m, 'OBS', observed), patch.object(m, 'BOOT', 'boot'), patch.object(m, 'namespace', return_value=[]), patch.object(m, 'save', side_effect=lambda p, v: saved.append(v)), patch.object(m.time, 'sleep') as sleep:
            with self.assertRaisesRegex(m.Stop, 'physical_owner_present'):
                m.physical('test')
        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0]['physical']['processes']['selected'], [{'pid': 123}])
        sleep.assert_not_called()

    def test_transient_read_gap_uses_bounded_readonly_reobservation(self):
        gap = self.stopped_report()
        gap['processes']['complete'] = False
        reports = iter((gap, self.stopped_report()))
        observed = types.SimpleNamespace(UNKNOWN=[], observe=lambda: next(reports))
        saved = []
        with patch.object(m, 'OBS', observed), patch.object(m, 'BOOT', 'boot'), patch.object(m, 'namespace', return_value=[]), patch.object(m, 'save', side_effect=lambda p, v: saved.append(v)), patch.object(m.time, 'sleep'):
            result = m.physical('test')
        self.assertEqual(len(saved), 2)
        self.assertTrue(result['processes']['complete'])

    def test_unknown_compose_reply_never_stops_old_server(self):
        with patch.object(m, 'NEW', None), patch.object(m, 'UP_ATTEMPTED', True), patch.object(m, 'command', return_value=json.dumps([{'Id': m.SERVER}]).encode()) as call:
            result = m.contain()
        self.assertEqual(result['admissions'], 'unidentified')
        self.assertEqual(call.call_count, 1)
        self.assertEqual(call.call_args.args[0][:2], ['docker', 'inspect'])


if __name__ == '__main__':
    unittest.main()
