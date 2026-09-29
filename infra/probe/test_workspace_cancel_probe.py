"""Cancellation evidence regressions; no native/provider claim."""
import copy
import unittest

from workspace_cancel_probe import cancellation_checks
from test_workspace_probe import native_fixture


def fixture():
    before = native_fixture(unavailable=True)
    before['live_identity'] = {**before['ownership'], 'present': True}
    after = copy.deepcopy(before)
    after['live_identity'] = {'present': False}
    opened = after['operations'][0]
    opened.update(state='cancelled', cancelled_by_operation_id='stop', result={'writer_absent': True})
    after['operations'].append({**copy.deepcopy(opened), 'id': 'stop', 'kind': 'stop', 'state': 'succeeded'})
    leases = [{'id': 'lease', 'state': 'released', 'settle_operation_id': 'stop', 'attempt_id': 'first',
        'open_operation_id': 'open', 'workspace_id': before['driver']['workspace_id']}]
    workspaces = [{'id': before['driver']['workspace_id'], 'ever_materialized': False}]
    receipt = {'status': 'error', 'request_id': 'unavailable-open', 'operation_id': 'open'}
    return before, after, leases, workspaces, receipt


class CancellationEvidenceTests(unittest.TestCase):
    def test_cancellation_requires_native_scope_and_lease_ownership(self):
        for field in ('attempt_id', 'workspace_id', 'open_operation_id'):
            values = fixture()
            values[2][0][field] = 'unrelated'
            self.assertFalse(cancellation_checks(*values))
        for index in (0, 1):
            values = fixture()
            values[index]['journal_requests'] = []
            self.assertFalse(cancellation_checks(*values))

    def test_exact_unexposed_cancellation(self):
        self.assertTrue(cancellation_checks(*fixture()))

    def test_ready_or_success_payload_cannot_be_cancelled(self):
        for field in ('workspace_id', 'path', 'workspace_metadata', 'git_commit', 'git_tree'):
            values = fixture()
            values[1]['operations'][0]['result'][field] = 'unexpected'
            with self.subTest(field=field):
                self.assertFalse(cancellation_checks(*values))
        values = fixture()
        values[3][0]['ever_materialized'] = True
        self.assertFalse(cancellation_checks(*values))

    def test_wrong_stop_or_lease_link_fails(self):
        for field in ('cancelled_by_operation_id', 'workspace_lease_id', 'id'):
            values = fixture()
            values[1]['operations'][0][field] = 'other'
            with self.subTest(field=field):
                self.assertFalse(cancellation_checks(*values))

    def test_new_identity_live_process_or_unreleased_lease_fails(self):
        values = fixture()
        values[1]['live_identity'] = {**values[0]['live_identity'], 'cgroup': '/escaped'}
        self.assertFalse(cancellation_checks(*values))
        values = fixture()
        values[1]['ownership']['pid'] += 1
        self.assertFalse(cancellation_checks(*values))
        values = fixture()
        values[2][0]['state'] = 'settling'
        self.assertFalse(cancellation_checks(*values))

    def test_unknown_receipt_or_duplicate_operation_fails(self):
        values = fixture()
        values[4]['status'] = 'unknown'
        self.assertFalse(cancellation_checks(*values))
        values = fixture()
        values[1]['operations'].append(copy.deepcopy(values[1]['operations'][0]))
        self.assertFalse(cancellation_checks(*values))


if __name__ == '__main__':
    unittest.main()
