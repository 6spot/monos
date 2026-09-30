import copy
import hashlib
import json
import pathlib
import shlex
import unittest
from unittest.mock import patch

from task_specification_probe import (TaskSpecificationProbe, driver_command, publication_checks,
    proposal_authority_checks, authorization_chain_checks)
from task_conversation_probe import canonical_bytes


def digest(value):
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


class SpecificationProbeTests(unittest.TestCase):
    def test_consumption_requires_exact_confirmation_and_admission_receipts(self):
        def receipt(request, name, payload, response):
            envelope = dict(schema_version=1, request_id=request, task_id='t', name=name, payload=payload)
            return dict(request_id=request, scope_id='t', envelope_json=canonical_bytes(envelope).decode(),
                digest=digest(envelope), response=response)
        records = dict(requirement_proposals=[dict(id='p', task_id='t', content_digest='content')],
            requirement_changes=[dict(id='c', proposal_id='p', authorization_id='a',
                admission_request_id='apply', admission_attempt_id=None)],
            requirement_authorizations=[dict(id='a', proposal_id='p', consumed_by='apply')],
            authorization_commands=[dict(authorization_id='a', task_id='t', request_id='confirm')],
            receipts=[], attempts=[], task_owner_receipts=[
                receipt('confirm', 'confirm_specification', dict(proposal_id='p', content_digest='content'),
                    dict(request_id='confirm', status='committed', confirmation_id='a')),
                receipt('apply', 'apply_specification_revision', dict(proposal_id='p', confirmation_id='a'),
                    dict(request_id='apply', status='admitted', operation_id='c'))])
        self.assertTrue(all(authorization_chain_checks(records, 'p').values()))
        for table, key, value in [('requirement_authorizations', 'consumed_by', 'unrelated'),
                ('authorization_commands', 'request_id', 'apply'),
                ('requirement_changes', 'admission_attempt_id', 'foreign')]:
            changed = copy.deepcopy(records)
            changed[table][0][key] = value
            self.assertFalse(all(authorization_chain_checks(changed, 'p').values()))
        changed = copy.deepcopy(records)
        changed['task_owner_receipts'][0] = receipt('confirm', 'submit_task_message',
            dict(proposal_id='p', content_digest='content'), dict(confirmation_id='a'))
        self.assertFalse(all(authorization_chain_checks(changed, 'p').values()))
        changed = copy.deepcopy(records)
        changed['task_owner_receipts'][1]['response']['operation_id'] = 'other'
        self.assertFalse(all(authorization_chain_checks(changed, 'p').values()))

    def test_authority_rejects_substituted_summary_source_attachment_and_receipt(self):
        proposal = dict(id='p', task_id='t', specification='full', summary='summary',
            impact={}, source_id=None, input_id=None, specification_digest=digest('full'),
            impact_digest=digest({}), input_cutoff='0', base_control_version='1',
            base_specification_id='s', base_plan_id=None)
        envelope = {k: proposal[k] for k in ('task_id', 'specification', 'summary', 'impact',
            'source_id', 'specification_digest', 'impact_digest')}
        envelope.update(proposal_id='p', source_input_ids=[], input_cutoff=0,
            basis=dict(control_version=1, specification_id='s', plan_id=None))
        command = dict(schema_version=1, request_id='r', task_id='t',
            name='confirm_specification', payload=dict(proposal_id='p', content_digest=digest(envelope)))
        records = dict(requirement_proposals=[proposal], requirement_owner_proposals=[
            dict(id='p', task_id='t', action='apply_specification_revision', content=envelope)],
            requirement_sources=[], requirement_attachments=[dict(proposal_id='p', task_id='t',
                source_id=None, input_id=None)], task_owner_receipts=[dict(request_id='r', scope_id='t',
                envelope_json=canonical_bytes(command).decode(), digest=digest(command),
                response=dict(request_id='r', proposal_id='p', status='committed'))])
        self.assertTrue(all(proposal_authority_checks(records, 'p', [command]).values()))
        for table, key, value in [('requirement_proposals', 'summary', 'changed'),
                ('requirement_proposals', 'source_id', 'foreign'),
                ('requirement_attachments', 'input_id', 'foreign'),
                ('task_owner_receipts', 'scope_id', 'foreign'),
                ('task_owner_receipts', 'digest', 'wrong')]:
            changed = copy.deepcopy(records)
            changed[table][0][key] = value
            self.assertFalse(all(proposal_authority_checks(changed, 'p', [command]).values()))
        changed = copy.deepcopy(records)
        changed['requirement_sources'] = [dict(proposal_id='p', task_id='t', input_id='hidden')]
        self.assertFalse(all(proposal_authority_checks(changed, 'p', [command]).values()))

    def test_invocation_survives_shell_parsing_and_uses_direct_script_execution(self):
        command = shlex.split(driver_command('task-a', 'repo', 'prior-a', 'spec-b', 'complete'))
        self.assertEqual(command[:2], ['python3', '-c'])
        with patch('pathlib.Path.cwd', return_value=pathlib.Path('/var/lib/monos-probe/execution/current-a/scratch')), \
                patch('os.execv') as execute:
            exec(compile(command[2], '<native-invocation>', 'exec'), {})
        args = execute.call_args.args[1]
        self.assertEqual(args[1], '/var/lib/monos-probe/probe-tools/task_specification_driver.py')
        self.assertEqual(args[2:4], ['--attempt', 'current-a'])
        self.assertEqual(args[args.index('--specification') + 1], 'spec-b')
        with self.assertRaises(ValueError):
            driver_command('task;bad', 'repo', 'prior', 'spec', 'hold')
        with self.assertRaises(ValueError):
            driver_command('task', 'repo', 'prior', 'spec', 'unknown')

    def test_extended_records_use_one_statement_snapshot(self):
        probe = object.__new__(TaskSpecificationProbe)
        calls = []
        probe.query = lambda sql: calls.append(sql) or {'snapshot': True}
        self.assertEqual(probe.specification_records('task'), {'snapshot': True})
        self.assertEqual(len(calls), 1)
        self.assertIn('task_conversation_outbox', calls[0])
        self.assertIn('requirement_changes', calls[0])
        self.assertIn('specification_node_applicability', calls[0])
        self.assertIn('authorization_receipts', calls[0])
        self.assertIn('node_completions', calls[0])

    def test_publication_must_bind_actual_revision_authorization_and_closed_slot(self):
        impact = {'graph_sufficient': True, 'nodes': [], 'guidance': []}
        envelope = {'task_id': 'task', 'specification': 'new', 'impact': impact}
        proposal = {'id': 'proposal', 'task_id': 'task', 'specification': 'new',
            'impact': impact, 'obligation_id': 'obligation', 'base_specification_id': 'old',
            'base_plan_id': None, 'specification_digest': digest('new'),
            'impact_digest': digest(impact), 'content_digest': digest(envelope)}
        records = {'task': {'id': 'task', 'specification_id': 'new-id', 'plan_id': None},
            'requirement_proposals': [proposal],
            'requirement_changes': [{'id': 'change', 'task_id': 'task', 'proposal_id': 'proposal',
                'status': 'published', 'specification_id': 'new-id', 'authorization_id': 'auth',
                'admission_request_id': 'request'}],
            'requirement_publications': [{'task_id': 'task', 'change_id': 'change',
                'specification_id': 'new-id', 'parent_id': 'old', 'plan_id': None}],
            'specifications': [{'id': 'new-id', 'task_id': 'task', 'parent_id': 'old',
                'content': 'new', 'content_digest': digest('new'), 'authorization_id': 'auth'}],
            'requirement_owner_proposals': [{'id': 'proposal', 'content': envelope,
                'content_digest': digest(envelope)}],
            'requirement_authorizations': [{'id': 'auth', 'proposal_id': 'proposal', 'consumed_by': 'request'}],
            'requirement_obligations': [{'id': 'obligation', 'status': 'published', 'current_proposal_id': 'proposal'}],
            'publication_slots': []}
        self.assertTrue(all(publication_checks(records, 'proposal').values()))
        for table, field, value in [('requirement_changes', 'status', 'settling'),
                ('requirement_publications', 'parent_id', 'other'),
                ('specifications', 'content', 'wrong'),
                ('requirement_authorizations', 'proposal_id', 'other'),
                ('requirement_authorizations', 'consumed_by', None),
                ('requirement_proposals', 'impact_digest', 'bad'),
                ('requirement_obligations', 'status', 'pending')]:
            changed = copy.deepcopy(records)
            changed[table][0][field] = value
            self.assertFalse(all(publication_checks(changed, 'proposal').values()), (table, field))
        changed = copy.deepcopy(records)
        changed['publication_slots'] = [{'operation_id': 'change'}]
        self.assertFalse(all(publication_checks(changed, 'proposal').values()))


if __name__ == '__main__':
    unittest.main()
