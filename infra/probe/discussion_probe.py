#!/usr/bin/env python3
"""Real Todo Discussion acceptance through authenticated product commands.

Runs only against the existing authorized test installation. No synthetic Task,
direct DB mutation, provider driver or permanent service is used. Observation
deadlines fail the fixture; they never classify a Runtime as hung.
"""
import argparse
import json
import os
import pathlib
import sqlite3
import time
import urllib.error
import urllib.request

from probe import checked_id, live_identity, verified_live_identity
from stop_probe import StopProbe


def reply_checks(messages, source_ids):
    owners = {m['message_id']: m for m in messages if m['author'] == 'owner'}
    replies = [m for m in messages if m['author'] == 'assistant']
    return {
        'exact_sources': set(owners) == set(source_ids),
        'one_reply_per_source': len(replies) == len(source_ids)
        and [m.get('source_message_id') for m in replies] == source_ids,
        'nonempty_formal_replies': bool(replies) and all(m['content'].strip() for m in replies),
        'correct_source_watermarks': all(m.get('source_message_id') in owners
            and m.get('source_watermark') == owners[m['source_message_id']]['sequence']
            for m in replies),
        'unique_ordered_history': len({m['message_id'] for m in messages}) == len(messages)
        and [m['sequence'] for m in messages] == sorted({m['sequence'] for m in messages}),
    }


def completion_checks(audit, source_ids):
    rows = audit['attempts']
    return {
        'no_task_or_node_created': audit['task_count'] == audit['baseline_task_count']
        and audit['node_count'] == audit['baseline_node_count'],
        'one_attempt_per_source': len(rows) == len(source_ids)
        and sorted(row['source_message_id'] for row in rows) == sorted(source_ids),
        'real_todo_planners': bool(rows) and all(row['kind'] == 'planner'
            and row['task_id'] is None and row['node_id'] is None
            and row['todo_id'] == audit['todo_id'] and row['resource_id'] is None for row in rows),
        'single_start_and_formal_handoff': all(row['starts'] == 1 and row['commits'] == 1 for row in rows),
        'successful_physical_release': all(row['state'] == 'SUCCEEDED' and row['started']
            and row['process_released'] and row['process_absent'] and not row['mutation_allowed']
            and row['unresolved_operations'] == 0 for row in rows),
    }


def receipt_matches(result, body, capture=False):
    return (result.get('status') == 'committed'
        and result.get('request_id') == body['request_id']
        and (result.get('todo', {}).get('todo_id') == body['payload']['todo_id'] if capture
             else result.get('todo_id') == body['todo_id']))


def physically_released(before, after):
    def same_process(expected, observed):
        return observed.get('present') is True and all(observed.get(key) == expected.get(key)
            for key in ('pid', 'birth', 'boot_id'))
    child_gone = ('native_sleep' not in before or 'observed_native_sleep' in after
        and not same_process(before['native_sleep'], after['observed_native_sleep']))
    return (verified_live_identity(before['ownership'], before['live_identity'])
        and all(after['ownership'].get(key) == before['ownership'].get(key)
            for key in ('pid', 'birth', 'boot_id', 'cgroup', 'dispatch_id'))
        and not same_process(before['ownership'], after['live_identity']) and child_gone
        and after['physical'].get('cgroup_populated') is False)


