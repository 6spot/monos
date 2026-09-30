#!/usr/bin/env python3
"""Read-only evidence plus explicit Owner commands for requirement revisions.

SQL supplies observations only. Requirement and physical state transitions go
through authenticated Owner commands or actual Agent-invoked monos commands.
"""
import hashlib
import json
import os
import pathlib
import shlex
import urllib.error

from probe import checked_id
from task_conversation_probe import TaskConversationProbe, canonical_bytes


REQUIREMENT_TABLES = {
    'activations': 'node_activations',
    'plan_membership': 'plan_nodes',
    'requirement_proposals': 'requirement_proposals',
    'requirement_obligations': 'requirement_obligations',
    'requirement_sources': 'requirement_sources',
    'requirement_attachments': 'requirement_attachments',
    'requirement_changes': 'requirement_changes',
    'publication_slots': 'task_publication_slots',
    'change_attempts': 'requirement_change_attempts',
    'change_effects': 'requirement_change_effects',
    'input_deferrals': 'requirement_input_deferrals',
    'requirement_publications': 'requirement_publications',
    'specification_applicability': 'specification_node_applicability',
    'requirement_owner_proposals': '(SELECT g.* FROM task_command_proposals g JOIN requirement_proposals p ON p.id=g.id)',
    'requirement_authorizations': '(SELECT a.*,p.task_id FROM authorization_receipts a JOIN requirement_proposals p ON p.id=a.proposal_id)',
    'authorization_commands': 'requirement_authorization_commands',
    'task_owner_receipts': '(SELECT r.*,r.scope_id AS task_id FROM owner_command_receipts r)',
}


def driver_command(task, resource, prior, revision, mode):
    if mode not in ('hold', 'complete'):
        raise ValueError('Unknown fixture mode')
    values = [checked_id(value) for value in (task, resource, prior, revision)]
    args = ['--task', values[0], '--resource', values[1], '--prior-attempt', values[2],
        '--specification', values[3], '--mode', mode, '--guidance', 'handled-guidance.json']
    # Execute the script directly so Python installs its sibling-import directory.
    # JSON string literals avoid nested single-quote transcription inside -c.
    program = ('import os,pathlib,sys; p=pathlib.Path.cwd(); '
        'assert p.name=="scratch" and p.parent.parent==pathlib.Path("/var/lib/monos-probe/execution"); '
        'os.execv(sys.executable,[sys.executable,"/var/lib/monos-probe/probe-tools/task_specification_driver.py",'
        '"--attempt",p.parent.name]+' + json.dumps(args) + ')')
    return 'python3 -c ' + shlex.quote(program)


def publication_checks(records, proposal_id):
    proposal = next((p for p in records['requirement_proposals'] if p['id'] == proposal_id), {})
    changes = [c for c in records['requirement_changes'] if c['proposal_id'] == proposal_id]
    change = changes[0] if len(changes) == 1 else {}
    publications = [p for p in records['requirement_publications'] if p['change_id'] == change.get('id')]
    publication = publications[0] if len(publications) == 1 else {}
    revision = next((s for s in records['specifications'] if s['id'] == change.get('specification_id')), {})
    owner = next((p for p in records['requirement_owner_proposals'] if p['id'] == proposal_id), {})
    authorization = next((a for a in records['requirement_authorizations']
        if a['id'] == change.get('authorization_id')), {})
    obligation = next((o for o in records['requirement_obligations'] if o['id'] == proposal.get('obligation_id')), {})
    task = records['task']
    return {
        'exact_published_revision': bool(proposal and change and publication and revision)
            and change.get('status') == 'published' and revision.get('content') == proposal.get('specification')
            and publication.get('specification_id') == task.get('specification_id') == revision.get('id')
            and revision.get('parent_id') == publication.get('parent_id') == proposal.get('base_specification_id')
            and publication.get('plan_id') == proposal.get('base_plan_id') == task.get('plan_id')
            and all(row.get('task_id') == task.get('id') for row in (proposal, change, publication, revision)),
        'exact_content_and_impact_hashes': bool(proposal and revision and owner)
            and proposal.get('specification_digest') == revision.get('content_digest')
                == hashlib.sha256(canonical_bytes(proposal.get('specification'))).hexdigest()
            and proposal.get('impact_digest') == hashlib.sha256(canonical_bytes(proposal.get('impact'))).hexdigest()
            and proposal.get('content_digest') == owner.get('content_digest')
                == hashlib.sha256(canonical_bytes(owner.get('content'))).hexdigest(),
        'exact_owner_authorization': bool(authorization and revision)
            and authorization.get('proposal_id') == proposal_id
            and revision.get('authorization_id') == authorization.get('id')
            and bool(authorization.get('consumed_by'))
            and authorization.get('consumed_by') == change.get('admission_request_id'),
        'one_closed_publication': len(changes) == len(publications) == 1
            and obligation.get('status') == 'published'
            and obligation.get('current_proposal_id') == proposal_id
            and not any(s['operation_id'] == change.get('id') for s in records['publication_slots']),
    }


