#!/usr/bin/env python3
"""Read-only Replan observations and exact, retained Owner command envelopes."""
import hashlib
import json
import os
import pathlib
import urllib.error

from probe import checked_id
from task_conversation_probe import canonical_bytes
from task_specification_probe import REQUIREMENT_TABLES, TaskSpecificationProbe


REPLAN_TABLES = REQUIREMENT_TABLES | {
    'replan_requests': 'replan_requests',
    'replan_sources': 'replan_sources',
    'replan_live_attempts': 'replan_live_attempts',
    'replan_issues': 'replan_issues',
    'replan_decisions': 'replan_decisions',
    'replan_proposals': 'replan_proposals',
    'replan_publications': 'replan_publications',
    'replan_applicability': 'replan_node_applicability',
    'replan_transfers': 'replan_workspace_transfers',
    'replan_guidance': 'replan_guidance_applicability',
    'replan_holds': 'replan_control_holds',
    'replan_deferrals': 'replan_input_deferrals',
    'replan_owner_proposals': '(SELECT g.* FROM task_command_proposals g JOIN replan_proposals p ON p.id=g.id)',
    'replan_authorizations': '(SELECT a.*,p.task_id FROM authorization_receipts a JOIN replan_proposals p ON p.id=a.proposal_id)',
    'replan_authorization_commands': 'replan_authorization_commands',
}


def one(rows):
    return rows[0] if len(rows) == 1 else {}


def owner_receipt(records, task, request):
    row = one([r for r in records['task_owner_receipts']
        if r['scope_id'] == task and r['request_id'] == request])
    raw = row.get('envelope_json', '{}')
    envelope = json.loads(raw)
    valid = bool(row) and canonical_bytes(envelope).decode() == raw \
        and hashlib.sha256(raw.encode()).hexdigest() == row.get('digest') \
        and envelope.get('task_id') == task and envelope.get('request_id') == request \
        and row.get('response', {}).get('request_id') == request \
        and row.get('response', {}).get('status') == 'committed'
    return row, envelope, valid


def native_receipts_bound(records, native_by_attempt, required_by_attempt):
    """Each phase declares its required commands; no fixed historical Attempt count."""
    if not required_by_attempt or set(native_by_attempt) != set(required_by_attempt):
        return False
    for attempt_id, required in required_by_attempt.items():
        receipts = [r for r in records['receipts'] if r.get('attempt_id') == attempt_id]
        if not required or any(not any(r.get('command_name') == name for r in receipts) for name in required):
            return False
        journal = native_by_attempt[attempt_id].get('planning_requests', [])
        for receipt in receipts:
            local = one([r for r in journal if r['request_id'] == receipt['request_id']])
            raw = receipt['envelope_json']
            envelope = json.loads(raw)
            if not local or local.get('digest_matches_bytes') is not True \
                    or canonical_bytes(envelope).decode() != raw \
                    or hashlib.sha256(raw.encode()).hexdigest() != receipt['digest'] \
                    or local.get('digest') != receipt['digest'] or local.get('envelope') != envelope \
                    or envelope.get('scope_id') != receipt.get('scope_id') \
                    or receipt.get('scope_id') != records['task']['id'] \
                    or envelope.get('request_id') != receipt['request_id'] \
                    or envelope.get('name') != receipt.get('command_name') \
                    or receipt.get('response', {}).get('request_id') != receipt['request_id']:
                return False
    return True


