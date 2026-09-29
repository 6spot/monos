#!/usr/bin/env python3
"""Single-use idle restart acceptance for the completed native Todo trials.

No model/Owner command is submitted. Only the existing Compose server and Runner
are restarted, once each, after durable evidence and repeated read-only guards.
An interrupted run requires inspection; a new directory is not retry authority.
"""
import argparse
import base64
import binascii
from datetime import datetime
import hashlib
import json
import os
import pathlib
import re
import sys
import time

from probe import boot_id, checked_id, live_identity
from task_preview_probe import TaskPreviewProbe, canonical_bytes, creation_checks, native_checks, provenance_checks


PREVIEW = 'task-preview-20260930-a'
ORDERED = 'discussion-ordered-20260930-a'
INTERRUPTED = 'discussion-interrupted-20260930-a'
TODOS = (PREVIEW, ORDERED, INTERRUPTED)
TASK = '0c24174a-6910-4810-b4b6-14f68d202f0b'
PREVIEW_DIR = pathlib.Path('/root/monos-task-preview-evidence-v1')
DISCUSSION_DIR = pathlib.Path('/root/monos-todo-discussion-evidence-v1')
ARCHIVE_SHA = 'a0913337e59aa109940bd2486c1e5b0264d27aba44af54d53c4ac6af39b1a014'
NATIVE_FIELDS = ('attempts', 'receipts', 'operations', 'events', 'journal_requests', 'ownership', 'handoffs')
MAX_JSON = 32 * 1024 * 1024
FAILED_HARNESS_SHA = 'a2e1184c053672e5c239b1d40dc9ac11aec784a6a69d69c9d779b3f5d913b034'


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def read_json(path):
    path = pathlib.Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_JSON:
        raise RuntimeError('Evidence must be a bounded regular file')
    with path.open('rb') as stream:
        data = stream.read(MAX_JSON + 1)
    if len(data) > MAX_JSON:
        raise RuntimeError('Evidence exceeds size bound')
    return json.loads(data)


def passed(value):
    checks = value.get('checks')
    return value.get('outcome') == 'pass' and (checks is None or (
        isinstance(checks, dict) and bool(checks) and all(v is True for v in checks.values())))


def ordered_rows(rows):
    return sorted(rows, key=canonical_bytes)


def native_semantics(value):
    return {key: ordered_rows(value[key]) if isinstance(value[key], list) else value[key]
            for key in NATIVE_FIELDS}


def historical_events(before, after):
    """Prior probes may finish before the final async log drain.

    Compare event identity and all retained summary fields, independent of SQL
    aggregate order. Only contiguous output/exit appends per stream are allowed;
    starts, attention and failure facts require separate inspection.
    """
    def keyed(rows):
        result = {}
        for row in rows:
            if (not isinstance(row.get('stream_id'), str) or not row['stream_id']
                    or type(row.get('sequence')) is not int or row['sequence'] < 1):
                return None
            key = (row['stream_id'], row['sequence'])
            if key in result:
                return None
            result[key] = row
        return result
    old, new = keyed(before), keyed(after)
    if old is None or new is None or any(new.get(key) != row for key, row in old.items()):
        return {'retained_prefix': False, 'appended': []}
    appended = [row for key, row in new.items() if key not in old]
    valid = all(row.get('kind') in ('output', 'exited') for row in appended)
    for stream in {row['stream_id'] for row in appended}:
        last = max((sequence for name, sequence in old if name == stream), default=0)
        sequences = sorted(row['sequence'] for row in appended if row['stream_id'] == stream)
        valid = valid and sequences == list(range(last + 1, last + 1 + len(sequences)))
    return {'retained_prefix': valid, 'appended': ordered_rows(appended)}


