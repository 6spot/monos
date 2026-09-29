#!/usr/bin/env python3
"""Canonical Owner creation -> explicit Start -> native issue -> answer/Retry.

Uses only the existing deployment. Each stage has an exclusive evidence claim;
uncertain work is inspected by identity, never replaced or silently relaunched.
SQL and the Runner journal are read-only independent evidence sources.
"""
import argparse
import hashlib
import json
import os
import pathlib
import sqlite3
import time
import urllib.error

from probe import checked_id
from task_preview_probe import (TaskPreviewProbe, canonical_bytes, creation_checks,
    native_checks, provenance_checks)
from workspace_probe import WorkspaceProbe, idle_checks, settled_checks


SPECIFICATION = """# A personal reading list

Deliver one small reading-list interface where the Owner can add book titles and
mark entries finished. Keep all work in one execution Node. The Node must retain
these hard requirements and human-readable expected outputs in its definition.
No repository is needed during planning.

The Owner must choose the primary button label: either 'Add book' or 'Save book'.
This decision has deliberately not been supplied. Initial planning MUST raise a
planning issue asking for that choice; do not guess, use a default, or publish a
Plan before the Owner answers. An exact Owner answer resolves this choice within
this Specification. Once answered, publish one Node with no dependencies, the
selected Role ID, nonempty hard_requirements and expected_outputs. Do not execute
the Node during planning.
"""
ANSWER = "Use 'Add book' as the primary button label. Keep the existing Specification and publish its one-Node Plan."


def before_start_checks(records, expected_specification=SPECIFICATION):
    task = records['task'] or {}
    return {
        'canonical_task': bool(task.get('todo_id') and task.get('creation_confirmation_id')
            and task.get('source_proposal_message_id') and task.get('project_id')),
        'planning_without_work': task.get('state') == 'PLANNING' and task.get('plan_id') is None
            and task.get('initial_planning_intent_id') is None
            and all(not records[key] for key in ('sources', 'attempts', 'plans', 'nodes', 'starts')),
        'one_exact_specification': len(records['specifications']) == 1
            and records['specifications'][0]['id'] == task.get('specification_id')
            and task.get('initial_specification_id') == task.get('specification_id')
            and records['specifications'][0]['content'] == expected_specification,
        'no_workspace': all(records[key] == 0 for key in ('workspaces', 'leases', 'node_attempts')),
    }