def preparation_checks(records, proposal_id, native):
    """Bind actual bundled CLI bytes and one terminal scratch-only Planner phase."""
    p = one([r for r in records['replan_proposals'] if r['id'] == proposal_id])
    source = one([r for r in records['replan_sources'] if r['id'] == p.get('source_id')])
    attempt = one([r for r in records['attempts'] if r['id'] == source.get('planned_attempt_id')])
    terminal_names = {'prepare_replan', 'raise_planning_issue', 'commit_task_turn', 'publish_execution_plan'}
    receipts = [r for r in records['receipts'] if r.get('attempt_id') == attempt.get('id')
        and r.get('command_name') in terminal_names]
    receipt = one(receipts)
    raw = receipt.get('envelope_json', '{}')
    command = json.loads(raw)
    journal = one([r for r in native.get('planning_requests', []) if r['request_id'] == receipt.get('request_id')])
    response = receipt.get('response') or {}
    outcome = response.get('result', {}).get('replan_outcome', {})
    operations = [r for r in records['operations'] if r['attempt_id'] == attempt.get('id')]
    stop = one(operations)
    stop_result = stop.get('result')
    content = dict(p.get('content') or {})
    content.pop('input_cutoff', None)
    content.pop('requirement_content_digest', None)
    binding = dict(request_id=source.get('request_id'), source_id=source.get('id'),
        specification_id=source.get('specification_id'), plan_id=source.get('plan_id'),
        control_version=int(source.get('expected_version', -1)), context_digest=source.get('context_digest'))
    launch = attempt.get('launch') or {}
    return {
        'one_terminal_native_preparation': bool(p and source and attempt and receipt and journal)
            and receipt.get('command_name') == command.get('name') == 'prepare_replan'
            and receipt.get('scope_id') == command.get('scope_id') == records['task']['id']
            and response.get('status') == 'committed' and command.get('payload') == content
            and command.get('request_id') == receipt.get('request_id')
            and response.get('request_id') == receipt.get('request_id')
            and command.get('expected_control_version') == int(source.get('expected_version', -1))
            and canonical_bytes(command).decode() == raw
            and hashlib.sha256(raw.encode()).hexdigest() == receipt.get('digest') == journal.get('digest')
            and journal.get('digest_matches_bytes') is True and journal.get('envelope') == command,
        'exact_prepared_outcome': bool(p and source) and outcome.get('kind') == 'proposal'
            and outcome.get('proposal_id') == p.get('id') and outcome.get('source_id') == source.get('id')
            and outcome.get('replan_request_id') == p.get('request_id') == source.get('request_id')
            and outcome.get('content_digest') == p.get('content_digest'),
        'canonical_scratch_only_replan_source': bool(source and attempt)
            and attempt.get('replan_source_id') == source.get('id') and attempt.get('kind') == 'planner'
            and attempt.get('task_id') == source.get('task_id') == records['task']['id']
            and attempt.get('node_id') is None and attempt.get('todo_id') is None
            and launch.get('task_replan_source') == binding and launch.get('prompt') == source.get('prompt')
            and source.get('prompt') == canonical_bytes(source.get('context')).decode()
            and hashlib.sha256(source.get('prompt', '').encode()).hexdigest() == source.get('context_digest')
            and isinstance(launch.get('workspace_reservations'), dict)
            and launch['workspace_reservations'].get('resources') == []
            and not any(launch.get(k) for k in ('node_execution_source', 'task_conversation_source',
                'task_planning_source', 'todo_discussion_source')),
        'prepared_planner_physically_released': bool(attempt and stop)
            and attempt.get('state') == 'SUCCEEDED' and attempt.get('mutation_allowed') is False
            and attempt.get('process_absent') is True and attempt.get('process_released') is True
            and len([r for r in records['starts'] if r['attempt_id'] == attempt.get('id')]) == 1
            and stop.get('kind') == 'stop' and stop.get('state') == 'succeeded'
            # repository_free=True marks Node completion; Planner Stop has no repository authority.
            and all(stop.get(k) is None for k in ('repository_free', 'resource_id',
                'workspace_descriptor', 'workspace_digest', 'workspace_lease_id',
                'completion_manifest_digest', 'completion_operation_id', 'completion_identity_digest',
                'completion_settlement', 'settlement_purpose', 'cancelled_by_operation_id'))
            and stop.get('id') == receipt.get('operation_id') == response.get('operation_id')
            and stop.get('request_id') == receipt.get('request_id')
            and isinstance(stop_result, dict) and stop_result.get('writer_absent') is True
            and not any(k in stop_result for k in ('workspace_id', 'workspace_metadata', 'path',
                'instruction_files', 'git_commit', 'git_tree', 'workspace_unavailable_reason'))
            and not any(r['attempt_id'] == attempt.get('id') for r in records['lease_records']),
    }


