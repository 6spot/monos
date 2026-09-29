"""Negative acceptance-evidence tests; no Linux services or models are invoked."""
import copy
import json
import pathlib
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

from probe import MODEL
from queue_probe import QueueProbe, promotion_checks, queue_checks, restart_checks, rows_by_id


ATTEMPTS = ['q-node', 'q-planner', 'q-queued']


def checkpoint():
    rows, states, logs = [], {}, {}
    for index, attempt in enumerate(ATTEMPTS):
        queued = index == 2
        kind = 'node' if index == 0 else 'planner'
        row = {'attempt_id': attempt, 'dispatch_id': 'dispatch-' + attempt, 'kind': kind,
               'state': 'QUEUED' if queued else 'RUNNING', 'started': not queued,
               'process_released': queued, 'process_absent': False, 'mutation_allowed': not queued,
               'queue_digest': 'digest-' + attempt, 'selection_context': {'target': {
                   'runner_id': 'runner', 'runtime_id': 'opencode', 'model_id': MODEL}},
               'log_mode': 'ordered_v1', 'starts': [] if queued else [{'id': 'start-' + attempt, 'done': True}]}
        identity = {'pid': 123 + index, 'birth': '123456', 'boot_id': 'boot',
                    'cgroup': '/system.slice/monos-probe-' + attempt + '.service'}
        states[attempt] = {
            'attempts': [row.copy()],
            'driver': None if queued else {'attempt_id': attempt, 'kind': kind,
                'stage': 'ready_for_handoff', 'hold_expires_at': time.time() + 300},
            'ownership': {} if queued else {**identity, 'dispatch_id': row['dispatch_id']},
            'live_identity': {'present': False} if queued else {**identity, 'uid': 1000, 'present': True},
            'physical': {'cgroup_populated': None if queued else True,
                         'descendants': [{'alive': True}, {'alive': True}] if index == 0 else []},
            'events': [] if queued else [{'kind': 'started'}],
        }
        events = [] if queued else [{'kind': 'started', 'attempt_id': attempt, 'order_sequence': 1}]
        logs[attempt] = {'events': events, 'cursor': 'cursor-' + attempt, 'page': {
            'attempt_id': attempt, 'task_id': 'task_' + attempt, 'events': events, 'has_more': False, 'gap_after': 0}}
        rows.append(row)
    status = {'attempt_id': ATTEMPTS[2], 'task_id': 'task_' + ATTEMPTS[2], 'state': 'QUEUED',
              'started': False, 'process_released': True, 'mutation_allowed': False,
              'visible_sequence': 0, 'latest_sequence': 0}
    return {'canonical': {'runner': {'runner_id': 'runner', 'capacity': 2, 'ready': True, 'connected': True,
                                     'connection_instance': 'backend', 'incarnation': 1},
                          'attempts': rows, 'unresolved_operations': []},
            'states': states, 'logs': logs, 'owner_status': status,
            'owner_list': {'task_id': status['task_id'], 'attempts': [status.copy()], 'has_more': False}}