def semantic_progress(before, after):
    """Keep semantic records exact; account only for delayed settled-runtime logs.

    Raw event/Attempt rows share one SQL snapshot. Native summaries are read
    earlier, so they may be a retained prefix of those raw rows, never vice versa.
    """
    result = {'valid': False, 'runtime_appends': [], 'projection_changes': {}}
    if before == after:
        return {**result, 'valid': True}
    try:
        if (set(before) != set(after) or any(before[key] != after[key]
                for key in before if key not in ('records', 'native'))):
            return result
        old, new = before['records'], after['records']
        if (set(old) != set(new) or any(old[key] != new[key]
                for key in old if key not in ('attempts', 'runtime_events'))
                or set(before['native']) != set(after['native'])):
            return result
        old_attempts = {row['id']: row for row in old['attempts']}
        new_attempts = {row['id']: row for row in new['attempts']}
        if (len(old_attempts) != len(old['attempts']) or len(new_attempts) != len(new['attempts'])
                or set(old_attempts) != set(new_attempts)):
            return result
        event_key = lambda row: (row['attempt_id'], row['stream_id'], row['sequence'])
        old_events = {event_key(row): row for row in old['runtime_events']}
        new_events = {event_key(row): row for row in new['runtime_events']}
        if (len(old_events) != len(old['runtime_events']) or len(new_events) != len(new['runtime_events'])
                or any(new_events.get(key) != row for key, row in old_events.items())):
            return result
        appended = [row for key, row in new_events.items() if key not in old_events]
        for attempt_id, prior in old_attempts.items():
            current = new_attempts[attempt_id]
            projections = ('exit_observed', 'log_visible_sequence', 'activity_at')
            if (set(prior) != set(current) or any(prior[key] != current[key]
                    for key in prior if key not in projections)):
                return result
            added = [row for row in appended if row['attempt_id'] == attempt_id]
            if not added:
                if any(prior[key] != current[key] for key in projections):
                    return result
            else:
                if (prior['process_released'] is not True or prior['process_absent'] is not True
                        or prior['mutation_allowed'] is not False):
                    return result
                owner = after['native'][attempt_id]['ownership']
                for row in added:
                    body = row['body']
                    allowed = {'attempt_id', 'dispatch_id', 'stream_id', 'sequence', 'kind', 'text',
                               'order_sequence', 'boot_id', 'exit_code', 'data_base64'}
                    if (set(row) != {'attempt_id', 'stream_id', 'sequence', 'digest', 'body'}
                            or set(body) - allowed or event_key(body) != event_key(row)
                            or body['dispatch_id'] != prior['dispatch_id']
                            or body['dispatch_id'] != owner['dispatch_id'] or body['boot_id'] != owner['boot_id']
                            or body['kind'] not in ('output', 'exited')
                            or not isinstance(body['text'], str) or len(body['text']) > 65536
                            or any(type(body[key]) is not int or not 1 <= body[key] <= 9007199254740991
                                   for key in ('sequence', 'order_sequence'))
                            or row['digest'] != hashlib.sha256(canonical_bytes(body)).hexdigest()):
                        return result
                    if body['kind'] == 'output':
                        encoded = body['data_base64']
                        if (body['stream_id'] not in ('stdout', 'stderr') or 'exit_code' in body
                                or not isinstance(encoded, str) or len(encoded) > 65536
                                or base64.b64encode(base64.b64decode(encoded, validate=True)).decode() != encoded):
                            return result
                    elif (body['stream_id'] != 'runtime' or 'data_base64' in body
                            or body['text'] != 'runtime main process exited; formal completion is independent'
                            or ('exit_code' in body and (type(body['exit_code']) is not int or not 0 <= body['exit_code'] <= 255))):
                        return result
                earlier = [row for row in old_events.values() if row['attempt_id'] == attempt_id]
                later = [row for row in new_events.values() if row['attempt_id'] == attempt_id]
                for stream in {row['stream_id'] for row in added}:
                    last = max((row['sequence'] for row in earlier if row['stream_id'] == stream), default=0)
                    sequences = sorted(row['sequence'] for row in added if row['stream_id'] == stream)
                    if sequences != list(range(last + 1, last + 1 + len(sequences))):
                        return result
                old_orders = sorted(row['body']['order_sequence'] for row in earlier)
                new_orders = sorted(row['body']['order_sequence'] for row in later)
                if (any(type(row[key]) is not int for row in (prior, current) for key in ('log_visible_sequence',))
                        or any(type(row['exit_observed']) is not bool for row in (prior, current))
                        or old_orders != list(range(1, len(old_orders) + 1))
                        or new_orders != list(range(1, len(new_orders) + 1))
                        or sorted(row['body']['order_sequence'] for row in added)
                        != list(range(len(old_orders) + 1, len(new_orders) + 1))
                        or prior['log_visible_sequence'] != len(old_orders)
                        or current['log_visible_sequence'] != len(new_orders)
                        or current['exit_observed'] is not (prior['exit_observed'] or any(row['body']['kind'] == 'exited' for row in added))):
                    return result
                old_time = datetime.fromisoformat(prior['activity_at']) if prior['activity_at'] else None
                new_time = datetime.fromisoformat(current['activity_at'])
                if new_time.tzinfo is None or (old_time is not None and new_time < old_time):
                    return result
                result['projection_changes'][attempt_id] = {key: {'before': prior[key], 'after': current[key]}
                    for key in projections if prior[key] != current[key]}
        if any(row['attempt_id'] not in old_attempts for row in appended):
            return result
        for attempt_id, old_native in before['native'].items():
            new_native = after['native'][attempt_id]
            if (set(old_native) != set(new_native) or any(old_native[key] != new_native[key]
                    for key in old_native if key != 'events')
                    or not historical_events(old_native['events'], new_native['events'])['retained_prefix']):
                return result
            # Every sampled summary must be present in the later same-collection
            # raw snapshot, with only permitted log/exit drainage in between.
            for semantic, sampled in ((before, old_native), (after, new_native)):
                summaries = [{'stream_id': row['stream_id'], 'sequence': row['sequence'],
                    'kind': row['body']['kind'], 'text_length': len(row['body']['text'])}
                    for row in semantic['records']['runtime_events'] if row['attempt_id'] == attempt_id]
                if not historical_events(sampled['events'], summaries)['retained_prefix']:
                    return result
        return {**result, 'valid': True, 'runtime_appends': ordered_rows(appended)}
    except (KeyError, TypeError, ValueError, OverflowError, binascii.Error):
        return result