def publication_checks(records, proposal_id, owner_commands):
    """Verify pointers plus actual exact graph confirmation/publication receipts.

    Joint requirements additionally need the Specification authorization observer;
    this function verifies its linkage and atomic pointer outcome, not that entire
    independent authorization chain.
    """
    p = one([r for r in records['replan_proposals'] if r['id'] == proposal_id])
    pub = one([r for r in records['replan_publications'] if r['proposal_id'] == proposal_id])
    request = one([r for r in records['replan_requests'] if r['id'] == p.get('request_id')])
    owner = one([r for r in records['replan_owner_proposals'] if r['id'] == proposal_id])
    auth = one([r for r in records['replan_authorizations'] if r['id'] == pub.get('authorization_id')])
    link = one([r for r in records['replan_authorization_commands'] if r['authorization_id'] == auth.get('id')])
    task = records['task']
    confirmation, confirmed, valid_confirmation = owner_receipt(records, task['id'], link.get('request_id'))
    publication, published, valid_publication = owner_receipt(records, task['id'], pub.get('owner_request_id'))
    content = p.get('content', {})
    basis = content.get('basis', {})
    cp, pp = confirmed.get('payload', {}), published.get('payload', {})
    plan = one([r for r in records['plans'] if r['id'] == pub.get('new_plan_id')])
    spec = one([r for r in records['specifications'] if r['id'] == pub.get('new_specification_id')])
    joint = p.get('requirement_proposal_id')
    requirement = one([r for r in records['requirement_proposals'] if r['id'] == joint]) if joint else {}
    change = one([r for r in records['requirement_changes'] if r['id'] == pub.get('requirement_change_id')]) if joint else {}
    graph = {'node_ids': [n['node_id'] for n in content.get('nodes', [])], 'nodes': content.get('nodes', [])}
    members = [r for r in records['plan_membership'] if r['plan_id'] == plan.get('id')]
    checks = {
        'one_exact_graph_publication': bool(p and pub and request and plan and spec)
            and request.get('status') == 'published'
            and request.get('proposal_id') == proposal_id
            and all(r.get('task_id') == task['id'] for r in (p, pub, request, plan, spec))
            and p.get('request_id') == pub.get('request_id')
            and p.get('plan_id') == content.get('plan_id') == pub.get('new_plan_id') == task.get('plan_id')
            and pub.get('new_specification_id') == task.get('specification_id')
            and pub.get('old_plan_id') == basis.get('plan_id')
            and pub.get('old_specification_id') == basis.get('specification_id'),
        'exact_published_graph': bool(plan and graph['nodes']) and plan.get('content') == graph
            and plan.get('specification_id') == pub.get('new_specification_id')
            and plan.get('content_digest') == hashlib.sha256(canonical_bytes(graph)).hexdigest()
            and len(members) == len(graph['node_ids'])
            and {r['node_id'] for r in members} == set(graph['node_ids'])
            and all(r.get('task_id') == task['id'] and r.get('definition') ==
                one([n for n in graph['nodes'] if n['node_id'] == r['node_id']]) for r in members),
        'full_graph_envelope_digest': bool(p and owner) and owner.get('action') == 'publish_replan'
            and owner.get('task_id') == task['id'] and owner.get('content') == content
            and owner.get('content_digest') == p.get('content_digest')
                == hashlib.sha256(canonical_bytes(content)).hexdigest(),
        'exact_graph_confirmation': bool(auth and link) and valid_confirmation
            and link.get('task_id') == task['id'] and auth.get('proposal_id') == proposal_id
            and confirmed.get('name') == 'confirm_replan'
            and cp == {'proposal_id': proposal_id, 'content_digest': p.get('content_digest')}
            and confirmation.get('response', {}).get('confirmation_id') == auth.get('id'),
        'exact_graph_consumption': bool(pub and auth) and valid_publication
            and published.get('name') == 'publish_replan'
            and pp.get('proposal_id') == proposal_id and pp.get('confirmation_id') == auth.get('id')
            and pp.get('basis') == basis and auth.get('consumed_by') == pub.get('owner_request_id')
            and publication.get('response', {}).get('publication_id') == pub.get('id'),
        'publication_slot_released': bool(pub) and not records['publication_slots'],
        'independently_preserved_owner_commands': len(owner_commands) == 2
            and {r.get('name') for r in owner_commands} == {'confirm_replan', 'publish_replan'}
            and all(command in owner_commands for command in (confirmed, published)),
    }
    if joint:
        checks['joint_exact_pointer_and_obligation'] = bool(requirement and change) \
            and change.get('proposal_id') == joint and change.get('status') == 'published' \
            and change.get('specification_id') == spec.get('id') \
            and requirement.get('content_digest') == content.get('requirement_content_digest') \
            and requirement.get('impact', {}).get('replan_proposal_id') == proposal_id \
            and requirement.get('impact', {}).get('replan_request_id') == request.get('id') \
            and requirement.get('impact', {}).get('graph_sufficient') is False \
            and requirement.get('specification') == spec.get('content') \
            and change.get('authorization_id') == pp.get('requirement_confirmation_id')
    else:
        checks['standalone_preserves_specification'] = bool(pub) \
            and pub.get('old_specification_id') == pub.get('new_specification_id') \
            and pub.get('requirement_change_id') is None \
            and 'requirement_confirmation_id' not in pp
    return checks