def phase_checks(records, native, expected_kind):
    """Require independent immutable command bytes, receipt and published result."""
    task = records['task'] or {}
    name = 'publish_execution_plan' if expected_kind == 'plan' else 'raise_planning_issue'
    selected = [row for row in records['attempts'] if row.get('planning_intent_id') == task.get('initial_planning_intent_id')]
    attempt = selected[0] if len(selected) == 1 else {}
    receipts = [row for row in records['receipts'] if row['attempt_id'] == attempt.get('id')]
    outcomes = [row for row in receipts if row['command_name'] == name]
    receipt = outcomes[0] if len(outcomes) == 1 else {}
    envelope = json.loads(receipt.get('envelope_json', '{}'))
    result = receipt.get('response', {}).get('result', {})
    outcome = result.get('planning_outcome', {})
    operations = [row for row in records['operations'] if row['attempt_id'] == attempt.get('id')]
    source = next((row for row in records['sources'] if row['id'] == attempt.get('planning_intent_id')), {})
    context_bytes = canonical_bytes(source.get('context'))
    specification = records['specifications'][0]['content'] if len(records['specifications']) == 1 else None
    starts = [row for row in records['starts'] if row['attempt_id'] == attempt.get('id')]
    journal = (native or {}).get('planning_requests', [])
    checks = {
        'current_source_attempt': bool(attempt) and attempt.get('task_id') == task.get('id')
            and attempt.get('kind') == 'planner' and attempt.get('node_id') is None
            and attempt.get('todo_id') is None and attempt.get('plan_id') is None
            and source.get('planned_attempt_id') == attempt.get('id'),
        'single_start': len(starts) == 1 and attempt.get('started') is True,
        'terminal_phase': attempt.get('state') == 'SUCCEEDED' and attempt.get('mutation_allowed') is False
            and attempt.get('process_released') is True and attempt.get('process_absent') is True,
        'no_workspace_or_node_execution': all(records[key] == 0 for key in ('workspaces', 'leases', 'node_attempts')),
        'exact_outcome': len(outcomes) == 1 and receipt.get('response', {}).get('status') == 'committed'
            and outcome.get('kind') == expected_kind
            and outcome.get('planning_intent_id') == source.get('id')
            and envelope.get('scope_id') == task.get('id')
            and envelope.get('payload', {}).get('planning_intent_id') == source.get('id'),
        'native_envelope_provenance': bool(receipt) and any(row.get('request_id') == receipt.get('request_id')
            and row.get('digest') == receipt.get('digest') and row.get('envelope') == envelope
            and row.get('digest_matches_bytes') is True for row in journal)
            and receipt.get('digest') == hashlib.sha256(canonical_bytes(envelope)).hexdigest(),
        'settled_stop': len(operations) == 1 and operations[0].get('kind') == 'stop'
            and operations[0].get('state') == 'succeeded'
            and receipt.get('operation_id') == operations[0].get('id'),
        'physical_absence': bool(native) and settled_checks(native),
        'task_only_context': isinstance(source.get('prompt'), str) and specification is not None
            and canonical_bytes(specification) in context_bytes
            and all(marker.encode() not in context_bytes for marker in ('TODO_ONLY_SENTINEL', 'PRIVATE_ROLE_SENTINEL')),
        'frozen_context_binding': source.get('context_digest') == hashlib.sha256(context_bytes).hexdigest()
            and source.get('prompt') == context_bytes.decode('utf-8')
            and attempt.get('launch', {}).get('prompt') == source.get('prompt')
            and attempt.get('launch', {}).get('task_planning_source', {}).get('context_digest') == source.get('context_digest'),
    }
    if expected_kind == 'plan':
        plan = records['plans'][0] if len(records['plans']) == 1 else {}
        definitions = records['plan_nodes']
        definition = definitions[0].get('definition', {}) if len(definitions) == 1 else {}
        checks['exact_published_plan'] = (task.get('state') == 'RUNNING' and plan.get('id') == task.get('plan_id')
            and plan.get('id') == outcome.get('plan_id') and plan.get('specification_id') == task.get('specification_id')
            and plan.get('content_digest') == hashlib.sha256(canonical_bytes(plan.get('content'))).hexdigest()
            and plan.get('content', {}).get('nodes') == [definition]
            and envelope.get('payload', {}).get('nodes') == [definition])
        checks['one_pending_complete_node'] = (len(records['nodes']) == len(definitions) == 1
            and records['nodes'][0].get('state') == 'PENDING' and definition.get('dependencies') == []
            and bool(definition.get('hard_requirements')) and bool(definition.get('expected_outputs'))
            and definition.get('role_id') in records['project']['role_ids'])
        checks['answer_retained'] = canonical_bytes(ANSWER) in context_bytes
    else:
        sequence = task.get('planning_issue_sequence')
        checks['exact_open_issue'] = (task.get('state') == 'RUNNING' and task.get('plan_id') is None
            and not records['plans'] and not records['nodes'] and sequence is not None
            and outcome.get('issue_sequence') == sequence
            and any(row['sequence'] == sequence and row.get('attempt_id') == attempt.get('id')
                and row['body'].get('reason') == envelope.get('payload', {}).get('reason') for row in records['events']))
    return checks


def lineage_checks(issue, current):
    old = issue['records']
    prior = old['task']['initial_planning_intent_id']
    head = current['task']['initial_planning_intent_id']
    sources = {row['id']: row for row in current['sources']}
    events = {row['sequence']: row for row in current['events']}
    receipts = {(row['attempt_id'], row['request_id']): row for row in current['receipts']}
    return {
        'one_explicit_successor': len(current['sources']) == 2 and len(current['attempts']) == 2
            and len(current['starts']) == 2 and prior != head and sources.get(head, {}).get('previous_intent_id') == prior,
        'initial_specification_unchanged': current['specifications'] == old['specifications']
            and current['task']['specification_id'] == old['task']['specification_id'],
        'retained_issue_history': all(events.get(row['sequence']) == row for row in old['events'])
            and all(receipts.get((row['attempt_id'], row['request_id'])) == row for row in old['receipts'])
            and all(sources.get(row['id']) == row for row in old['sources']),
        'all_attempts_settled': all(row['process_released'] is True and row['process_absent'] is True
            and row['mutation_allowed'] is False for row in current['attempts']),
    }