def proposal_authority_checks(records, proposal_id, owner_commands):
    """Compare independently preserved requests with persisted proposal authority."""
    proposals = [p for p in records['requirement_proposals'] if p['id'] == proposal_id]
    owners = [p for p in records['requirement_owner_proposals'] if p['id'] == proposal_id]
    if len(proposals) != 1 or len(owners) != 1:
        return {'unique_proposal_authority': False}
    p, owner = proposals[0], owners[0]
    envelope = owner['content']
    source_ids = envelope.get('source_input_ids', [])
    expected = {key: p[key] for key in ('task_id', 'specification', 'summary', 'impact',
        'source_id', 'specification_digest', 'impact_digest')}
    expected.update(proposal_id=p['id'], input_cutoff=int(p['input_cutoff']),
        source_input_ids=source_ids, basis={'control_version': int(p['base_control_version']),
            'specification_id': p['base_specification_id'], 'plan_id': p['base_plan_id']})
    basis = envelope.get('basis', {})
    for key in ('node_id', 'node_activation', 'source_id'):
        if key in basis:
            node = next((n for n in p['impact']['nodes'] if n['node_id'] == basis.get('node_id')), {})
            expected['basis'][key] = node.get(key)
    links = [s for s in records['requirement_sources'] if s['proposal_id'] == proposal_id]
    attachments = [a for a in records['requirement_attachments'] if a['proposal_id'] == proposal_id]
    checks = {
        'full_proposal_envelope': envelope == expected and owner['task_id'] == p['task_id']
            and owner['action'] == 'apply_specification_revision',
        'exact_normalized_sources': len(set(source_ids)) == len(source_ids) == len(links)
            and set(source_ids) == {s['input_id'] for s in links}
            and all(s['task_id'] == p['task_id'] for s in links),
        'exact_attachment': len(attachments) == 1 and all(
            attachments[0].get(key) == p.get(key) for key in ('task_id', 'source_id', 'input_id')),
        'preserved_owner_requests_present': bool(owner_commands),
    }
    for index, command in enumerate(owner_commands):
        receipts = [r for r in records['task_owner_receipts']
            if r['request_id'] == command['request_id'] and r['scope_id'] == p['task_id']]
        receipt = receipts[0] if len(receipts) == 1 else {}
        response = receipt.get('response', {})
        checks[f'owner_request_{index}_exact_receipt'] = bool(receipt) \
            and command.get('task_id') == p['task_id'] \
            and command.get('payload', {}).get('proposal_id') == proposal_id \
            and receipt.get('envelope_json') == canonical_bytes(command).decode() \
            and receipt.get('digest') == hashlib.sha256(canonical_bytes(command)).hexdigest() \
            and response.get('request_id') == command['request_id'] \
            and response.get('proposal_id') == proposal_id \
            and response.get('status') in ('committed', 'admitted')
        if command.get('name') == 'edit_specification':
            expected_input = {key: expected[key] for key in ('proposal_id', 'specification',
                'summary', 'impact', 'basis', 'source_input_ids')}
            if p.get('predecessor_id') is not None:
                expected_input['supersedes'] = p['predecessor_id']
            checks[f'owner_request_{index}_exact_edit'] = command.get('payload') == expected_input
    return checks