class DiscussionProbe(StopProbe):
    def post(self, path, body):
        request = urllib.request.Request(self.endpoint + path,
            data=json.dumps(body, separators=(',', ':')).encode(),
            headers={'Content-Type': 'application/json', 'Origin': self.endpoint})
        with self.browser.open(request, timeout=30) as response:
            return json.load(response)

    def execute(self, body, capture=False):
        # Persist each exact request before admission. On uncertain transport,
        # keep it and inspect the receipt; never generate another identity.
        self.save('request-' + body['request_id'], {'command': body})
        base = '/v1/owner/todos/' + ('' if capture else 'discussion/') + 'commands'
        try:
            result = self.post(base, body)
        except urllib.error.HTTPError as error:
            if error.code < 500:
                self.save('rejection-' + body['request_id'], {'http_status': error.code})
                raise
            result = self.recover(base, body)
        except (OSError, TimeoutError, ValueError):
            result = self.recover(base, body)
        self.save('receipt-' + body['request_id'], {'receipt': result})
        if not receipt_matches(result, body, capture):
            raise RuntimeError('Owner receipt identity or committed result differs')
        return result

    def recover(self, base, body):
        result = self.read(base + '/' + body['request_id'])
        if result.get('request_id') != body['request_id']:
            raise RuntimeError('Recovery receipt has another request identity')
        if result.get('status') == 'unknown':
            result = self.post(base, body)
        return result

    def status(self, todo):
        return self.read('/v1/owner/todos/' + checked_id(todo) + '/discussion')

    def messages(self, todo):
        path = '/v1/owner/todos/' + checked_id(todo) + '/discussion/messages'
        page = self.read(path)
        result, cursors, oldest = [], set(), None
        for _ in range(32):
            if page.get('todo_id') != todo or page['cursor'] in cursors:
                raise RuntimeError('History scope or cursor did not progress')
            cursors.add(page['cursor'])
            sequences = [message['sequence'] for message in page['messages']]
            if sequences != sorted(set(sequences)) or (oldest is not None and sequences and max(sequences) >= oldest):
                raise RuntimeError('History page order or earlier-page boundary regressed')
            if sequences:
                oldest = min(sequences)
            result.extend(page['messages'])
            if not page['has_more']:
                if len({m['message_id'] for m in result}) != len(result) or len({m['sequence'] for m in result}) != len(result):
                    raise RuntimeError('History repeated a message or sequence')
                return sorted(result, key=lambda message: message['sequence'])
            page = self.read(path + '?cursor=' + page['cursor'])
        raise RuntimeError('Fixture history exceeded page bound')

    def audit(self, todo, baseline=None):
        todo = checked_id(todo)
        value = self.query("SELECT jsonb_build_object('todo_id','" + todo + "',"
            "'task_count',(SELECT count(*) FROM tasks),'node_count',(SELECT count(*) FROM nodes),"
            "'attempts',(SELECT coalesce(jsonb_agg(jsonb_build_object('attempt_id',a.id,"
            "'todo_id',a.todo_id,'task_id',a.task_id,'node_id',a.node_id,'kind',a.kind,"
            "'source_message_id',a.launch->>'source_message_id','resource_id',a.launch->>'resource_id',"
            "'state',a.state,'started',a.started,'mutation_allowed',a.mutation_allowed,"
            "'process_released',a.process_released,'process_absent',a.process_absent,"
            "'starts',(SELECT count(*) FROM outbox o WHERE o.attempt_id=a.id AND o.kind='start'),"
            "'commits',(SELECT count(*) FROM command_receipts r WHERE r.attempt_id=a.id AND r.command_name='commit_discussion_turn'),"
            "'unresolved_operations',(SELECT count(*) FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN ('succeeded','cancelled')))"
            " ORDER BY a.created_at,a.id),'[]'::jsonb) FROM attempts a WHERE a.todo_id='" + todo + "'));" )
        if baseline is not None:
            value['baseline_task_count'] = baseline['task_count']
            value['baseline_node_count'] = baseline['node_count']
        return value

    def snapshot(self, attempt):
        # Existing snapshot's physical/journal evidence is Attempt-scoped; replace
        # only its legacy Task-join projection with the actual Todo Attempt row.
        state = super().snapshot(attempt)
        state['attempts'] = self.query("SELECT coalesce(jsonb_agg(jsonb_build_object("
            "'attempt_id',id,'todo_id',todo_id,'task_id',task_id,'dispatch_id',dispatch_id,"
            "'state',state,'started',started,'mutation_allowed',mutation_allowed,"
            "'process_absent',process_absent,'process_released',process_released)),'[]'::jsonb) "
            "FROM attempts WHERE id='" + checked_id(attempt) + "';")
        journal = sqlite3.connect('file:' + self.config['journal'] + '?mode=ro', uri=True)
        try:
            state['handoffs'] = []
            for request_id, digest, envelope in journal.execute('SELECT id,digest,envelope FROM requests WHERE attempt=?', (attempt,)):
                value = json.loads(envelope)
                if value['name'] == 'commit_discussion_turn':
                    state['handoffs'].append({'request_id': request_id, 'digest': digest,
                        'scope_id': value['scope_id'], 'source_message_id': value['payload']['source_message_id'],
                        'source_watermark': value['payload']['source_watermark']})
        finally:
            journal.close()
        return state

    def native_sleep(self, state):
        if not verified_live_identity(state['ownership'], state['live_identity']):
            return None
        group = state['ownership']['cgroup']
        root = pathlib.Path('/sys/fs/cgroup' + group)
        pids = set()
        for path in root.rglob('cgroup.procs'):
            try:
                pids.update(int(value) for value in path.read_text().split())
            except FileNotFoundError:
                continue
        for pid in pids:
            try:
                args = pathlib.Path('/proc', str(pid), 'cmdline').read_bytes().split(b'\0')
            except (FileNotFoundError, ProcessLookupError):
                continue
            if len(args) >= 2 and args[0].rsplit(b'/', 1)[-1] == b'sleep' and args[1] == b'45':
                identity = live_identity({'pid': pid})
                if identity.get('cgroup') == group and identity.get('uid') == self.config['execution_uid']:
                    return identity
        return None

    def observe_native(self, todo, count):
        retained = {}
        def native(status, audit):
            if len(audit['attempts']) != count or audit['attempts'][-1]['state'] != 'RUNNING':
                return False
            attempt = status.get('current_source', {}).get('attempt_id')
            if not attempt:
                return False
            state = self.snapshot(attempt)
            sleep = self.native_sleep(state)
            if not sleep:
                return False
            state['native_sleep'] = sleep
            retained['state'] = state
            return True
        status, audit = self.observe(todo, native)
        return status, audit, retained['state']

    def require(self, name, value, checks):
        value['checks'] = checks
        value['outcome'] = 'pass' if checks and all(checks.values()) else 'fail'
        self.save(name, value)
        if value['outcome'] != 'pass':
            raise RuntimeError('Discussion evidence failed: ' + name)

    def observe(self, todo, predicate, seconds=240):
        deadline = time.monotonic() + seconds
        while True:
            status = self.status(todo)
            audit = self.audit(todo)
            if predicate(status, audit):
                return status, audit
            if time.monotonic() >= deadline:
                self.save('deadline-' + todo, {'status': status, 'audit': audit})
                raise RuntimeError('Fixture observation deadline exceeded; inspect retained evidence')
            time.sleep(1)

    def submit(self, todo, suffix, content):
        source = checked_id(todo + '-' + suffix)
        result = self.execute({'schema_version': 1, 'request_id': source + '-send',
            'todo_id': todo, 'name': 'submit_discussion_message',
            'payload': {'message_id': source, 'content': content}})
        if result.get('message_id') != source:
            raise RuntimeError('Committed source identity differs')
        return source

    def control(self, todo, action, status, suffix):
        source = status['current_source']
        payload = {'source_message_id': source['message_id']}
        if action == 'stop':
            payload['attempt_id'] = source['attempt_id']
        return self.execute({'schema_version': 1, 'request_id': todo + '-' + suffix,
            'todo_id': todo, 'name': action + '_discussion_turn',
            'expected_discussion_version': status['discussion_version'], 'payload': payload})

    def ordered(self, todo):
        baseline = self.audit(todo)
        self.save('preflight-' + todo, {'catalog': self.catalog(), 'baseline': baseline})
        self.execute({'schema_version': 1, 'request_id': todo + '-capture',
            'name': 'capture_todo', 'payload': {'todo_id': todo,
                'original_capture': 'A compact personal reading list. This is an isolated Discussion acceptance idea.'}}, capture=True)
        captured = self.audit(todo, baseline)
        self.require('captured-' + todo, {'audit': captured}, {
            'pure_capture': not captured['attempts'] and not self.messages(todo),
            'no_task': captured['task_count'] == baseline['task_count']})
        first = self.submit(todo, 'first', 'Help clarify a compact personal reading list. Reply in one short sentence containing READ-LIST and commit the current requirement state. Do not propose a Task or inspect repositories.')
        second = self.submit(todo, 'second', 'Add that a reading-list entry can be marked finished. Reply in one short sentence containing FINISHED and update the requirement state. Do not propose a Task or inspect repositories.')
        queued = self.status(todo)
        self.save('queued-' + todo, {'status': queued, 'messages': self.messages(todo)})
        self.observe(todo, lambda status, audit: 'current_source' not in status
            and len(audit['attempts']) == 2 and all(row['process_released'] for row in audit['attempts']))
        status, messages, audit = self.status(todo), self.messages(todo), self.audit(todo, baseline)
        checks = reply_checks(messages, [first, second]) | completion_checks(audit, [first, second])
        checks['requirement_cache'] = bool(status.get('working_requirement_state', '').strip())
        checks['resolved_second_source'] = status['resolved_watermark'] == next(m['sequence'] for m in messages if m['message_id'] == second)
        states = {row['attempt_id']: self.snapshot(row['attempt_id']) for row in audit['attempts']}
        checks['native_cli_journal'] = all(state['journal_requests'] and all(r['digest_matches_bytes'] for r in state['journal_requests']) for state in states.values())
        checks['journaled_formal_commits'] = all(len([h for h in states[row['attempt_id']]['handoffs']
            if h['scope_id'] == todo and h['source_message_id'] == row['source_message_id']
                and h['source_watermark'] == next(m['sequence'] for m in messages if m['message_id'] == row['source_message_id'])
                and any(r['request_id'] == h['request_id'] and r['digest'] == h['digest']
                    and r['scope_id'] == todo and r['command_name'] == 'commit_discussion_turn' and r['status'] == 'committed'
                    for r in states[row['attempt_id']]['receipts'])]) == 1 for row in audit['attempts'])
        replies = [m for m in messages if m['author'] == 'assistant']
        checks['source_specific_replies'] = len(replies) == 2 and 'READ-LIST' in replies[0]['content'] and 'FINISHED' in replies[1]['content']
        checks['latest_requirement_retained'] = 'finished' in status.get('working_requirement_state', '').lower()
        self.require('ordered-' + todo, {'status': status, 'messages': messages, 'audit': audit, 'states': states}, checks)

    def interrupted(self, todo):
        baseline = self.audit(todo)
        self.save('preflight-' + todo, {'catalog': self.catalog(), 'baseline': baseline})
        self.execute({'schema_version': 1, 'request_id': todo + '-capture', 'name': 'capture_todo',
            'payload': {'todo_id': todo, 'original_capture': 'An isolated Discussion Stop and withdrawal acceptance idea.'}}, capture=True)
        first = self.submit(todo, 'held', 'For this execution test, first use the shell tool to run sleep 45, without modifying files. Only after it returns, reply briefly and commit the requirement state. Do not inspect a repository or propose a Task.')
        second = self.submit(todo, 'later', 'The current goal is a reading list with finished entries. Reply briefly and commit this requirement state; no shell delay, Task preview or repository inspection is needed for this message.')
        status, _, first_physical = self.observe_native(todo, 1)
        attempt = status['current_source']['attempt_id']
        physical = first_physical
        self.require('running-' + todo, {'status': status, 'state': physical}, {
            'first_source': status['current_source']['message_id'] == first,
            'verified_live_process': verified_live_identity(physical['ownership'], physical['live_identity']),
            'execution_account': physical['live_identity'].get('uid') == self.config['execution_uid']})
        self.control(todo, 'stop', status, 'stop')
        status, audit = self.observe(todo, lambda status, audit: status.get('current_source', {}).get('status') == 'interrupted'
            and all(row['process_released'] for row in audit['attempts']))
        before = self.messages(todo)
        stopped = self.snapshot(attempt)
        stopped['observed_native_sleep'] = live_identity(first_physical['native_sleep'])
        self.require('stopped-' + todo, {'status': status, 'audit': audit, 'messages': before, 'state': stopped}, {
            'same_unresolved_source': status['current_source']['message_id'] == first,
            'later_source_retained': [m['message_id'] for m in before] == [first, second],
            'no_reply_or_replacement': len(audit['attempts']) == 1 and audit['attempts'][0]['commits'] == 0,
            'old_writer_released': audit['attempts'][0]['process_released'] and audit['attempts'][0]['process_absent'],
            'host_absence_proved': physically_released(first_physical, stopped)})
        self.control(todo, 'retry', status, 'retry')
        status, audit, retry_physical = self.observe_native(todo, 2)
        retry = status['current_source']['attempt_id']
        physical = retry_physical
        self.require('retried-' + todo, {'status': status, 'audit': audit, 'state': physical}, {
            'same_source_new_attempt': status['current_source']['message_id'] == first and retry != attempt,
            'old_writer_remains_released': audit['attempts'][0]['process_released'] and audit['attempts'][0]['process_absent'],
            'live_retry_process': verified_live_identity(physical['ownership'], physical['live_identity']),
            'no_duplicate_input': [m['message_id'] for m in self.messages(todo)] == [first, second]})
        self.control(todo, 'stop', status, 'stop-retry')
        status, _ = self.observe(todo, lambda status, audit: status.get('current_source', {}).get('status') == 'interrupted'
            and all(row['process_released'] for row in audit['attempts']))
        stopped = self.snapshot(retry)
        stopped['observed_native_sleep'] = live_identity(retry_physical['native_sleep'])
        self.require('retry-stopped-' + todo, {'state': stopped}, {'host_absence_proved': physically_released(retry_physical, stopped)})
        self.control(todo, 'withdraw', status, 'withdraw')
        self.observe(todo, lambda status, audit: 'current_source' not in status
            and len(audit['attempts']) == 3 and all(row['process_released'] for row in audit['attempts']))
        messages, audit = self.messages(todo), self.audit(todo, baseline)
        replies = [m for m in messages if m['author'] == 'assistant']
        self.require('withdrawn-' + todo, {'status': self.status(todo), 'messages': messages, 'audit': audit}, {
            'withdrawal_retained': next(m for m in messages if m['message_id'] == first).get('disposition') == 'withdrawn',
            'only_later_reply': len(replies) == 1 and replies[0].get('source_message_id') == second,
            'second_success': audit['attempts'][2]['state'] == 'SUCCEEDED' and audit['attempts'][2]['commits'] == 1,
            'correct_sources': [row['source_message_id'] for row in audit['attempts']] == [first, first, second],
            'no_task_or_node_created': audit['task_count'] == baseline['task_count'] and audit['node_count'] == baseline['node_count'],
            'only_todo_scope': all(row['todo_id'] == todo and row['task_id'] is None and row['node_id'] is None and row['resource_id'] is None for row in audit['attempts']),
            'all_reconciled': all(row['process_released'] and row['process_absent'] and not row['mutation_allowed'] and row['unresolved_operations'] == 0 for row in audit['attempts'])})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default='/root/monos-boundary-probe-src')
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--password-file', required=True)
    parser.add_argument('action', choices=('ordered', 'interrupted'))
    parser.add_argument('todo_id')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Run only as root on the authorized test host')
    todo = checked_id(args.todo_id)
    if len(todo) > 48:
        raise ValueError('Reserve suffix space for immutable fixture identities')
    probe = DiscussionProbe(args.source, args.evidence)
    probe.login(args.password_file)
    getattr(probe, args.action)(todo)


if __name__ == '__main__':
    main()