class TaskPlanningProbe(TaskPreviewProbe):
    def claim(self, stage):
        self.save('claim-' + stage, {'stage': stage, 'started_at': time.time(),
            'harness_sha256': hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()})

    def idle(self, stage):
        counts = WorkspaceProbe.idle_state(self)
        counts['pending_planning'] = self.query('SELECT count(*) FROM task_planning_outbox WHERE NOT done;')
        self.require(stage, {'counts': counts}, {'globally_idle': idle_checks({k: v for k, v in counts.items()
            if k != 'pending_planning'}) and counts['pending_planning'] == 0})

    def records(self, task):
        task = checked_id(task)
        tables = {'sources': 'task_planning_outbox', 'specifications': 'specification_revisions',
            'plans': 'plan_revisions', 'nodes': 'nodes', 'plan_nodes': 'plan_nodes', 'events': 'task_events'}
        fields = ["'task',(SELECT to_jsonb(t) FROM tasks t WHERE id='" + task + "')",
            "'project',(SELECT to_jsonb(p)||jsonb_build_object('role_ids',(SELECT coalesce(jsonb_agg(role_id ORDER BY role_id),'[]'::jsonb) FROM project_roles WHERE project_id=p.id)) FROM projects p JOIN tasks t ON t.project_id=p.id WHERE t.id='" + task + "')"]
        for key, table in tables.items():
            fields.append("'" + key + "',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM " + table + " r WHERE task_id='" + task + "')")
        fields += ["'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) FROM (SELECT id,task_id,todo_id,node_id,kind,state,planning_intent_id,specification_id,plan_id,launch,dispatch_id,started,process_released,process_absent,mutation_allowed FROM attempts WHERE task_id='" + task + "') a)",
            "'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM command_receipts r WHERE scope_id='" + task + "')",
            "'operations',(SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) FROM operations o JOIN attempts a ON a.id=o.attempt_id WHERE a.task_id='" + task + "')",
            "'starts',(SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) FROM outbox o JOIN attempts a ON a.id=o.attempt_id WHERE a.task_id='" + task + "' AND o.kind='start')",
            "'workspaces',(SELECT count(*) FROM task_workspaces WHERE task_id='" + task + "')",
            "'leases',(SELECT count(*) FROM workspace_leases WHERE task_id='" + task + "')",
            "'node_attempts',(SELECT count(*) FROM attempts WHERE task_id='" + task + "' AND kind='node')"]
        return self.query('SELECT jsonb_build_object(' + ','.join(fields) + ');')

    def planning_snapshot(self, attempt):
        value = self.snapshot(attempt)
        with sqlite3.connect('file:' + self.config['journal'] + '?mode=ro', uri=True) as journal:
            value['planning_requests'] = [{'request_id': row[0], 'digest': row[1],
                'digest_matches_bytes': hashlib.sha256(row[2]).hexdigest() == row[1], 'envelope': json.loads(row[2])}
                for row in journal.execute('SELECT id,digest,envelope FROM requests WHERE attempt=?', (attempt,))]
        return value

    def load_task(self):
        return json.loads((self.evidence / 'created.json').read_text())['task']['task_id']

    def create(self, prefix):
        self.claim('create')
        self.idle('create-idle')
        self.save('catalog', self.catalog())
        existing = self.query("SELECT jsonb_build_object('todo',EXISTS(SELECT 1 FROM todos WHERE id='" + checked_id(prefix)
            + "'),'project',EXISTS(SELECT 1 FROM projects WHERE id='" + checked_id(prefix + '-project')
            + "'),'role',EXISTS(SELECT 1 FROM roles WHERE id='" + checked_id(prefix + '-role') + "'));")
        self.require('fresh-identities', {'existing': existing}, {'fresh': existing == {'todo': False, 'project': False, 'role': False}})
        role = {'id': prefix + '-role', 'name': 'Reading list implementation',
            'description': 'Implements and verifies a small reading-list interface.',
            'instructions': 'Implement and verify the specified interface. PRIVATE_ROLE_SENTINEL', 'archived': False}
        configuration = self.read('/v1/owner/configuration')
        self.formal('/v1/owner/configuration/commands', {'schema_version': 1,
            'request_id': prefix + '-save-role', 'expected_control_version': configuration['control_version'],
            'name': 'save_role', 'payload': role}, lambda result, body: result.get('status') == 'committed'
                and result.get('request_id') == body['request_id'] and result.get('entity_id') == role['id'])
        project = {'id': prefix + '-project', 'name': 'Initial Task planning acceptance',
            'context': 'Small reading-list interfaces. Preserve explicit Owner choices and objective requirements.',
            'role_ids': [role['id']], 'resources': [], 'archived': False}
        self.project(project, prefix + '-save-project')
        self.execute({'schema_version': 1, 'request_id': prefix + '-capture', 'name': 'capture_todo',
            'payload': {'todo_id': prefix, 'original_capture': 'TODO_ONLY_SENTINEL Reading-list planning acceptance.'}}, capture=True)
        source = self.submit(prefix, 'preview', 'Create exactly one Task preview. Use the following Markdown verbatim as its specification; preserve whitespace and all requirements. Leave Project unspecified. The label decision is deliberately deferred to Task initial planning, so do not resolve it in Discussion. Commit the preview using commit_discussion_turn.\n\n' + SPECIFICATION)
        self.observe(prefix, lambda status, audit: 'current_source' not in status
            and len(audit['attempts']) == 1 and all(row['process_released'] for row in audit['attempts']))
        messages, audit = self.messages(prefix), self.audit(prefix)
        replies = [row for row in messages if row['author'] == 'assistant']
        if len(replies) != 1 or not replies[0].get('task_preview'):
            self.save('preview-failed', {'messages': messages, 'audit': audit, 'outcome': 'fail'})
            raise RuntimeError('Native Discussion did not commit one preview')
        reply = replies[0]
        native = self.snapshot(audit['attempts'][0]['attempt_id'])
        self.require('preview', {'messages': messages, 'audit': audit, 'native': native},
            native_checks(native, prefix, source, reply['source_watermark'], reply)
            | {'required_specification': reply['task_preview']['specification'].strip() == SPECIFICATION.strip()})
        selected = self.read('/v1/owner/todos/' + prefix + '/task-previews/' + reply['message_id'] + '?project_id=' + project['id'])
        confirm = {'schema_version': 1, 'todo_id': prefix, 'request_id': prefix + '-confirm', 'name': 'confirm_task_preview',
            'payload': {'proposal_message_id': reply['message_id'], 'project_id': project['id'], 'content_digest': selected['content_digest']}}
        confirmation = self.task_command(confirm)
        create = {'schema_version': 1, 'todo_id': prefix, 'request_id': prefix + '-create', 'name': 'create_execution_task',
            'payload': {'proposal_message_id': reply['message_id'], 'confirmation_id': confirmation['confirmation_id'], 'content_digest': selected['content_digest']}}
        creation = self.task_command(create)
        task = self.read('/v1/owner/tasks/' + checked_id(creation['task_id']))
        footprint = self.footprint(prefix, task['task_id'])
        creation_rows = self.creation_records(reply['message_id'], task['task_id'], [confirm, create])
        records = self.records(task['task_id'])
        self.require('created', {'task': task, 'records': records, 'preview': selected,
            'confirmation': confirmation, 'creation': creation, 'creation_records': creation_rows},
            creation_checks(selected, [confirmation], [creation], task, footprint)
            | provenance_checks(selected, [confirmation], [creation], creation_rows, [confirm, create])
            | before_start_checks(records, selected['preview']['specification']))

    def control(self, stage, name, payload):
        self.claim(stage)
        task = self.load_task()
        overview = self.read('/v1/owner/tasks/' + task)
        body = {'schema_version': 1, 'request_id': checked_id(task + '-' + stage), 'scope_id': task,
            'expected_control_version': overview['control_version'], 'name': name, 'payload': payload}
        self.save('request-' + stage, {'command': body})
        try:
            result = self.post('/v1/owner/commands', body)
        except (OSError, TimeoutError, ValueError):
            result = self.read('/v1/owner/scopes/' + task + '/commands/' + body['request_id'])
        self.save('receipt-' + stage, {'receipt': result})
        if result.get('status') not in ('admitted', 'committed') or result.get('request_id') != body['request_id']:
            raise RuntimeError('Unknown Owner outcome; inspect retained exact request before continuing')
        replay = self.post('/v1/owner/commands', body)
        recovered = self.read('/v1/owner/scopes/' + task + '/commands/' + body['request_id'])
        self.require(stage + '-replay', {'receipt': result, 'replay': replay, 'recovered': recovered},
            {'immutable_owner_receipt': result == replay == recovered})

    def inspect(self, stage, expected):
        self.claim(stage)
        task = self.load_task()
        deadline = time.monotonic() + 300
        while True:
            records = self.records(task)
            selected = [row for row in records['attempts'] if row.get('planning_intent_id') == records['task']['initial_planning_intent_id']]
            if len(selected) == 1 and selected[0]['state'] in ('SUCCEEDED', 'FAILED', 'CANCELLED') and selected[0]['process_released']:
                break
            if time.monotonic() >= deadline:
                self.save(stage + '-timeout', {'records': records, 'outcome': 'fail'})
                raise RuntimeError('Trial deadline; retain source and inspect, no automatic Retry')
            time.sleep(2)
        native = self.planning_snapshot(selected[0]['id'])
        planning = self.read('/v1/owner/tasks/' + task + '/planning')
        plan = self.read('/v1/owner/tasks/' + task + '/plans/' + records['task']['plan_id']) if records['task']['plan_id'] else None
        checks = phase_checks(records, native, expected)
        checks['scoped_current_planning_read'] = (planning.get('task_id') == task
            and planning.get('specification_id') == records['task']['specification_id']
            and planning.get('control_version') == records['task']['control_version']
            and planning.get('planning_source', {}).get('intent_id') == selected[0]['planning_intent_id']
            and planning.get('attempt_id') == selected[0]['id'])
        if expected == 'plan':
            checks.update(lineage_checks(json.loads((self.evidence / 'issue.json').read_text()), records))
            checks['scoped_exact_plan_read'] = (plan.get('task_id') == task and plan.get('plan_id') == records['task']['plan_id']
                and plan.get('content_digest') == records['plans'][0]['content_digest']
                and plan.get('nodes') == records['plans'][0]['content']['nodes'])
            checks['published_projection'] = planning.get('status') == 'published' and planning.get('available_actions') == []
        else:
            event = next((row for row in records['events'] if row['sequence'] == records['task']['planning_issue_sequence']), {})
            checks['exact_issue_projection'] = (planning.get('status') == 'issue'
                and planning.get('issue') == {'issue_sequence': event.get('sequence'), 'reason': event.get('body', {}).get('reason')}
                and set(planning.get('available_actions', [])) == {'retry_initial_planning', 'stop_initial_planning', 'cancel_task'})
        self.require(stage, {'records': records, 'native': native, 'planning': planning, 'plan': plan}, checks)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--password-file', required=True)
    parser.add_argument('stage', choices=('create', 'start', 'issue', 'retry', 'plan', 'audit'))
    parser.add_argument('--prefix', default='planning-native-v1')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Run only on the authorized test host as root')
    prefix = checked_id(args.prefix)
    if len(prefix) > 48:
        raise ValueError('Reserve suffix space')
    probe = TaskPlanningProbe('/root/monos-boundary-probe-src', args.evidence)
    probe.login(args.password_file)
    if args.stage == 'create':
        probe.create(prefix)
    elif args.stage == 'start':
        records = probe.records(probe.load_task())
        created = json.loads((probe.evidence / 'created.json').read_text())
        probe.require('before-start', {'records': records}, before_start_checks(records, created['preview']['preview']['specification']))
        probe.control('start', 'start_task', {'specification_id': records['task']['specification_id']})
    elif args.stage == 'retry':
        issue = json.loads((probe.evidence / 'issue.json').read_text())
        if issue.get('outcome') != 'pass':
            raise RuntimeError('Inspect failed issue evidence before Retry')
        task = issue['records']['task']
        probe.control('retry', 'retry_initial_planning', {'planning_intent_id': task['initial_planning_intent_id'],
            'issue_sequence': task['planning_issue_sequence'], 'answer': ANSWER})
    elif args.stage in ('issue', 'plan'):
        probe.inspect(args.stage, args.stage)
    else:
        probe.claim('audit')
        probe.idle('final-idle')
        probe.save('final-records', {'records': probe.records(probe.load_task())})


if __name__ == '__main__':
    main()