def authorization_chain_checks(records, proposal_id):
    """Require actual confirmation and admission receipts, not a nonempty token."""
    def one(rows):
        return rows[0] if len(rows) == 1 else {}

    def command(receipt):
        raw = receipt.get('envelope_json', '{}')
        value = json.loads(raw)
        valid = bool(receipt) and canonical_bytes(value).decode() == raw \
            and hashlib.sha256(raw.encode()).hexdigest() == receipt.get('digest') \
            and value.get('request_id') == receipt.get('request_id') \
            and value.get('task_id', value.get('scope_id')) == receipt.get('scope_id') \
            and receipt.get('response', {}).get('request_id') == receipt.get('request_id') \
            and receipt.get('response', {}).get('status') in ('committed', 'admitted')
        return value, valid

    p = one([r for r in records['requirement_proposals'] if r['id'] == proposal_id])
    c = one([r for r in records['requirement_changes'] if r['proposal_id'] == proposal_id])
    auth = one([r for r in records['requirement_authorizations'] if r['id'] == c.get('authorization_id')])
    link = one([r for r in records['authorization_commands'] if r['authorization_id'] == auth.get('id')])
    origin = one([r for r in records['task_owner_receipts']
        if r['scope_id'] == p.get('task_id') and r['request_id'] == link.get('request_id')])
    confirmed, origin_valid = command(origin)
    payload = confirmed.get('payload', {})
    direct = confirmed.get('name') == 'edit_specification'
    exact_confirmation = (direct and payload.get('specification') == p.get('specification')
        and payload.get('impact') == p.get('impact')) or (
        confirmed.get('name') in ('confirm_specification', 'confirm_proposal')
        and payload.get('content_digest') == p.get('content_digest'))
    attempt_id = c.get('admission_attempt_id')
    receipts = records['receipts'] if attempt_id else records['task_owner_receipts']
    admission = one([r for r in receipts if r['scope_id'] == p.get('task_id')
        and r['request_id'] == c.get('admission_request_id')
        and (not attempt_id or r.get('attempt_id') == attempt_id)])
    admitted, admission_valid = command(admission)
    admitted_payload = admitted.get('payload', {})
    response = admission.get('response', {})
    operation = response.get('result', {}).get('requirement_operation_id') if attempt_id \
        else response.get('operation_id')
    exact_apply = admitted.get('name') == 'apply_specification_revision' \
        and admitted_payload.get('confirmation_id') == auth.get('id')
    exact_edit = not attempt_id and admitted.get('name') == 'edit_specification' \
        and admission == origin and direct
    return {
        'exact_confirmation_origin': bool(p and c and auth and link) and origin_valid
            and link.get('task_id') == p.get('task_id')
            and auth.get('proposal_id') == payload.get('proposal_id') == proposal_id
            and origin.get('response', {}).get('confirmation_id') == auth.get('id')
            and exact_confirmation,
        'exact_authorization_consumption': bool(c and auth) and admission_valid
            and auth.get('consumed_by') == c.get('admission_request_id')
            and operation == c.get('id') and admitted_payload.get('proposal_id') == proposal_id
            and (exact_apply or exact_edit),
        'canonical_agent_admission': not attempt_id or any(a['id'] == attempt_id
            and a.get('task_id') == p.get('task_id') and a.get('task_conversation_source_id')
            for a in records['attempts']),
    }