def identity_retained(identity):
    return (type(identity.get('pid')) is int and identity['pid'] > 0
        and isinstance(identity.get('birth'), str) and identity['birth'].isdigit()
        and isinstance(identity.get('boot_id'), str) and bool(identity['boot_id'])
        and re.fullmatch(r'/system.slice/monos-probe-[A-Za-z0-9_-]+\.service', identity.get('cgroup', '')) is not None)


def process_absent(expected, observed):
    if not identity_retained(expected):
        return False
    return observed.get('present') is False or (observed.get('present') is True
        and type(observed.get('pid')) is int and observed['pid'] > 0
        and isinstance(observed.get('birth'), str) and observed['birth'].isdigit()
        and isinstance(observed.get('boot_id'), str) and bool(observed['boot_id'])
        and any(observed[key] != expected[key] for key in ('pid', 'birth', 'boot_id')))


def native_absent(value):
    rows, owner = value['attempts'], value['ownership']
    return (len(rows) == 1 and rows[0]['process_released'] is True
        and rows[0]['process_absent'] is True and rows[0]['mutation_allowed'] is False
        and rows[0]['dispatch_id'] == owner.get('dispatch_id')
        and process_absent(owner, value['live_identity'])
        and value['physical'].get('cgroup_populated') is False
        and all(row.get('alive') is False for row in value['physical'].get('descendants', [])))


def verify_manifest(source, manifest):
    files = manifest.get('files')
    if (manifest.get('source_tar_sha256') != ARCHIVE_SHA or not isinstance(files, dict)
            or len(files) != 205):
        raise RuntimeError('Final product manifest identity differs')
    source = pathlib.Path(source).resolve()
    for name, expected in files.items():
        relative = pathlib.PurePosixPath(name)
        if (relative.is_absolute() or '..' in relative.parts or str(relative) != name
                or not re.fullmatch('[a-f0-9]{64}', expected)):
            raise RuntimeError('Invalid product manifest entry')
        path = source / name
        if not path.resolve().is_relative_to(source) or path.is_symlink() or not path.is_file():
            raise RuntimeError('Product manifest path escaped or disappeared')
        if digest(path) != expected:
            raise RuntimeError('Final product source changed')
    return {'source_files_verified': len(files), 'source_tar_sha256': ARCHIVE_SHA,
            'manifest_digest': hashlib.sha256(canonical_bytes(manifest)).hexdigest()}


def ready(state, runner_id):
    row = state.get('runner') or {}
    online = [r for r in state['infrastructure']['runners'] if r['runner_id'] == runner_id]
    backend, runner = state['backend'], state['service']
    return (state['health'].get('database') == 'ready'
        and state['session'].get('authenticated') is True
        and row.get('connected') is True and row.get('ready') is True and row.get('fresh') is True
        and type(row.get('incarnation')) is int and row['incarnation'] > 0
        and row.get('runtime_report_incarnation') == row['incarnation']
        and isinstance(row.get('connection_instance'), str) and bool(row['connection_instance'])
        and len(online) == 1 and online[0]['online'] is True
        and backend.get('running') is True and type(backend.get('pid')) is int and backend['pid'] > 0
        and bool(backend.get('started')) and bool(backend.get('id')) and bool(backend.get('image'))
        and runner.get('ActiveState') == 'active' and runner.get('SubState') == 'running'
        and runner.get('MainPID', '').isdigit() and int(runner['MainPID']) > 0
        and runner.get('ExecMainStartTimestampMonotonic', '').isdigit()
        and int(runner['ExecMainStartTimestampMonotonic']) > 0 and bool(runner.get('InvocationID')))


def restart_checks(before, after, target):
    old, new = before['runtime'], after['runtime']
    backend_old, backend_new = old['backend'], new['backend']
    service_old, service_new = old['service'], new['service']
    checks = {
        'same_boot': old['boot_id'] == new['boot_id'],
        'same_container_image': all(backend_old[k] == backend_new[k] for k in ('id', 'image')),
        'same_compose_images': old['images'] == new['images'],
        'new_runner_incarnation': new['runner']['incarnation'] > old['runner']['incarnation'],
        'semantic_state_unchanged': semantic_progress(before['semantic'], after['semantic'])['valid'],
        'source_unchanged': before['source'] == after['source'],
        'runner_binaries_unchanged': before['binaries'] == after['binaries'],
    }
    if target == 'backend':
        checks.update(backend_restarted=backend_old['started'] != backend_new['started'],
            new_backend_connection=old['runner']['connection_instance'] != new['runner']['connection_instance'],
            runner_process_unchanged=service_old == service_new)
    else:
        checks.update(backend_process_unchanged=backend_old == backend_new,
            same_backend_connection=old['runner']['connection_instance'] == new['runner']['connection_instance'],
            runner_process_restarted=service_old['InvocationID'] != service_new['InvocationID']
                and service_old['ExecMainStartTimestampMonotonic'] != service_new['ExecMainStartTimestampMonotonic'])
    return checks


