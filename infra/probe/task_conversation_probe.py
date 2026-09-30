#!/usr/bin/env python3
"""Ordered Task Conversation evidence against the existing installation.

Every observation reads one PostgreSQL statement snapshot. Native command bytes,
Owner receipts and physical process state remain independent evidence sources.
This harness never updates canonical tables or overwrites an earlier observation.
"""
import argparse
import hashlib
import json
import os
import pathlib
import time
import urllib.error

from probe import checked_id, verified_live_identity
from node_execution_probe import NodeExecutionProbe
from task_preview_probe import canonical_bytes
from workspace_probe import settled_checks


def ordered_turn_checks(records, input_ids, native_by_attempt):
    inputs = {row['id']: row for row in records['inputs']}
    sources = {row['id']: row for row in records['conversation_sources']}
    messages = {row['id']: row for row in records['messages']}
    resolutions = {row['input_id']: row for row in records['resolutions']}
    task = records['task']
    checks = {'nonempty_distinct_inputs': bool(input_ids) and len(set(input_ids)) == len(input_ids),
        'unique_ordered_message_identity': len(messages) == len(records['messages'])
            and len({row['sequence'] for row in records['messages']}) == len(messages)}
    owner_sequences = []
    for index, input_id in enumerate(input_ids):
        prefix = str(index) + '_'
        input_row = inputs.get(input_id, {})
        resolution = resolutions.get(input_id, {})
        owner = messages.get(input_row.get('message_id'), {})
        reply = messages.get(resolution.get('reply_message_id'), {})
        source = sources.get(resolution.get('source_id'), {})
        attempts = [a for a in records['attempts'] if a.get('task_conversation_source_id') == source.get('id')]
        attempt = attempts[0] if len(attempts) == 1 else {}
        native = native_by_attempt.get(attempt.get('id'), {})
        receipt_rows = [r for r in records['receipts'] if r['attempt_id'] == attempt.get('id')]
        commits = [r for r in receipt_rows if r['command_name'] == 'commit_task_turn']
        receipt = commits[0] if len(commits) == 1 else {}
        envelope = json.loads(receipt.get('envelope_json', '{}'))
        payload = envelope.get('payload', {})
        launches = [r for r in records['starts'] if r['attempt_id'] == attempt.get('id')]
        operations = [r for r in records['operations'] if r['attempt_id'] == attempt.get('id')]
        launch_source = attempt.get('launch', {}).get('task_conversation_source', {})
        if owner:
            owner_sequences.append(owner['sequence'])
        checks[prefix + 'canonical_source_resolution'] = bool(source and owner and reply and attempt) \
            and input_row.get('task_id') == task['id'] and input_row.get('status') == 'replied' \
            and resolution.get('disposition') == 'replied' and resolution.get('attempt_id') == attempt.get('id') \
            and resolution.get('request_id') == receipt.get('request_id') \
            and owner.get('author') == 'owner' and reply.get('author') == 'assistant' \
            and source.get('input_id') == input_id and reply.get('input_id') == input_id \
            and reply.get('source_id') == source.get('id') \
            and owner.get('sequence') == source.get('source_watermark') == reply.get('source_watermark')
        checks[prefix + 'one_native_commit_exact_payload'] = len(commits) == 1 \
            and receipt.get('response', {}).get('status') == 'committed' \
            and envelope.get('scope_id') == task['id'] and payload.get('reply') == reply.get('content') \
            and payload.get('source_id') == source.get('id') and payload.get('input_id') == input_id \
            and payload.get('source_watermark') == source.get('source_watermark') \
            and payload.get('routing') == resolution.get('routing') \
            and envelope.get('expected_control_version') == source.get('expected_version')
        journals = native.get('planning_requests', [])
        checks[prefix + 'all_native_receipts_bound'] = bool(receipt_rows) and all(
            row['digest'] == hashlib.sha256(row['envelope_json'].encode()).hexdigest()
            and canonical_bytes(json.loads(row['envelope_json'])) == row['envelope_json'].encode()
            and any(j.get('request_id') == row['request_id'] and j.get('digest') == row['digest']
                and j.get('digest_matches_bytes') is True
                and j.get('envelope') == json.loads(row['envelope_json']) for j in journals)
            for row in receipt_rows)
        checks[prefix + 'immutable_source_launch'] = bool(source) \
            and source.get('context_digest') == hashlib.sha256(canonical_bytes(source.get('context'))).hexdigest() \
            and source.get('prompt') == canonical_bytes(source.get('context')).decode() \
            and source.get('planned_attempt_id') == attempt.get('id') \
            and attempt.get('launch', {}).get('prompt') == source.get('prompt') \
            and launch_source == {'source_id': source.get('id'), 'input_id': input_id,
                'source_watermark': source.get('source_watermark'),
                'conversation_version': source.get('expected_version'),
                'context_digest': source.get('context_digest'), 'reply_only': source.get('reply_only')}
        checks[prefix + 'task_planner_without_workspace'] = attempt.get('kind') == 'planner' \
            and attempt.get('task_id') == task['id'] and attempt.get('todo_id') is None \
            and attempt.get('node_id') is None and attempt.get('planning_intent_id') is None \
            and attempt.get('node_execution_source_id') is None \
            and attempt.get('owner_key') == 'planner:' + task['id'] \
            and attempt.get('launch', {}).get('workspace_reservations', {}).get('resources') == [] \
            and attempt.get('launch', {}).get('resource_id') is None
        checks[prefix + 'single_start_physical_cleanup'] = len(launches) == 1 \
            and attempt.get('started') is True and attempt.get('state') == 'SUCCEEDED' \
            and attempt.get('mutation_allowed') is False and attempt.get('process_released') is True \
            and attempt.get('process_absent') is True and len(operations) == 1 \
            and operations[0].get('id') == receipt.get('operation_id') \
            and operations[0].get('kind') == 'stop' and operations[0].get('state') == 'succeeded' \
            and bool(native) and settled_checks(native) \
            and native.get('ownership', {}).get('dispatch_id') == attempt.get('dispatch_id') \
            and native.get('attempts', [{}])[0].get('attempt_id') == attempt.get('id')
    checks['requested_input_order'] = len(owner_sequences) == len(input_ids) \
        and owner_sequences == sorted(set(owner_sequences))
    return checks