def workspace_transfer_checks(records, publication_id, open_operation_id, predecessor_root):
    """Compare immutable publication input, canonical lease and saved root state.

    predecessor_root must be collected read-only before adoption from the trusted
    root-owned workspace record. A later new-owner record is not old-lease proof.
    Physical process absence is a separate native snapshot requirement.
    """
    pub = one([r for r in records['replan_publications'] if r['id'] == publication_id])
    proposal = one([r for r in records['replan_proposals'] if r['id'] == pub.get('proposal_id')])
    operation = one([r for r in records['operations'] if r['id'] == open_operation_id])
    descriptor = operation.get('workspace_descriptor') or {}
    transfer = descriptor.get('transfer') or {}
    saved = one([r for r in records['replan_transfers'] if r['publication_id'] == publication_id
        and r['workspace_id'] == descriptor.get('workspace_id')])
    old_lease = one([r for r in records['lease_records'] if r['id'] == transfer.get('from_lease_id')])
    new_lease = one([r for r in records['lease_records'] if r['id'] == descriptor.get('lease_id')])
    inputs = proposal.get('content', {}).get('impact', {}).get('workspaces', [])
    old_input = one([r for r in inputs if r['workspace_id'] == descriptor.get('workspace_id')])
    root_op = predecessor_root.get('operation') or {}
    root_workspace = root_op.get('workspace') or {}
    root_metadata = dict(predecessor_root.get('metadata') or {})
    if predecessor_root.get('private_checkpoint') is not None:
        root_metadata['checkpoint'] = predecessor_root['private_checkpoint']
    expected = old_input | dict(publication_id=publication_id, proposal_id=proposal.get('id'),
        to_plan_id=pub.get('new_plan_id'), to_node_id=descriptor.get('node_id'),
        to_node_activation=descriptor.get('node_activation'))
    old_attempt = one([r for r in records['attempts'] if r['id'] == transfer.get('from_attempt_id')])
    new_attempt = one([r for r in records['attempts'] if r['id'] == operation.get('attempt_id')])
    old_source = one([r for r in records['node_sources'] if r['id'] == old_attempt.get('node_execution_source_id')])
    new_source = one([r for r in records['node_sources'] if r['id'] == new_attempt.get('node_execution_source_id')])
    return {
        'exact_transfer_scope_and_sources': bool(pub and transfer and old_source and new_source)
            and all(r.get('task_id') == records['task']['id'] for r in
                (pub, proposal, saved, descriptor, transfer, old_lease, new_lease, old_attempt, new_attempt,
                    old_source, new_source, root_workspace))
            and transfer.get('from_plan_id') == old_source.get('plan_id')
            and transfer.get('to_plan_id') == new_source.get('plan_id') == pub.get('new_plan_id')
            and old_source.get('node_id') == transfer.get('from_node_id')
            and old_source.get('node_activation') == transfer.get('from_node_activation')
            and new_source.get('node_id') == transfer.get('to_node_id')
            and new_source.get('node_activation') == transfer.get('to_node_activation')
            and all(r.get('workspace_id') == transfer.get('workspace_id')
                for r in (descriptor, saved, old_lease, new_lease, root_workspace))
            and all(r.get('runner_id') == transfer.get('runner_id')
                for r in (descriptor, old_attempt, new_attempt, root_workspace))
            and descriptor.get('resource_id') == root_workspace.get('resource_id') == transfer.get('resource_id'),
        'exact_confirmed_transfer': bool(pub and proposal and saved and old_input and transfer)
            and saved.get('descriptor') == transfer == expected
            and saved.get('target_node_id') == descriptor.get('node_id')
            and saved.get('target_node_activation') == descriptor.get('node_activation'),
        'exact_new_open_descriptor': bool(operation and new_lease)
            and operation.get('kind') == 'open_workspace' and operation.get('state') == 'succeeded'
            and operation.get('workspace_digest') == hashlib.sha256(canonical_bytes(descriptor)).hexdigest()
            and operation.get('workspace_lease_id') == new_lease.get('id') == descriptor.get('lease_id')
            and new_lease.get('attempt_id') == operation.get('attempt_id') == new_attempt.get('id')
            and new_lease.get('node_id') == descriptor.get('node_id')
            and new_lease.get('node_activation') == descriptor.get('node_activation'),
        'released_exact_predecessor': bool(old_lease and transfer)
            and old_lease.get('state') == 'released'
            and old_lease.get('attempt_id') == transfer.get('from_attempt_id')
            and old_lease.get('node_id') == transfer.get('from_node_id')
            and old_lease.get('node_activation') == transfer.get('from_node_activation')
            and old_lease.get('settle_operation_id') == transfer.get('settle_operation_id'),
        'trusted_root_predecessor_matches': bool(root_op and root_workspace and transfer)
            and predecessor_root.get('released') is True
            and root_op.get('attempt_id') == transfer.get('from_attempt_id')
            and root_workspace.get('lease_id') == transfer.get('from_lease_id')
            and root_workspace.get('workspace_id') == transfer.get('workspace_id')
            and root_workspace.get('task_id') == transfer.get('task_id')
            and root_workspace.get('resource_id') == transfer.get('resource_id')
            and root_workspace.get('node_id') == transfer.get('from_node_id')
            and root_workspace.get('node_activation') == transfer.get('from_node_activation')
            and root_metadata == transfer.get('metadata'),
    }


