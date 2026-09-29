import copy
import hashlib
import json
import pathlib
import tempfile
import unittest
from unittest.mock import Mock, patch

from task_planning_probe import (ANSWER, SPECIFICATION, TaskPlanningProbe,
    before_start_checks, canonical_bytes, lineage_checks, phase_checks)


class PlanningEvidenceTests(unittest.TestCase):
    def fixture(self, kind='issue'):
        context = {'specification': SPECIFICATION, 'answers': [ANSWER] if kind == 'plan' else []}
        digest = hashlib.sha256(canonical_bytes(context)).hexdigest()
        prompt = canonical_bytes(context).decode()
        definition = {'node_id': 'node', 'role_id': 'role', 'goal': 'Reading list', 'dependencies': [],
            'hard_requirements': ['Use Add book'], 'expected_outputs': ['Working interface']}
        content = {'node_ids': ['node'], 'nodes': [definition]}
        payload = {'planning_intent_id': 'intent', **({'reason': 'Choose label'} if kind == 'issue'
            else {'plan_id': 'plan', 'nodes': [definition]})}
        name = 'raise_planning_issue' if kind == 'issue' else 'publish_execution_plan'
        envelope = {'scope_id': 'task', 'name': name, 'payload': payload}
        command_digest = hashlib.sha256(canonical_bytes(envelope)).hexdigest()
        outcome = {'kind': kind, 'planning_intent_id': 'intent',
            **({'issue_sequence': 2} if kind == 'issue' else {'plan_id': 'plan'})}
        task = {'id': 'task', 'state': 'RUNNING', 'specification_id': 'spec', 'initial_specification_id': 'spec',
            'initial_planning_intent_id': 'intent', 'plan_id': None if kind == 'issue' else 'plan',
            'planning_issue_sequence': 2 if kind == 'issue' else None,
            'todo_id': 'todo', 'creation_confirmation_id': 'confirm', 'source_proposal_message_id': 'proposal', 'project_id': 'project'}
        attempt = {'id': 'attempt', 'task_id': 'task', 'todo_id': None, 'node_id': None, 'plan_id': None,
            'planning_intent_id': 'intent', 'kind': 'planner', 'started': True, 'state': 'SUCCEEDED',
            'process_released': True, 'process_absent': True, 'mutation_allowed': False,
            'launch': {'prompt': prompt, 'task_planning_source': {'context_digest': digest}}}
        records = {'task': task, 'project': {'role_ids': ['role']},
            'sources': [{'id': 'intent', 'planned_attempt_id': 'attempt', 'context': context, 'context_digest': digest, 'prompt': prompt}],
            'attempts': [attempt], 'starts': [{'attempt_id': 'attempt'}],
            'receipts': [{'attempt_id': 'attempt', 'command_name': name, 'request_id': 'request', 'digest': command_digest,
                'envelope_json': canonical_bytes(envelope).decode(), 'response': {'status': 'committed',
                    'result': {'planning_outcome': outcome}}, 'operation_id': 'stop'}],
            'operations': [{'attempt_id': 'attempt', 'kind': 'stop', 'state': 'succeeded', 'id': 'stop'}],
            'workspaces': 0, 'leases': 0, 'node_attempts': 0,
            'specifications': [{'id': 'spec', 'content': SPECIFICATION}],
            'plans': [] if kind == 'issue' else [{'id': 'plan', 'specification_id': 'spec', 'content': content,
                'content_digest': hashlib.sha256(canonical_bytes(content)).hexdigest()}],
            'nodes': [] if kind == 'issue' else [{'id': 'node', 'state': 'PENDING'}],
            'plan_nodes': [] if kind == 'issue' else [{'definition': definition}],
            'events': [{'sequence': 2, 'attempt_id': 'attempt', 'body': {'reason': 'Choose label'}}]}
        native = {'attempts': [{'process_absent': True, 'process_released': True, 'mutation_allowed': False, 'dispatch_id': 'dispatch'}],
            'ownership': {'pid': 123, 'birth': '1234', 'boot_id': 'boot', 'cgroup': '/system.slice/native.service', 'dispatch_id': 'dispatch'},
            'live_identity': {'present': False}, 'physical': {'cgroup_populated': False, 'descendants': []},
            'planning_requests': [{'request_id': 'request', 'digest': command_digest, 'envelope': envelope, 'digest_matches_bytes': True}]}
        return records, native

    def test_creation_requires_real_provenance_and_zero_execution(self):
        records, _ = self.fixture()
        records['task'].update(state='PLANNING', initial_planning_intent_id=None)
        for key in ('sources', 'attempts', 'plans', 'nodes', 'starts'):
            records[key] = []
        self.assertTrue(all(before_start_checks(records).values()))
        for key in ('sources', 'attempts', 'plans', 'nodes', 'starts'):
            broken = copy.deepcopy(records)
            broken[key] = [{'id': 'premature'}]
            self.assertFalse(all(before_start_checks(broken).values()), key)
        for key in ('creation_confirmation_id', 'source_proposal_message_id'):
            broken = copy.deepcopy(records)
            broken['task'][key] = None
            self.assertFalse(all(before_start_checks(broken).values()), key)

    def test_issue_and_plan_require_independent_exact_outcome_and_process_evidence(self):
        for kind in ('issue', 'plan'):
            with self.subTest(kind=kind):
                records, native = self.fixture(kind)
                self.assertTrue(all(phase_checks(records, native, kind).values()))
                mutations = [
                    lambda r, n: r['starts'].append({'attempt_id': 'attempt'}),
                    lambda r, n: r['attempts'][0].update(process_released=False),
                    lambda r, n: r['attempts'][0].update(planning_intent_id='stale'),
                    lambda r, n: r.update(workspaces=1),
                    lambda r, n: r.update(node_attempts=1),
                    lambda r, n: r['operations'][0].update(state='recovery'),
                    lambda r, n: r['receipts'][0].update(digest='f' * 64),
                    lambda r, n: n['planning_requests'][0].update(envelope={'scope_id': 'other'}),
                    lambda r, n: n['physical'].update(cgroup_populated=True),
                    lambda r, n: n.update(ownership={}),
                    lambda r, n: r['sources'][0]['context'].update(todo='TODO_ONLY_SENTINEL'),
                    lambda r, n: r['sources'][0]['context'].update(instructions='PRIVATE_ROLE_SENTINEL'),
                    lambda r, n: r['attempts'][0]['launch'].update(prompt='different'),
                ]
                for index, mutate in enumerate(mutations):
                    broken, observed = copy.deepcopy((records, native))
                    mutate(broken, observed)
                    self.assertFalse(all(phase_checks(broken, observed, kind).values()), index)

    def test_published_plan_must_retain_exact_definitions_and_answer(self):
        records, native = self.fixture('plan')
        for patch in ({'hard_requirements': []}, {'expected_outputs': []}, {'dependencies': ['missing']}, {'role_id': 'other'}):
            broken = copy.deepcopy(records)
            broken['plan_nodes'][0]['definition'].update(patch)
            self.assertFalse(all(phase_checks(broken, native, 'plan').values()), patch)
        records['sources'][0]['context']['answers'] = []
        self.assertFalse(phase_checks(records, native, 'plan')['answer_retained'])

    def test_uncertain_control_never_generates_another_request_or_blindly_retries(self):
        with tempfile.TemporaryDirectory() as directory:
            probe = object.__new__(TaskPlanningProbe)
            probe.evidence = pathlib.Path(directory)
            (probe.evidence / 'created.json').write_text(json.dumps({'task': {'task_id': 'task'}}))
            probe.post = Mock(side_effect=TimeoutError('lost response'))
            probe.read = Mock(side_effect=[{'control_version': 1}, {'request_id': 'task-start', 'status': 'unknown'}])
            with self.assertRaisesRegex(RuntimeError, 'Unknown Owner outcome'):
                probe.control('start', 'start_task', {'specification_id': 'spec'})
            self.assertEqual(probe.post.call_count, 1)
            retained = (probe.evidence / 'request-start.json').read_bytes()
            with self.assertRaises(FileExistsError):
                probe.control('start', 'start_task', {'specification_id': 'spec'})
            self.assertEqual(probe.post.call_count, 1)
            self.assertEqual(retained, (probe.evidence / 'request-start.json').read_bytes())

    def test_retry_keeps_issue_records_and_creates_only_one_successor(self):
        old, _ = self.fixture('issue')
        current = copy.deepcopy(old)
        current['task']['initial_planning_intent_id'] = 'next'
        current['sources'].append({'id': 'next', 'previous_intent_id': 'intent'})
        current['attempts'].append({**current['attempts'][0], 'id': 'next-attempt'})
        current['starts'].append({'attempt_id': 'next-attempt'})
        self.assertTrue(all(lineage_checks({'records': old}, current).values()))
        for mutate in (
            lambda r: r['sources'].append({'id': 'third'}),
            lambda r: r['events'][0]['body'].update(reason='rewritten'),
            lambda r: r['specifications'][0].update(content='revised'),
            lambda r: r['sources'][1].update(previous_intent_id='other'),
            lambda r: r['receipts'].clear(),
        ):
            broken = copy.deepcopy(current)
            mutate(broken)
            self.assertFalse(all(lineage_checks({'records': old}, broken).values()))

    def test_inspection_does_not_treat_unstarted_queued_attempt_as_completed(self):
        records, native = self.fixture('issue')
        records['task']['control_version'] = 3
        queued, running = copy.deepcopy(records), copy.deepcopy(records)
        queued['attempts'][0].update(state='QUEUED', process_released=True, started=False)
        running['attempts'][0].update(state='RUNNING', process_released=False)
        probe = object.__new__(TaskPlanningProbe)
        probe.claim = Mock()
        probe.load_task = Mock(return_value='task')
        probe.records = Mock(side_effect=[queued, running, records])
        probe.planning_snapshot = Mock(return_value=native)
        probe.read = Mock(return_value={'task_id': 'task', 'specification_id': 'spec', 'control_version': 3,
            'planning_source': {'intent_id': 'intent'}, 'attempt_id': 'attempt', 'status': 'issue',
            'issue': {'issue_sequence': 2, 'reason': 'Choose label'},
            'available_actions': ['retry_initial_planning', 'stop_initial_planning', 'cancel_task']})
        probe.require = Mock()
        with patch('task_planning_probe.time.sleep') as sleep:
            probe.inspect('issue', 'issue')
        self.assertEqual(probe.records.call_count, 3)
        self.assertEqual(sleep.call_count, 2)
        probe.planning_snapshot.assert_called_once_with('attempt')
        self.assertTrue(all(probe.require.call_args.args[2].values()))


if __name__ == '__main__':
    unittest.main()
