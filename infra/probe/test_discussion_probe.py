"""Reject incomplete or misattributed Discussion acceptance evidence."""
import copy
import unittest
import urllib.error
from unittest.mock import Mock

from discussion_probe import DiscussionProbe, completion_checks, physically_released, receipt_matches, reply_checks


class DiscussionEvidenceTests(unittest.TestCase):
    def messages(self):
        return [
            {'message_id': 'm1', 'sequence': 1, 'author': 'owner', 'content': 'first'},
            {'message_id': 'm2', 'sequence': 2, 'author': 'owner', 'content': 'second'},
            {'message_id': 'r1', 'sequence': 3, 'author': 'assistant', 'content': 'one', 'source_message_id': 'm1', 'source_watermark': 1},
            {'message_id': 'r2', 'sequence': 4, 'author': 'assistant', 'content': 'two', 'source_message_id': 'm2', 'source_watermark': 2},
        ]

    def audit(self):
        return {'todo_id': 'todo', 'task_count': 8, 'baseline_task_count': 8,
            'node_count': 4, 'baseline_node_count': 4, 'attempts': [
                {'source_message_id': source, 'kind': 'planner', 'task_id': None,
                 'node_id': None, 'todo_id': 'todo', 'resource_id': None, 'starts': 1,
                 'commits': 1, 'state': 'SUCCEEDED', 'started': True,
                 'process_released': True, 'process_absent': True,
                 'mutation_allowed': False, 'unresolved_operations': 0}
                for source in ['m1', 'm2']]}

    def test_reply_order_follows_sources_not_append_adjacency(self):
        self.assertTrue(all(reply_checks(self.messages(), ['m1', 'm2']).values()))

    def test_duplicate_wrong_or_empty_reply_is_rejected(self):
        for patch in [{'source_message_id': 'm1'}, {'source_watermark': 1}, {'content': ''}, {'message_id': 'r1'}, {'sequence': 3}]:
            with self.subTest(patch=patch):
                messages = self.messages()
                messages[-1].update(patch)
                self.assertFalse(all(reply_checks(messages, ['m1', 'm2']).values()))

    def test_reordered_reply_is_rejected(self):
        messages = self.messages()
        messages[2], messages[3] = messages[3], messages[2]
        self.assertFalse(all(reply_checks(messages, ['m1', 'm2']).values()))

    def test_complete_todo_evidence_passes(self):
        self.assertTrue(all(completion_checks(self.audit(), ['m1', 'm2']).values()))

    def test_fake_task_or_unsettled_process_is_rejected(self):
        for patch in [{'task_id': 'fake'}, {'resource_id': 'fixture'}, {'todo_id': 'other'},
                      {'starts': 2}, {'commits': 0}, {'started': False},
                      {'state': 'FAILED'}, {'process_absent': False},
                      {'process_released': False}, {'mutation_allowed': True},
                      {'unresolved_operations': 1}]:
            with self.subTest(patch=patch):
                audit = copy.deepcopy(self.audit())
                audit['attempts'][0].update(patch)
                self.assertFalse(all(completion_checks(audit, ['m1', 'm2']).values()))

    def test_missing_or_unrelated_created_work_is_rejected(self):
        audit = self.audit()
        audit['attempts'] = []
        self.assertFalse(all(completion_checks(audit, ['m1', 'm2']).values()))
        audit = self.audit()
        audit['task_count'] += 1
        self.assertFalse(all(completion_checks(audit, ['m1', 'm2']).values()))

    def test_receipt_binds_request_and_todo(self):
        body = {'request_id': 'r', 'todo_id': 't'}
        good = {'request_id': 'r', 'todo_id': 't', 'status': 'committed'}
        self.assertTrue(receipt_matches(good, body))
        for patch in [{'request_id': 'other'}, {'todo_id': 'other'}, {'status': 'unknown'}]:
            self.assertFalse(receipt_matches(good | patch, body))

    def test_uncertain_http_and_json_recover_original_receipt(self):
        body = {'request_id': 'r', 'todo_id': 't'}
        receipt = {'request_id': 'r', 'todo_id': 't', 'status': 'committed'}
        for error in [urllib.error.HTTPError('https://test', 503, 'unavailable', {}, None), ValueError('truncated JSON'), OSError('closed')]:
            probe = object.__new__(DiscussionProbe)
            probe.save = Mock()
            probe.post = Mock(side_effect=error)
            probe.read = Mock(return_value=receipt)
            self.assertEqual(probe.execute(body), receipt)
            probe.post.assert_called_once()
            probe.read.assert_called_once_with('/v1/owner/todos/discussion/commands/r')

    def test_unknown_recovery_replays_same_body_and_rejects_wrong_id(self):
        body = {'request_id': 'r', 'todo_id': 't'}
        receipt = {'request_id': 'r', 'todo_id': 't', 'status': 'committed'}
        probe = object.__new__(DiscussionProbe)
        probe.save = Mock()
        probe.post = Mock(side_effect=[OSError('closed'), receipt])
        probe.read = Mock(return_value={'request_id': 'r', 'status': 'unknown'})
        self.assertEqual(probe.execute(body), receipt)
        self.assertEqual(probe.post.call_args_list[0], probe.post.call_args_list[1])
        probe.read = Mock(return_value={'request_id': 'wrong', 'status': 'unknown'})
        with self.assertRaises(RuntimeError):
            probe.recover('/commands', body)

    def test_recent_then_older_pages_reconstruct_order_and_reject_duplicates(self):
        messages = self.messages()
        pages = [{'todo_id': 't', 'messages': messages[2:], 'cursor': 'older', 'has_more': True},
                 {'todo_id': 't', 'messages': messages[:2], 'cursor': 'end', 'has_more': False}]
        probe = object.__new__(DiscussionProbe)
        probe.read = Mock(side_effect=pages)
        self.assertEqual(probe.messages('t'), messages)
        pages[1]['messages'] = messages[1:3]
        probe.read = Mock(side_effect=pages)
        with self.assertRaises(RuntimeError):
            probe.messages('t')
        pages[0]['messages'] = messages[:1]
        pages[1]['messages'] = messages[1:2]
        probe.read = Mock(side_effect=pages)
        with self.assertRaises(RuntimeError):
            probe.messages('t')

    def test_database_release_does_not_replace_host_absence(self):
        owner = {'pid': 1, 'birth': '42', 'boot_id': 'boot', 'cgroup': '/system.slice/owned.service', 'dispatch_id': 'd', 'phase': 'running'}
        before = {'ownership': owner, 'live_identity': owner | {'present': True}}
        after = {'ownership': owner | {'phase': 'released'}, 'live_identity': {'present': False}, 'physical': {'cgroup_populated': False}}
        self.assertTrue(physically_released(before, after))
        after['physical']['cgroup_populated'] = True
        self.assertFalse(physically_released(before, after))
        after['physical']['cgroup_populated'] = False
        after['live_identity'] = before['live_identity']
        self.assertFalse(physically_released(before, after))
        after['live_identity'] = before['live_identity'] | {'cgroup': '/escaped'}
        self.assertFalse(physically_released(before, after))
        after['live_identity'] = {'present': False}
        before['native_sleep'] = owner | {'pid': 2, 'birth': '43', 'present': True}
        self.assertFalse(physically_released(before, after))
        after['observed_native_sleep'] = before['native_sleep'] | {'cgroup': '/escaped'}
        self.assertFalse(physically_released(before, after))
        after['observed_native_sleep'] = {'present': False}
        self.assertTrue(physically_released(before, after))


if __name__ == '__main__':
    unittest.main()