def joint_authorization_checks(records, proposal_id, owner_commands):
    """The requirements approval must be consumed by this same joint publication."""
    p = one([r for r in records['replan_proposals'] if r['id'] == proposal_id])
    pub = one([r for r in records['replan_publications'] if r['proposal_id'] == proposal_id])
    req = one([r for r in records['requirement_proposals'] if r['id'] == p.get('requirement_proposal_id')])
    change = one([r for r in records['requirement_changes'] if r['id'] == pub.get('requirement_change_id')])
    auth = one([r for r in records['requirement_authorizations'] if r['id'] == change.get('authorization_id')])
    link = one([r for r in records['authorization_commands'] if r['authorization_id'] == auth.get('id')])
    task = records['task']['id']
    confirmation, confirmed, confirm_valid = owner_receipt(records, task, link.get('request_id'))
    publication, published, publish_valid = owner_receipt(records, task, pub.get('owner_request_id'))
    owner = one([r for r in records['requirement_owner_proposals'] if r['id'] == req.get('id')])
    revision = one([r for r in records['specifications'] if r['id'] == pub.get('new_specification_id')])
    obligation = one([r for r in records['requirement_obligations'] if r['id'] == req.get('obligation_id')])
    attachment = one([r for r in records['requirement_attachments'] if r['proposal_id'] == req.get('id')])
    req_publication = one([r for r in records['requirement_publications'] if r['change_id'] == change.get('id')])
    request = one([r for r in records['replan_requests'] if r['id'] == p.get('request_id')])
    source_ids = [request['input_id']] if request.get('input_id') else []
    links = [r for r in records['requirement_sources'] if r['proposal_id'] == req.get('id')]
    expected = {k: req.get(k) for k in ('task_id', 'specification', 'summary', 'impact',
        'specification_digest', 'impact_digest', 'replan_source_id')}
    expected.update(proposal_id=req.get('id'), source_id=None, source_input_ids=source_ids,
        input_cutoff=int(req.get('input_cutoff', -1)), basis={
            'control_version': int(req.get('base_control_version', -1)),
            'specification_id': req.get('base_specification_id'), 'plan_id': req.get('base_plan_id')})
    # TaskActionBasis can additionally bind a Node source. Those optional fields
    # must match the approved graph basis exactly rather than disappear here.
    for key in ('node_id', 'node_activation', 'source_id'):
        if key in p.get('content', {}).get('basis', {}):
            expected['basis'][key] = p['content']['basis'][key]
    return {
        'joint_requirement_exact_envelope': bool(p and req and owner)
            and owner.get('action') == 'apply_specification_revision'
            and owner.get('content') == expected and expected['task_id'] == task
            and expected['basis'] == p.get('content', {}).get('basis')
            and owner.get('task_id') == task and owner.get('content_digest') == req.get('content_digest')
                == p.get('content', {}).get('requirement_content_digest')
                == hashlib.sha256(canonical_bytes(owner.get('content'))).hexdigest()
            and owner.get('content', {}).get('specification') == req.get('specification')
            and owner.get('content', {}).get('impact') == req.get('impact')
            and req.get('specification_digest') == hashlib.sha256(canonical_bytes(req.get('specification'))).hexdigest()
            and req.get('impact_digest') == hashlib.sha256(canonical_bytes(req.get('impact'))).hexdigest(),
        'joint_requirement_exact_confirmation': bool(auth and link) and confirm_valid
            and confirmed.get('name') in ('confirm_specification', 'confirm_proposal')
            and confirmed.get('payload') == {'proposal_id': req.get('id'), 'content_digest': req.get('content_digest')}
            and auth.get('proposal_id') == req.get('id') and link.get('task_id') == task
            and confirmation.get('response', {}).get('confirmation_id') == auth.get('id'),
        'joint_requirement_same_atomic_consumption': bool(pub and change and revision) and publish_valid
            and published.get('name') == 'publish_replan'
            and published.get('payload', {}).get('proposal_id') == proposal_id
            and published.get('payload', {}).get('requirement_confirmation_id') == auth.get('id')
            and auth.get('consumed_by') == change.get('admission_request_id') == pub.get('owner_request_id')
            and revision.get('authorization_id') == auth.get('id')
            and revision.get('content') == req.get('specification')
            and revision.get('content_digest') == req.get('specification_digest')
            and revision.get('parent_id') == req_publication.get('parent_id') == pub.get('old_specification_id')
            and req_publication.get('specification_id') == change.get('specification_id') == revision.get('id')
            and req_publication.get('plan_id') == pub.get('new_plan_id')
            and publication.get('response', {}).get('publication_id') == pub.get('id'),
        'joint_requirement_real_replan_provenance': bool(attachment and obligation and req)
            and bool(p.get('source_id')) and request.get('id') == p.get('request_id')
            and req.get('replan_source_id') == attachment.get('replan_source_id') == p.get('source_id')
            and attachment.get('task_id') == task
            and req.get('source_id') is None and req.get('input_id') is None
            and attachment.get('source_id') is None and attachment.get('input_id') is None
            and obligation.get('current_proposal_id') == req.get('id') and obligation.get('status') == 'published',
        'joint_requirement_normalized_inputs': len(links) == len(source_ids)
            and {r['input_id'] for r in links} == set(source_ids)
            and all(r.get('task_id') == task for r in links),
        'joint_independently_saved_commands': len(owner_commands) == 2
            and confirmed in owner_commands and published in owner_commands,
    }