class CaptureDiscussionAcceptance(TaskPreviewProbe):
    def claim(self):
        # Directory must be fresh. Exclusive claim also serializes concurrent
        # invocations that both observed an empty directory. Never erase a claim.
        if any(self.evidence.iterdir()):
            raise RuntimeError('Existing acceptance evidence requires inspection')
        self.save('claim', {'started_at': time.time(), 'pid': os.getpid(),
            'harness_sha256': digest(pathlib.Path(__file__)), 'outcome': 'claimed'})

    def load_prior(self, index_path):
        index = read_json(index_path)
        cases = index['cases']
        if not 10 <= len(cases) <= 64:
            raise RuntimeError('Prior evidence index is incomplete or oversized')
        reports = {}
        for name, record in cases.items():
            path = pathlib.Path(name)
            if (path.parent not in (PREVIEW_DIR, DISCUSSION_DIR,
                    pathlib.Path('/root/monos-todo-capture-evidence-v1'),
                    pathlib.Path('/root/monos-integration-evidence-v1'))
                    or not passed(record) or digest(path) != record['sha256']):
                raise RuntimeError('Prior success evidence identity differs')
            report = read_json(path)
            if not passed(report):
                raise RuntimeError('Prior report did not pass completely')
            reports[path.name] = report
        required = {'capture-deployment.json', 'captured-' + ORDERED + '.json',
            'ordered-' + ORDERED + '.json', 'stopped-' + INTERRUPTED + '.json',
            'retried-' + INTERRUPTED + '.json', 'retry-stopped-' + INTERRUPTED + '.json',
            'withdrawn-' + INTERRUPTED + '.json', 'discussion-complete.json',
            'preview-installation-audit.json', 'queue-final-integration-queue-20260929-01.json'}
        required.update('preview-' + stage + '-' + PREVIEW + '.json'
                        for stage in ('proposed', 'read', 'confirmed', 'created', 'complete'))
        if not required.issubset(reports):
            raise RuntimeError('Required prior acceptance case missing')
        self.created = reports['preview-created-' + PREVIEW + '.json']
        self.complete = reports['preview-complete-' + PREVIEW + '.json']
        self.installation = reports['preview-installation-audit.json']
        self.prior_trials = {
            PREVIEW: reports['preview-proposed-' + PREVIEW + '.json'],
            ORDERED: reports['ordered-' + ORDERED + '.json'],
            INTERRUPTED: reports['withdrawn-' + INTERRUPTED + '.json'],
        }
        self.attempts = sorted(checked_id(row['attempt_id']) for trial in self.prior_trials.values()
                               for row in trial['audit']['attempts'])
        if len(self.attempts) != 6 or len(set(self.attempts)) != 6 or self.complete['task']['task_id'] != TASK:
            raise RuntimeError('Prior native trial identities differ')
        self.prior_native = dict(self.prior_trials[ORDERED]['states'])
        for value in (self.prior_trials[PREVIEW]['native'], reports['stopped-' + INTERRUPTED + '.json']['state'],
                      reports['retry-stopped-' + INTERRUPTED + '.json']['state']):
            self.prior_native[value['attempts'][0]['attempt_id']] = value
        self.manifest = read_json(PREVIEW_DIR / 'monos-preview-manifest.json')
        self.children = []
        bindings = {str(index_path): digest(pathlib.Path(index_path))}
        for name in ('running-' + INTERRUPTED, 'retried-' + INTERRUPTED):
            path = DISCUSSION_DIR / (name + '.json')
            report = read_json(path)
            state = report['state']
            child = state['native_sleep']
            if (not passed(report) or not identity_retained(child)
                    or child['cgroup'] != state['ownership']['cgroup']
                    or state['attempts'][0]['attempt_id'] not in self.attempts):
                raise RuntimeError('Native child provenance missing')
            self.children.append(child)
            bindings[str(path)] = digest(path)
        binary_path = DISCUSSION_DIR / 'runner-updated.json'
        self.binary_report = read_json(binary_path)
        if not passed(self.binary_report) or set(self.binary_report['hashes']) != {
                'monos', 'monos-runner', 'monos-probe-exec', 'monos-probe-launch'}:
            raise RuntimeError('Installed Runner provenance missing')
        bindings[str(binary_path)] = digest(binary_path)
        self.owner_commands = self.load_commands()
        bindings.update({str(PREVIEW_DIR / 'monos-preview-manifest.json'):
                         digest(PREVIEW_DIR / 'monos-preview-manifest.json')})
        self.save('prior-evidence', {'index': index, 'additional_sha256': bindings,
            'manifest': self.manifest, 'attempts': self.attempts,
            'owner_commands': self.owner_commands, 'runner_binaries': self.binary_report})

    def load_commands(self):
        result = {}
        for directory in (PREVIEW_DIR, DISCUSSION_DIR):
            paths = sorted(directory.glob('request-*.json'))
            if len(paths) > 128:
                raise RuntimeError('Prior request collection exceeds bound')
            for path in paths:
                command = read_json(path)['command']
                request_id = checked_id(command['request_id'])
                if not any(request_id.startswith(todo + '-') for todo in TODOS):
                    continue
                name = command['name']
                if name == 'save_project':
                    family = 'configuration'
                elif name in ('capture_todo', 'assign_todo_project', 'set_todo_archived'):
                    family = 'todos'
                elif name in ('confirm_task_preview', 'create_execution_task', 'cancel_task_preview'):
                    family = 'task-previews'
                elif name in ('submit_discussion_message', 'stop_discussion_turn', 'retry_discussion_turn', 'withdraw_discussion_turn'):
                    family = 'todos/discussion'
                else:
                    raise RuntimeError('Unexpected prior Owner command family')
                receipt_path = directory / ('receipt-' + request_id + '.json')
                receipt = read_json(receipt_path)['receipt']
                if receipt.get('request_id') != request_id or receipt.get('status') != 'committed' or request_id in result:
                    raise RuntimeError('Prior Owner receipt incomplete or duplicated')
                result[request_id] = {'command': command, 'receipt': receipt,
                    'path': '/v1/owner/' + family + '/commands/' + request_id,
                    'request_sha256': digest(path), 'receipt_sha256': digest(receipt_path)}
        if len(result) < 20:
            raise RuntimeError('Prior Owner receipt collection incomplete')
        return result

    def runtime(self):
        container = self.call(self.compose + ['ps', '-q', 'server']).strip()
        if not re.fullmatch('[a-f0-9]{12,64}', container):
            raise RuntimeError('Expected one existing backend container')
        template = ('{"id":{{json .Id}},"image":{{json .Image}},"started":{{json .State.StartedAt}},'
                    '"pid":{{.State.Pid}},"running":{{.State.Running}},"restart_count":{{.RestartCount}}}')
        backend = json.loads(self.call(['docker', 'inspect', '--format', template, container]))
        properties = ('MainPID', 'ExecMainStartTimestampMonotonic', 'InvocationID', 'ActiveState', 'SubState')
        service = dict(line.split('=', 1) for line in self.call(['systemctl', 'show',
            'monos-probe-runner.service', '--property=' + ','.join(properties)]).strip().splitlines())
        row = self.query("SELECT jsonb_build_object('incarnation',incarnation,'connected',connected,"
            "'ready',ready,'connection_instance',connection_instance,'last_seen',last_seen,"
            "'runtime_report_incarnation',runtime_report_incarnation,"
            "'fresh',last_seen>clock_timestamp()-interval '15 seconds') FROM runners WHERE id='" + self.runner + "';")
        return {'backend': backend, 'service': service, 'runner': row, 'boot_id': boot_id(),
            'images': ordered_rows(json.loads(self.call(self.compose + ['images', '--format', 'json']))),
            'health': self.read('/health'), 'session': self.read('/v1/owner/session'),
            'infrastructure': self.read('/v1/owner/infrastructure')}

    def global_state(self):
        counts = [('queued', "SELECT count(*) FROM attempts WHERE state='QUEUED'"),
            ('unreleased', 'SELECT count(*) FROM attempts WHERE NOT process_released'),
            ('writable', 'SELECT count(*) FROM attempts WHERE mutation_allowed'),
            ('writable', 'SELECT count(*) FROM attempts WHERE mutation_allowed'),
            ('unsettled', "SELECT count(*) FROM operations WHERE state<>'succeeded'"),
            ('pending_discussion', 'SELECT count(*) FROM todo_discussion_outbox WHERE NOT done'),
            ('unresolved_sources', 'SELECT count(*) FROM todo_discussion_controls WHERE source_message_id IS NOT NULL'),
            ('pending_outbox', 'SELECT count(*) FROM outbox WHERE NOT done')]
        totals = [(name, 'SELECT count(*) FROM ' + table) for name, table in (
            ('tasks', 'tasks'), ('specifications', 'specification_revisions'), ('plans', 'plan_revisions'),
            ('nodes', 'nodes'), ('attempts', 'attempts'), ('operations', 'operations'),
            ('receipts', 'command_receipts'), ('owner_receipts', 'owner_command_receipts'))]
        totals.append(('starts', "SELECT count(*) FROM outbox WHERE kind='start'"))
        def sql_pairs(pairs):
            return ','.join("'" + name + "',(" + query + ')' for name, query in pairs)
        return self.query("SELECT jsonb_build_object('idle',jsonb_build_object(" + sql_pairs(counts)
            + "),'counts',jsonb_build_object(" + sql_pairs(totals) + '));')

    def records(self):
        # One statement keeps all exact retained records on the same DB snapshot.
        todo_ids = ','.join("'" + checked_id(todo) + "'" for todo in TODOS)
        attempts = ','.join("'" + checked_id(attempt) + "'" for attempt in self.attempts)
        requests = ','.join("'" + checked_id(request) + "'" for request in self.owner_commands)
        scoped = [(table, 'todo_id IN (' + todo_ids + ')') for table in (
            'todo_discussion_controls', 'todo_discussion_messages', 'todo_discussion_resolutions',
            'todo_requirement_cache', 'todo_discussion_outbox')]
        scoped += [(table, 'attempt_id IN (' + attempts + ')') for table in (
            'command_receipts', 'operations', 'runtime_events', 'outbox')]
        scoped += [(table, 'request_id IN (' + requests + ')') for table in (
            'configuration_receipts', 'todo_command_receipts', 'discussion_command_receipts', 'task_preview_command_receipts')]
        scoped += [('attempts', 'id IN (' + attempts + ')'), ('todos', 'id IN (' + todo_ids + ')'),
            ('task_creation_confirmations', "todo_id='" + PREVIEW + "'"),
            ('task_preview_resolutions', "todo_id='" + PREVIEW + "'"),
            ('tasks', "id='" + TASK + "'"), ('specification_revisions', "task_id='" + TASK + "'"),
            ('task_events', "task_id='" + TASK + "'"), ('projects', "id='" + PREVIEW + "-project'")]
        return self.query('SELECT jsonb_build_object(' + ','.join("'" + table
            + "',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) FROM "
            + table + ' r WHERE ' + where + ')' for table, where in scoped) + ');')

    def collect(self):
        source = verify_manifest(self.source, self.manifest)
        binaries = {name: digest(pathlib.Path('/usr/local/bin' if name == 'monos'
                    else '/usr/local/libexec') / name) for name in self.binary_report['hashes']}
        trials = {todo: {'todo': self.read('/v1/owner/todos/' + todo),
            'status': self.status(todo), 'messages': self.messages(todo), 'audit': self.audit(todo)} for todo in TODOS}
        proposal = checked_id(self.created['preview']['proposal_message_id'])
        path = '/v1/owner/todos/' + PREVIEW + '/task-previews/' + proposal
        states = {attempt: self.snapshot(attempt) for attempt in self.attempts}
        semantic = {'trials': trials, 'preview': self.read(path),
            'wrong_selector_preview': self.read(path + '?project_id=unavailable-selection'),
            'task': self.read('/v1/owner/tasks/' + TASK), 'footprint': self.footprint(PREVIEW, TASK),
            'owner_receipts': {request: self.read(row['path']) for request, row in self.owner_commands.items()},
            'records': self.records(), 'native': {attempt: native_semantics(value) for attempt, value in states.items()}}
        global_state = self.global_state()
        semantic['global_counts'] = global_state['counts']
        return {'source': source, 'binaries': binaries, 'semantic': semantic, 'native_observations': states,
            'historical_event_appends': {attempt: historical_events(prior['events'], states[attempt]['events'])
                for attempt, prior in self.prior_native.items()},
            'children': [{'expected': child, 'observed': live_identity(child)} for child in self.children],
            'idle': global_state['idle'], 'runtime': self.runtime()}

    def guard(self, state):
        semantic = state['semantic']
        checks = {'globally_idle': bool(state['idle']) and all(type(v) is int and v == 0 for v in state['idle'].values()),
            'current_ready_connection': ready(state['runtime'], self.runner),
            'installed_images': state['runtime']['images'] == ordered_rows(self.installation['images']),
            'final_source': state['source']['source_files_verified'] == self.installation['source_files_verified'] == 205
                and state['source']['source_tar_sha256'] == self.installation['source_tar_sha256'] == ARCHIVE_SHA,
            'installed_runner': state['binaries'] == self.binary_report['hashes'],
            'archived_source': semantic['trials'][PREVIEW]['todo'].get('archived') is True,
            'exact_final_task': semantic['task'] == self.complete['task'],
            'created_preview_retained': semantic['preview'] == semantic['wrong_selector_preview'] == self.complete['restored'],
            'exact_owner_receipts': semantic['owner_receipts'] == {
                request: row['receipt'] for request, row in self.owner_commands.items()},
            'native_absence': set(state['native_observations']) == set(self.attempts)
                and all(native_absent(value) for value in state['native_observations'].values()),
            'native_children_absent': len(state['children']) == 2
                and all(process_absent(row['expected'], row['observed']) for row in state['children']),
        }
        checks.update(creation_checks(self.created['preview'], self.created['confirmations'],
            self.created['creations'], semantic['task'], semantic['footprint']))
        records = semantic['records']
        checks['archived_created_project'] = (len(records['projects']) == 1
            and records['projects'][0]['id'] == self.created['preview']['selected_project_id']
            and records['projects'][0]['archived'] is True)
        for attempt, prior in self.prior_native.items():
            current = state['native_observations'][attempt]
            checks['native_provenance_' + attempt] = all(
                ordered_rows(current[key]) == ordered_rows(prior[key]) if isinstance(prior[key], list)
                else current[key] == prior[key] for key in NATIVE_FIELDS if key not in ('handoffs', 'events'))
            checks['historical_events_' + attempt] = historical_events(prior['events'], current['events'])['retained_prefix']
        original_ids = [row['request_id'] for row in self.created['confirmations'] + self.created['creations']]
        original_records = {'confirmations': records['task_creation_confirmations'],
            'resolutions': records['task_preview_resolutions'],
            'task': records['tasks'][0] if len(records['tasks']) == 1 else None,
            'revision': records['specification_revisions'][0] if len(records['specification_revisions']) == 1 else None,
            'receipts': [row for row in records['task_preview_command_receipts'] if row['request_id'] in original_ids]}
        checks.update(provenance_checks(self.created['preview'], self.created['confirmations'],
            self.created['creations'], original_records, [self.owner_commands[key]['command'] for key in original_ids]))
        for todo, prior in self.prior_trials.items():
            current = semantic['trials'][todo]
            checks['history_' + todo] = current['messages'] == prior['messages']
            checks['attempts_' + todo] = current['audit']['attempts'] == prior['audit']['attempts']
            if todo != PREVIEW:
                checks['status_' + todo] = current['status'] == prior['status']
            # The later interrupted-trial success has historical messages/audit,
            # but no old native snapshot. Bind every successful source to those
            # messages through the current exact journal bytes and formal receipt.
            successes = [row for row in prior['audit']['attempts'] if row['state'] == 'SUCCEEDED']
            replies = [row for row in prior['messages'] if row['author'] == 'assistant']
            checks['successful_source_count_' + todo] = len(successes) == len(replies) == (2 if todo == ORDERED else 1)
            for row in successes:
                matches = [reply for reply in replies if reply.get('source_message_id') == row['source_message_id']]
                native = state['native_observations'][row['attempt_id']]
                checks['successful_native_handoff_' + row['attempt_id']] = (len(matches) == 1
                    and len(native['attempts']) == 1 and native['attempts'][0]['attempt_id'] == row['attempt_id']
                    and all(native_checks(native, todo, row['source_message_id'],
                        matches[0]['source_watermark'], matches[0]).values()))
        return checks

    def checkpoint(self, name, state, checks):
        checks = {**self.guard(state), **checks}
        self.save(name, {'state': state, 'checks': checks,
            'outcome': 'pass' if checks and all(v is True for v in checks.values()) else 'fail'})
        if not checks or any(v is not True for v in checks.values()):
            raise RuntimeError('Acceptance checkpoint failed: ' + name)

    def await_restart(self, before, target, seconds=90):
        deadline = time.monotonic() + seconds
        last_error = None
        runtime = None
        while time.monotonic() < deadline:
            try:
                runtime = self.runtime()
                after = {**before, 'runtime': runtime}
                checks = restart_checks(before, after, target)
                if ready(runtime, self.runner) and all(checks.values()):
                    return
                last_error = 'readiness_or_identity'
            except (OSError, ValueError, RuntimeError) as error:
                last_error = type(error).__name__
            time.sleep(1)
        self.save('readiness-failed-' + target, {'runtime': runtime, 'error_type': last_error, 'outcome': 'fail'})
        raise RuntimeError('Restart readiness deadline: ' + str(last_error))

    def resume_backend(self, directory):
        previous = pathlib.Path(directory)
        if (previous.is_symlink() or not previous.is_dir()
                or previous.resolve() == self.evidence.resolve()):
            raise RuntimeError('Resume requires a separate retained failed directory')
        expected_files = {'claim', 'prior-evidence', 'before', 'before-backend',
                          'restart-backend-intent', 'after-backend', 'failure'}
        if {path.name for path in previous.iterdir()} != {name + '.json' for name in expected_files}:
            raise RuntimeError('Failed run already resumed or has an uncertain additional stage')
        reports = {name: read_json(previous / (name + '.json')) for name in expected_files}
        hashes = {name: digest(previous / (name + '.json')) for name in expected_files}
        before, after = reports['before-backend'], reports['after-backend']
        intent, failure = reports['restart-backend-intent'], reports['failure']
        fresh_prior = read_json(self.evidence / 'prior-evidence.json')
        if (reports['claim'].get('harness_sha256') != FAILED_HARNESS_SHA
                or not passed(reports['before']) or not passed(before)
                or after.get('outcome') != 'fail'
                or {key for key, value in after['checks'].items() if value is not True} != {'semantic_state_unchanged'}
                or after['checks'].get('semantic_state_unchanged') is not False
                or failure.get('stage') != 'after-backend' or failure.get('outcome') != 'fail'
                or failure.get('requires_inspection') is not True
                or intent.get('target') != 'backend' or intent.get('outcome') != 'intent'
                or intent.get('before_checkpoint') != 'before-backend'
                or intent.get('before_sha256') != hashes['before-backend']
                or intent.get('semantic_sha256') != hashlib.sha256(canonical_bytes(before['state']['semantic'])).hexdigest()
                or any(reports['prior-evidence'][key] != fresh_prior[key]
                       for key in ('index', 'manifest', 'attempts', 'owner_commands', 'runner_binaries'))):
            raise RuntimeError('Retained backend failure or intent identity differs')
        for name in ('before', 'before-backend', 'after-backend'):
            if not all(self.guard(reports[name]['state']).values()):
                raise RuntimeError('Retained guard no longer verifies')
        if (not semantic_progress(reports['before']['state']['semantic'], before['state']['semantic'])['valid']
                or not all(restart_checks(before['state'], after['state'], 'backend').values())):
            raise RuntimeError('Retained backend restart cannot be verified')
        self.save('resume-backend-evidence', {'directory': str(previous.resolve()),
            'sha256': hashes, 'reports': reports,
            'corrected_comparison': semantic_progress(before['state']['semantic'], after['state']['semantic']),
            'outcome': 'pass', 'original_outcome': 'fail'})
        # This evidence-only claim is shared across fresh output directories. A
        # second resume cannot repeat Runner restart after an uncertain first one.
        original_directory = self.evidence
        try:
            self.evidence = previous
            self.save('resume-claim', {'output_directory': str(original_directory.resolve()),
                'after_backend_sha256': hashes['after-backend'],
                'resume_evidence_sha256': digest(original_directory / 'resume-backend-evidence.json'),
                'harness_sha256': digest(pathlib.Path(__file__)), 'outcome': 'claimed'})
        finally:
            self.evidence = original_directory
        return after['state']

    def run_acceptance(self, index_path, check_only=False, resume_after_backend=None):
        if check_only and resume_after_backend is not None:
            raise ValueError('Read-only preflight and explicit resume are separate actions')
        self.claim()
        stage = 'prior-evidence'
        try:
            self.load_prior(index_path)
            retained = None
            if resume_after_backend is not None:
                stage = 'resume-backend'
                retained = self.resume_backend(resume_after_backend)
            stage = 'before'
            baseline = self.collect()
            resume_checks = {}
            if retained is not None:
                resume_checks = {
                    'retained_semantics_verified': semantic_progress(retained['semantic'], baseline['semantic'])['valid'],
                    'same_services_before_resume': all(retained['runtime'][key] == baseline['runtime'][key]
                        for key in ('backend', 'service', 'boot_id', 'images')),
                    'same_connection_before_resume': all(retained['runtime']['runner'][key] == baseline['runtime']['runner'][key]
                        for key in ('incarnation', 'connection_instance'))}
            self.checkpoint('before', baseline, resume_checks)
            if check_only:
                self.save('checked', {'outcome': 'pass', 'service_mutations': 0,
                    'limitation': 'Read-only preflight; restart acceptance has not run.'})
                return
            previous = baseline
            for target in (('runner',) if retained is not None else ('backend', 'runner')):
                stage = 'before-' + target
                guarded = self.collect()
                self.checkpoint(stage, guarded, {
                    'same_semantics_before_mutation': semantic_progress(baseline['semantic'], guarded['semantic'])['valid'],
                    'same_service_before_mutation': all(guarded['runtime'][key] == previous['runtime'][key]
                        for key in ('backend', 'service', 'boot_id')),
                    'same_connection_before_mutation': all(guarded['runtime']['runner'][key] == previous['runtime']['runner'][key]
                        for key in ('incarnation', 'connection_instance'))})
                stage = 'restart-' + target
                self.save(stage + '-intent', {'target': target, 'before_checkpoint': 'before-' + target,
                    'before_sha256': digest(self.evidence / ('before-' + target + '.json')),
                    'semantic_sha256': hashlib.sha256(canonical_bytes(guarded['semantic'])).hexdigest(),
                    'issued_at': time.time(), 'outcome': 'intent'})
                # Exactly one attempt. Exceptions never authorize retry or cleanup.
                self.call(self.compose + ['restart', 'server'] if target == 'backend'
                          else ['systemctl', 'restart', 'monos-probe-runner.service'])
                self.await_restart(guarded, target)
                stage = 'after-' + target
                after = self.collect()
                self.save('runtime-progress-' + target, semantic_progress(guarded['semantic'], after['semantic']))
                self.checkpoint(stage, after, restart_checks(guarded, after, target))
                previous = after
            self.save('complete', {'outcome': 'pass', 'task_id': TASK, 'attempts': self.attempts,
                'semantic_sha256': hashlib.sha256(canonical_bytes(baseline['semantic'])).hexdigest(),
                'resumed_after_backend': str(resume_after_backend) if retained is not None else None,
                'limitation': 'Idle persistence only; no model call, live interruption, host reboot or Task execution.'})
        except BaseException as error:
            # Never stringify external exceptions: URLs, prompts or stderr may be private.
            self.save('failure', {'outcome': 'fail', 'stage': stage, 'error_type': type(error).__name__,
                'requires_inspection': True})
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--password-file', required=True)
    parser.add_argument('--prior-index', required=True)
    parser.add_argument('--check-only', action='store_true', help='Save read-only preflight in a separate fresh evidence directory')
    parser.add_argument('--resume-after-backend', help='Retained failed backend-only run; resume Runner once in fresh evidence')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Run only as root on the authorized test host')
    probe = CaptureDiscussionAcceptance('/root/monos-boundary-probe-src', args.evidence)
    probe.login(args.password_file)
    probe.run_acceptance(args.prior_index, check_only=args.check_only, resume_after_backend=args.resume_after_backend)


if __name__ == '__main__':
    try:
        main()
    except BaseException as failure:
        if isinstance(failure, SystemExit):
            raise
        print(json.dumps({'outcome': 'fail', 'error_type': type(failure).__name__,
            'action': 'Inspect retained evidence; do not repeat a restart.'}), file=sys.stderr)
        sys.exit(1)
