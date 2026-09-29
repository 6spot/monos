"""Evidence and real local-Git checks; not native Linux/provider acceptance."""
import copy
import hashlib
import json
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

import workspace_driver as driver
import workspace_probe as probe


def fixture(reuse=False):
    metadata = {'base_commit': 'a' * 40, 'target_branch': 'main', 'finalized_commit': 'a' * 40,
        'lease_id': 'lease-one', 'storage_id': 'storage', 'generation': 1}
    report = {'attempt_id': 'first', 'task_id': 'task', 'resource_id': 'repo',
        'workspace_id': driver.workspace_id('task', 'repo'), 'execution_uid': 1000,
        'stage': 'completion_submitting' if reuse else 'held_for_stop',
        'checks': {key: True for key in probe.COMMON_CHECKS | (probe.REUSE_CHECKS if reuse else set())},
        'fingerprint': {'head': 'b' * 40}, 'expected_checkpoint_tree': 'c' * 40,
        'open': {'result': {'workspace_metadata': metadata}}}
    state = {'attempts': [{'dispatch_id': 'dispatch', 'process_absent': True, 'process_released': True, 'mutation_allowed': False}],
        'ownership': {'pid': 10, 'birth': '1234', 'boot_id': 'boot', 'cgroup': '/system.slice/trial', 'dispatch_id': 'dispatch'},
        'live_identity': {'present': False},
        'physical': {'cgroup_populated': False, 'descendants': [{'alive': False}]}}
    stop = {'id': 'stop-one', 'kind': 'stop', 'state': 'succeeded', 'result': {
        'writer_absent': True, 'workspace_id': report['workspace_id'], 'workspace_metadata': {**metadata,
            'checkpoint': {'operation_id': 'stop-one', 'head_commit': 'b' * 40, 'tree_id': 'c' * 40, 'commit_id': 'd' * 40}}}}
    return report, state, [stop]