class TaskReplanProbe(TaskSpecificationProbe):
    def install_node_drivers(self):
        super().install_node_drivers()
        source = self.source / 'infra/probe/task_replan_driver.py'
        target = pathlib.Path('/var/lib/monos-probe/probe-tools/task_replan_driver.py')
        if target.is_symlink() or target.exists() and (not target.is_file()
                or target.stat().st_uid != 0 or target.stat().st_mode & 0o022
                or not target.stat().st_mode & 0o004 or target.read_bytes() != source.read_bytes()):
            raise RuntimeError('Preserve previously installed Replan driver')
        if not target.exists():
            with target.open('xb') as output:
                output.write(source.read_bytes())
                output.flush()
                os.fsync(output.fileno())
            target.chmod(0o644)
        self.save('replan-driver-hash', {'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})

    def node_snapshot(self, attempt, records):
        native = super().node_snapshot(attempt, records)
        path = pathlib.Path('/var/lib/monos-probe/execution') / checked_id(attempt) \
            / 'scratch/task-replan-driver.json'
        if path.is_file():
            if native.get('driver'):
                raise RuntimeError('Ambiguous native driver evidence')
            native['driver'] = json.loads(path.read_text())
        return native

    def replan_records(self, task):
        return self.conversation_records(task, REPLAN_TABLES)

    def replan_command(self, body):
        task, request = checked_id(body['task_id']), checked_id(body['request_id'])
        self.preserve('request-' + request, {'command': body})
        path = '/v1/owner/tasks/replan/commands'
        try:
            result = self.post(path, body)
        except urllib.error.HTTPError as error:
            if error.code < 500:
                raise
            result = self.read('/v1/owner/tasks/' + task + '/replan/commands/' + request)
            if result.get('status') == 'unknown':
                result = self.post(path, body)
        except (TimeoutError, urllib.error.URLError):
            result = self.read('/v1/owner/tasks/' + task + '/replan/commands/' + request)
            if result.get('status') == 'unknown':
                result = self.post(path, body)
        self.preserve('receipt-' + request, {'receipt': result})
        if result.get('request_id') != request or result.get('status') != 'committed':
            raise RuntimeError('Uncertain or mismatched Replan command receipt')
        return result