def execution_unchanged(before, after):
    """A pre-Start/stopped status reply cannot create or change execution."""
    task_fields = ('id', 'state', 'control_version', 'specification_id', 'plan_id',
        'initial_planning_intent_id', 'planning_issue_sequence')
    keys = ('specifications', 'plans', 'planning_sources', 'nodes', 'node_sources', 'completions', 'manifests',
        'workspace_records', 'lease_records')
    def execution_attempts(records):
        return [{key: value for key, value in row.items()
            if key not in ('activity_at', 'log_visible_sequence', 'exit_observed')}
            for row in records['attempts'] if not row.get('task_conversation_source_id')]
    def execution_effects(records, key):
        ids = {row['id'] for row in execution_attempts(records)}
        return sorted([row for row in records[key] if row.get('attempt_id') in ids], key=canonical_bytes)
    return all(before['task'].get(key) == after['task'].get(key) for key in task_fields) \
        and all(sorted(before[key], key=canonical_bytes) == sorted(after[key], key=canonical_bytes) for key in keys) \
        and execution_attempts(before) == execution_attempts(after) \
        and all(execution_effects(before, key) == execution_effects(after, key) for key in ('starts', 'operations'))


def handling_checks(records, operation_id, declared_ids):
    manifests = [r for r in records['manifests'] if r['operation_id'] == operation_id]
    manifest = manifests[0] if len(manifests) == 1 else {}
    operations = [r for r in records['operations'] if r['id'] == operation_id]
    operation = operations[0] if len(operations) == 1 else {}
    completions = [r for r in records['completions'] if r['operation_id'] == operation_id]
    completion = completions[0] if len(completions) == 1 else {}
    source = next((r for r in records['node_sources'] if r['id'] == manifest.get('source_id')), {})
    guidance = {r['id']: r for r in records['guidance']}
    obligations = {r['id']: r for r in records['obligations']}
    assignments = [r for r in records['assignments'] if r['source_id'] == source.get('id')]
    items = source.get('context', {}).get('guidance', {}).get('items', [])
    expected_manifest = {key: manifest.get(key) for key in ('manifest_version', 'handled_guidance_ids',
        'task_id', 'node_id', 'node_activation', 'attempt_id', 'source_id',
        'specification_id', 'plan_id', 'summary', 'artifact_ids')}
    expected_hash = hashlib.sha256(canonical_bytes(expected_manifest)).hexdigest()
    checks = {
        'explicit_nonempty_handling': bool(declared_ids) and len(set(declared_ids)) == len(declared_ids)
            and manifest.get('manifest_version') == 2 and manifest.get('handled_guidance_ids') == declared_ids,
        'exact_manifest_operation_completion': bool(manifest and operation and completion and source)
            and manifest.get('content_digest') == expected_hash == operation.get('completion_manifest_digest')
            and completion.get('result', {}).get('completion_manifest_digest') == expected_hash
            and completion.get('result', {}).get('handled_guidance_ids') == declared_ids
            and operation.get('state') == 'succeeded' and operation.get('kind') == 'complete_node'
            and manifest.get('task_id') == source.get('task_id') == records['task']['id']
            and manifest.get('node_id') == source.get('node_id') == completion.get('node_id')
            and manifest.get('node_activation') == source.get('node_activation') == completion.get('activation')
            and manifest.get('attempt_id') == source.get('planned_attempt_id')
                == operation.get('attempt_id') == completion.get('attempt_id'),
    }
    for index, guidance_id in enumerate(declared_ids):
        matches = [r for r in assignments if r['guidance_id'] == guidance_id]
        assignment = matches[0] if len(matches) == 1 else {}
        obligation = obligations.get(assignment.get('obligation_id'), {})
        entry = guidance.get(guidance_id, {})
        matching_items = [r for r in items if r.get('guidance_id') == guidance_id]
        item = matching_items[0] if len(matching_items) == 1 else {}
        checks[str(index) + '_exact_handled_obligation'] = bool(assignment and obligation and entry and item) \
            and obligation.get('guidance_id') == guidance_id and obligation.get('status') == 'handled' \
            and obligation.get('completion_operation_id') == operation_id \
            and obligation.get('node_id') == manifest.get('node_id') \
            and obligation.get('node_activation') == manifest.get('node_activation') \
            and obligation.get('task_id') == entry.get('task_id') == manifest.get('task_id') \
            and item.get('obligation_id') == obligation.get('id') \
            and item.get('text') == entry.get('text') \
            and item.get('content_digest') == entry.get('content_digest') \
                == hashlib.sha256(entry.get('text', '').encode()).hexdigest()
    return checks


