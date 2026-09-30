"""Independent negative checks for the native Specification evidence observer."""
import copy
import hashlib
import os
import pathlib
import tempfile
import types
import unittest
from unittest.mock import MagicMock, patch

from task_conversation_probe import canonical_bytes
from task_specification_probe import (authorization_chain_checks, proposal_authority_checks,
    TaskSpecificationProbe)


def sha(value):
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def receipt(command, response):
    return dict(scope_id='task', request_id=command['request_id'],
        envelope_json=canonical_bytes(command).decode(), digest=sha(command), response=response)


def fixture(node=False):
    basis = dict(control_version=1, specification_id='old', plan_id='plan' if node else None)
    if node:
        basis.update(node_id='node', node_activation=1, source_id='node-source')
    impact = dict(graph_sufficient=True, guidance=[], nodes=[])
    if node:
        impact['nodes'] = [dict(node_id='node', node_activation=1, source_id='node-source',
            completion_operation_id=None, completion_manifest_digest=None, disposition='refresh')]
    p = dict(id='proposal', task_id='task', specification='Exact specification', summary='Exact summary',
        impact=impact, source_id=None, input_id=None, specification_digest=sha('Exact specification'),
        impact_digest=sha(impact), input_cutoff='0', base_control_version='1',
        base_specification_id='old', base_plan_id=basis['plan_id'], obligation_id='obligation')
    envelope = {key: p[key] for key in ('task_id', 'specification', 'summary', 'impact',
        'source_id', 'specification_digest', 'impact_digest')}
    envelope.update(proposal_id='proposal', input_cutoff=0, source_input_ids=[], basis=basis)
    p['content_digest'] = sha(envelope)
    edit = dict(schema_version=1, request_id='edit', task_id='task', name='edit_specification',
        payload=dict(proposal_id='proposal', specification=p['specification'], summary=p['summary'],
            basis=basis, impact=impact, source_input_ids=[]))
    response = dict(schema_version=1, request_id='edit', status='admitted', proposal_id='proposal',
        content_digest=p['content_digest'], confirmation_id='authorization', operation_id='change')
    records = dict(task=dict(id='task', specification_id='new', plan_id=basis['plan_id'], state='PLANNING'),
        requirement_proposals=[p], requirement_owner_proposals=[dict(id='proposal', task_id='task',
            action='apply_specification_revision', content=envelope, content_digest=sha(envelope), basis=basis)],
        requirement_sources=[], requirement_attachments=[dict(proposal_id='proposal', task_id='task',
            source_id=None, input_id=None)],
        requirement_changes=[dict(id='change', task_id='task', proposal_id='proposal', authorization_id='authorization',
            admission_request_id='edit', admission_attempt_id=None, status='published', specification_id='new')],
        requirement_authorizations=[dict(id='authorization', task_id='task', proposal_id='proposal', consumed_by='edit')],
        authorization_commands=[dict(authorization_id='authorization', task_id='task', request_id='edit')],
        task_owner_receipts=[receipt(edit, response)], receipts=[], attempts=[],
        requirement_publications=[dict(task_id='task', change_id='change', specification_id='new', parent_id='old', plan_id=basis['plan_id'])],
        specifications=[dict(id='old', task_id='task', content='Old requirement'),
            dict(id='new', task_id='task', content=p['specification'], content_digest=p['specification_digest'], parent_id='old', authorization_id='authorization')],
        requirement_obligations=[dict(id='obligation', status='published', current_proposal_id='proposal')],
        publication_slots=[], plans=[], nodes=[], starts=[], operations=[], planning_sources=[], node_sources=[])
    return records, edit


class SpecificationProbeReviewTests(unittest.TestCase):
    def test_complete_direct_edit_authority_is_accepted(self):
        records, command = fixture()
        checks = proposal_authority_checks(records, 'proposal', [command])
        checks.update(authorization_chain_checks(records, 'proposal'))
        self.assertTrue(all(checks.values()))

    def test_valid_node_basis_is_not_truncated_to_three_task_fields(self):
        records, command = fixture(node=True)
        self.assertTrue(all(proposal_authority_checks(records, 'proposal', [command]).values()))

    def test_authorization_checks_reject_internally_wrong_task_or_request_even_with_valid_hash(self):
        for field, value in [('task_id', 'foreign'), ('request_id', 'foreign')]:
            with self.subTest(field=field):
                records, command = fixture()
                altered = copy.deepcopy(command)
                altered[field] = value
                r = records['task_owner_receipts'][0]
                r['envelope_json'], r['digest'] = canonical_bytes(altered).decode(), sha(altered)
                self.assertFalse(all(authorization_chain_checks(records, 'proposal').values()))

    def test_authorization_checks_reject_wrong_response_request_and_failure_status(self):
        for field, value in [('request_id', 'foreign'), ('status', 'error')]:
            with self.subTest(field=field):
                records, _ = fixture()
                records['task_owner_receipts'][0]['response'][field] = value
                self.assertFalse(all(authorization_chain_checks(records, 'proposal').values()))

    def test_direct_authorization_compares_full_input_not_just_specification_and_impact(self):
        for field, value in [('summary', 'Unapproved summary'),
                ('basis', dict(control_version=2, specification_id='other', plan_id=None)),
                ('source_input_ids', ['unapproved-input'])]:
            with self.subTest(field=field):
                records, command = fixture()
                command['payload'][field] = value
                r = records['task_owner_receipts'][0]
                r['envelope_json'], r['digest'] = canonical_bytes(command).decode(), sha(command)
                # All three observers are normally combined by prestart_edit.
                checks = proposal_authority_checks(records, 'proposal', [command])
                checks.update(authorization_chain_checks(records, 'proposal'))
                self.assertFalse(all(checks.values()))

    def test_prestart_checks_returned_receipt_against_canonical_publication(self):
        after, command = fixture()
        before = copy.deepcopy(after)
        before['task']['specification_id'] = 'old'
        before['task']['control_version'] = 1
        before['specifications'] = before['specifications'][:1]
        stages = []
        probe = object.__new__(TaskSpecificationProbe)
        probe.git_binding = lambda: {'task': {'task_id': 'task'}}
        probe.claim = lambda stage: None
        snapshots = iter([before, after])
        probe.specification_records = lambda task: next(snapshots)
        probe.specification_command = lambda body: {'schema_version': 1, 'request_id': 'edit',
            'status': 'admitted', 'proposal_id': 'other', 'operation_id': 'unrelated'}
        probe.require = lambda stage, evidence, checks: stages.append(checks)
        # Use the exact helper-generated summary so the only disagreement is the API receipt.
        summary = 'Clarify the exact local preservation result.'
        after['requirement_proposals'][0]['summary'] = summary
        after['requirement_owner_proposals'][0]['content']['summary'] = summary
        command['payload']['summary'] = summary
        envelope = after['requirement_owner_proposals'][0]['content']
        after['requirement_owner_proposals'][0]['content_digest'] = sha(envelope)
        after['requirement_proposals'][0]['content_digest'] = sha(envelope)
        r = after['task_owner_receipts'][0]
        r['envelope_json'], r['digest'] = canonical_bytes(command).decode(), sha(command)
        r['response']['content_digest'] = sha(envelope)
        probe.prestart_edit('proposal', 'edit', 'Exact specification')
        self.assertFalse(all(stages[-1].values()))