def native_fixture(complete=False, unavailable=False):
    report, state, _ = fixture()
    row = state['attempts'][0]
    row.update(attempt_id='first', task_id='task', started=True)
    state.update(start_count=1, legacy_count=0, driver=report,
        native_launch={'attempt_id': 'first', 'task_id': 'task', 'kind': 'node', 'node_id': 'node_task',
            'dispatch_id': 'dispatch', 'workspace_reservations': {'project_id': 'project', 'resources': [
                {'resource_id': 'repo', 'workspace_id': report['workspace_id']}]}})
    descriptor = {'task_id': 'task', 'project_id': 'project', 'resource_id': 'repo',
        'workspace_id': report['workspace_id'], 'lease_id': 'lease', 'node_id': 'node_task',
        'node_activation': 1, 'resource': {'resource_id': 'repo'}, 'open_operation_id': 'open'}
    descriptor_digest = hashlib.sha256(json.dumps(descriptor, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    operation = {'id': 'open', 'attempt_id': 'first', 'resource_id': 'repo', 'kind': 'open_workspace',
        'state': 'recovery' if unavailable else 'succeeded', 'workspace_lease_id': 'lease',
        'workspace_descriptor': descriptor, 'workspace_digest': descriptor_digest, 'result': report['open']['result']}
    report['open']['operation_id'] = 'open'
    report['duplicate'] = copy.deepcopy(report['open'])
    state['operations'] = [operation]
    state['receipts'], state['journal_requests'] = [], []
    requests = {'unavailable-open': 'open_workspace'} if unavailable else {
        'workspace-open': 'open_workspace', 'workspace-open-second': 'open_workspace'}
    if complete:
        requests['workspace-complete'] = 'complete_node'
        state['operations'].append({**copy.deepcopy(operation), 'id': 'complete', 'kind': 'complete_node'})
    for request, kind in requests.items():
        envelope = {'schema_version': 1, 'request_id': request, 'name': kind, 'scope_id': 'task',
            'payload': {'resource_id': 'repo'} if kind == 'open_workspace' else {'summary': 'Native result'}}
        digest = hashlib.sha256(json.dumps(envelope, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        common = {'request_id': request, 'digest': digest, 'digest_matches_bytes': True, 'envelope': envelope}
        state['journal_requests'].append(copy.deepcopy(common))
        state['receipts'].append({**copy.deepcopy(common), 'scope_id': 'task', 'command_name': kind,
            'schema_version': 1, 'operation_id': 'complete' if kind == 'complete_node' else 'open'})
    return state


class WorkspaceEvidenceTests(unittest.TestCase):
    def test_public_source_requires_exact_repo_commit_and_actual_tree(self):
        evidence = {'repository_id': probe.PUBLIC_REPOSITORY_ID, 'private': False,
            'full_name': probe.PUBLIC_REPOSITORY, 'commit': 'a' * 40, 'tree': 'b' * 40}
        metadata = {'repository_identity': 'github.com/' + probe.PUBLIC_REPOSITORY, 'base_commit': 'a' * 40,
            'provider_metadata': {'github': {'repository_id': str(probe.PUBLIC_REPOSITORY_ID)}}}
        local = {'tree': 'b' * 40}
        self.assertTrue(probe.public_source_checks(evidence, metadata, local))
        for field, value in [('repository_id', 123), ('private', True), ('full_name', 'other/repo'),
            ('commit', 'c' * 40), ('tree', 'c' * 40)]:
            self.assertFalse(probe.public_source_checks({**evidence, field: value}, metadata, local))
        self.assertFalse(probe.public_source_checks(evidence, metadata, {'tree': 'c' * 40}))
        self.assertFalse(probe.public_source_checks(evidence, {**metadata, 'provider_metadata': {}}, local))

    def test_public_api_is_bounded_fixed_read_only_and_never_follows_redirects(self):
        from unittest.mock import MagicMock
        repository = {'id': probe.PUBLIC_REPOSITORY_ID, 'private': False, 'full_name': probe.PUBLIC_REPOSITORY}
        values = [repository, {'sha': 'a' * 40, 'tree': {'sha': 'b' * 40}}]
        responses = []
        for value in values:
            response = MagicMock()
            response.__enter__.return_value.read.return_value = json.dumps(value).encode()
            responses.append(response)
        opener = Mock()
        opener.open.side_effect = responses
        with patch.object(probe.urllib.request, 'build_opener', return_value=opener):
            result = probe.public_repository_evidence('a' * 40)
        self.assertEqual(result['tree'], 'b' * 40)
        for index, call in enumerate(opener.open.call_args_list):
            request = call.args[0]
            self.assertEqual(request.get_method(), 'GET')
            self.assertFalse(request.has_header('Authorization'))
            self.assertEqual(request.full_url, 'https://api.github.com/repos/' + probe.PUBLIC_REPOSITORY
                + ('/git/commits/' + 'a' * 40 if index else ''))
            self.assertEqual(call.kwargs['timeout'], 15)
            responses[index].__enter__.return_value.read.assert_called_once_with(1048577)
        with self.assertRaises(RuntimeError):
            probe.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.example')

    def test_public_api_wrong_repository_oversize_and_invalid_oid_fail_closed(self):
        from unittest.mock import MagicMock
        for raw in (json.dumps({'id': 123, 'private': False, 'full_name': probe.PUBLIC_REPOSITORY}).encode(), b'x' * 1048577):
            opener, response = Mock(), MagicMock()
            response.__enter__.return_value.read.return_value = raw
            opener.open.return_value = response
            with patch.object(probe.urllib.request, 'build_opener', return_value=opener):
                with self.assertRaises(RuntimeError):
                    probe.public_repository_evidence('a' * 40)
            opener.open.assert_called_once()
        with patch.object(probe.urllib.request, 'build_opener') as build:
            with self.assertRaises(RuntimeError):
                probe.public_repository_evidence('../../another-repo')
            build.assert_not_called()

    def test_restart_requires_changed_service_and_current_reconciled_connection(self):
        before = {'process': {'InvocationID': 'a' * 32, 'MainPID': '101', 'ActiveEnterTimestampMonotonic': '123'},
            'registration': {'incarnation': 1, 'report_incarnation': 1, 'backend': 'server',
                'ready': True, 'connected': True, 'last_seen': 99}}
        after = copy.deepcopy(before)
        after['process'].update(InvocationID='b' * 32, MainPID='102', ActiveEnterTimestampMonotonic='456')
        after['registration'].update(incarnation=2, report_incarnation=2, last_seen=101)
        self.assertTrue(probe.runner_restarted(before, after, 100))
        for group, key, value in [('process', 'InvocationID', 'a' * 32), ('process', 'MainPID', '0'),
            ('process', 'ActiveEnterTimestampMonotonic', '123'), ('registration', 'incarnation', 1),
            ('registration', 'report_incarnation', 1), ('registration', 'ready', False),
            ('registration', 'connected', 1), ('registration', 'backend', 'other'), ('registration', 'last_seen', 99)]:
            changed = copy.deepcopy(after)
            changed[group][key] = value
            with self.subTest(group=group, key=key):
                self.assertFalse(probe.runner_restarted(before, changed, 100))
        self.assertFalse(probe.runner_restarted({}, after, 100))

    def test_restart_intent_failure_and_lost_reply_never_repeat_service_action(self):
        instance = probe.WorkspaceProbe.__new__(probe.WorkspaceProbe)
        instance.runner_identity = Mock(return_value={'original': True})
        instance.save, instance.call = Mock(side_effect=OSError('disk full')), Mock()
        with self.assertRaises(OSError):
            instance.restart_runner('attempt', {'pid': 10})
        instance.call.assert_not_called()
        instance.save = Mock()
        instance.call = Mock(side_effect=TimeoutError())
        with self.assertRaises(TimeoutError):
            instance.restart_runner('attempt', {'pid': 10})
        instance.call.assert_called_once_with(['systemctl', 'restart', 'monos-probe-runner.service'])
        self.assertEqual(instance.save.call_args.args[0], 'runner-restart-intent')
        self.assertEqual(instance.save.call_args.args[1]['attempt_id'], 'attempt')

    def test_admission_failure_retains_prepared_identity_without_retry(self):
        instance = probe.WorkspaceProbe.__new__(probe.WorkspaceProbe)
        instance.runner, instance.compose = 'runner', ['compose']
        instance.catalog, instance.install_workspace_driver = Mock(return_value={}), Mock()
        instance.save, instance.call = Mock(side_effect=OSError('disk full')), Mock()
        with self.assertRaises(OSError):
            instance.start_workspace('task', 'project', 'repo', 'first')
        instance.call.assert_not_called()
        instance.save = Mock()
        instance.call = Mock(side_effect=TimeoutError())
        with self.assertRaises(TimeoutError):
            instance.start_workspace('task', 'project', 'repo', 'first')
        instance.call.assert_called_once()
        self.assertEqual(instance.save.call_args.args[0], 'prepared-first')
        self.assertEqual(instance.save.call_args.args[1]['admission']['attempt_id'], 'first')

    def test_same_evidence_directory_cannot_repeat_admission(self):
        instance = probe.WorkspaceProbe.__new__(probe.WorkspaceProbe)
        instance.runner, instance.compose = 'runner', ['compose']
        instance.catalog, instance.install_workspace_driver = Mock(return_value={}), Mock()
        instance.call = Mock(return_value='{"status":"queued","attempt_id":"first"}')
        with tempfile.TemporaryDirectory() as directory:
            instance.evidence = pathlib.Path(directory)
            instance.start_workspace('task', 'project', 'repo', 'first')
            with self.assertRaises(FileExistsError):
                instance.start_workspace('task', 'project', 'repo', 'first')
        instance.call.assert_called_once()

    def test_snapshot_hashes_actual_database_and_journal_envelopes(self):
        state = native_fixture()
        with tempfile.TemporaryDirectory() as directory:
            journal = pathlib.Path(directory) / 'journal.db'
            db = sqlite3.connect(journal)
            db.executescript('CREATE TABLE requests (id TEXT,digest TEXT,envelope BLOB,attempt TEXT); CREATE TABLE starts (attempt TEXT,body TEXT);')
            receipts = []
            for row in state['receipts']:
                raw = json.dumps(row['envelope'], sort_keys=True, separators=(',', ':'))
                db.execute('INSERT INTO requests VALUES(?,?,?,?)', (row['request_id'], row['digest'], raw.encode(), 'first'))
                receipts.append({**row, 'envelope_json': raw})
            db.execute('INSERT INTO starts VALUES(?,?)', ('first', json.dumps({'dispatch': state['native_launch']})))
            db.commit()
            db.close()
            scratch = pathlib.Path(directory) / 'execution/first/scratch'
            scratch.mkdir(parents=True)
            (scratch / 'workspace-driver.json').write_text(json.dumps(state['driver']))
            instance = probe.WorkspaceProbe.__new__(probe.WorkspaceProbe)
            instance.config = {'journal': str(journal)}
            instance.query = Mock(side_effect=[state['operations'], receipts, {'start_count': 1, 'legacy_count': 0}])
            with patch.object(probe.DiscussionProbe, 'snapshot', return_value=copy.deepcopy(state)), \
                patch.object(probe, 'ROOT', pathlib.Path(directory)), patch.object(probe, 'physical_state', return_value={}):
                result = instance.workspace_snapshot('first')
            self.assertTrue(probe.receipts_bound(result, 'task'))
            self.assertTrue(all(row['digest_matches_bytes'] for row in result['journal_requests'] + result['receipts']))

    def test_incomplete_or_racing_live_observation_never_proves_absence(self):
        _, state, _ = fixture()
        for observed in ({'present': 0}, {'present': 1}, {'present': True},
            {'present': False, 'identity_changed': True}, {**state['ownership'], 'present': True, 'birth': ''},
            {**state['ownership'], 'present': True, 'pid': 99, 'birth': '999'}):
            with self.subTest(observed=observed):
                self.assertFalse(probe.settled_checks({**state, 'live_identity': observed}))
        # A complete observation of the retained PID with another birth proves
        # PID reuse, while an escaped cgroup does not prove the old process gone.
        self.assertTrue(probe.settled_checks({**state, 'live_identity': {**state['ownership'], 'present': True, 'birth': '999'}}))
        state['attempts'][0]['dispatch_id'] = 'different'
        self.assertFalse(probe.settled_checks(state))

    def test_native_open_and_completion_provenance(self):
        self.assertTrue(probe.receipts_bound(native_fixture(), 'task'))
        self.assertTrue(probe.receipts_bound(native_fixture(complete=True), 'task', complete=True))

    def test_native_envelope_digest_scope_and_operation_must_match(self):
        for group, key, bad in [('journal_requests', 'digest_matches_bytes', False),
            ('receipts', 'digest_matches_bytes', False), ('journal_requests', 'digest', 'wrong'),
            ('receipts', 'scope_id', 'other'), ('receipts', 'operation_id', 'other'),
            ('operations', 'attempt_id', 'other'), ('operations', 'resource_id', 'other'),
            ('operations', 'workspace_digest', 'wrong'), ('operations', 'state', 'recovery')]:
            state = native_fixture()
            state[group][0][key] = bad
            with self.subTest(group=group, key=key):
                self.assertFalse(probe.receipts_bound(state, 'task'))
        for key, bad in [('scope_id', 'other'), ('name', 'inspect_repository'), ('request_id', 'other'),
            ('payload', {'resource_id': 'unrelated'})]:
            state = native_fixture()
            # Even a forged matching pair of digests cannot substitute scope.
            for group in ('receipts', 'journal_requests'):
                state[group][0]['envelope'][key] = bad
            self.assertFalse(probe.receipts_bound(state, 'task'))

    def test_single_start_canonical_launch_and_unique_request_rows_required(self):
        for field, value in [('start_count', 2), ('start_count', True), ('legacy_count', 1), ('legacy_count', False)]:
            state = native_fixture()
            state[field] = value
            self.assertFalse(probe.receipts_bound(state, 'task'))
        for field in ('receipts', 'journal_requests', 'operations'):
            state = native_fixture()
            state[field].append(copy.deepcopy(state[field][0]))
            self.assertFalse(probe.receipts_bound(state, 'task'))
        for field, value in [('resource_id', 'fixture'), ('dispatch_id', 'other'), ('workspace_reservations', {})]:
            state = native_fixture()
            state['native_launch'][field] = value
            self.assertFalse(probe.receipts_bound(state, 'task'))

    def test_complete_native_request_cannot_be_missing_or_bound_to_open(self):
        state = native_fixture(complete=True)
        state['receipts'][-1]['operation_id'] = 'open'
        self.assertFalse(probe.receipts_bound(state, 'task', complete=True))
        self.assertFalse(probe.receipts_bound(native_fixture(), 'task', complete=True))

    def test_idle_audit_rejects_queue_effects_and_missing_or_boolean_counts(self):
        counts = dict.fromkeys(probe.IDLE_FIELDS, 0)
        self.assertTrue(probe.idle_checks(counts))
        for field in counts:
            for value in (1, False, None):
                self.assertFalse(probe.idle_checks({**counts, field: value}))
            missing = dict(counts)
            del missing[field]
            self.assertFalse(probe.idle_checks(missing))

    def test_failed_idle_guard_does_not_admit_or_restart(self):
        instance = probe.WorkspaceProbe.__new__(probe.WorkspaceProbe)
        instance.require_idle = Mock(side_effect=RuntimeError('busy'))
        instance.config_command, instance.call = Mock(), Mock()
        with self.assertRaises(RuntimeError):
            instance.trial('trial')
        instance.config_command.assert_not_called()
        instance.call.assert_not_called()

    def test_git_object_rejects_unvalidated_revision_before_shell(self):
        instance = probe.WorkspaceProbe.__new__(probe.WorkspaceProbe)
        instance.call = Mock(return_value='b' * 40 + '\n' + 'c' * 40 + '\n')
        for oid in (None, '', 'HEAD', '--help'):
            self.assertEqual(instance.git_object('task', 'repo', oid), {})
        instance.call.assert_not_called()
        self.assertEqual(instance.git_object('task', 'repo', 'a' * 40), {'tree': 'b' * 40, 'parents': ['c' * 40]})
        command = instance.call.call_args.args[0]
        self.assertIn('-i', command)
        self.assertIn('--no-replace-objects', command)

    def test_local_git_strips_overrides_and_cache_denial_is_specific(self):
        with patch.dict(os.environ, {'GIT_CONFIG_COUNT': '1', 'GIT_CONFIG_VALUE_0': 'secret', 'GITHUB_TOKEN': 'synthetic'}):
            environment = driver.local_git_environment()
            self.assertNotIn('GIT_CONFIG_COUNT', environment)
            self.assertNotIn('GITHUB_TOKEN', environment)
            self.assertEqual(environment['GIT_ALLOW_PROTOCOL'], 'file')
        with tempfile.TemporaryDirectory() as directory:
            cache = pathlib.Path(directory)
            self.assertFalse(driver.cache_write_denied(cache, 'unexpected-write'))
            self.assertTrue((cache / 'monos-write-denial-unexpected-write').exists())
            with patch.object(driver.os, 'open', side_effect=PermissionError()):
                self.assertTrue(driver.cache_write_denied(cache, 'denied'))
            with patch.object(driver.os, 'open', side_effect=OSError('disk full')):
                with self.assertRaises(OSError):
                    driver.cache_write_denied(cache, 'disk')

    def test_positive_driver_and_stop_evidence(self):
        report, state, operations = fixture()
        self.assertTrue(probe.driver_checks(report, 'task', 'repo', 'first', 1000))
        self.assertTrue(probe.checkpoint_checks(report, state, operations))

    def test_every_required_check_is_mandatory(self):
        for reuse in (False, True):
            report, _, _ = fixture(reuse)
            for key in list(report['checks']):
                changed = copy.deepcopy(report)
                del changed['checks'][key]
                with self.subTest(reuse=reuse, key=key):
                    self.assertFalse(probe.driver_checks(changed, 'task', 'repo', 'first', 1000, reuse))

    def test_wrong_driver_scope_stage_or_uid_fails(self):
        report, _, _ = fixture()
        for key in ('attempt_id', 'task_id', 'resource_id', 'workspace_id', 'execution_uid', 'stage'):
            changed = {**report, key: 'wrong'}
            with self.subTest(key=key):
                self.assertFalse(probe.driver_checks(changed, 'task', 'repo', 'first', 1000))

    def test_missing_or_live_physical_state_cannot_pass(self):
        _, state, _ = fixture()
        for field in ('process_absent', 'process_released', 'mutation_allowed'):
            changed = copy.deepcopy(state)
            changed['attempts'][0][field] = not changed['attempts'][0][field]
            self.assertFalse(probe.settled_checks(changed))
        for population in (None, True):
            changed = copy.deepcopy(state)
            changed['physical']['cgroup_populated'] = population
            self.assertFalse(probe.settled_checks(changed))
        changed = copy.deepcopy(state)
        changed['physical']['descendants'][0]['alive'] = True
        self.assertFalse(probe.settled_checks(changed))

    def test_checkpoint_requires_exact_original_tree_head_and_stop(self):
        report, state, operations = fixture()
        for field in ('tree_id', 'head_commit', 'operation_id', 'commit_id'):
            changed = copy.deepcopy(operations)
            changed[0]['result']['workspace_metadata']['checkpoint'][field] = ''
            with self.subTest(field=field):
                self.assertFalse(probe.checkpoint_checks(report, state, changed))

    def test_escaped_main_process_and_missing_identity_fail_settlement(self):
        _, state, _ = fixture()
        changed = copy.deepcopy(state)
        changed['live_identity'] = {**state['ownership'], 'present': True, 'cgroup': '/escaped'}
        self.assertFalse(probe.settled_checks(changed))
        for key in ('ownership', 'live_identity'):
            changed = copy.deepcopy(state)
            del changed[key]
            self.assertFalse(probe.settled_checks(changed))

    def test_checkpoint_cannot_advance_finalized_pointer_or_switch_lease(self):
        report, state, operations = fixture()
        for field in ('base_commit', 'target_branch', 'finalized_commit', 'lease_id', 'storage_id', 'generation'):
            changed = copy.deepcopy(operations)
            changed[0]['result']['workspace_metadata'][field] = 'different'
            with self.subTest(field=field):
                self.assertFalse(probe.checkpoint_checks(report, state, changed))
        self.assertFalse(probe.checkpoint_checks(report, state, operations * 2))

    def test_failed_evidence_write_prevents_admission(self):
        instance = probe.WorkspaceProbe.__new__(probe.WorkspaceProbe)
        instance.save = Mock(side_effect=OSError('disk full'))
        instance.post = Mock()
        with self.assertRaises(OSError):
            instance.exact_post('/commands', {'request_id': 'one'})
        instance.post.assert_not_called()

    def test_uncertain_post_inspects_original_receipt_without_repeat(self):
        instance = probe.WorkspaceProbe.__new__(probe.WorkspaceProbe)
        instance.save = Mock()
        instance.post = Mock(side_effect=TimeoutError())
        instance.read = Mock(return_value={'request_id': 'one', 'status': 'admitted', 'operation_id': 'op'})
        result = instance.exact_post('/commands', {'request_id': 'one'})
        self.assertEqual(result['operation_id'], 'op')
        instance.post.assert_called_once()
        instance.read.assert_called_once_with('/commands/one')

    def test_unknown_or_wrong_receipt_remains_uncertain(self):
        for result in ({'request_id': 'one', 'status': 'unknown'}, {'request_id': 'other', 'status': 'committed'}):
            instance = probe.WorkspaceProbe.__new__(probe.WorkspaceProbe)
            instance.save = Mock()
            instance.post = Mock(side_effect=TimeoutError())
            instance.read = Mock(return_value=result)
            with self.assertRaises(RuntimeError):
                instance.exact_post('/commands', {'request_id': 'one'})
            instance.post.assert_called_once()

    def test_shared_workspace_identity_fixture(self):
        path = pathlib.Path(__file__).resolve().parents[2] / 'packages/protocol/fixtures/workspace-identities.json'
        raw = json.loads(path.read_text())
        rows = raw if isinstance(raw, list) else raw['cases']
        for case in rows:
            self.assertEqual(driver.workspace_id(case['task_id'], case['resource_id']), case['workspace_id'])

    def test_initial_report_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'report.json'
            driver.save(path, {'stage': 'first'}, initial=True)
            with self.assertRaises(FileExistsError):
                driver.save(path, {'stage': 'second'}, initial=True)
            self.assertEqual(json.loads(path.read_text())['stage'], 'first')

    def test_two_observed_children_required_before_absence(self):
        _, before, _ = fixture()
        before['physical']['descendants'] = [{'name': name, 'alive': True, 'identity': {
            'pid': i + 20, 'birth': '123', 'boot_id': 'boot', 'cgroup': before['ownership']['cgroup']}}
            for i, name in enumerate(('setsid', 'double-fork'))]
        after = copy.deepcopy(before)
        for row in after['physical']['descendants']:
            row['alive'] = False
        self.assertTrue(probe.children_settled(before, after))
        for target in ('before', 'after'):
            left, right = copy.deepcopy(before), copy.deepcopy(after)
            (left if target == 'before' else right)['physical']['descendants'].pop()
            self.assertFalse(probe.children_settled(left, right))
        after['physical']['descendants'][0]['identity']['pid'] += 1
        self.assertFalse(probe.children_settled(before, after))

    def test_final_lineage_binds_commit_tree_node_and_both_leases(self):
        wid = driver.workspace_id('task', 'repo')
        result = {'workspace_id': wid, 'git_commit': 'a' * 40, 'git_tree': 'b' * 40,
            'writer_absent': True, 'workspace_metadata': {'lease_id': 'second', 'finalized_commit': 'a' * 40}}
        operation = {'id': 'complete', 'state': 'succeeded', 'result': result}
        records = {'workspaces': [{'id': wid, 'finalized_commit': 'a' * 40}],
            'leases': [{'id': 'first', 'state': 'released'}, {'id': 'second', 'state': 'released',
                'settle_operation_id': 'complete', 'attempt_id': 'attempt'}],
            'completion_rows': [{'operation_id': 'complete', 'attempt_id': 'attempt', 'result': result, 'activation': 1}]}
        check = lambda value, tree='b' * 40: probe.final_lineage(value, operation, tree, 'task', 'repo', 'attempt')
        self.assertTrue(check(records))
        self.assertFalse(check(records, 'wrong-tree'))
        for group, index, key in (('workspaces', 0, 'finalized_commit'), ('leases', 1, 'settle_operation_id'),
            ('leases', 0, 'state'), ('completion_rows', 0, 'attempt_id'), ('completion_rows', 0, 'operation_id')):
            changed = copy.deepcopy(records)
            changed[group][index][key] = 'wrong'
            with self.subTest(group=group, key=key):
                self.assertFalse(check(changed))


class ResumeAfterStopTests(unittest.TestCase):
    def prepare(self, directory):
        prefix = 'trial'
        task, project, resource, first = ('trial-' + part for part in ('task', 'project', 'repo', 'first'))
        mapping = {'task': task, 'project': project, 'repo': resource, 'first': first, 'node_task': 'node_' + task,
            driver.workspace_id('task', 'repo'): driver.workspace_id(task, resource), 'lease': 'lease-one'}
        def rename(value):
            if isinstance(value, dict):
                return {key: rename(item) for key, item in value.items()}
            if isinstance(value, list):
                return [rename(item) for item in value]
            return mapping.get(value, value) if isinstance(value, str) else value
        before = rename(native_fixture())
        before['ownership']['phase'] = 'running'
        before['live_identity'] = {**before['ownership'], 'present': True}
        before['attempts'][0].update(process_absent=False, process_released=False, mutation_allowed=True)
        before['physical'] = {'cgroup_populated': True, 'descendants': [{'name': name, 'alive': True, 'identity': {
            'pid': i + 20, 'birth': '123', 'boot_id': 'boot', 'cgroup': before['ownership']['cgroup']}}
            for i, name in enumerate(('setsid', 'double-fork'))]}
        before['driver']['hold_expires_at'] = 300
        metadata = before['driver']['open']['result']['workspace_metadata']
        metadata.update(repository_identity='github.com/' + probe.PUBLIC_REPOSITORY, target_commit='a' * 40,
            provider_metadata={'github': {'repository_id': str(probe.PUBLIC_REPOSITORY_ID)}})
        descriptor = before['operations'][0]['workspace_descriptor']
        descriptor['resource'].update(repository_identity=metadata['repository_identity'], remote_url=probe.PUBLIC_REMOTE)
        before['operations'][0]['workspace_digest'] = hashlib.sha256(json.dumps(descriptor, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        before['operations'][0]['result'] = copy.deepcopy(before['driver']['open']['result'])
        before['driver']['duplicate'] = copy.deepcopy(before['driver']['open'])
        for group in ('receipts', 'journal_requests'):
            for row in before[group]:
                row['digest'] = hashlib.sha256(json.dumps(row['envelope'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        runner = {'process': {'InvocationID': 'a' * 32, 'MainPID': '101', 'ActiveEnterTimestampMonotonic': '123'},
            'registration': {'incarnation': 1, 'report_incarnation': 1, 'backend': 'server', 'ready': True, 'connected': True, 'last_seen': 99}}
        after_runner = copy.deepcopy(runner)
        after_runner['process'].update(InvocationID='b' * 32, MainPID='102', ActiveEnterTimestampMonotonic='456')
        after_runner['registration'].update(incarnation=2, report_incarnation=2, last_seen=101)
        config = {'id': project, 'name': 'test', 'context': '', 'archived': False, 'role_ids': [], 'resources': [
            {'id': resource, 'remote_url': probe.PUBLIC_REMOTE, 'remote_preparation': 'after_acceptance'}]}
        command = {'schema_version': 1, 'request_id': first + '-stop', 'scope_id': task,
            'expected_control_version': 1, 'name': 'stop_node', 'payload': {'attempt_id': first, 'node_id': 'node_' + task, 'node_activation': 1}}
        receipt = {'schema_version': 1, 'request_id': command['request_id'], 'status': 'admitted',
            'attempt_id': first, 'node_id': 'node_' + task, 'end_reason': 'owner_stopped', 'operation_id': 'stop-one'}
        instance = probe.WorkspaceProbe.__new__(probe.WorkspaceProbe)
        instance.evidence, instance.source = pathlib.Path(directory), pathlib.Path(__file__).resolve().parents[2]
        instance.config, instance.runner = {'execution_uid': 1000}, 'runner'
        evidence = {
            'manifest': {'remote': probe.PUBLIC_REMOTE, 'harness_sha256': instance.harness_hashes()},
            'initial-idle': {'outcome': 'pass', 'checks': {'globally_idle': True}, 'counts': {key: 0 for key in probe.IDLE_FIELDS}},
            'first-open': {'outcome': 'pass', 'checks': {key: True for key in ('public_source_matches_git', 'driver', 'live_hold',
                'verified_native_identity', 'two_native_children', 'receipt_provenance')}, 'state': before,
                'public_source': {'repository_id': probe.PUBLIC_REPOSITORY_ID, 'private': False, 'full_name': probe.PUBLIC_REPOSITORY,
                    'commit': metadata['base_commit'], 'tree': 'e' * 40}, 'base_object': {'tree': 'e' * 40, 'parents': []}},
            'runner-restart-intent': {'attempt_id': first, 'ownership': before['ownership'], 'runner': runner, 'at': 100},
            'runner-restarted': {'outcome': 'pass', 'checks': {key: True for key in ('same_live_identity', 'original_open_retained', 'two_children_retained')},
                'state': copy.deepcopy(before), 'runner': after_runner},
            'prepared-' + first: {'admission': {'attempt_id': first, 'task_id': task, 'project_id': project, 'runner_id': 'runner', 'create': True}},
            'started-' + first: {'selection': {'dispatch_id': 'dispatch', 'runner_id': 'runner'}},
            'request-' + first + '-stop': {'command': command}, 'receipt-' + first + '-stop': {'receipt': receipt},
            'request-' + project + '-create': {'command': {'name': 'save_project', 'request_id': project + '-create', 'payload': config}},
            'receipt-' + project + '-create': {'receipt': {'request_id': project + '-create', 'status': 'committed', 'entity_id': project}},
            'recovery-' + first: {'failure': 'retained original failure'},
        }
        for name, value in evidence.items():
            (instance.evidence / (name + '.json')).write_text(json.dumps(value))
        stopped = copy.deepcopy(before)
        stopped['attempts'][0].update(process_absent=True, process_released=True, mutation_allowed=False)
        stopped['ownership']['phase'] = 'absent'
        stopped['live_identity'] = {'present': False}
        stopped['physical']['cgroup_populated'] = False
        for child in stopped['physical']['descendants']:
            child['alive'] = False
        checkpoint = {'operation_id': 'stop-one', 'head_commit': before['driver']['fingerprint']['head'],
            'tree_id': before['driver']['expected_checkpoint_tree'], 'commit_id': 'd' * 40}
        stopped['operations'].append({**copy.deepcopy(before['operations'][0]), 'id': 'stop-one', 'kind': 'stop', 'request_id': command['request_id'],
            'result': {'writer_absent': True, 'workspace_id': driver.workspace_id(task, resource),
                'workspace_metadata': {**metadata, 'checkpoint': checkpoint}}})
        raw = json.dumps(command, sort_keys=True, separators=(',', ':'))
        records = {'owner_receipts': [{'scope_id': task, 'request_id': command['request_id'], 'envelope_json': raw,
            'digest': hashlib.sha256(raw.encode()).hexdigest(), 'response': receipt}], 'attempts': [first],
            'leases': [{'id': metadata['lease_id'], 'state': 'released', 'workspace_id': driver.workspace_id(task, resource),
                'task_id': task, 'attempt_id': first, 'dispatch_id': 'dispatch', 'node_id': 'node_' + task, 'node_activation': 1,
                'open_operation_id': 'open', 'settle_operation_id': 'stop-one', 'generation': 1, 'checkpoint': checkpoint,
                'target_commit': metadata['target_commit']}],
            'workspaces': [{**metadata, 'id': driver.workspace_id(task, resource), 'task_id': task, 'project_id': project,
                'resource_id': resource, 'runner_id': 'runner', 'ever_materialized': True, 'resource': descriptor['resource']}]}
        instance.workspace_snapshot = Mock(return_value=stopped)
        records = copy.deepcopy(records)
        instance.query = Mock(return_value=records)
        api_receipt = copy.deepcopy(receipt)
        instance.read = Mock(side_effect=lambda path: {'projects': [config]} if path == '/v1/owner/configuration' else api_receipt)
        instance.idle_state = Mock(return_value={key: 0 for key in probe.IDLE_FIELDS})
        instance.git_object = Mock(side_effect=lambda task, resource, oid: {'tree': 'e' * 40, 'parents': []} if oid == metadata['base_commit']
            else {'tree': checkpoint['tree_id'], 'parents': [checkpoint['head_commit']]})
        instance.after_stop = Mock(return_value={'outcome': 'pass'})
        instance.restart_runner, instance.task_control, instance.start_workspace, instance.config_command, instance.call = (Mock() for _ in range(5))
        return instance, evidence, stopped, records

    def test_resume_keeps_all_old_bytes_claims_once_and_only_runs_remaining_stages(self):
        with tempfile.TemporaryDirectory() as directory:
            instance, _, _, _ = self.prepare(directory)
            old = {path.name: path.read_bytes() for path in instance.evidence.glob('*.json')}
            self.assertEqual(instance.resume_after_stop('trial'), {'outcome': 'pass'})
            instance.after_stop.assert_called_once()
            self.assertEqual(instance.after_stop.call_args.args[:5], ('trial-task', 'trial-project', 'trial-repo', 'trial-first', 'trial-second'))
            for name, raw in old.items():
                self.assertEqual((instance.evidence / name).read_bytes(), raw)
            intent = json.loads((instance.evidence / 'resume-after-stop-intent.json').read_text())
            self.assertEqual(intent['retained_sha256'], {name: hashlib.sha256(raw).hexdigest() for name, raw in old.items()})
            for method in (instance.restart_runner, instance.task_control, instance.start_workspace, instance.config_command, instance.call):
                method.assert_not_called()
            with self.assertRaises(RuntimeError):
                instance.resume_after_stop('trial')
            instance.after_stop.assert_called_once()

    def test_every_required_retained_file_is_mandatory_before_any_continuation(self):
        with tempfile.TemporaryDirectory() as directory:
            instance, evidence, _, _ = self.prepare(directory)
            for name in evidence:
                if name.startswith('recovery-'):
                    continue
                path = instance.evidence / (name + '.json')
                original = path.read_bytes()
                path.unlink()
                with self.subTest(name=name), self.assertRaises(RuntimeError):
                    instance.resume_after_stop('trial')
                path.write_bytes(original)
            instance.after_stop.assert_not_called()
            self.assertFalse((instance.evidence / 'resume-after-stop-intent.json').exists())

    def test_tampered_historical_identity_restart_and_admission_are_refused(self):
        changes = [
            ('first-open', lambda v: v['checks'].update(live_hold=1)),
            ('first-open', lambda v: v['public_source'].update(repository_id=42)),
            ('first-open', lambda v: v['state']['driver'].update(task_id='wrong')),
            ('first-open', lambda v: v['state']['physical']['descendants'].pop()),
            ('runner-restart-intent', lambda v: v.update(attempt_id='wrong')),
            ('runner-restart-intent', lambda v: v.update(at=400)),
            ('runner-restarted', lambda v: v['runner']['process'].update(InvocationID='a' * 32)),
            ('runner-restarted', lambda v: v['state']['ownership'].update(birth='5678')),
            ('prepared-trial-first', lambda v: v['admission'].update(create=False)),
            ('started-trial-first', lambda v: v['selection'].update(dispatch_id='wrong')),
            ('request-trial-first-stop', lambda v: v['command'].update(expected_control_version=2)),
            ('request-trial-first-stop', lambda v: v['command'].update(schema_version=True)),
            ('receipt-trial-first-stop', lambda v: v['receipt'].update(operation_id='replacement')),
            ('receipt-trial-first-stop', lambda v: v['receipt'].update(schema_version=True)),
            ('manifest', lambda v: v['harness_sha256'].update(**{'workspace_driver.py': '0' * 64})),
        ]
        for name, change in changes:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                instance, evidence, _, _ = self.prepare(directory)
                change(evidence[name])
                (instance.evidence / (name + '.json')).write_text(json.dumps(evidence[name]))
                with self.assertRaises(RuntimeError):
                    instance.resume_after_stop('trial')
                instance.after_stop.assert_not_called()

    def test_unsettled_changed_or_replaced_current_ownership_cannot_resume(self):
        changes = [
            lambda s, r: s['operations'][1].update(state='recovery'),
            lambda s, r: s['attempts'][0].update(process_released=False),
            lambda s, r: s['physical'].update(cgroup_populated=True),
            lambda s, r: s['physical']['descendants'][0].update(alive=True),
            lambda s, r: s['ownership'].update(pid=999),
            lambda s, r: s['operations'][1].update(id='replacement'),
            lambda s, r: s['operations'][1].update(workspace_lease_id='replacement'),
            lambda s, r: s.update(start_count=2),
            lambda s, r: r['leases'][0].update(state='held'),
            lambda s, r: r['leases'][0].update(settle_operation_id='replacement'),
            lambda s, r: r['workspaces'][0].update(storage_id='replacement'),
            lambda s, r: r['attempts'].append('trial-second'),
            lambda s, r: r['owner_receipts'][0].update(digest='0' * 64),
            lambda s, r: r['owner_receipts'].append(copy.deepcopy(r['owner_receipts'][0])),
        ]
        for index, change in enumerate(changes):
            with self.subTest(index=index), tempfile.TemporaryDirectory() as directory:
                instance, _, state, records = self.prepare(directory)
                change(state, records)
                with self.assertRaises(RuntimeError):
                    instance.resume_after_stop('trial')
                instance.after_stop.assert_not_called()
                self.assertFalse((instance.evidence / 'resume-after-stop-intent.json').exists())

    def test_lost_continuation_reply_and_failed_claim_never_repeat_side_effects(self):
        with tempfile.TemporaryDirectory() as directory:
            instance, _, _, _ = self.prepare(directory)
            instance.after_stop.side_effect = TimeoutError('uncertain continuation')
            with self.assertRaises(TimeoutError):
                instance.resume_after_stop('trial')
            with self.assertRaises(RuntimeError):
                instance.resume_after_stop('trial')
            instance.after_stop.assert_called_once()
        with tempfile.TemporaryDirectory() as directory:
            instance, _, _, _ = self.prepare(directory)
            instance.save = Mock(side_effect=OSError('disk full'))
            with self.assertRaises(OSError):
                instance.resume_after_stop('trial')
            instance.after_stop.assert_not_called()

    def test_existing_future_intent_or_changed_project_or_busy_host_refuses_resume(self):
        for name in ('request-trial-project-defaults', 'request-trial-first-continue', 'prepared-trial-second', 'final'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                instance, _, _, _ = self.prepare(directory)
                (instance.evidence / (name + '.json')).write_text('{}')
                with self.assertRaises(RuntimeError):
                    instance.resume_after_stop('trial')
                instance.workspace_snapshot.assert_not_called()
                instance.after_stop.assert_not_called()
        for changed in ('project', 'idle'):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as directory:
                instance, _, _, _ = self.prepare(directory)
                if changed == 'project':
                    original = instance.read.side_effect
                    instance.read.side_effect = lambda path: {'projects': []} if path == '/v1/owner/configuration' else original(path)
                else:
                    instance.idle_state.return_value['leases'] = 1
                with self.assertRaises(RuntimeError):
                    instance.resume_after_stop('trial')
                instance.after_stop.assert_not_called()

    def test_evidence_mutation_during_read_only_validation_is_not_claimed(self):
        with tempfile.TemporaryDirectory() as directory:
            instance, _, _, _ = self.prepare(directory)
            def changed_counts():
                path = instance.evidence / 'runner-restart-intent.json'
                path.write_text(path.read_text() + '\n')
                return {key: 0 for key in probe.IDLE_FIELDS}
            instance.idle_state.side_effect = changed_counts
            with self.assertRaisesRegex(RuntimeError, 'changed during validation'):
                instance.resume_after_stop('trial')
            instance.after_stop.assert_not_called()
            self.assertFalse((instance.evidence / 'resume-after-stop-intent.json').exists())


class LocalGitCaptureTests(unittest.TestCase):
    def test_cache_push_never_uses_remote_pushurl_or_url_rewrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            repo, cache = root / 'repo', root / 'cache.git'
            subprocess.run(['git', 'init', '-q', str(repo)], check=True, capture_output=True)
            subprocess.run(['git', 'init', '--bare', '-q', str(cache)], check=True, capture_output=True)
            driver.git(repo, 'commit', '--allow-empty', '-qm', 'initial')
            driver.git(repo, 'config', 'remote.origin.pushurl', 'https://invalid.example/repo.git')
            # The deliberately writable local cache accepts a push, so the
            # negative probe fails. No configured provider pushurl is invoked.
            self.assertFalse(driver.cache_push_denied(repo, cache, 'local'))
            self.assertEqual(driver.git(cache, 'rev-parse', 'refs/heads/monos-negative-local'), driver.git(repo, 'rev-parse', 'HEAD'))
            with self.assertRaises(RuntimeError):
                driver.cache_push_denied(repo, cache, 'local')
            driver.git(repo, 'config', 'url.https://invalid.example/.insteadOf', 'file://')
            with patch.object(driver.subprocess, 'run', wraps=subprocess.run) as run:
                with self.assertRaises(RuntimeError):
                    driver.cache_push_denied(repo, cache, 'rewrite')
                self.assertFalse(any('push' in call.args[0] for call in run.call_args_list))

    def test_checkpoint_tree_includes_dirty_tracked_and_untracked_but_keeps_index_and_ignored(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            repo, scratch = root / 'repo', root / 'scratch'
            repo.mkdir()
            scratch.mkdir()
            subprocess.run(['git', 'init', '-q', str(repo)], check=True, capture_output=True)
            (repo / driver.NAMES[0]).write_text('committed\n')
            driver.git(repo, 'add', '--', driver.NAMES[0])
            driver.git(repo, 'commit', '-qm', 'initial')
            (repo / driver.NAMES[0]).write_text('dirty\n')
            (repo / driver.NAMES[1]).write_text('staged\n')
            driver.git(repo, 'add', '--', driver.NAMES[1])
            (repo / driver.NAMES[1]).write_text('unstaged\n')
            (repo / driver.NAMES[2]).write_text('untracked\n')
            (repo / '.git/info/exclude').write_text('/' + driver.NAMES[3] + '\n')
            (repo / driver.NAMES[3]).write_text('private ignored\n')
            before = driver.fingerprint(repo)
            tree = driver.capture_tree(repo, scratch)
            self.assertEqual(driver.fingerprint(repo), before)
            paths = driver.git(repo, 'ls-tree', '--name-only', tree).decode().splitlines()
            self.assertEqual(set(paths), set(driver.NAMES[:3]))
            self.assertEqual(driver.git(repo, 'show', tree + ':' + driver.NAMES[1]), b'unstaged\n')
            self.assertTrue((repo / driver.NAMES[3]).exists())
            with self.assertRaises(RuntimeError):
                driver.capture_tree(repo, scratch)


if __name__ == '__main__':
    unittest.main()