def busy_input_checks(before, after, first_id, next_id, native):
    source = next((r for r in before['conversation_sources']
        if r['id'] == before['task'].get('conversation_source_id')), {})
    attempt = next((r for r in after['attempts'] if r['id'] == source.get('planned_attempt_id')), {})
    later = next((r for r in after['inputs'] if r['id'] == next_id), {})
    message = next((r for r in after['messages'] if r['id'] == later.get('message_id')), {})
    return {
        'first_source_still_current': bool(source and attempt)
            and source.get('input_id') == first_id
            and before['task'].get('conversation_input_id') == first_id
            and after['task'].get('conversation_input_id') == first_id
            and after['task'].get('conversation_source_id') == source.get('id')
            and source in after['conversation_sources'],
        'later_input_durable_pending': bool(later and message)
            and later.get('status') == 'pending' and message.get('author') == 'owner'
            and message.get('sequence', 0) > source.get('source_watermark', 0)
            and not any(r['input_id'] == next_id for r in after['resolutions'])
            and not any(r['input_id'] == next_id for r in after['conversation_sources']),
        'real_first_planner_still_active': attempt.get('started') is True
            and attempt.get('mutation_allowed') is True and attempt.get('process_released') is False
            and native.get('ownership', {}).get('dispatch_id') == attempt.get('dispatch_id')
            and verified_live_identity(native.get('ownership', {}), native.get('live_identity', {})),
    }


