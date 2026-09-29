import copy
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import pathlib
import tempfile
import unittest
from unittest.mock import Mock, patch

from capture_discussion_acceptance import (ARCHIVE_SHA, FAILED_HARNESS_SHA, INTERRUPTED, ORDERED, PREVIEW, TASK, TODOS,
    CaptureDiscussionAcceptance, historical_events, native_absent, native_semantics, passed, process_absent,
    ready, restart_checks, semantic_progress, verify_manifest)
from task_preview_probe import canonical_bytes, preview_content


class AcceptanceTests(unittest.TestCase):
    def setUp(self):
        output = patch('builtins.print')
        output.start()
        self.addCleanup(output.stop)

    def fixture(self, directory):
        probe = object.__new__(CaptureDiscussionAcceptance)
        probe.evidence = pathlib.Path(directory)
        probe.runner = 'runner'
        probe.compose = ['docker', 'compose', '-f', 'existing.yaml']
        probe.attempts = ['attempt-' + str(i) for i in range(6)]
        probe.installation = {'images': [{'ID': 'image'}], 'source_files_verified': 205,
                              'source_tar_sha256': ARCHIVE_SHA}
        probe.binary_report = {'hashes': {'monos': 'binary-hash'}}
        preview = {'todo_id': PREVIEW, 'proposal_message_id': 'proposal', 'source_message_id': 'source',
            'source_watermark': 1, 'project_context_version': 0, 'selected_project_id': PREVIEW + '-project',
            'preview': {'title': 'Exact title', 'specification': '# Exact\n\n- Finished entries.\n'}}
        preview['content_digest'] = hashlib.sha256(canonical_bytes(preview_content(preview))).hexdigest()
        task = {'task_id': TASK, 'title': preview['preview']['title'], 'todo_id': PREVIEW,
            'project_id': preview['selected_project_id'], 'specification': preview['preview']['specification'],
            'state': 'PLANNING', 'initial_specification_id': 'spec', 'specification_id': 'spec',
            'queued_attempts': 0, 'held_attempts': 0, 'open_operations': 0}
        confirmations = [{'request_id': 'confirm-' + str(i), 'confirmation_id': 'confirmation',
            'content_digest': preview['content_digest']} for i in range(2)]
        creations = [{'request_id': 'create-' + str(i), 'task_id': TASK, 'specification_id': 'spec'} for i in range(2)]
        probe.created = {'preview': preview, 'confirmations': confirmations, 'creations': creations}
        restored = {**preview, 'state': 'created', 'task': task}
        probe.complete = {'task': task, 'restored': restored}
        probe.owner_commands = {row['request_id']: {'command': {'request_id': row['request_id']},
            'receipt': row} for row in confirmations + creations}
        native = {}
        for i, attempt in enumerate(probe.attempts):
            owner = {'pid': 100 + i, 'birth': '42', 'boot_id': 'boot',
                'cgroup': '/system.slice/monos-probe-' + attempt + '.service', 'dispatch_id': 'dispatch-' + str(i)}
            native[attempt] = {'ownership': owner, 'attempts': [{'attempt_id': attempt,
                'dispatch_id': owner['dispatch_id'], 'process_released': True, 'process_absent': True,
                'mutation_allowed': False}], 'live_identity': {'present': False},
                'physical': {'cgroup_populated': False, 'descendants': []},
                'receipts': [{'request_id': 'handoff-' + str(i)}], 'events': [], 'operations': [],
                'handoffs': [], 'journal_requests': [{'request_id': 'handoff-' + str(i), 'digest_matches_bytes': True}]}
        spans = {PREVIEW: probe.attempts[:1], ORDERED: probe.attempts[1:3], INTERRUPTED: probe.attempts[3:]}
        trials = {}
        for todo, attempts in spans.items():
            trial = {'todo': {'todo_id': todo, 'archived': todo == PREVIEW},
                     'status': {'resolved_watermark': 2}, 'messages': [], 'audit': {'attempts': []}}
            for index, attempt in enumerate(attempts):
                success = todo != INTERRUPTED or index == 2
                source = todo + '-source-' + str(index)
                trial['audit']['attempts'].append({'attempt_id': attempt,
                    'source_message_id': source, 'state': 'SUCCEEDED' if success else 'CANCELLED'})
                native[attempt]['attempts'][0]['todo_id'] = todo
                if not success:
                    continue
                payload = {'source_message_id': source, 'source_watermark': index + 1,
                           'reply': 'Exact native reply for ' + source}
                if todo == PREVIEW:
                    payload['task_preview'] = preview['preview']
                trial['messages'].append({'message_id': source, 'author': 'owner', 'content': 'Retain exact input.'})
                trial['messages'].append({'message_id': attempt + '-reply', 'author': 'assistant',
                    'source_message_id': source, 'source_watermark': index + 1, 'content': payload['reply'],
                    **({'task_preview': payload['task_preview']} if 'task_preview' in payload else {})})
                request = {'request_id': 'handoff-' + attempt, 'digest': hashlib.sha256(canonical_bytes(payload)).hexdigest()}
                native[attempt]['handoffs'] = [{**request, 'scope_id': todo, 'source_message_id': source,
                    'source_watermark': index + 1, 'payload': payload}]
                native[attempt]['receipts'] = [{**request, 'scope_id': todo,
                    'command_name': 'commit_discussion_turn', 'status': 'committed'}]
                native[attempt]['journal_requests'] = [{**request, 'digest_matches_bytes': True}]
            trials[todo] = trial
        probe.prior_native = {key: copy.deepcopy(value) for key, value in native.items()
                              if key != probe.attempts[-1]}
        probe.prior_trials = copy.deepcopy(trials)
        records = {'projects': [{'id': preview['selected_project_id'], 'archived': True}],
            'task_creation_confirmations': [{'id': 'confirmation', 'request_id': 'confirm-0', 'todo_id': PREVIEW,
                'proposal_message_id': 'proposal', 'project_id': preview['selected_project_id'],
                'content': preview_content(preview), 'content_digest': preview['content_digest']}],
            'task_preview_resolutions': [{'disposition': 'created', 'todo_id': PREVIEW,
                'proposal_message_id': 'proposal', 'task_id': TASK, 'confirmation_id': 'confirmation', 'request_id': 'create-0'}],
            'tasks': [{'source_proposal_message_id': 'proposal', 'creation_confirmation_id': 'confirmation',
                'todo_id': PREVIEW, 'project_id': preview['selected_project_id'], 'resource_id': None,
                'initial_specification_id': 'spec'}],
            'specification_revisions': [{'id': 'spec', 'task_id': TASK, 'content': preview['preview']['specification'],
                'content_digest': hashlib.sha256(canonical_bytes(preview['preview']['specification'])).hexdigest()}],
            'task_preview_command_receipts': [{'request_id': key, 'response': value['receipt'],
                'digest': hashlib.sha256(canonical_bytes(value['command'])).hexdigest()}
                for key, value in probe.owner_commands.items()]}
        state = {'source': {'source_files_verified': 205, 'source_tar_sha256': ARCHIVE_SHA},
            'binaries': {'monos': 'binary-hash'}, 'semantic': {'trials': trials, 'preview': restored,
                'wrong_selector_preview': restored, 'task': task, 'records': records,
                'footprint': {'tasks': 1, 'revisions': 1, 'plans': 0, 'nodes': 0, 'attempts': 0, 'starts': 0},
                'owner_receipts': {key: value['receipt'] for key, value in probe.owner_commands.items()},
                'native': {key: native_semantics(value) for key, value in native.items()},
                'global_counts': {'tasks': 1, 'attempts': 6, 'starts': 6}},
            'native_observations': native,
            'children': [{'expected': native[key]['ownership'], 'observed': {'present': False}} for key in probe.attempts[:2]],
            'idle': {key: 0 for key in ('queued', 'unreleased', 'writable', 'unsettled', 'pending_discussion', 'unresolved_sources', 'pending_outbox')},
            'runtime': {'boot_id': 'boot', 'backend': {'id': 'container', 'image': 'image', 'started': 'old',
                'pid': 42, 'running': True, 'restart_count': 0},
                'service': {'MainPID': '12', 'ExecMainStartTimestampMonotonic': '100', 'InvocationID': 'old',
                    'ActiveState': 'active', 'SubState': 'running'},
                'runner': {'incarnation': 4, 'runtime_report_incarnation': 4, 'connected': True,
                    'ready': True, 'fresh': True, 'connection_instance': 'old'},
                'health': {'database': 'ready'}, 'session': {'authenticated': True},
                'images': [{'ID': 'image'}], 'infrastructure': {'runners': [{'runner_id': 'runner', 'online': True}]}}}
        probe.load_prior = Mock()
        probe.call = Mock()
        probe.await_restart = Mock()
        self.assertTrue(all(probe.guard(state).values()))
        return probe, copy.deepcopy(state)

    def stages(self, state):
        backend = copy.deepcopy(state)
        backend['runtime']['backend'].update(started='new', pid=43)
        backend['runtime']['runner'].update(incarnation=5, runtime_report_incarnation=5, connection_instance='new')
        runner = copy.deepcopy(backend)
        runner['runtime']['service'].update(MainPID='13', ExecMainStartTimestampMonotonic='200', InvocationID='new')
        runner['runtime']['runner'].update(incarnation=6, runtime_report_incarnation=6)
        return [copy.deepcopy(state), copy.deepcopy(state), backend, copy.deepcopy(backend), runner]

    def runtime_fixture(self, state):
        records = state['semantic']['records']
        records['attempts'], records['runtime_events'] = [], []
        for attempt, native in state['native_observations'].items():
            owner = native['ownership']
            records['attempts'].append({'id': attempt, 'dispatch_id': owner['dispatch_id'],
                'process_released': True, 'process_absent': True, 'mutation_allowed': False,
                'state': 'SUCCEEDED', 'exit_observed': False, 'log_visible_sequence': 1,
                'activity_at': '2026-09-30T01:00:00+00:00'})
            body = {'attempt_id': attempt, 'dispatch_id': owner['dispatch_id'], 'boot_id': owner['boot_id'],
                    'stream_id': 'runtime', 'sequence': 1, 'order_sequence': 1, 'kind': 'started', 'text': 'started'}
            records['runtime_events'].append(self.event_row(body))
            native['events'] = [{'stream_id': 'runtime', 'sequence': 1, 'kind': 'started', 'text_length': 7}]
            state['semantic']['native'][attempt] = native_semantics(native)
        return state

    def event_row(self, body):
        return {'attempt_id': body['attempt_id'], 'stream_id': body['stream_id'],
                'sequence': body['sequence'], 'body': body,
                'digest': hashlib.sha256(canonical_bytes(body)).hexdigest()}

    def late_exit(self, state, sampled=False):
        after = copy.deepcopy(state)
        attempt = after['semantic']['records']['attempts'][0]
        body = {'attempt_id': attempt['id'], 'dispatch_id': attempt['dispatch_id'], 'boot_id': 'boot',
            'stream_id': 'runtime', 'sequence': 2, 'order_sequence': 2, 'kind': 'exited', 'exit_code': 0,
            'text': 'runtime main process exited; formal completion is independent'}
        after['semantic']['records']['runtime_events'].append(self.event_row(body))
        attempt.update(exit_observed=True, log_visible_sequence=2, activity_at='2026-09-30T01:00:01+00:00')
        if sampled:
            native = after['native_observations'][attempt['id']]
            native['events'].append({'stream_id': 'runtime', 'sequence': 2, 'kind': 'exited', 'text_length': len(body['text'])})
            after['semantic']['native'][attempt['id']] = native_semantics(native)
        return after

    def failed_backend_fixture(self, probe, state, previous):
        # Mirrors the exact a2e118 run: the raw SQL snapshot saw a late exit;
        # the earlier native sub-snapshot did not. No Runner intent exists.
        before = self.runtime_fixture(copy.deepcopy(state))
        for attempt, prior in probe.prior_native.items():
            prior['events'] = copy.deepcopy(before['native_observations'][attempt]['events'])
        after = self.late_exit(self.stages(before)[2])
        self.assertTrue(all(probe.guard(before).values()))
        self.assertTrue(all(probe.guard(after).values()))
        prior = {'index': {}, 'manifest': {}, 'attempts': probe.attempts,
                 'owner_commands': probe.owner_commands, 'runner_binaries': probe.binary_report}
        probe.load_prior = lambda _path: probe.save('prior-evidence', prior)
        original = probe.evidence
        probe.evidence = pathlib.Path(previous)
        try:
            probe.save('claim', {'harness_sha256': FAILED_HARNESS_SHA})
            probe.save('prior-evidence', prior)
            probe.save('before', {'state': before, 'checks': probe.guard(before), 'outcome': 'pass'})
            probe.save('before-backend', {'state': before, 'checks': probe.guard(before), 'outcome': 'pass'})
            probe.save('restart-backend-intent', {'target': 'backend', 'outcome': 'intent',
                'before_checkpoint': 'before-backend',
                'before_sha256': hashlib.sha256((probe.evidence / 'before-backend.json').read_bytes()).hexdigest(),
                'semantic_sha256': hashlib.sha256(canonical_bytes(before['semantic'])).hexdigest()})
            probe.save('after-backend', {'state': after, 'checks': {**probe.guard(after),
                **restart_checks(before, after, 'backend'), 'semantic_state_unchanged': False}, 'outcome': 'fail'})
            probe.save('failure', {'stage': 'after-backend', 'outcome': 'fail', 'requires_inspection': True})
        finally:
            probe.evidence = original
        return before, after

    def test_two_ordered_restarts_preserve_exact_state(self):
        with tempfile.TemporaryDirectory() as directory:
            probe, state = self.fixture(directory)
            probe.collect = Mock(side_effect=self.stages(state))
            probe.run_acceptance('index')
            self.assertEqual(probe.call.call_args_list[0].args[0], probe.compose + ['restart', 'server'])
            self.assertEqual(probe.call.call_args_list[1].args[0], ['systemctl', 'restart', 'monos-probe-runner.service'])
            self.assertEqual(probe.call.call_count, 2)
            self.assertEqual(json.loads((probe.evidence / 'complete.json').read_text())['outcome'], 'pass')
            self.assertTrue((probe.evidence / 'restart-backend-intent.json').is_file())
            self.assertTrue((probe.evidence / 'restart-runner-intent.json').is_file())

    def test_check_only_never_mutates_services(self):
        with tempfile.TemporaryDirectory() as directory:
            probe, state = self.fixture(directory)
            probe.collect = Mock(return_value=state)
            probe.run_acceptance('index', check_only=True)
            probe.call.assert_not_called()
            self.assertTrue((probe.evidence / 'checked.json').is_file())
            self.assertFalse((probe.evidence / 'complete.json').exists())

    def test_refuses_unsafe_preflight_without_service_mutation(self):
        def set_value(value, path, replacement):
            for key in path[:-1]:
                value = value[key]
            value[path[-1]] = replacement
        changes = [(('idle', key), 1) for key in ('queued', 'unreleased', 'writable', 'unsettled', 'pending_discussion', 'unresolved_sources', 'pending_outbox')]
        changes += [(('runtime', 'runner', 'fresh'), False), (('runtime', 'runner', 'ready'), False),
            (('runtime', 'infrastructure', 'runners', 0, 'online'), False),
            (('source', 'source_tar_sha256'), 'wrong'), (('binaries', 'monos'), 'wrong'),
            (('semantic', 'preview', 'state'), 'eligible'),
            (('semantic', 'trials', PREVIEW, 'todo', 'archived'), False),
            (('native_observations', 'attempt-0', 'physical', 'cgroup_populated'), True),
            (('native_observations', 'attempt-0', 'ownership', 'pid'), 0)]
        for path, replacement in changes:
            with self.subTest(path=path), tempfile.TemporaryDirectory() as directory:
                probe, state = self.fixture(directory)
                set_value(state, path, replacement)
                probe.collect = Mock(return_value=state)
                with self.assertRaises(RuntimeError):
                    probe.run_acceptance('index')
                probe.call.assert_not_called()
                self.assertTrue((probe.evidence / 'before.json').is_file())

    def test_guard_rechecked_immediately_before_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            probe, state = self.fixture(directory)
            later = copy.deepcopy(state)
            later['idle']['queued'] = 1
            probe.collect = Mock(side_effect=[state, later])
            with self.assertRaises(RuntimeError):
                probe.run_acceptance('index')
            probe.call.assert_not_called()
            self.assertFalse((probe.evidence / 'restart-backend-intent.json').exists())

    def test_evidence_failure_prevents_restart_and_retains_partial_file(self):
        for failed in ('before', 'restart-backend-intent'):
            with self.subTest(failed=failed), tempfile.TemporaryDirectory() as directory:
                probe, state = self.fixture(directory)
                probe.collect = Mock(side_effect=self.stages(state))
                save = probe.save
                def fail_save(name, value):
                    if name == failed:
                        with (probe.evidence / (name + '.json')).open('x') as stream:
                            stream.write('{')
                        raise OSError('disk failure')
                    save(name, value)
                probe.save = fail_save
                with self.assertRaises(OSError):
                    probe.run_acceptance('index')
                probe.call.assert_not_called()
                probe.save = save
                with self.assertRaises(RuntimeError):
                    probe.run_acceptance('index')
                self.assertEqual((probe.evidence / (failed + '.json')).read_text(), '{')

    def test_uncertain_restart_cannot_restart_or_overwrite_on_rerun(self):
        with tempfile.TemporaryDirectory() as directory:
            probe, state = self.fixture(directory)
            probe.collect = Mock(side_effect=self.stages(state))
            probe.call.side_effect = TimeoutError('private external details')
            with self.assertRaises(TimeoutError):
                probe.run_acceptance('index')
            evidence = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in probe.evidence.iterdir()}
            self.assertIn('before-backend.json', evidence)
            self.assertIn('restart-backend-intent.json', evidence)
            self.assertNotIn(b'private external details', evidence['failure.json'][0])
            with self.assertRaises(RuntimeError):
                probe.run_acceptance('index')
            self.assertEqual(probe.call.call_count, 1)
            self.assertEqual(evidence, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in probe.evidence.iterdir()})

    def test_lost_state_after_backend_blocks_runner_restart(self):
        mutations = [lambda s: s['semantic']['owner_receipts'].pop('create-0'),
            lambda s: s['semantic']['trials'][ORDERED]['messages'].clear(),
            lambda s: s['semantic']['records']['specification_revisions'].clear(),
            lambda s: s['semantic']['records']['tasks'].clear(),
            lambda s: s['semantic']['native']['attempt-0']['receipts'].clear(),
            lambda s: s['semantic']['global_counts'].update(attempts=7),
            lambda s: s['semantic']['global_counts'].update(starts=7)]
        for mutation in mutations:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                probe, state = self.fixture(directory)
                stages = self.stages(state)
                mutation(stages[2])
                probe.collect = Mock(side_effect=stages)
                with self.assertRaises(RuntimeError):
                    probe.run_acceptance('index')
                self.assertEqual(probe.call.call_count, 1)
                self.assertFalse((probe.evidence / 'restart-runner-intent.json').exists())
                self.assertEqual(json.loads((probe.evidence / 'after-backend.json').read_text())['outcome'], 'fail')

    def test_only_one_concurrent_claim_wins(self):
        with tempfile.TemporaryDirectory() as directory:
            probe, _ = self.fixture(directory)
            def claim():
                try:
                    probe.claim()
                    return True
                except (OSError, RuntimeError):
                    return False
            with ThreadPoolExecutor(max_workers=2) as pool:
                self.assertEqual(sorted(pool.map(lambda _: claim(), range(2))), [False, True])

    def test_new_service_and_backend_connection_are_required(self):
        with tempfile.TemporaryDirectory() as directory:
            probe, state = self.fixture(directory)
            self.assertFalse(all(restart_checks(state, state, 'backend').values()))
            self.assertFalse(all(restart_checks(state, state, 'runner').values()))
            after = self.stages(state)[2]
            self.assertTrue(all(restart_checks(state, after, 'backend').values()))
            after['runtime']['runner']['connection_instance'] = 'old'
            self.assertFalse(all(restart_checks(state, after, 'backend').values()))
            after['runtime']['infrastructure']['runners'][0]['online'] = False
            self.assertFalse(ready(after['runtime'], probe.runner))
            probe.runtime = Mock(return_value=state['runtime'])
            with patch('capture_discussion_acceptance.time.monotonic', side_effect=[0, 0, 2]), \
                    patch('capture_discussion_acceptance.time.sleep'):
                with self.assertRaises(RuntimeError):
                    CaptureDiscussionAcceptance.await_restart(probe, state, 'backend', seconds=1)
            self.assertTrue((probe.evidence / 'readiness-failed-backend.json').is_file())

    def test_physical_unknown_and_escaped_old_process_are_not_absence(self):
        expected = {'pid': 12, 'birth': '4', 'boot_id': 'boot', 'cgroup': '/system.slice/monos-probe-old.service'}
        self.assertTrue(process_absent(expected, {'present': False}))
        self.assertFalse(process_absent(expected, {'present': None}))
        self.assertFalse(process_absent({}, {'present': False}))
        escaped = {**expected, 'present': True, 'cgroup': '/escaped'}
        self.assertFalse(process_absent(expected, escaped))
        self.assertTrue(process_absent(expected, {**escaped, 'birth': '5'}))
        with tempfile.TemporaryDirectory() as directory:
            _, state = self.fixture(directory)
            native = state['native_observations']['attempt-0']
            self.assertTrue(native_absent(native))
            native['physical']['cgroup_populated'] = None
            self.assertFalse(native_absent(native))

    def test_success_without_old_snapshot_requires_exact_native_handoff(self):
        mutations = [lambda value: value['handoffs'].clear(),
            lambda value: value['handoffs'].append(copy.deepcopy(value['handoffs'][0])),
            lambda value: value['handoffs'][0].update(source_message_id='another-source'),
            lambda value: value['handoffs'][0].update(source_watermark=99),
            lambda value: value['handoffs'][0].update(scope_id=ORDERED),
            lambda value: value['handoffs'][0]['payload'].update(reply='Changed exact reply'),
            lambda value: value['journal_requests'][0].update(digest_matches_bytes=False),
            lambda value: value['journal_requests'][0].update(digest='wrong'),
            lambda value: value['receipts'][0].update(status='unknown'),
            lambda value: value['attempts'][0].update(attempt_id='another-attempt')]
        for mutation in mutations:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                probe, state = self.fixture(directory)
                attempt = probe.attempts[-1]
                self.assertNotIn(attempt, probe.prior_native)
                mutation(state['native_observations'][attempt])
                probe.collect = Mock(return_value=state)
                with self.assertRaises(RuntimeError):
                    probe.run_acceptance('index')
                probe.call.assert_not_called()
                before = json.loads((probe.evidence / 'before.json').read_text())
                self.assertFalse(before['checks']['successful_native_handoff_' + attempt])

    def test_historical_log_drain_preserves_exact_stream_prefix(self):
        before = [{'stream_id': 'runtime', 'sequence': 1, 'kind': 'started', 'text_length': 3},
                  {'stream_id': 'stdout', 'sequence': 1, 'kind': 'output', 'text_length': 20}]
        appended = [{'stream_id': 'runtime', 'sequence': 2, 'kind': 'exited', 'text_length': 61},
                    {'stream_id': 'stdout', 'sequence': 2, 'kind': 'output', 'text_length': 4612}]
        after = before + appended
        result = historical_events(before, after)
        self.assertTrue(result['retained_prefix'])
        self.assertEqual(len(result['appended']), 2)
        # Aggregate ordering is not stream ordering; DB may return rows differently.
        self.assertEqual(historical_events(before, list(reversed(after))), result)
        changed = copy.deepcopy(after)
        changed[1]['text_length'] = 21
        reordered = copy.deepcopy(after)
        reordered[1]['sequence'], reordered[3]['sequence'] = 2, 1
        variants = [after[1:], changed, reordered, after + [after[0]],
            after + [{'stream_id': 'runtime', 'sequence': 3, 'kind': 'started', 'text_length': 3}],
            before + [{'stream_id': 'stdout', 'sequence': 3, 'kind': 'output', 'text_length': 8}]]
        variants.extend(after + [{'stream_id': 'runtime', 'sequence': 3, 'kind': kind, 'text_length': 3}]
                        for kind in ('attention', 'capture_failed', 'process_absent', 'unknown', None))
        for rows in variants:
            with self.subTest(rows=rows):
                self.assertFalse(historical_events(before, rows)['retained_prefix'])

    def test_unbacked_native_append_does_not_bypass_full_record_comparison(self):
        with tempfile.TemporaryDirectory() as directory:
            probe, state = self.fixture(directory)
            prior = [{'stream_id': 'runtime', 'sequence': 1, 'kind': 'started', 'text_length': 3}]
            appended = {'stream_id': 'runtime', 'sequence': 2, 'kind': 'exited', 'text_length': 61}
            probe.prior_native['attempt-0']['events'] = copy.deepcopy(prior)
            state['native_observations']['attempt-0']['events'] = copy.deepcopy(prior + [appended])
            state['semantic']['native']['attempt-0']['events'] = copy.deepcopy(prior + [appended])
            self.assertTrue(all(probe.guard(state).values()))
            stages = self.stages(state)
            stages[2]['semantic']['native']['attempt-0']['events'].append({
                'stream_id': 'runtime', 'sequence': 3, 'kind': 'exited', 'text_length': 61})
            probe.collect = Mock(side_effect=stages)
            with self.assertRaises(RuntimeError):
                probe.run_acceptance('index')
            self.assertEqual(probe.call.call_count, 1)

    def test_valid_late_exit_preserves_semantics_and_matching_projections(self):
        with tempfile.TemporaryDirectory() as directory:
            probe, state = self.fixture(directory)
            before = self.runtime_fixture(state)
            after = self.late_exit(before)
            result = semantic_progress(before['semantic'], after['semantic'])
            self.assertTrue(result['valid'])
            self.assertEqual(len(result['runtime_appends']), 1)
            self.assertEqual(set(result['projection_changes']['attempt-0']),
                             {'exit_observed', 'log_visible_sequence', 'activity_at'})
            # Later native sampling catches up to the already-retained raw event.
            caught_up = self.late_exit(before, sampled=True)
            self.assertTrue(semantic_progress(after['semantic'], caught_up['semantic'])['valid'])
            self.assertTrue(semantic_progress(before['semantic'], caught_up['semantic'])['valid'])
            self.assertFalse(semantic_progress(caught_up['semantic'], before['semantic'])['valid'])

    def test_valid_late_output_requires_source_bytes_and_only_log_projection(self):
        with tempfile.TemporaryDirectory() as directory:
            _, state = self.fixture(directory)
            before = self.runtime_fixture(state)
            after = self.late_exit(before)
            row = after['semantic']['records']['runtime_events'][-1]
            body = {**row['body'], 'kind': 'output', 'stream_id': 'stdout', 'sequence': 1,
                    'text': 'tail', 'data_base64': 'dGFpbA=='}
            del body['exit_code']
            after['semantic']['records']['runtime_events'][-1] = self.event_row(body)
            after['semantic']['records']['attempts'][0]['exit_observed'] = False
            self.assertTrue(semantic_progress(before['semantic'], after['semantic'])['valid'])
            after['semantic']['records']['attempts'][0]['exit_observed'] = True
            self.assertFalse(semantic_progress(before['semantic'], after['semantic'])['valid'])
            after['semantic']['records']['attempts'][0]['exit_observed'] = False
            body['data_base64'] = 'not-base64'
            after['semantic']['records']['runtime_events'][-1] = self.event_row(body)
            self.assertFalse(semantic_progress(before['semantic'], after['semantic'])['valid'])

    def test_late_runtime_drain_rejects_other_changes_or_unexplained_projections(self):
        mutations = [lambda s: s['records']['attempts'][0].update(state='FAILED'),
            lambda s: s['records']['attempts'][0].update(mutation_allowed=True),
            lambda s: s['records']['attempts'][0].update(process_released=False),
            lambda s: s['records']['attempts'][0].update(log_visible_sequence=3),
            lambda s: s['records']['attempts'][0].update(exit_observed=False),
            lambda s: s['records']['attempts'][0].update(activity_at='2026-09-29T01:00:00+00:00'),
            lambda s: s['records']['attempts'][1].update(activity_at='2026-09-30T01:00:01+00:00'),
            lambda s: s['records']['runtime_events'][0]['body'].update(text='changed history'),
            lambda s: s['records']['runtime_events'].pop(0),
            lambda s: s['records']['runtime_events'].append(copy.deepcopy(s['records']['runtime_events'][-1])),
            lambda s: s['records']['runtime_events'][-1].update(digest='wrong'),
            lambda s: s['records']['task_preview_command_receipts'].clear(),
            lambda s: s['owner_receipts'].clear(),
            lambda s: s['native']['attempt-0']['ownership'].update(pid=999),
            lambda s: s['global_counts'].update(starts=7)]
        for mutation in mutations:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                _, state = self.fixture(directory)
                before = self.runtime_fixture(state)
                after = self.late_exit(before)
                mutation(after['semantic'])
                self.assertFalse(semantic_progress(before['semantic'], after['semantic'])['valid'])
        for key, replacement in [('dispatch_id', 'another-dispatch'), ('boot_id', 'another-boot'),
                ('kind', 'started'), ('kind', 'attention'), ('kind', 'capture_failed'),
                ('stream_id', 'another-stream'), ('sequence', 3), ('order_sequence', 3),
                ('text', 'unrecognized exit'), ('exit_code', 999)]:
            with self.subTest(key=key, value=replacement), tempfile.TemporaryDirectory() as directory:
                _, state = self.fixture(directory)
                before = self.runtime_fixture(state)
                after = self.late_exit(before)
                body = after['semantic']['records']['runtime_events'][-1]['body']
                body[key] = replacement
                after['semantic']['records']['runtime_events'][-1] = self.event_row(body)
                self.assertFalse(semantic_progress(before['semantic'], after['semantic'])['valid'])

    def test_resume_revalidates_backend_and_restarts_only_runner_once(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as previous:
            probe, state = self.fixture(directory)
            _, backend = self.failed_backend_fixture(probe, state, previous)
            old_bytes = {p.name: p.read_bytes() for p in pathlib.Path(previous).iterdir()}
            runner = copy.deepcopy(backend)
            runner['runtime']['service'].update(MainPID='13', ExecMainStartTimestampMonotonic='200', InvocationID='new')
            runner['runtime']['runner'].update(incarnation=6, runtime_report_incarnation=6)
            probe.collect = Mock(side_effect=[backend, copy.deepcopy(backend), runner])
            probe.run_acceptance('index', resume_after_backend=previous)
            probe.call.assert_called_once_with(['systemctl', 'restart', 'monos-probe-runner.service'])
            self.assertFalse((probe.evidence / 'restart-backend-intent.json').exists())
            self.assertTrue((probe.evidence / 'complete.json').is_file())
            self.assertTrue((pathlib.Path(previous) / 'resume-claim.json').is_file())
            self.assertEqual(old_bytes, {name: (pathlib.Path(previous) / name).read_bytes() for name in old_bytes})
            retained = json.loads((probe.evidence / 'resume-backend-evidence.json').read_text())
            self.assertEqual(retained['original_outcome'], 'fail')
            self.assertEqual(retained['reports']['after-backend']['outcome'], 'fail')

    def test_resume_refuses_bad_intent_or_an_existing_runner_stage(self):
        changes = [('restart-backend-intent', lambda r: r.update(before_sha256='changed')),
            ('claim', lambda r: r.update(harness_sha256='unknown')),
            ('failure', lambda r: r.update(stage='restart-runner')),
            ('after-backend', lambda r: r['checks'].update(native_absence=False)),
            ('after-backend', lambda r: r['state']['semantic']['owner_receipts'].clear())]
        for name, change in changes:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as previous:
                probe, state = self.fixture(directory)
                self.failed_backend_fixture(probe, state, previous)
                path = pathlib.Path(previous) / (name + '.json')
                report = json.loads(path.read_text())
                change(report)
                path.write_text(json.dumps(report))
                with self.assertRaises(RuntimeError):
                    probe.run_acceptance('index', resume_after_backend=previous)
                probe.call.assert_not_called()
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as previous:
            probe, state = self.fixture(directory)
            self.failed_backend_fixture(probe, state, previous)
            (pathlib.Path(previous) / 'restart-runner-intent.json').write_text('{}')
            with self.assertRaises(RuntimeError):
                probe.run_acceptance('index', resume_after_backend=previous)
            probe.call.assert_not_called()

    def test_resume_current_identity_change_blocks_mutation(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as previous:
            probe, state = self.fixture(directory)
            _, backend = self.failed_backend_fixture(probe, state, previous)
            backend['runtime']['service']['InvocationID'] = 'unexpected-restart'
            probe.collect = Mock(return_value=backend)
            with self.assertRaises(RuntimeError):
                probe.run_acceptance('index', resume_after_backend=previous)
            probe.call.assert_not_called()

    def test_uncertain_resume_cannot_repeat_from_another_output_directory(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as previous, tempfile.TemporaryDirectory() as retry:
            probe, state = self.fixture(directory)
            _, backend = self.failed_backend_fixture(probe, state, previous)
            probe.collect = Mock(return_value=backend)
            probe.call.side_effect = TimeoutError('uncertain Runner restart')
            with self.assertRaises(TimeoutError):
                probe.run_acceptance('index', resume_after_backend=previous)
            self.assertEqual(probe.call.call_count, 1)
            first_files = {p.name: p.read_bytes() for p in probe.evidence.iterdir()}
            probe.evidence = pathlib.Path(retry)
            with self.assertRaises(RuntimeError):
                probe.run_acceptance('index', resume_after_backend=previous)
            self.assertEqual(probe.call.call_count, 1)
            self.assertEqual(first_files, {p.name: p.read_bytes() for p in pathlib.Path(directory).iterdir()})

    def test_resume_evidence_failure_or_late_work_prevents_runner_restart(self):
        for failure_point in ('resume-backend-evidence', 'resume-claim', 'restart-runner-intent', 'late-work'):
            with self.subTest(point=failure_point), tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as previous:
                probe, state = self.fixture(directory)
                _, backend = self.failed_backend_fixture(probe, state, previous)
                if failure_point == 'late-work':
                    unsafe = copy.deepcopy(backend)
                    unsafe['idle']['writable'] = 1
                    probe.collect = Mock(side_effect=[backend, unsafe])
                else:
                    probe.collect = Mock(return_value=backend)
                    save = probe.save
                    def fail_save(name, value):
                        if name == failure_point:
                            raise OSError('evidence failure')
                        save(name, value)
                    probe.save = fail_save
                with self.assertRaises((RuntimeError, OSError)):
                    probe.run_acceptance('index', resume_after_backend=previous)
                probe.call.assert_not_called()

    def test_manifest_rejects_traversal_escape_missing_and_changed_source(self):
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory)
            files = {}
            for i in range(205):
                (source / str(i)).write_text('source')
                files[str(i)] = hashlib.sha256(b'source').hexdigest()
            manifest = {'files': files, 'source_tar_sha256': ARCHIVE_SHA}
            self.assertEqual(verify_manifest(source, manifest)['source_files_verified'], 205)
            for bad in ('../escape', '/absolute', 'a/../../escape', './0'):
                changed = copy.deepcopy(manifest)
                changed['files'][bad] = changed['files'].pop('0')
                with self.subTest(path=bad), self.assertRaises(RuntimeError):
                    verify_manifest(source, changed)
            (source / '0').write_text('changed')
            with self.assertRaises(RuntimeError):
                verify_manifest(source, manifest)
            (source / '0').unlink()
            (source / '0').symlink_to('/etc/hosts')
            with self.assertRaises(RuntimeError):
                verify_manifest(source, manifest)
            self.assertFalse(passed({'outcome': 'pass', 'checks': {'one': True, 'two': False}}))
            self.assertFalse(passed({'outcome': 'pass', 'checks': {}}))

    def test_failed_or_missing_prior_case_prevents_even_baseline_collection(self):
        cases = {'/root/monos-task-preview-evidence-v1/case-' + str(i) + '.json': {
            'outcome': 'pass', 'sha256': 'a' * 64} for i in range(10)}
        for report in ({'outcome': 'fail'}, {'outcome': 'pass', 'checks': {'one': True, 'two': False}},
                       {'outcome': 'pass'}):
            with self.subTest(report=report), tempfile.TemporaryDirectory() as directory:
                probe, _ = self.fixture(directory)
                probe.load_prior = lambda path: CaptureDiscussionAcceptance.load_prior(probe, path)
                probe.collect = Mock()
                with patch('capture_discussion_acceptance.read_json', side_effect=[{'cases': cases}] + [report] * 10), \
                        patch('capture_discussion_acceptance.digest', return_value='a' * 64):
                    with self.assertRaises(RuntimeError):
                        probe.run_acceptance('index')
                probe.collect.assert_not_called()
                probe.call.assert_not_called()


if __name__ == '__main__':
    unittest.main()
