import copy
import hashlib
import json
import pathlib
import shlex
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from node_execution_probe import (CARRYOVER_NODE, CARRYOVER_PLAN, CARRYOVER_PLAN_DIGEST, GIT_SPECIFICATION,
    CARRYOVER_TASK, NodeExecutionProbe, canonical_bytes, carryover_checks, durable_execution,
    driver_instructions, git_receipts_bound, git_specification_matches, no_repository_checks)


class NodeCarryoverEvidenceTests(unittest.TestCase):
    def fixture(self):
        role = {'id': 'planning-native-v1-role', 'instructions': 'Current instructions'}
        records = {'task': {'id': CARRYOVER_TASK, 'creation_confirmation_id': 'confirmation',
            'todo_id': 'todo', 'state': 'RUNNING', 'plan_id': CARRYOVER_PLAN},
            'nodes': [{'id': CARRYOVER_NODE, 'state': 'PENDING'}],
            'plans': [{'id': CARRYOVER_PLAN, 'content_digest': CARRYOVER_PLAN_DIGEST}],
            'plan_nodes': [{'definition': {'node_id': CARRYOVER_NODE, 'role_id': role['id'],
                'dependencies': [], 'hard_requirements': ['Add book'], 'expected_outputs': ['Interface']}}],
            'attempts': [{'kind': 'planner', 'process_absent': True,
                'process_released': True, 'mutation_allowed': False}],
            'node_attempts': 0, 'workspaces': 0, 'leases': 0,
            'events': [{'kind': 'planning_retried', 'body': {'answer': "Use 'Add book' as the primary button label."}}]}
        return records, role

    def test_requires_exact_retained_plan_and_no_existing_execution(self):
        records, role = self.fixture()
        self.assertTrue(all(carryover_checks(records, role).values()))
        mutations = [
            lambda r: r['task'].update(creation_confirmation_id=None),
            lambda r: r['task'].update(plan_id='another-plan'),
            lambda r: r['plans'][0].update(content_digest='changed'),
            lambda r: r['nodes'][0].update(state='COMPLETED'),
            lambda r: r['nodes'].append(copy.deepcopy(r['nodes'][0])),
            lambda r: r.update(node_attempts=1),
            lambda r: r.update(workspaces=1),
            lambda r: r.update(leases=1),
            lambda r: r['attempts'][0].update(process_released=False),
            lambda r: r['attempts'][0].update(mutation_allowed=True),
            lambda r: r.update(events=[]),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                broken = copy.deepcopy(records)
                mutate(broken)
                self.assertFalse(all(carryover_checks(broken, role).values()))

    def test_failed_preflight_does_not_change_role_or_start_work(self):
        records, role = self.fixture()
        records['node_attempts'] = 1
        probe = object.__new__(NodeExecutionProbe)
        for name in ('claim', 'idle', 'save', 'catalog', 'read', 'formal'):
            setattr(probe, name, Mock())
        probe.records = Mock(return_value=records)
        probe.current_role = Mock(return_value=role)
        def require(_name, _value, checks):
            if not all(checks.values()):
                raise RuntimeError('Failed retained-plan preflight')
        probe.require = require
        with self.assertRaisesRegex(RuntimeError, 'preflight'):
            probe.prepare_carryover()
        probe.formal.assert_not_called()
        probe.read.assert_not_called()


class NodeCompletionEvidenceTests(unittest.TestCase):
    def fixture(self):
        role = {'instructions': 'Build interface PRIVATE_ROLE_SENTINEL'}
        context = {'role': role}
        prompt = canonical_bytes(context).decode()
        artifact = {'id': 'artifact', 'task_id': CARRYOVER_TASK, 'node_id': CARRYOVER_NODE,
            'source_id': 'source', 'title': 'Reading list',
            'node_activation': 1, 'attempt_id': 'attempt', 'specification_id': 'spec', 'plan_id': CARRYOVER_PLAN,
            'media_type': 'text/html', 'content': '<button>Add book</button>', 'size_bytes': 25,
            'content_digest': hashlib.sha256(b'<button>Add book</button>').hexdigest()}
        read = {'metadata': {'artifact_id': 'artifact', 'size_bytes': 25, 'content_digest': artifact['content_digest']},
            'content': {'text': artifact['content'], 'media_type': 'text/html'}}
        read['metadata'].update({key: artifact[key] for key in
            ('task_id', 'node_id', 'node_activation', 'attempt_id', 'specification_id', 'plan_id', 'media_type')})
        manifest = {'task_id': CARRYOVER_TASK, 'node_id': CARRYOVER_NODE, 'node_activation': 1,
            'attempt_id': 'attempt', 'source_id': 'source', 'specification_id': 'spec', 'plan_id': CARRYOVER_PLAN,
            'summary': 'Implemented', 'artifact_ids': ['artifact']}
        manifest_hash = hashlib.sha256(canonical_bytes(manifest)).hexdigest()
        manifest.update(operation_id='complete', content_digest=manifest_hash)
        result = {'writer_absent': True}
        records = {'task': {'id': CARRYOVER_TASK, 'state': 'REVIEW', 'plan_id': CARRYOVER_PLAN},
            'nodes': [{'id': CARRYOVER_NODE, 'state': 'COMPLETED', 'execution_source_id': 'source', 'activation': 1}],
            'attempts': [{'id': 'attempt', 'kind': 'node', 'node_execution_source_id': 'source',
                'state': 'SUCCEEDED', 'launch': {'prompt': prompt}}],
            'node_sources': [{'id': 'source', 'planned_attempt_id': 'attempt', 'context': context, 'prompt': prompt,
                'context_digest': hashlib.sha256(prompt.encode()).hexdigest()}],
            'artifacts': [artifact], 'operations': [{'id': 'complete', 'attempt_id': 'attempt', 'kind': 'complete_node',
                'state': 'succeeded', 'repository_free': True, 'result': result, 'completion_manifest_digest': manifest_hash}],
            'manifests': [manifest], 'completions': [{'operation_id': 'complete', 'attempt_id': 'attempt',
                'activation': 1, 'result': {**result, 'summary': 'Implemented', 'artifact_ids': ['artifact'],
                    'completion_manifest_digest': manifest_hash}}], 'receipts': [],
            'starts': [{'attempt_id': 'attempt'}], 'workspaces': 0, 'leases': 0}
        native = {'attempts': [{'process_absent': True, 'process_released': True, 'mutation_allowed': False,
            'dispatch_id': 'dispatch'}], 'ownership': {'pid': 123, 'birth': '42', 'boot_id': 'boot',
            'cgroup': '/system.slice/native.service', 'dispatch_id': 'dispatch'}, 'live_identity': {'present': False},
            'physical': {'cgroup_populated': False, 'descendants': []}, 'planning_requests': []}
        for name, payload, response in [('complete_node', {'summary': 'Implemented', 'artifact_ids': ['artifact']}, {}),
            ('publish_artifact', {'artifact_id': 'artifact', 'title': 'Reading list', 'content': read['content']},
                {'status': 'committed', 'result': {'artifact_id': 'artifact'}}),
            ('read_artifact', {'artifact_id': 'artifact'}, {'result': {'artifact': read}})]:
            envelope = {'scope_id': CARRYOVER_TASK, 'name': name, 'payload': payload}
            raw = canonical_bytes(envelope)
            hash_value = hashlib.sha256(raw).hexdigest()
            records['receipts'].append({'attempt_id': 'attempt', 'command_name': name, 'request_id': name,
                'operation_id': 'complete' if name == 'complete_node' else None, 'digest': hash_value,
                'envelope_json': raw.decode(), 'response': response})
            native['planning_requests'].append({'request_id': name, 'digest': hash_value, 'digest_matches_bytes': True, 'envelope': envelope})
        headers = {'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store'}
        return records, native, read, headers, role

    def test_truthful_result_requires_physical_and_immutable_evidence(self):
        fixture = self.fixture()
        self.assertTrue(all(no_repository_checks(*fixture).values()), no_repository_checks(*fixture))
        mutations = [
            lambda f: f[0]['operations'][0]['result'].update(git_commit='fabricated'),
            lambda f: f[0]['operations'][0].update(repository_free=False),
            lambda f: f[0].update(workspaces=1),
            lambda f: f[0]['completions'][0].update(activation=2),
            lambda f: f[0]['manifests'][0].update(artifact_ids=[]),
            lambda f: f[0]['node_sources'][0].update(prompt='refreshed'),
            lambda f: f[1]['planning_requests'][0].update(digest='changed'),
            lambda f: f[1]['attempts'][0].update(process_released=False),
            lambda f: f[1]['physical'].update(cgroup_populated=True),
            lambda f: f[2]['metadata'].update(content_digest='wrong'),
            lambda f: f[2]['metadata'].update(references=[{'url': 'https://example.invalid/changed'}]),
            lambda f: f[2]['metadata'].update(supersedes='changed'),
            lambda f: f[3].update({'content-type': 'text/html'}),
            lambda f: f[0]['receipts'].pop(),
            lambda f: f[0].update(receipts=[r for r in f[0]['receipts'] if r['command_name'] != 'publish_artifact']),
            lambda f: f[0]['artifacts'][0].update(source_id='different-source'),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                broken = copy.deepcopy(fixture)
                mutate(broken)
                self.assertFalse(all(no_repository_checks(*broken).values()))

    def test_policy_retry_requires_exact_retained_failure_and_formal_source(self):
        fixture = self.fixture()
        prior = {'id': 'prior', 'planned_attempt_id': 'never-started', 'done': True,
            'waiting_reason': 'policy_missing', 'context_digest': 'frozen'}
        receipt = {'request_id': 'retry', 'source_id': 'source', 'status': 'committed'}
        fixture[0]['node_sources'].append(copy.deepcopy(prior))
        fixture[0]['node_sources'][0].update(previous_source_id='prior', owner_request_id='retry')
        fixture[0]['events'] = [{'kind': 'retry_node', 'body': {'source_id': 'source', 'previous_source_id': 'prior'}}]
        policy_retry = {'source': prior, 'receipt': receipt}
        self.assertTrue(all(no_repository_checks(*fixture, policy_retry).values()))
        self.assertFalse(all(no_repository_checks(*fixture).values()))
        mutations = [lambda f: f[0]['node_sources'][1].update(context_digest='rewritten'),
            lambda f: f[0]['attempts'].append({'id': 'never-started', 'kind': 'node'}),
            lambda f: f[0]['starts'].append({'attempt_id': 'never-started'}),
            lambda f: f[0]['events'].clear(),
            lambda f: f[0]['node_sources'][0].update(owner_request_id='invented')]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                broken = copy.deepcopy(fixture)
                mutate(broken)
                self.assertFalse(all(no_repository_checks(*broken, policy_retry).values()))

    def test_duplicate_review_preserves_every_output_and_native_publication(self):
        fixture = self.fixture()
        records, native, read, _, _ = fixture
        read['metadata']['title'] = records['artifacts'][0]['title']
        old = copy.deepcopy(records['artifacts'][0])
        old['id'] = 'historical'
        records['artifacts'].append(old)
        old_read = copy.deepcopy(read)
        old_read['metadata']['artifact_id'] = 'historical'
        publication = copy.deepcopy(next(r for r in records['receipts'] if r['command_name'] == 'publish_artifact'))
        publication['request_id'] = 'historical-publication'
        envelope = json.loads(publication['envelope_json'])
        envelope['payload']['artifact_id'] = 'historical'
        publication['envelope_json'] = canonical_bytes(envelope).decode()
        publication['digest'] = hashlib.sha256(canonical_bytes(envelope)).hexdigest()
        publication['response']['result']['artifact_id'] = 'historical'
        records['receipts'].append(publication)
        native['planning_requests'].append({'request_id': publication['request_id'],
            'digest': publication['digest'], 'digest_matches_bytes': True, 'envelope': envelope})
        review = {'retained': copy.deepcopy(records['artifacts']), 'reads': [copy.deepcopy(read), old_read]}
        self.assertFalse(all(no_repository_checks(*fixture).values()))
        self.assertTrue(all(no_repository_checks(*fixture, None, review).values()))
        mutations = [lambda f, r: f[0]['receipts'].pop(),
            lambda f, r: f[1]['planning_requests'][-1].update(digest='rewritten'),
            lambda f, r: r['reads'][1]['metadata'].update(size_bytes=1),
            lambda f, r: r['reads'][1]['metadata'].update(references=[{'url': 'https://example.invalid/changed'}]),
            lambda f, r: r['reads'][1]['metadata'].update(supersedes='changed'),
            lambda f, r: r['reads'][1]['content'].update(text='rewritten'),
            lambda f, r: f[0]['artifacts'][1].update(source_id='another-source'),
            lambda f, r: r['retained'].pop(),
            lambda f, r: f[0]['manifests'][0].update(artifact_ids=['artifact', 'historical'])]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                broken, bad_review = copy.deepcopy(fixture), copy.deepcopy(review)
                mutate(broken, bad_review)
                self.assertFalse(all(no_repository_checks(*broken, None, bad_review).values()))


class NodeRestartEvidenceTests(unittest.TestCase):
    def test_observer_rechecks_torn_operation_and_attempt_view(self):
        records = {key: [] for key in ('nodes', 'plans', 'specifications', 'plan_nodes', 'events', 'receipts',
            'operations', 'starts', 'node_sources', 'artifacts', 'manifests', 'blockers',
            'workspace_records', 'lease_records', 'completions')}
        records.update(task={'state': 'BLOCKED'}, attempts=[{'id': 'attempt', 'kind': 'node', 'state': 'CANCELLED'}])
        records['operations'] = [{'id': 'stop', 'state': 'admitted'}]
        settled = copy.deepcopy(records)
        settled['operations'][0]['state'] = 'succeeded'
        probe = object.__new__(NodeExecutionProbe)
        probe.git_binding = Mock(return_value={'task': {'task_id': 'task'}})
        probe.execution_records = Mock(side_effect=[records, settled, settled, settled])
        probe.node_snapshot = Mock(return_value={'fresh_release': True})
        with patch('time.sleep'):
            result, _, _ = probe.observe_git('test', 1, lambda _r, _a, s: s['fresh_release'])
        self.assertEqual(result['operations'][0]['state'], 'succeeded')
        self.assertEqual(probe.execution_records.call_count, 4)

    def test_late_log_projection_is_separate_from_retained_execution(self):
        records = {key: [] for key in ('nodes', 'plans', 'specifications', 'plan_nodes', 'events', 'receipts',
            'operations', 'starts', 'node_sources', 'artifacts', 'manifests', 'blockers',
            'workspace_records', 'lease_records', 'completions')}
        records.update(task={'state': 'REVIEW'}, attempts=[{'id': 'attempt', 'state': 'SUCCEEDED',
            'process_released': True, 'launch': {'prompt': 'frozen'}, 'log_visible_sequence': 3}])
        after = copy.deepcopy(records)
        after['attempts'][0]['log_visible_sequence'] = 4
        self.assertEqual(durable_execution(records), durable_execution(after))
        after['attempts'][0]['launch']['prompt'] = 'refreshed'
        self.assertNotEqual(durable_execution(records), durable_execution(after))
        after = copy.deepcopy(records)
        after['attempts'][0]['process_released'] = False
        self.assertNotEqual(durable_execution(records), durable_execution(after))
        for key in ('selection_context', 'queue_digest', 'owner_key', 'runner_id', 'created_at',
                    'planning_intent_id', 'future_identity'):
            with self.subTest(field=key):
                after = copy.deepcopy(records)
                after['attempts'][0][key] = 'changed'
                self.assertNotEqual(durable_execution(records), durable_execution(after))

    def test_nonidle_work_refuses_restart_before_service_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            probe = object.__new__(NodeExecutionProbe)
            probe.evidence = pathlib.Path(directory)
            for name in ('artifact', 'git-final'):
                (probe.evidence / (name + '.json')).write_text(json.dumps({'outcome': 'pass'}))
            probe.claim = Mock()
            probe.call = Mock()
            probe.idle = Mock(side_effect=RuntimeError('Existing work is not idle'))
            with self.assertRaisesRegex(RuntimeError, 'idle'):
                probe.restart_audit()
            probe.call.assert_not_called()


class NodeGitReceiptEvidenceTests(unittest.TestCase):
    def test_bound_command_uses_own_cwd_and_exact_task_without_model_substitution(self):
        command = shlex.split(driver_instructions('resource', task_id='task').split('\n')[-1])
        self.assertEqual(command[:2], ['python3', '-c'])
        with patch.object(pathlib.Path, 'cwd', return_value=pathlib.Path('/var/lib/monos-probe/execution/actual-attempt/scratch')), \
                patch('runpy.run_path') as run, patch.object(sys, 'argv', []):
            exec(command[2], {})
            self.assertEqual(sys.argv, ['workspace_driver.py', '--attempt', 'actual-attempt', '--task', 'task', '--resource', 'resource'])
            run.assert_called_once()
        with patch.object(pathlib.Path, 'cwd', return_value=pathlib.Path('/tmp/untrusted/scratch')), patch('runpy.run_path') as run:
            with self.assertRaises(AssertionError):
                exec(command[2], {})
            run.assert_not_called()

    def test_preview_title_split_preserves_every_requirement(self):
        heading, body = GIT_SPECIFICATION.strip().split('\n\n', 1)
        self.assertTrue(git_specification_matches({'title': heading[2:], 'specification': body}))
        self.assertTrue(git_specification_matches({'title': heading[2:], 'specification': GIT_SPECIFICATION}))
        self.assertFalse(git_specification_matches({'title': 'Changed task', 'specification': body}))
        self.assertFalse(git_specification_matches({'title': heading[2:], 'specification': body.replace('no\nremote push', 'allow\nremote push')}))

    def fixture(self):
        records = {'receipts': []}
        native = {}
        for attempt in ('first', 'second', 'third'):
            native[attempt] = {'planning_requests': []}
            for name in ['open_workspace'] + (['complete_node'] if attempt != 'first' else []):
                envelope = {'name': name, 'attempt_id': attempt, 'payload': {}}
                raw = canonical_bytes(envelope)
                digest = hashlib.sha256(raw).hexdigest()
                request = attempt + '-' + name
                records['receipts'].append({'attempt_id': attempt, 'command_name': name,
                    'request_id': request, 'digest': digest, 'envelope_json': raw.decode()})
                native[attempt]['planning_requests'].append({'request_id': request,
                    'digest': digest, 'digest_matches_bytes': True, 'envelope': envelope})
        return records, native, ['second', 'third']

    def test_missing_required_receipts_cannot_pass_vacuously(self):
        fixture = self.fixture()
        self.assertTrue(git_receipts_bound(*fixture))
        for index in range(len(fixture[0]['receipts'])):
            with self.subTest(receipt=index):
                broken = copy.deepcopy(fixture)
                broken[0]['receipts'].pop(index)
                self.assertFalse(git_receipts_bound(*broken))
        fixture[0]['receipts'] = []
        self.assertFalse(git_receipts_bound(*fixture))

    def test_every_receipt_requires_exact_native_identity_and_bytes(self):
        mutations = [lambda f: f[1].pop('first'), lambda f: f[2].pop(),
            lambda f: f[1]['second']['planning_requests'].clear(),
            lambda f: f[1]['first']['planning_requests'][0].update(digest_matches_bytes=False),
            lambda f: f[1]['third']['planning_requests'][0].update(digest='different'),
            lambda f: f[1]['third']['planning_requests'][1]['envelope'].update(attempt_id='second')]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                fixture = self.fixture()
                mutate(fixture)
                self.assertFalse(git_receipts_bound(*fixture))


if __name__ == '__main__':
    unittest.main()