class TaskConversationProbe(NodeExecutionProbe):
    def install_node_drivers(self):
        super().install_node_drivers()
        source = self.source / 'infra/probe/task_conversation_driver.py'
        target = pathlib.Path('/var/lib/monos-probe/probe-tools/task_conversation_driver.py')
        if target.is_symlink() or target.exists() and (not target.is_file()
                or target.stat().st_uid != 0 or target.stat().st_mode & 0o022
                or target.read_bytes() != source.read_bytes()):
            raise RuntimeError('Preserve previously installed Conversation driver')
        if not target.exists():
            with target.open('xb') as output:
                output.write(source.read_bytes())
                output.flush()
                os.fsync(output.fileno())
            target.chmod(0o644)
        self.save('conversation-driver-hash', {'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})

    def conversation_command(self, body):
        base = '/v1/owner/tasks/conversation/commands'
        self.preserve('request-' + body['request_id'], {'command': body})
        try:
            result = self.post(base, body)
        except urllib.error.HTTPError as error:
            if error.code < 500:
                self.preserve('rejection-' + body['request_id'], {'http_status': error.code})
                raise
            result = self.recover_conversation(body)
        except (OSError, TimeoutError, ValueError):
            result = self.recover_conversation(body)
        self.preserve('receipt-' + body['request_id'], {'receipt': result})
        if result.get('status') != 'committed' or result.get('request_id') != body['request_id'] \
                or result.get('task_id') != body['task_id']:
            raise RuntimeError('Task Conversation command receipt differs')
        return result

    def submit_task(self, task, label, content):
        return self.conversation_command({'schema_version': 1, 'task_id': checked_id(task),
            'request_id': checked_id(task + '-' + label), 'name': 'submit_task_message',
            'payload': {'message_id': checked_id(task + '-' + label + '-message'), 'content': content}})

    def submit_while_active(self, task, first_input, label, content):
        self.claim(label + '-busy-input')
        deadline = time.monotonic() + 180
        while True:
            before = self.conversation_records(task)
            source = next((r for r in before['conversation_sources']
                if r['id'] == before['task'].get('conversation_source_id') and r['input_id'] == first_input), {})
            attempt = next((r for r in before['attempts'] if r['id'] == source.get('planned_attempt_id')), {})
            if attempt.get('started') and attempt.get('mutation_allowed') and not attempt.get('process_released'):
                break
            if any(r['input_id'] == first_input for r in before['resolutions']) or time.monotonic() >= deadline:
                self.save(label + '-not-active', {'outcome': 'fail', 'records': before})
                raise RuntimeError('First input is not actively processing; no later input was submitted')
            time.sleep(1)
        native = self.planning_snapshot(attempt['id'])
        receipt = self.submit_task(task, label, content)
        after = self.conversation_records(task)
        self.require(label + '-queued', {'before': before, 'after': after,
            'native': native, 'receipt': receipt}, busy_input_checks(before, after, first_input, receipt['input_id'], native))
        return receipt

    def node_snapshot(self, attempt, records):
        native = super().node_snapshot(attempt, records)
        report = pathlib.Path('/var/lib/monos-probe/execution') / checked_id(attempt) \
            / 'scratch/task-conversation-driver.json'
        if report.is_file():
            if native.get('driver'):
                raise RuntimeError('Ambiguous native driver reports for the same Attempt')
            native['driver'] = json.loads(report.read_text())
        return native

    def recover_conversation(self, body):
        result = self.read('/v1/owner/tasks/' + checked_id(body['task_id'])
            + '/conversation/commands/' + checked_id(body['request_id']))
        if result.get('request_id') != body['request_id'] or result.get('task_id') != body['task_id']:
            raise RuntimeError('Task Conversation recovery scope differs')
        if result.get('status') == 'unknown':
            result = self.post('/v1/owner/tasks/conversation/commands', body)
        return result

    def conversation_records(self, task, extra_tables=None):
        task = checked_id(task)
        tables = {'inputs': 'task_inputs', 'messages': 'task_messages',
            'conversation_sources': 'task_conversation_outbox', 'resolutions': 'task_input_resolutions',
            'guidance': 'task_guidance', 'obligations': 'task_guidance_obligations',
            'followups': 'task_guidance_followups', 'issues': 'task_input_issues', 'answers': 'task_input_answers',
            'specifications': 'specification_revisions', 'plans': 'plan_revisions',
            'planning_sources': 'task_planning_outbox', 'nodes': 'nodes',
            'node_sources': 'node_execution_outbox', 'artifacts': 'artifacts', 'manifests': 'completion_manifests',
            'workspace_records': 'task_workspaces', 'lease_records': 'workspace_leases', 'events': 'task_events'}
        # Internal probe-owned extensions share this same statement snapshot.
        tables.update(extra_tables or {})
        fields = ["'task',(SELECT to_jsonb(t) FROM tasks t WHERE id='" + task + "')"]
        for key, table in tables.items():
            fields.append("'" + key + "',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM "
                + table + " r WHERE task_id='" + task + "')")
        fields += ["'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.created_at,a.id),'[]') FROM attempts a WHERE task_id='" + task + "')",
            "'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM command_receipts r WHERE scope_id='" + task + "')",
            "'operations',(SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]') FROM operations o JOIN attempts a ON a.id=o.attempt_id WHERE a.task_id='" + task + "')",
            "'starts',(SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]') FROM outbox o JOIN attempts a ON a.id=o.attempt_id WHERE a.task_id='" + task + "' AND o.kind='start')",
            "'completions',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM node_completions c JOIN nodes n ON n.id=c.node_id WHERE n.task_id='" + task + "')",
            "'assignments',(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM task_guidance_assignments a JOIN node_execution_outbox s ON s.id=a.source_id WHERE s.task_id='" + task + "')"]
        return self.query('SELECT jsonb_build_object(' + ','.join(fields) + ');')

    def observe_turns(self, task, input_ids, stage, timeout=300):
        self.claim(stage)
        deadline = time.monotonic() + timeout
        while True:
            records = self.conversation_records(task)
            selected = [r for r in records['inputs'] if r['id'] in input_ids]
            resolutions = [r for r in records['resolutions'] if r['input_id'] in input_ids]
            ids = [r.get('attempt_id') for r in resolutions]
            attempts = [a for a in records['attempts'] if a['id'] in ids]
            if len(selected) == len(resolutions) == len(attempts) == len(input_ids) \
                    and all(r['status'] == 'replied' for r in selected) \
                    and all(a['process_released'] for a in attempts):
                break
            if any(r['status'] in ('failed', 'withdrawn') for r in selected) or time.monotonic() >= deadline:
                self.save(stage + '-incomplete', {'outcome': 'fail', 'records': records})
                raise RuntimeError('Task turn did not resolve; inspect original input/receipt before recovery')
            time.sleep(2)
        native = {a['id']: self.planning_snapshot(a['id']) for a in attempts}
        after = self.conversation_records(task)
        checks = ordered_turn_checks(after, input_ids, native)
        # Same semantic source/resolution sets must still be present after native reads.
        checks['stable_committed_turns'] = all(sorted(records[key], key=canonical_bytes)
            == sorted(after[key], key=canonical_bytes)
            for key in ('inputs', 'messages', 'conversation_sources', 'resolutions'))
        self.require(stage, {'records': after, 'native': native, 'input_ids': input_ids}, checks)
        return after


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default='/root/monos-boundary-probe-src')
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--action', choices=('create', 'start', 'observe'), default='observe')
    parser.add_argument('--prefix')
    parser.add_argument('--task')
    parser.add_argument('--stage')
    parser.add_argument('--input', action='append')
    args = parser.parse_args()
    if args.action == 'create' and not args.prefix:
        parser.error('--prefix is required for create')
    if args.action == 'observe' and not all((args.task, args.stage, args.input)):
        parser.error('--task, --stage and --input are required for observe')
    probe = TaskConversationProbe(args.source, args.evidence)
    probe.login('/etc/monos-probe/owner-password')
    if args.action == 'create':
        probe.create_git(checked_id(args.prefix))
    elif args.action == 'start':
        probe.start_git()
    else:
        probe.observe_turns(checked_id(args.task), [checked_id(value) for value in args.input], checked_id(args.stage))


if __name__ == '__main__':
    main()
