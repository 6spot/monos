import copy
import hashlib
import json
import unittest
from unittest.mock import Mock

from task_conversation_probe import canonical_bytes
from task_replan_probe import (TaskReplanProbe, publication_checks, workspace_transfer_checks,
    joint_authorization_checks, preparation_checks, native_receipts_bound)


def receipt(request, name, payload, result):
    envelope = dict(schema_version=1, request_id=request, task_id='t', name=name, payload=payload)
    raw = canonical_bytes(envelope)
    return dict(scope_id='t', request_id=request, envelope_json=raw.decode(),
        digest=hashlib.sha256(raw).hexdigest(), response=dict(status='committed', request_id=request, **result))


def fixture():
    basis = dict(control_version=7, specification_id='s', plan_id='old')
    content = dict(replan_request_id='r', source_id='source', proposal_id='p', plan_id='new',
        nodes=[{'node_id': 'new-node'}], summary='Replace work', basis=basis, input_cutoff=2)
    digest = hashlib.sha256(canonical_bytes(content)).hexdigest()
    return dict(task=dict(id='t', plan_id='new', specification_id='s'),
        replan_proposals=[dict(id='p', task_id='t', request_id='r', plan_id='new', content=content, content_digest=digest)],
        replan_requests=[dict(id='r', task_id='t', status='published', proposal_id='p')],
        replan_publications=[dict(id='pub', task_id='t', request_id='r', proposal_id='p',
            authorization_id='a', owner_request_id='publish', old_plan_id='old', new_plan_id='new',
            old_specification_id='s', new_specification_id='s', requirement_change_id=None)],
        replan_owner_proposals=[dict(id='p', task_id='t', action='publish_replan', content=content, content_digest=digest)],
        replan_authorizations=[dict(id='a', proposal_id='p', consumed_by='publish')],
        replan_authorization_commands=[dict(authorization_id='a', task_id='t', request_id='confirm')],
        plans=[dict(id='new', task_id='t', specification_id='s', content={'node_ids': ['new-node'], 'nodes': content['nodes']}, content_digest=hashlib.sha256(canonical_bytes({'node_ids': ['new-node'], 'nodes': content['nodes']})).hexdigest())], plan_membership=[dict(task_id='t', plan_id='new', node_id='new-node', definition=content['nodes'][0])], specifications=[dict(id='s', task_id='t')],
        requirement_proposals=[], requirement_changes=[], publication_slots=[],
        task_owner_receipts=[receipt('confirm', 'confirm_replan', dict(proposal_id='p', content_digest=digest),
            dict(confirmation_id='a')), receipt('publish', 'publish_replan',
            dict(proposal_id='p', confirmation_id='a', basis=basis), dict(publication_id='pub'))])


def preparation_fixture():
    records = fixture()
    p = records['replan_proposals'][0]
    p['source_id'] = 'source'
    context = {'reason': 'Replace formal work'}
    prompt = canonical_bytes(context).decode()
    source = dict(id='source', task_id='t', request_id='r', planned_attempt_id='a',
        specification_id='s', plan_id='old', expected_version=7, context=context,
        prompt=prompt, context_digest=hashlib.sha256(prompt.encode()).hexdigest())
    binding = dict(request_id='r', source_id='source', specification_id='s', plan_id='old',
        control_version=7, context_digest=source['context_digest'])
    records['replan_sources'] = [source]
    records['attempts'] = [dict(id='a', task_id='t', kind='planner', replan_source_id='source',
        state='SUCCEEDED', mutation_allowed=False, process_absent=True, process_released=True,
        launch=dict(task_replan_source=binding, prompt=prompt, workspace_reservations={'resources': []}))]
    payload = {k: v for k, v in p['content'].items() if k != 'input_cutoff'}
    command = dict(name='prepare_replan', scope_id='t', request_id='prepare', expected_control_version=7, payload=payload)
    raw = canonical_bytes(command)
    digest = hashlib.sha256(raw).hexdigest()
    records['receipts'] = [dict(attempt_id='a', scope_id='t', request_id='prepare',
        command_name='prepare_replan', operation_id='stop', envelope_json=raw.decode(), digest=digest,
        response=dict(status='committed', request_id='prepare', operation_id='stop', result={'replan_outcome':
            dict(kind='proposal', proposal_id='p', source_id='source', replan_request_id='r',
                content_digest=p['content_digest'])}))]
    records['operations'] = [dict(id='stop', attempt_id='a', request_id='prepare', kind='stop',
        state='succeeded', repository_free=None, resource_id=None, workspace_descriptor=None,
        workspace_digest=None, workspace_lease_id=None, completion_manifest_digest=None,
        completion_operation_id=None, completion_identity_digest=None, completion_settlement=None,
        settlement_purpose=None, cancelled_by_operation_id=None, result={'writer_absent': True})]
    records['starts'] = [{'attempt_id': 'a'}]
    records['lease_records'] = []
    native = dict(planning_requests=[dict(request_id='prepare', digest=digest,
        digest_matches_bytes=True, envelope=command)])
    return records, native


