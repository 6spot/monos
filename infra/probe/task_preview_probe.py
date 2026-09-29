#!/usr/bin/env python3
"""Native proposal -> exact Owner confirmation -> one independent Task.

Only use the existing authorized test installation. Fixture Projects/Todos are
created and archived by Owner commands; no synthetic Task/Discussion DB writes.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
import re
import sqlite3
import urllib.error

from discussion_probe import DiscussionProbe, completion_checks, reply_checks
from probe import checked_id


def canonical_bytes(value):
    # This fixed contract has ASCII keys, Unicode strings and safe integers only;
    # compact sorted JSON therefore matches its RFC 8785 representation.
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def preview_content(preview):
    return {'schema_version': 1, 'action': 'create_execution_task', 'todo_id': preview['todo_id'],
        'proposal_message_id': preview['proposal_message_id'], 'source_message_id': preview['source_message_id'],
        'source_watermark': preview['source_watermark'], 'source_project_id': preview.get('source_project_id'),
        'project_context_version': preview['project_context_version'], 'title': preview['preview']['title'],
        'specification': preview['preview']['specification'], 'selected_project_id': preview['selected_project_id']}


def task_receipt_matches(result, body):
    if (not isinstance(result, dict) or result.get('schema_version') != 1
            or result.get('status') != 'committed' or result.get('request_id') != body['request_id']
            or result.get('todo_id') != body['todo_id']
            or result.get('proposal_message_id') != body['payload']['proposal_message_id']):
        return False
    outcome = result.get('outcome')
    if body['name'] == 'cancel_task_preview':
        return outcome == 'cancelled'
    if (outcome not in ('confirmed', 'created') or not result.get('confirmation_id')
            or result.get('content_digest') != body['payload']['content_digest']):
        return False
    if body['name'] == 'create_execution_task' and (outcome != 'created'
            or result['confirmation_id'] != body['payload']['confirmation_id']):
        return False
    return outcome != 'created' or bool(result.get('task_id') and result.get('specification_id'))


def creation_checks(preview, confirmations, creations, overview, footprint):
    confirmed_ids = {row.get('confirmation_id') for row in confirmations}
    task_ids = {row.get('task_id') for row in creations}
    specification_ids = {row.get('specification_id') for row in creations}
    return {
        'exact_confirmation_digest': preview['content_digest'] == hashlib.sha256(canonical_bytes(preview_content(preview))).hexdigest(),
        'one_exact_confirmation': len(confirmed_ids) == 1 and None not in confirmed_ids
            and all(row.get('content_digest') == preview['content_digest'] for row in confirmations),
        'one_task_across_requests': len(task_ids) == 1 and overview['task_id'] in task_ids
            and len(specification_ids) == 1 and overview['initial_specification_id'] in specification_ids,
        'exact_content_and_project': overview.get('title') == preview['preview']['title']
            and overview.get('specification') == preview['preview']['specification']
            and overview.get('project_id') == preview['selected_project_id']
            and overview.get('todo_id') == preview['todo_id'],
        'independent_ready_task': overview['state'] == 'PLANNING' and 'plan_id' not in overview
            and overview['specification_id'] == overview['initial_specification_id']
            and all(overview[key] == 0 for key in ('queued_attempts', 'held_attempts', 'open_operations')),
        'one_initial_revision_no_execution': footprint == {
            'tasks': 1, 'revisions': 1, 'plans': 0, 'nodes': 0, 'attempts': 0, 'starts': 0},
    }


def native_checks(native, todo, source, watermark, reply):
    ownership = native['ownership']
    observed = native['live_identity']
    attempts = native['attempts']
    retained_identity = (type(ownership.get('pid')) is int and ownership['pid'] > 0
        and isinstance(ownership.get('birth'), str) and ownership['birth'].isdigit()
        and isinstance(ownership.get('boot_id'), str) and bool(ownership['boot_id'])
        and re.fullmatch(r'/system.slice/monos-probe-[A-Za-z0-9_-]+\.service', ownership.get('cgroup', '')) is not None
        and len(attempts) == 1 and attempts[0]['todo_id'] == todo
        and ownership.get('dispatch_id') == attempts[0]['dispatch_id'])
    pid_reused = (observed.get('present') is True and all(observed.get(key) is not None for key in ('pid', 'birth', 'boot_id'))
        and any(observed[key] != ownership.get(key) for key in ('pid', 'birth', 'boot_id')))
    matched = [handoff for handoff in native['handoffs']
        if handoff['scope_id'] == todo and handoff['source_message_id'] == source
        and handoff['source_watermark'] == watermark
        and handoff.get('payload', {}).get('task_preview') == reply.get('task_preview')
        and handoff.get('payload', {}).get('reply') == reply.get('content')
        and any(request.get('request_id') == handoff['request_id'] and request.get('digest') == handoff['digest']
            and request.get('digest_matches_bytes') is True for request in native['journal_requests'])
        and any(receipt['request_id'] == handoff['request_id'] and receipt['digest'] == handoff['digest']
            and receipt['scope_id'] == todo and receipt['command_name'] == 'commit_discussion_turn'
            and receipt['status'] == 'committed' for receipt in native['receipts'])]
    return {
        'native_journal_handoff': bool(native['journal_requests'])
            and all(row['digest_matches_bytes'] for row in native['journal_requests']) and len(matched) == 1,
        'physical_source_absence': retained_identity and (observed.get('present') is False or pid_reused)
            and native['physical'].get('cgroup_populated') is False
            and all(row.get('alive') is False for row in native['physical'].get('descendants', [])),
    }


def provenance_checks(preview, confirmations, creations, records, commands):
    content = preview_content(preview)
    expected_digest = hashlib.sha256(canonical_bytes(content)).hexdigest()
    confirmation = records['confirmations'][0] if len(records['confirmations']) == 1 else {}
    resolution = records['resolutions'][0] if len(records['resolutions']) == 1 else {}
    task = records['task'] or {}
    revision = records['revision'] or {}
    receipts = {row['request_id']: row for row in records['receipts']}
    first_confirmation = confirmations[0]
    first_creation = creations[0]
    return {
        'persisted_exact_authorization': confirmation.get('id') == first_confirmation['confirmation_id']
            and confirmation.get('request_id') in {row['request_id'] for row in confirmations}
            and confirmation.get('todo_id') == preview['todo_id']
            and confirmation.get('proposal_message_id') == preview['proposal_message_id']
            and confirmation.get('project_id') == preview['selected_project_id']
            and confirmation.get('content') == content and confirmation.get('content_digest') == expected_digest,
        'consumed_once_for_exact_task': resolution.get('disposition') == 'created'
            and resolution.get('todo_id') == preview['todo_id']
            and resolution.get('proposal_message_id') == preview['proposal_message_id']
            and resolution.get('task_id') == first_creation['task_id']
            and resolution.get('confirmation_id') == first_confirmation['confirmation_id']
            and resolution.get('request_id') in {row['request_id'] for row in creations}
            and task.get('source_proposal_message_id') == preview['proposal_message_id']
            and task.get('creation_confirmation_id') == first_confirmation['confirmation_id']
            and task.get('todo_id') == preview['todo_id'] and task.get('project_id') == preview['selected_project_id']
            and task.get('resource_id') is None,
        'persisted_exact_initial_revision': revision.get('id') == first_creation['specification_id']
            and revision.get('id') == task.get('initial_specification_id')
            and revision.get('task_id') == first_creation['task_id']
            and revision.get('content') == preview['preview']['specification']
            and revision.get('content_digest') == hashlib.sha256(canonical_bytes(preview['preview']['specification'])).hexdigest(),
        'persisted_command_receipts': len(receipts) == len(records['receipts']) == len(commands) == len(confirmations + creations)
            and all(receipts.get(command['request_id'], {}).get('digest') == hashlib.sha256(canonical_bytes(command)).hexdigest()
                and receipts[command['request_id']]['response'] == result
                for command, result in zip(commands, confirmations + creations)),
    }


class TaskPreviewProbe(DiscussionProbe):
    def preserve(self, name, value):
        path = self.evidence / (name + '.json')
        if path.exists():
            if canonical_bytes(json.loads(path.read_text())) != canonical_bytes(value):
                raise RuntimeError('Existing immutable evidence differs: ' + name)
            return
        self.save(name, value)

    def formal(self, base, body, valid):
        self.preserve('request-' + body['request_id'], {'command': body})
        try:
            result = self.post(base, body)
        except urllib.error.HTTPError as error:
            if error.code < 500:
                self.preserve('rejection-' + body['request_id'], {'http_status': error.code})
                raise
            result = self.recover(base, body)
        except (OSError, TimeoutError, ValueError):
            result = self.recover(base, body)
        self.preserve('receipt-' + body['request_id'], {'receipt': result})
        if not valid(result, body):
            raise RuntimeError('Formal command receipt identity or result differs')
        return result

    def task_command(self, body):
        return self.formal('/v1/owner/task-previews/commands', body, task_receipt_matches)

    def snapshot(self, attempt):
        value = super().snapshot(attempt)
        journal = sqlite3.connect('file:' + self.config['journal'] + '?mode=ro', uri=True)
        try:
            payloads = {request_id: json.loads(envelope)['payload'] for request_id, envelope in
                journal.execute('SELECT id,envelope FROM requests WHERE attempt=?', (attempt,))}
            for handoff in value['handoffs']:
                handoff['payload'] = payloads[handoff['request_id']]
        finally:
            journal.close()
        return value

    def project(self, project, request_id):
        configuration = self.read('/v1/owner/configuration')
        return self.formal('/v1/owner/configuration/commands', {
            'schema_version': 1, 'request_id': request_id,
            'expected_control_version': configuration['control_version'],
            'name': 'save_project', 'payload': project,
        }, lambda result, body: result.get('status') == 'committed'
            and result.get('request_id') == body['request_id'] and result.get('entity_id') == project['id'])

    def footprint(self, todo, task):
        todo, task = checked_id(todo), checked_id(task)
        return self.query("SELECT jsonb_build_object("
            "'tasks',(SELECT count(*) FROM tasks WHERE todo_id='" + todo + "'),"
            "'revisions',(SELECT count(*) FROM specification_revisions WHERE task_id='" + task + "'),"
            "'plans',(SELECT count(*) FROM plan_revisions WHERE task_id='" + task + "'),"
            "'nodes',(SELECT count(*) FROM nodes WHERE task_id='" + task + "'),"
            "'attempts',(SELECT count(*) FROM attempts WHERE task_id='" + task + "'),"
            "'starts',(SELECT count(*) FROM outbox o JOIN attempts a ON a.id=o.attempt_id WHERE a.task_id='" + task + "' AND o.kind='start'));" )

    def creation_records(self, proposal, task, commands):
        proposal, task = checked_id(proposal), checked_id(task)
        request_ids = ','.join("'" + checked_id(command['request_id']) + "'" for command in commands)
        return self.query("SELECT jsonb_build_object("
            "'confirmations',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM task_creation_confirmations c WHERE proposal_message_id='" + proposal + "'),"
            "'resolutions',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM task_preview_resolutions r WHERE proposal_message_id='" + proposal + "'),"
            "'task',(SELECT to_jsonb(t) FROM tasks t WHERE id='" + task + "'),"
            "'revision',(SELECT to_jsonb(s) FROM specification_revisions s JOIN tasks t ON t.initial_specification_id=s.id AND t.id=s.task_id WHERE t.id='" + task + "'),"
            "'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM task_preview_command_receipts r WHERE request_id IN (" + request_ids + ")));" )

    def run(self, todo):
        project = {'id': todo + '-project', 'name': 'Task preview acceptance', 'context': '',
            'role_ids': [], 'resources': [], 'archived': False}
        baseline = self.audit(todo)
        existing = self.query("SELECT jsonb_build_object('todo',EXISTS(SELECT 1 FROM todos WHERE id='" + checked_id(todo)
            + "'),'project',EXISTS(SELECT 1 FROM projects WHERE id='" + checked_id(project['id']) + "'));" )
        self.require('preview-preflight-' + todo, {'catalog': self.catalog(), 'baseline': baseline, 'existing': existing,
            'harness_sha256': hashlib.sha256((self.source / 'infra/probe/task_preview_probe.py').read_bytes()).hexdigest()},
            {'fresh_trial_identities': existing == {'todo': False, 'project': False} and not baseline['attempts']})
        self.project(project, todo + '-project-save')
        self.execute({'schema_version': 1, 'request_id': todo + '-capture', 'name': 'capture_todo',
            'payload': {'todo_id': todo, 'original_capture': 'A small personal reading list with finished entries.'}}, capture=True)
        source = self.submit(todo, 'source', 'Prepare one structured execution Task preview for a small personal reading list: add entries and mark them finished. Use a short title and a concise Markdown specification. Commit the preview with your Discussion reply and requirement state using the native monos command. Leave Project unspecified. Do not inspect repositories or start execution.')
        self.observe(todo, lambda status, audit: 'current_source' not in status
            and len(audit['attempts']) == 1 and all(row['process_released'] for row in audit['attempts']))
        messages, audit = self.messages(todo), self.audit(todo, baseline)
        replies = [message for message in messages if message['author'] == 'assistant']
        checks = reply_checks(messages, [source]) | completion_checks(audit, [source])
        checks['structured_committed_preview'] = len(replies) == 1 and bool(replies[0].get('task_preview'))
        native = self.snapshot(audit['attempts'][0]['attempt_id'])
        checks.update(native_checks(native, todo, source,
            next(message['sequence'] for message in messages if message['message_id'] == source), replies[0] if replies else {}))
        self.require('preview-proposed-' + todo, {'messages': messages, 'audit': audit, 'native': native}, checks)
        proposal = replies[0]['message_id']
        path = '/v1/owner/todos/' + todo + '/task-previews/' + checked_id(proposal)
        unassigned = self.read(path)
        selected = self.read(path + '?project_id=' + project['id'])
        self.require('preview-read-' + todo, {'unassigned': unassigned, 'selected': selected}, {
            'project_required': unassigned['state'] == 'project_required',
            'exact_source': selected['todo_id'] == todo and selected['proposal_message_id'] == proposal
                and selected['source_message_id'] == source and selected['source_watermark'] == replies[0]['source_watermark']
                and selected.get('source_project_id') == replies[0].get('project_id')
                and selected['project_context_version'] == replies[0]['project_context_version']
                and selected['preview'] == replies[0]['task_preview'],
            'exact_digest': selected['content_digest'] == hashlib.sha256(canonical_bytes(preview_content(selected))).hexdigest(),
            'selected_without_reassigning': selected['state'] == 'eligible'
                and selected['selected_project_id'] == project['id']
                and 'project_id' not in self.read('/v1/owner/todos/' + todo),
            'no_task_from_reads': self.audit(todo)['task_count'] == baseline['task_count'],
        })
        common = {'schema_version': 1, 'todo_id': todo}
        payload = {'proposal_message_id': proposal, 'project_id': project['id'], 'content_digest': selected['content_digest']}
        confirms = [{**common, 'request_id': todo + '-confirm-' + str(i),
            'name': 'confirm_task_preview', 'payload': payload} for i in range(2)]
        with ThreadPoolExecutor(max_workers=2) as pool:
            confirmations = list(pool.map(self.task_command, confirms))
        self.require('preview-confirmed-' + todo, {'confirmations': confirmations}, {
            'no_task_from_confirmation': self.audit(todo)['task_count'] == baseline['task_count'],
            'same_authorization': confirmations[0]['confirmation_id'] == confirmations[1]['confirmation_id'],
        })
        creates = [{**common, 'request_id': todo + '-create-' + str(i), 'name': 'create_execution_task',
            'payload': {'proposal_message_id': proposal, 'confirmation_id': confirmations[i]['confirmation_id'],
                'content_digest': selected['content_digest']}} for i in range(2)]
        with ThreadPoolExecutor(max_workers=2) as pool:
            creations = list(pool.map(self.task_command, creates))
        task = checked_id(creations[0]['task_id'])
        overview = self.read('/v1/owner/tasks/' + task)
        footprint = self.footprint(todo, task)
        records = self.creation_records(proposal, task, confirms + creates)
        self.require('preview-created-' + todo, {'preview': selected, 'confirmations': confirmations,
            'creations': creations, 'task': overview, 'footprint': footprint, 'records': records},
            creation_checks(selected, confirmations, creations, overview, footprint)
                | provenance_checks(selected, confirmations, creations, records, confirms + creates))
        record = self.read('/v1/owner/todos/' + todo)
        self.execute({'schema_version': 1, 'request_id': todo + '-assign', 'name': 'assign_todo_project',
            'expected_control_version': record['control_version'], 'payload': {'todo_id': todo, 'project_id': project['id']}}, capture=True)
        record = self.read('/v1/owner/todos/' + todo)
        self.execute({'schema_version': 1, 'request_id': todo + '-archive', 'name': 'set_todo_archived',
            'expected_control_version': record['control_version'], 'payload': {'todo_id': todo, 'archived': True}}, capture=True)
        self.project({**project, 'archived': True}, todo + '-project-archive')
        restored = self.read(path + '?project_id=unavailable-selection')
        replay = self.task_command(creates[0])
        recovered = self.read('/v1/owner/task-previews/commands/' + creates[1]['request_id'])
        new_confirmation = self.task_command({**confirms[0], 'request_id': todo + '-confirm-after'})
        new_creation = self.task_command({**creates[0], 'request_id': todo + '-create-after'})
        final_audit, final_footprint = self.audit(todo, baseline), self.footprint(todo, task)
        final_task = self.read('/v1/owner/tasks/' + task)
        self.require('preview-complete-' + todo, {'restored': restored, 'replay': replay, 'recovered': recovered,
            'new_confirmation': new_confirmation, 'new_creation': new_creation, 'task': final_task,
            'audit': final_audit, 'footprint': final_footprint}, {
            'created_binding_wins': restored['state'] == 'created' and restored['task']['task_id'] == task
                and restored['selected_project_id'] == project['id'],
            'immutable_request_replay': replay == creations[0] and recovered == creations[1],
            'new_request_same_task_after_archive': new_confirmation['task_id'] == task and new_creation['task_id'] == task,
            'one_task_no_execution': all(creation_checks(selected, confirmations, creations, final_task, final_footprint).values()),
            'source_attempt_released': len(final_audit['attempts']) == 1
                and final_audit['attempts'][0]['attempt_id'] == audit['attempts'][0]['attempt_id']
                and all(row['process_released'] and row['process_absent'] and not row['mutation_allowed']
                    and row['unresolved_operations'] == 0 for row in final_audit['attempts']),
        })


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--password-file', required=True)
    parser.add_argument('todo_id')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Run only as root on the authorized test host')
    todo = checked_id(args.todo_id)
    if len(todo) > 48:
        raise ValueError('Reserve suffix space for immutable fixture identities')
    probe = TaskPreviewProbe('/root/monos-boundary-probe-src', args.evidence)
    probe.login(args.password_file)
    probe.run(todo)


if __name__ == '__main__':
    main()