class TaskSpecificationProbe(TaskConversationProbe):
    def install_node_drivers(self):
        super().install_node_drivers()
        source = self.source / 'infra/probe/task_specification_driver.py'
        target = pathlib.Path('/var/lib/monos-probe/probe-tools/task_specification_driver.py')
        if target.is_symlink() or target.exists() and (not target.is_file()
                or target.stat().st_uid != 0 or target.stat().st_mode & 0o022
                or not target.stat().st_mode & 0o004
                or target.read_bytes() != source.read_bytes()):
            raise RuntimeError('Preserve previously installed Specification driver')
        if not target.exists():
            with target.open('xb') as output:
                output.write(source.read_bytes())
                output.flush()
                os.fsync(output.fileno())
            target.chmod(0o644)
        self.save('specification-driver-hash', {'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})

    def specification_records(self, task):
        return super().conversation_records(task, REQUIREMENT_TABLES)

    def prestart_edit(self, proposal_id, request_id, specification):
        task = self.git_binding()['task']['task_id']
        self.claim('prestart-specification')
        before = self.specification_records(task)
        self.require('prestart-specification-before', {'records': before}, {
            'never_started': before['task']['state'] == 'PLANNING'
                and not any(before[key] for key in ('attempts', 'plans', 'nodes', 'starts'))})
        body = {'schema_version': 1, 'request_id': checked_id(request_id), 'task_id': task,
            'name': 'edit_specification', 'payload': {'proposal_id': checked_id(proposal_id),
                'specification': specification, 'summary': 'Clarify the exact local preservation result.',
                'basis': {'control_version': int(before['task']['control_version']),
                    'specification_id': before['task']['specification_id'], 'plan_id': None},
                'impact': {'graph_sufficient': True, 'nodes': [], 'guidance': []}, 'source_input_ids': []}}
        receipt = self.specification_command(body)
        after = self.specification_records(task)
        checks = publication_checks(after, proposal_id)
        checks.update(proposal_authority_checks(after, proposal_id, [body]))
        checks.update(authorization_chain_checks(after, proposal_id))
        checks['no_execution_created'] = after['task']['state'] == 'PLANNING' and all(
            after[key] == before[key] for key in ('attempts', 'plans', 'nodes', 'starts',
                'operations', 'planning_sources', 'node_sources'))
        checks['original_revision_retained'] = all(s in after['specifications'] for s in before['specifications'])
        checks['returned_receipt_matches_publication'] = any(r['request_id'] == request_id
            and r['scope_id'] == task and r['response'] == receipt for r in after['task_owner_receipts'])
        self.require('prestart-specification-published', {'before': before, 'after': after,
            'command': body, 'receipt': receipt}, checks)
        return after

    def specification_command(self, body):
        task = checked_id(body['task_id'])
        request_id = checked_id(body['request_id'])
        self.preserve('request-' + request_id, {'command': body})
        path = '/v1/owner/tasks/specification/commands'
        def recover():
            value = self.read('/v1/owner/tasks/' + task + '/specification/commands/' + request_id)
            if value.get('status') == 'unknown':
                value = self.post(path, body)
            return value
        try:
            result = self.post(path, body)
        except urllib.error.HTTPError as error:
            if error.code < 500:
                self.preserve('rejection-' + request_id, {'http_status': error.code})
                raise
            result = recover()
        except (OSError, TimeoutError, ValueError):
            result = recover()
        self.preserve('receipt-' + request_id, {'receipt': result})
        if result.get('request_id') != request_id or result.get('status') not in ('committed', 'admitted'):
            raise RuntimeError('Specification command receipt differs')
        return result

    def node_snapshot(self, attempt, records):
        native = super().node_snapshot(attempt, records)
        path = pathlib.Path('/var/lib/monos-probe/execution') / checked_id(attempt) \
            / 'scratch/task-specification-driver.json'
        if path.is_file():
            if native.get('driver'):
                raise RuntimeError('Ambiguous native driver evidence')
            native['driver'] = json.loads(path.read_text())
        return native