class QueueEvidenceTests(unittest.TestCase):
    def test_two_held_executions_and_visible_queue(self):
        self.assertTrue(all(queue_checks(checkpoint(), ATTEMPTS, 1000).values()))

    def test_missing_or_duplicate_inventory_cannot_pass(self):
        state = checkpoint()
        state['canonical']['attempts'].pop()
        self.assertFalse(all(queue_checks(state, ATTEMPTS, 1000).values()))
        state = checkpoint()
        state['canonical']['attempts'].append(state['canonical']['attempts'][0])
        with self.assertRaises(RuntimeError):
            rows_by_id(state['canonical'])

    def test_queued_claim_start_driver_or_runtime_output_fails(self):
        edits = [
            lambda s: s['canonical']['attempts'][2].update(starts=[{'id': 'unexpected'}]),
            lambda s: s['canonical']['attempts'][2].update(process_released=False),
            lambda s: s['states'][ATTEMPTS[2]].update(ownership={'pid': 999}),
            lambda s: s['states'][ATTEMPTS[2]].update(driver={'stage': 'ready_for_handoff'}),
            lambda s: s['states'][ATTEMPTS[2]].update(events=[{'kind': 'started'}]),
        ]
        for edit in edits:
            state = checkpoint()
            edit(state)
            with self.subTest(edit=edit):
                self.assertFalse(all(queue_checks(state, ATTEMPTS, 1000).values()))

    def test_owner_reads_must_expose_the_same_idle_queue(self):
        for field, value in [('state', 'RUNNING'), ('latest_sequence', 1), ('activity_at', 'invented'),
                             ('task_id', 'wrong'), ('mutation_allowed', True)]:
            state = checkpoint()
            state['owner_status'][field] = value
            with self.subTest(field=field):
                self.assertFalse(all(queue_checks(state, ATTEMPTS, 1000).values()))
        state = checkpoint()
        state['owner_list']['attempts'] = []
        self.assertFalse(all(queue_checks(state, ATTEMPTS, 1000).values()))

    def test_empty_held_logs_and_queued_gap_fail(self):
        for attempt in ATTEMPTS[:2]:
            state = checkpoint()
            state['logs'][attempt]['events'] = []
            self.assertFalse(all(queue_checks(state, ATTEMPTS, 1000).values()))
        state = checkpoint()
        state['logs'][ATTEMPTS[2]]['page']['gap_after'] = 2
        self.assertFalse(all(queue_checks(state, ATTEMPTS, 1000).values()))

    def test_expired_hold_unknown_cgroup_wrong_uid_and_shared_identity_fail(self):
        for edit in (
            lambda s: s['states'][ATTEMPTS[0]]['driver'].update(hold_expires_at=time.time() + 40),
            lambda s: s['states'][ATTEMPTS[0]]['physical'].update(cgroup_populated=None),
            lambda s: s['states'][ATTEMPTS[0]]['live_identity'].update(uid=0),
            lambda s: s['states'][ATTEMPTS[0]]['live_identity'].update(birth='different'),
            lambda s: s['states'][ATTEMPTS[0]]['physical']['descendants'].pop(),
        ):
            state = checkpoint()
            edit(state)
            self.assertFalse(all(queue_checks(state, ATTEMPTS, 1000).values()))
        state = checkpoint()
        for key in ('ownership', 'live_identity'):
            state['states'][ATTEMPTS[1]][key].update(
                {k: state['states'][ATTEMPTS[0]][key][k] for k in ('pid', 'birth', 'boot_id', 'cgroup')})
        self.assertFalse(all(queue_checks(state, ATTEMPTS, 1000).values()))

    def test_wrong_model_or_missing_selection_does_not_pass(self):
        for value in ({}, {'target': {'model_id': 'paid/model'}}):
            state = checkpoint()
            state['canonical']['attempts'][0]['selection_context'] = value
            self.assertFalse(all(queue_checks(state, ATTEMPTS, 1000).values()))

    def test_restart_requires_new_connection_original_selection_and_identity(self):
        before = checkpoint()
        after = copy.deepcopy(before)
        after['canonical']['runner']['incarnation'] = 2
        self.assertTrue(all(restart_checks(before, after, ATTEMPTS).values()))
        for edit in (
            lambda s: s['canonical']['runner'].update(incarnation=1),
            lambda s: s['canonical']['attempts'][2].update(queue_digest='changed'),
            lambda s: s['canonical']['attempts'][0]['starts'].append({'id': 'duplicate'}),
            lambda s: s['states'][ATTEMPTS[0]]['live_identity'].update(pid=999),
        ):
            changed = copy.deepcopy(after)
            edit(changed)
            self.assertFalse(all(restart_checks(before, changed, ATTEMPTS).values()))

    def promotion(self):
        initial = checkpoint()['canonical']
        promoted = copy.deepcopy(initial)
        promoted['attempts'][0].update(process_released=True, process_absent=True, mutation_allowed=False, state='SUCCEEDED')
        promoted['attempts'][2].update(state='RUNNING', started=True, process_released=False,
                                       mutation_allowed=True, starts=[{'id': 'start-queued'}])
        return initial, promoted

    def test_promotion_requires_predecessor_absence_release_and_capacity(self):
        initial, promoted = self.promotion()
        self.assertTrue(all(promotion_checks(initial, ATTEMPTS, rows_by_id(initial)).values()))
        self.assertTrue(all(promotion_checks(promoted, ATTEMPTS, rows_by_id(initial)).values()))
        for field, value in [('process_released', False), ('process_absent', False), ('mutation_allowed', True)]:
            state = copy.deepcopy(promoted)
            state['attempts'][0][field] = value
            with self.subTest(field=field):
                self.assertFalse(all(promotion_checks(state, ATTEMPTS, rows_by_id(initial)).values()))

    def test_cancelled_queue_duplicate_start_changed_target_or_foreign_work_fails(self):
        initial, promoted = self.promotion()
        for edit in (
            lambda s: s['attempts'][2].update(state='CANCELLED'),
            lambda s: s['attempts'][2]['starts'].append({'id': 'another'}),
            lambda s: s['attempts'][0].update(starts=[{'id': 'replacement-start'}]),
            lambda s: s['attempts'][2].update(dispatch_id='replacement'),
            lambda s: s['attempts'].append({**s['attempts'][1], 'attempt_id': 'foreign'}),
        ):
            state = copy.deepcopy(promoted)
            edit(state)
            self.assertFalse(all(promotion_checks(state, ATTEMPTS, rows_by_id(initial)).values()))


class QueueFailureTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.probe = QueueProbe.__new__(QueueProbe)
        self.probe.evidence = pathlib.Path(self.directory.name)
        self.probe.source = pathlib.Path(__file__).resolve().parents[2]
        self.probe.config = {'execution_uid': 1000}
        self.probe.start = Mock()
        self.probe.call = Mock()
        self.probe.inventory = Mock(return_value={
            'runner': {'capacity': 2, 'ready': True, 'connected': True},
            'attempts': [], 'unresolved_operations': []})

    def test_failed_first_evidence_write_prevents_admission_and_restart(self):
        self.probe.save = Mock(side_effect=OSError('disk unavailable'))
        with self.assertRaises(OSError):
            self.probe.trial('new')
        self.probe.start.assert_not_called()
        self.probe.call.assert_not_called()

    def test_unresolved_foreign_work_prevents_admission_and_restart(self):
        self.probe.inventory.return_value['unresolved_operations'] = ['prior-operation']
        with self.assertRaises(RuntimeError):
            self.probe.trial('new')
        self.probe.start.assert_not_called()
        self.probe.call.assert_not_called()

    def test_same_prefix_cannot_hide_a_failed_trial(self):
        self.probe.inventory.return_value['attempts'] = [{'attempt_id': 'old'}]
        with self.assertRaises(RuntimeError):
            self.probe.trial('new')
        original = (self.probe.evidence / 'queue-preflight-new.json').read_bytes()
        self.probe.inventory.return_value['attempts'] = []
        with self.assertRaises(FileExistsError):
            self.probe.trial('new')
        self.assertEqual((self.probe.evidence / 'queue-preflight-new.json').read_bytes(), original)
        self.probe.start.assert_not_called()

    def test_lost_admission_reply_records_intent_and_runs_no_more_starts(self):
        self.probe.start.side_effect = TimeoutError()
        self.probe.cleanup = Mock(return_value={'new-node': {'outcome': 'unknown'}})
        result = self.probe.trial('new')
        self.assertEqual(result['outcome'], 'fail')
        self.probe.start.assert_called_once()
        self.probe.cleanup.assert_called_once_with('new', ['new-node'])
        failure = json.loads((self.probe.evidence / 'queue-failure-new.json').read_text())
        self.assertEqual(failure['attempted'], ['new-node'])
        self.assertEqual(failure['acknowledged'], [])
        self.probe.call.assert_not_called()

    def test_failed_release_checkpoint_does_not_touch_release_file(self):
        state = checkpoint()
        self.probe.save = Mock(side_effect=OSError())
        with patch('queue_probe.ROOT') as root, self.assertRaises(OSError):
            self.probe.release('q', ATTEMPTS[0], state['states'][ATTEMPTS[0]], state['canonical']['attempts'][0])
        root.__truediv__.assert_not_called()

    def test_cleanup_cancels_queue_before_releasing_any_other_slot(self):
        state = checkpoint()
        self.probe.snapshot = Mock(side_effect=lambda a: state['states'][a])
        self.probe.owner = Mock(return_value=state['owner_status'])
        self.probe.overview = Mock(return_value={'control_version': 1})
        self.probe.command = Mock(side_effect=TimeoutError())
        result = self.probe.cleanup('q', ATTEMPTS)
        self.probe.command.assert_called_once_with(ATTEMPTS[2], 'stop_initial_planning', 1,
                                                   {'attempt_id': ATTEMPTS[2]}, 'queue-trial-cleanup')
        self.probe.snapshot.assert_called_once_with(ATTEMPTS[2])
        self.assertEqual(result[ATTEMPTS[2]]['outcome'], 'unknown')

    def test_unsettled_queue_cleanup_never_frees_the_predecessors(self):
        state = checkpoint()
        self.probe.snapshot = Mock(side_effect=lambda a: state['states'][a])
        self.probe.wait_released = Mock(return_value=state['states'][ATTEMPTS[2]])
        self.probe.owner = Mock(return_value=state['owner_status'])
        self.probe.overview = Mock(return_value={'control_version': 1})
        self.probe.command = Mock(return_value={'status': 'admitted'})
        result = self.probe.cleanup('q', ATTEMPTS)
        self.probe.command.assert_called_once()
        self.probe.snapshot.assert_called_once_with(ATTEMPTS[2])
        self.assertEqual(result[ATTEMPTS[2]]['outcome'], 'unknown')


if __name__ == '__main__':
    unittest.main()