class SpecificationDriverInstallReviewTests(unittest.TestCase):
    def install_fixture(self, folder):
        root = pathlib.Path(folder)
        source = root / 'source'
        (source / 'infra/probe').mkdir(parents=True)
        (source / 'infra/probe/task_specification_driver.py').write_bytes(b'# exact driver bytes\n')
        actual = root / 'task_specification_driver.py'
        target = MagicMock(wraps=actual)
        target.stat.side_effect = lambda: types.SimpleNamespace(st_uid=0, st_mode=actual.stat().st_mode)
        probe = object.__new__(TaskSpecificationProbe)
        probe.source = source
        probe.save = MagicMock()
        return probe, actual, target

    def install(self, probe, target):
        with patch('task_specification_probe.pathlib', types.SimpleNamespace(Path=lambda value: target)), \
                patch('task_specification_probe.TaskConversationProbe.install_node_drivers') as parent:
            probe.install_node_drivers()
            parent.assert_called_once_with()

    def test_install_is_readable_under_private_umask_and_records_exact_hash(self):
        with tempfile.TemporaryDirectory() as folder:
            probe, actual, target = self.install_fixture(folder)
            previous = os.umask(0o077)
            try:
                self.install(probe, target)
            finally:
                os.umask(previous)
            self.assertEqual(actual.stat().st_mode & 0o777, 0o644)
            self.assertEqual(actual.read_bytes(), b'# exact driver bytes\n')
            probe.save.assert_called_once_with('specification-driver-hash',
                {'sha256': hashlib.sha256(actual.read_bytes()).hexdigest()})
            before = actual.stat().st_mtime_ns
            self.install(probe, target)
            self.assertEqual(actual.stat().st_mtime_ns, before)

    def test_existing_untrusted_or_different_driver_is_preserved(self):
        for invalid in ('different-bytes', 'symlink', 'writable', 'foreign-owner'):
            with self.subTest(invalid=invalid), tempfile.TemporaryDirectory() as folder:
                probe, actual, target = self.install_fixture(folder)
                if invalid == 'symlink':
                    actual.symlink_to(pathlib.Path(folder) / 'missing')
                else:
                    actual.write_bytes(b'foreign' if invalid == 'different-bytes' else b'# exact driver bytes\n')
                    actual.chmod(0o666 if invalid == 'writable' else 0o644)
                    if invalid == 'foreign-owner':
                        target.stat.side_effect = lambda: types.SimpleNamespace(st_uid=1000, st_mode=actual.stat().st_mode)
                with self.assertRaisesRegex(RuntimeError, 'Preserve'):
                    self.install(probe, target)
                probe.save.assert_not_called()
                if invalid == 'symlink':
                    self.assertTrue(actual.is_symlink())
                elif invalid == 'different-bytes':
                    self.assertEqual(actual.read_bytes(), b'foreign')

    def test_retained_private_mode_cannot_be_reported_as_usable_driver(self):
        # A prior process can die after writing/fsync but before chmod(0644).
        # A matching root-owned 0600 file remains unreadable to native Agents.
        with tempfile.TemporaryDirectory() as folder:
            probe, actual, target = self.install_fixture(folder)
            actual.write_bytes(b'# exact driver bytes\n')
            actual.chmod(0o600)
            try:
                self.install(probe, target)
            except RuntimeError:
                probe.save.assert_not_called()
            else:
                self.assertTrue(actual.stat().st_mode & 0o004,
                    'successful installation retained an Agent-unreadable driver')

    def test_failed_fsync_cannot_record_a_successful_installation(self):
        with tempfile.TemporaryDirectory() as folder:
            probe, _, target = self.install_fixture(folder)
            with patch('task_specification_probe.os.fsync', side_effect=OSError('injected fsync failure')):
                with self.assertRaises(OSError):
                    self.install(probe, target)
            probe.save.assert_not_called()


if __name__ == '__main__':
    unittest.main()