class ReplanProbeTests(unittest.TestCase):
    def test_native_phase_commands_bind_exact_request_bytes_without_fixed_attempt_count(self):
        command = dict(request_id='r', scope_id='t', name='request_replan', payload={'reason': 'New goal'})
        raw = canonical_bytes(command)
        digest = hashlib.sha256(raw).hexdigest()
        records = dict(task={'id': 't'}, receipts=[dict(attempt_id='a', request_id='r', scope_id='t',
            command_name='request_replan', envelope_json=raw.decode(), digest=digest,
            response={'request_id': 'r'})])
        native = {'a': {'planning_requests': [dict(request_id='r', digest=digest,
            digest_matches_bytes=True, envelope=command)]}}
        required = {'a': ['request_replan']}
        self.assertTrue(native_receipts_bound(records, native, required))
        self.assertFalse(native_receipts_bound(records, native, {'a': ['complete_node']}))
        self.assertFalse(native_receipts_bound(records, native, {'other': ['request_replan']}))
        changed = copy.deepcopy(records)
        changed['receipts'][0]['response']['request_id'] = 'other'
        self.assertFalse(native_receipts_bound(changed, native, required))

    def test_preparation_binds_native_bytes_and_actual_planner_release(self):
        records, native = preparation_fixture()
        self.assertTrue(all(preparation_checks(records, 'p', native).values()))
        for table, key, value in [('attempts', 'process_released', False),
                ('operations', 'repository_free', True), ('replan_sources', 'context_digest', 'wrong'),
                ('receipts', 'command_name', 'raise_planning_issue')]:
            changed = copy.deepcopy(records)
            changed[table][0][key] = value
            self.assertFalse(all(preparation_checks(changed, 'p', native).values()))
        changed_native = copy.deepcopy(native)
        changed_native['planning_requests'][0]['envelope']['payload']['summary'] = 'substituted'
        self.assertFalse(preparation_checks(records, 'p', changed_native)['one_terminal_native_preparation'])

    def test_prepared_stop_rejects_workspace_and_completion_authority(self):
        records, native = preparation_fixture()
        for field, value in [('repository_free', True), ('repository_free', False),
                ('resource_id', ''), ('workspace_descriptor', {}), ('workspace_digest', 'digest'),
                ('workspace_lease_id', 'lease'), ('completion_manifest_digest', 'manifest'),
                ('completion_operation_id', 'completion'), ('completion_identity_digest', 'identity'),
                ('completion_settlement', {}), ('settlement_purpose', 'correct'),
                ('cancelled_by_operation_id', 'other')]:
            with self.subTest(field=field, value=value):
                changed = copy.deepcopy(records)
                changed['operations'][0][field] = value
                self.assertFalse(preparation_checks(changed, 'p', native)['prepared_planner_physically_released'])

    def test_prepared_stop_requires_successful_whole_process_absence(self):
        records, native = preparation_fixture()
        for result in (None, {}, {'writer_absent': False}, {'writer_absent': 1}):
            with self.subTest(result=result):
                changed = copy.deepcopy(records)
                changed['operations'][0]['result'] = result
                self.assertFalse(preparation_checks(changed, 'p', native)['prepared_planner_physically_released'])
        changed = copy.deepcopy(records)
        del changed['operations'][0]['result']
        self.assertFalse(preparation_checks(changed, 'p', native)['prepared_planner_physically_released'])
        changed = copy.deepcopy(records)
        changed['operations'][0]['state'] = 'recovery'
        self.assertFalse(preparation_checks(changed, 'p', native)['prepared_planner_physically_released'])

    def test_prepared_stop_cannot_report_git_or_workspace_results(self):
        records, native = preparation_fixture()
        for field, value in [('workspace_id', 'workspace'), ('workspace_metadata', {}),
                ('path', ''), ('instruction_files', []), ('git_commit', 'commit'),
                ('git_tree', 'tree'), ('workspace_unavailable_reason', 'unavailable')]:
            with self.subTest(field=field):
                changed = copy.deepcopy(records)
                changed['operations'][0]['result'][field] = value
                self.assertFalse(preparation_checks(changed, 'p', native)['prepared_planner_physically_released'])

    def test_prepared_stop_binds_the_exact_terminal_receipt_identity(self):
        records, native = preparation_fixture()
        for table, field in [('operations', 'id'), ('operations', 'request_id'),
                ('operations', 'attempt_id'), ('receipts', 'operation_id')]:
            with self.subTest(table=table, field=field):
                changed = copy.deepcopy(records)
                changed[table][0][field] = 'other'
                self.assertFalse(preparation_checks(changed, 'p', native)['prepared_planner_physically_released'])
        changed = copy.deepcopy(records)
        changed['receipts'][0]['response']['operation_id'] = 'other'
        self.assertFalse(preparation_checks(changed, 'p', native)['prepared_planner_physically_released'])

    def test_joint_approval_cannot_be_replaced_by_standalone_apply_receipt(self):
        records = fixture()
        graph = records['replan_proposals'][0]
        graph.update(source_id='source', requirement_proposal_id='req')
        impact = dict(graph_sufficient=False, replan_proposal_id='p', replan_request_id='r')
        spec_hash = hashlib.sha256(canonical_bytes('full requirements')).hexdigest()
        impact_hash = hashlib.sha256(canonical_bytes(impact)).hexdigest()
        envelope = dict(task_id='t', proposal_id='req', specification='full requirements',
            summary='Requirement summary', impact=impact, source_id=None, replan_source_id='source',
            basis=graph['content']['basis'], source_input_ids=[], input_cutoff=2,
            specification_digest=spec_hash, impact_digest=impact_hash)
        req_hash = hashlib.sha256(canonical_bytes(envelope)).hexdigest()
        spec_hash = hashlib.sha256(canonical_bytes(envelope['specification'])).hexdigest()
        graph['content']['requirement_content_digest'] = req_hash
        records['replan_publications'][0].update(requirement_change_id='change', new_specification_id='new-spec')
        records['requirement_proposals'] = [dict(id='req', task_id='t', obligation_id='obligation',
            replan_source_id='source', specification='full requirements', impact=impact,
            content_digest=req_hash, specification_digest=spec_hash, summary='Requirement summary',
            input_cutoff=2, base_control_version=7, base_specification_id='s', base_plan_id='old',
            impact_digest=hashlib.sha256(canonical_bytes(impact)).hexdigest())]
        records['requirement_owner_proposals'] = [dict(id='req', task_id='t',
            action='apply_specification_revision', content=envelope, content_digest=req_hash)]
        records['requirement_changes'] = [dict(id='change', authorization_id='req-auth',
            admission_request_id='publish', specification_id='new-spec')]
        records['requirement_authorizations'] = [dict(id='req-auth', proposal_id='req', consumed_by='publish')]
        records['authorization_commands'] = [dict(authorization_id='req-auth', task_id='t', request_id='req-confirm')]
        records['requirement_obligations'] = [dict(id='obligation', current_proposal_id='req', status='published')]
        records['requirement_attachments'] = [dict(task_id='t', proposal_id='req', replan_source_id='source')]
        records['requirement_sources'] = []
        records['requirement_publications'] = [dict(change_id='change', parent_id='s',
            specification_id='new-spec', plan_id='new')]
        records['specifications'] = [dict(id='new-spec', content='full requirements',
            content_digest=spec_hash, parent_id='s', authorization_id='req-auth')]
        confirm = receipt('req-confirm', 'confirm_specification',
            dict(proposal_id='req', content_digest=req_hash), dict(confirmation_id='req-auth'))
        publish = receipt('publish', 'publish_replan', dict(proposal_id='p', requirement_confirmation_id='req-auth'),
            dict(publication_id='pub'))
        records['task_owner_receipts'] = [confirm, publish]
        commands = [json.loads(r['envelope_json']) for r in (confirm, publish)]
        self.assertTrue(all(joint_authorization_checks(records, 'p', commands).values()))
        for table, key, value in [('requirement_authorizations', 'consumed_by', 'standalone'),
                ('requirement_publications', 'plan_id', 'old'),
                ('requirement_attachments', 'replan_source_id', 'foreign'),
                ('requirement_obligations', 'status', 'withdrawn'),
                ('requirement_proposals', 'summary', 'changed'),
                ('requirement_proposals', 'base_control_version', 99)]:
            changed = copy.deepcopy(records)
            changed[table][0][key] = value
            self.assertFalse(all(joint_authorization_checks(changed, 'p', commands).values()))
        changed = copy.deepcopy(records)
        changed['task_owner_receipts'][1] = receipt('publish', 'apply_specification_revision',
            commands[1]['payload'], dict(publication_id='pub'))
        self.assertFalse(joint_authorization_checks(changed, 'p', commands)['joint_requirement_same_atomic_consumption'])

    def test_transfer_cannot_mix_root_proof_with_foreign_lease_or_plan(self):
        scope = dict(task_id='t', workspace_id='w', resource_id='r', runner_id='runner')
        metadata = dict(lease_id='old', checkpoint={'operation_id': 'stop', 'tree_id': 'tree'})
        old_input = scope | dict(from_plan_id='historical', from_node_id='old-node',
            from_node_activation=1, from_attempt_id='old-attempt', from_lease_id='old',
            settle_operation_id='stop', kind='checkpoint', metadata=metadata)
        transfer = old_input | dict(publication_id='pub', proposal_id='p', to_plan_id='new',
            to_node_id='new-node', to_node_activation=1)
        descriptor = scope | dict(lease_id='new', node_id='new-node', node_activation=1, transfer=transfer)
        old_descriptor = scope | dict(lease_id='old', node_id='old-node', node_activation=1)
        root = dict(released=True, operation=dict(attempt_id='old-attempt', workspace=old_descriptor),
            metadata={'lease_id': 'old'}, private_checkpoint=metadata['checkpoint'])
        records = dict(task={'id': 't'}, replan_publications=[dict(id='pub', task_id='t',
            proposal_id='p', old_plan_id='recent', new_plan_id='new')],
            replan_proposals=[dict(id='p', task_id='t', content={'impact': {'workspaces': [old_input]}})],
            replan_transfers=[dict(task_id='t', publication_id='pub', workspace_id='w',
                target_node_id='new-node', target_node_activation=1, descriptor=transfer)],
            operations=[dict(id='open', kind='open_workspace', state='succeeded', attempt_id='new-attempt',
                workspace_descriptor=descriptor, workspace_lease_id='new',
                workspace_digest=hashlib.sha256(canonical_bytes(descriptor)).hexdigest())],
            lease_records=[dict(id='old', task_id='t', workspace_id='w', node_id='old-node',
                node_activation=1, attempt_id='old-attempt', state='released', settle_operation_id='stop'),
                dict(id='new', task_id='t', workspace_id='w', node_id='new-node', node_activation=1,
                    attempt_id='new-attempt')],
            attempts=[dict(id='old-attempt', task_id='t', runner_id='runner', node_execution_source_id='old-source'),
                dict(id='new-attempt', task_id='t', runner_id='runner', node_execution_source_id='new-source')],
            node_sources=[dict(id='old-source', task_id='t', plan_id='historical', node_id='old-node', node_activation=1),
                dict(id='new-source', task_id='t', plan_id='new', node_id='new-node', node_activation=1)])
        self.assertTrue(all(workspace_transfer_checks(records, 'pub', 'open', root).values()))
        for table, index, key, value in [('node_sources', 0, 'plan_id', 'recent'),
                ('lease_records', 0, 'state', 'held'), ('lease_records', 1, 'task_id', 'foreign'),
                ('attempts', 1, 'runner_id', 'foreign'), ('node_sources', 1, 'node_activation', 2),
                ('operations', 0, 'workspace_digest', 'wrong')]:
            changed = copy.deepcopy(records)
            changed[table][index][key] = value
            self.assertFalse(all(workspace_transfer_checks(changed, 'pub', 'open', root).values()))
        self.assertFalse(all(workspace_transfer_checks(records, 'pub', 'open', root | {'released': False}).values()))

    def test_graph_authority_needs_exact_receipts_not_just_consumed_token(self):
        records = fixture()
        commands = [json.loads(r['envelope_json']) for r in records['task_owner_receipts']]
        self.assertTrue(all(publication_checks(records, 'p', commands).values()))
        for table, key, value in [('replan_authorizations', 'consumed_by', 'unrelated'),
                ('replan_authorization_commands', 'request_id', 'publish'),
                ('replan_requests', 'status', 'dismissed'),
                ('replan_publications', 'old_plan_id', 'foreign'),
                ('replan_publications', 'new_specification_id', 'foreign'),
                ('replan_owner_proposals', 'action', 'apply_specification_revision'),
                ('replan_proposals', 'content_digest', 'wrong'),
                ('plans', 'task_id', 'foreign'), ('plans', 'content', {}),
                ('plan_membership', 'definition', {'node_id': 'forged'}),
                ('replan_requests', 'proposal_id', 'other')]:
            changed = copy.deepcopy(records)
            changed[table][0][key] = value
            self.assertFalse(all(publication_checks(changed, 'p', commands).values()), (table, key))
        changed = copy.deepcopy(records)
        changed['task_owner_receipts'][0] = receipt('confirm', 'submit_task_message',
            json.loads(records['task_owner_receipts'][0]['envelope_json'])['payload'], dict(confirmation_id='a'))
        self.assertFalse(publication_checks(changed, 'p', commands)['exact_graph_confirmation'])
        changed = copy.deepcopy(records)
        changed['publication_slots'].append(dict(operation_id='other'))
        self.assertFalse(publication_checks(changed, 'p', commands)['publication_slot_released'])
        changed = copy.deepcopy(records)
        changed['replan_publications'].append(copy.deepcopy(changed['replan_publications'][0]))
        self.assertFalse(publication_checks(changed, 'p', commands)['one_exact_graph_publication'])

    def test_record_observation_is_one_statement_and_command_evidence_precedes_send(self):
        probe = object.__new__(TaskReplanProbe)
        probe.query = Mock(return_value={})
        self.assertEqual(probe.replan_records('task'), {})
        probe.query.assert_called_once()
        sql = probe.query.call_args.args[0]
        self.assertEqual(sql.count('jsonb_build_object('), 2)
        self.assertIn(') || jsonb_build_object(', sql)
        for table in ('replan_sources', 'replan_workspace_transfers', 'replan_control_holds',
                'requirement_changes', 'plan_nodes'):
            self.assertIn(table, sql)
        probe.preserve = Mock(side_effect=OSError('full'))
        probe.post = Mock()
        with self.assertRaises(OSError):
            probe.replan_command(dict(task_id='task', request_id='request'))
        probe.post.assert_not_called()

    def test_uncertain_command_recovers_original_receipt_before_any_resubmit(self):
        probe = object.__new__(TaskReplanProbe)
        probe.preserve = Mock()
        probe.post = Mock(side_effect=TimeoutError('unknown'))
        original = dict(status='committed', request_id='request', publication_id='pub')
        probe.read = Mock(return_value=original)
        body = dict(task_id='task', request_id='request', name='publish_replan', payload={})
        self.assertEqual(probe.replan_command(body), original)
        probe.post.assert_called_once_with('/v1/owner/tasks/replan/commands', body)
        probe.read.assert_called_once_with('/v1/owner/tasks/task/replan/commands/request')


if __name__ == '__main__':
    unittest.main()
