#!/usr/bin/env python3
"""Canonical public-repository trial on the existing authorized Linux host.

This uses a test-only Plan/Node admission seam, not the later product Start flow.
No provider writes or permanent services. Preserve every failed/uncertain trial.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import sqlite3
import time
import urllib.error
import urllib.request

from discussion_probe import DiscussionProbe
from probe import ROOT, checked_id, physical_state, retained_live_identity, verified_live_identity
from workspace_driver import workspace_id

PUBLIC_REMOTE = 'https://github.com/6spot/monolab-feasibility-20260928-160020-public.git'
PUBLIC_REPOSITORY = '6spot/monolab-feasibility-20260928-160020-public'
PUBLIC_REPOSITORY_ID = 1393178791
COMMON_CHECKS = {'lazy_or_retained', 'stable_path', 'instructions_read', 'real_repository',
    'one_operation_for_two_requests', 'uncredentialed_cache_origin', 'cache_read_only',
    'cache_push_denied', 'cache_write_denied', 'separate_common', 'no_service_credentials_in_agent_environment',
    'no_auth_in_git_config', 'capture_preserves_index'}
REUSE_CHECKS = {'private_dirty_and_index_preserved', 'base_target_pinned', 'new_lease_same_workspace'}
IDLE_FIELDS = {'queued', 'unreleased', 'writable', 'operations', 'leases',
    'pending_outbox', 'pending_discussion', 'unresolved_sources'}
HARNESS_FILES = ('workspace_probe.py', 'workspace_driver.py', 'workspace-attempt.ts',
    'driver.py', 'probe.py', 'discussion_probe.py')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Public repository evidence forbids redirects')


def public_repository_evidence(base):
    if not isinstance(base, str) or not re.fullmatch('[a-f0-9]{40}', base):
        raise RuntimeError('Invalid public GitHub commit identity')
    opener = urllib.request.build_opener(NoRedirect())
    def read(suffix):
        request = urllib.request.Request('https://api.github.com/repos/' + PUBLIC_REPOSITORY + suffix,
            headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'monos-workspace-acceptance'})
        with opener.open(request, timeout=15) as response:
            raw = response.read(1048577)
        if len(raw) > 1048576:
            raise RuntimeError('Public repository evidence exceeds response bound')
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise RuntimeError('Invalid public repository evidence')
        return value
    repository = read('')
    if (type(repository.get('id')) is not int or repository['id'] != PUBLIC_REPOSITORY_ID
        or repository.get('private') is not False or repository.get('full_name') != PUBLIC_REPOSITORY):
        raise RuntimeError('Authorized public repository identity differs')
    commit = read('/git/commits/' + base)
    if not isinstance(commit.get('tree'), dict):
        raise RuntimeError('Invalid public commit evidence')
    return {'repository_id': repository['id'], 'private': repository['private'], 'full_name': repository['full_name'],
        'commit': commit.get('sha'), 'tree': commit['tree'].get('sha')}


def public_source_checks(evidence, metadata, actual_base):
    return (type(evidence.get('repository_id')) is int and evidence['repository_id'] == PUBLIC_REPOSITORY_ID
        and evidence.get('private') is False and evidence.get('full_name') == PUBLIC_REPOSITORY
        and metadata.get('repository_identity') == 'github.com/' + PUBLIC_REPOSITORY
        and metadata.get('provider_metadata', {}).get('github', {}).get('repository_id') == str(PUBLIC_REPOSITORY_ID)
        and evidence.get('commit') == metadata.get('base_commit')
        and isinstance(evidence.get('tree'), str) and bool(re.fullmatch('[a-f0-9]{40}', evidence['tree']))
        and evidence['tree'] == actual_base.get('tree'))


def valid_identity(value):
    return (isinstance(value, dict) and type(value.get('pid')) is int and value['pid'] > 0
        and isinstance(value.get('birth'), str) and value['birth'].isdigit()
        and isinstance(value.get('boot_id'), str) and bool(value['boot_id'])
        and isinstance(value.get('cgroup'), str) and value['cgroup'].startswith('/'))


def idle_checks(counts):
    return (isinstance(counts, dict) and set(counts) == IDLE_FIELDS
        and all(type(value) is int and value == 0 for value in counts.values()))


def runner_restarted(before, after, restart_at):
    for state in (before, after):
        process, registration = state.get('process', {}), state.get('registration', {})
        if (not re.fullmatch('[a-f0-9]{32}', process.get('InvocationID', ''))
            or not process.get('MainPID', '').isdigit() or int(process['MainPID']) <= 0
            or not process.get('ActiveEnterTimestampMonotonic', '').isdigit()
            or int(process['ActiveEnterTimestampMonotonic']) <= 0
            or type(registration.get('incarnation')) is not int
            or not registration.get('backend')):
            return False
    old, new = before['registration'], after['registration']
    return (new.get('connected') is True and new.get('ready') is True
        and isinstance(new.get('last_seen'), (int, float)) and new['last_seen'] >= restart_at
        and type(new.get('report_incarnation')) is int and new['incarnation'] == new['report_incarnation']
        and new['incarnation'] > old['incarnation'] and new['backend'] == old['backend']
        and before['process']['InvocationID'] != after['process']['InvocationID']
        and int(after['process']['ActiveEnterTimestampMonotonic']) > int(before['process']['ActiveEnterTimestampMonotonic']))


def driver_checks(report, task, resource, attempt, uid, reuse=False):
    return (isinstance(report, dict) and report.get('attempt_id') == attempt
        and report.get('task_id') == task and report.get('resource_id') == resource
        and report.get('workspace_id') == workspace_id(task, resource)
        and report.get('execution_uid') == uid
        and report.get('stage') == ('completion_submitting' if reuse else 'held_for_stop')
        and all(report.get('checks', {}).get(key) is True for key in COMMON_CHECKS | (REUSE_CHECKS if reuse else set())))


def settled_checks(state):
    rows = state.get('attempts', [])
    ownership, observed = state.get('ownership', {}), state.get('live_identity', {})
    recorded = valid_identity(ownership) and isinstance(ownership.get('dispatch_id'), str) and bool(ownership['dispatch_id'])
    same_process = (observed.get('present') is True
        and all(observed.get(key) == ownership.get(key) for key in ('pid', 'birth', 'boot_id')))
    return (len(rows) == 1 and rows[0].get('process_absent') is True
        and rows[0].get('process_released') is True and rows[0].get('mutation_allowed') is False
        and recorded and rows[0].get('dispatch_id') == ownership['dispatch_id']
        and (observed.get('present') is False and not observed.get('identity_changed')
            or observed.get('present') is True and valid_identity(observed)
            and observed['pid'] == ownership['pid'] and not same_process)
        and state.get('physical', {}).get('cgroup_populated') is False
        and all(child.get('alive') is False for child in state.get('physical', {}).get('descendants', [])))


def checkpoint_checks(first, stopped, operations):
    stops = [item for item in operations if item['kind'] == 'stop']
    if len(stops) != 1:
        return False
    stop = stops[0]
    result = stop.get('result') or {}
    meta = result.get('workspace_metadata') or {}
    checkpoint = meta.get('checkpoint') or {}
    original = first['open']['result']
    return (settled_checks(stopped) and stop['state'] == 'succeeded'
        and result.get('writer_absent') is True and result.get('workspace_id') == first['workspace_id']
        and checkpoint.get('operation_id') == stop['id']
        and checkpoint.get('head_commit') == first['fingerprint']['head']
        and checkpoint.get('tree_id') == first['expected_checkpoint_tree']
        and bool(checkpoint.get('commit_id'))
        and all(meta.get(key) == original['workspace_metadata'][key]
            for key in ('base_commit', 'target_branch', 'finalized_commit', 'lease_id', 'storage_id', 'generation')))


def stopped_evidence_checks(before, stopped, checkpoint_object, task):
    return {'checkpoint': checkpoint_checks(before['driver'], stopped, stopped['operations']),
        'checkpoint_git_object': bool(checkpoint_object) and checkpoint_object.get('tree') == before['driver']['expected_checkpoint_tree']
            and checkpoint_object.get('parents') == [before['driver']['fingerprint']['head']],
        'no_completion': not any(op['kind'] == 'complete_node' for op in stopped['operations']),
        'same_main_identity': stopped['ownership'] == {**before['ownership'], 'phase': stopped['ownership'].get('phase')},
        'two_children_absent': children_settled(before, stopped), 'receipt_provenance': receipts_bound(stopped, task)}


def children_live(state):
    children = state.get('physical', {}).get('descendants', [])
    return (len(children) == 2 and {child.get('name') for child in children} == {'setsid', 'double-fork'}
        and len({child.get('identity', {}).get('pid') for child in children}) == 2
        and all(child.get('alive') is True and valid_identity(child.get('identity'))
            and child['identity']['boot_id'] == state['ownership']['boot_id']
            and child['identity']['cgroup'] == state['ownership']['cgroup'] for child in children))


def children_settled(before, after):
    original = {child['name']: child for child in before.get('physical', {}).get('descendants', [])}
    current = {child['name']: child for child in after.get('physical', {}).get('descendants', [])}
    return (children_live(before) and set(original) == set(current)
        and all(current[name].get('alive') is False and current[name].get('identity') == old.get('identity') for name, old in original.items()))


def native_requests_bound(state, task, resource, expected):
    receipts = {row['request_id']: row for row in state.get('receipts', [])}
    local = {row['request_id']: row for row in state.get('journal_requests', [])}
    operations = {row['id']: row for row in state.get('operations', [])}
    rows, launch = state.get('attempts', []), state.get('native_launch', {})
    if (set(receipts) != set(expected) or set(local) != set(expected)
        or len(receipts) != len(state.get('receipts', [])) or len(local) != len(state.get('journal_requests', []))
        or len(operations) != len(state.get('operations', [])) or len(rows) != 1
        or type(state.get('start_count')) is not int or state['start_count'] != 1
        or type(state.get('legacy_count')) is not int or state['legacy_count'] != 0
        or rows[0].get('task_id') != task or rows[0].get('started') is not True
        or launch.get('task_id') != task or launch.get('attempt_id') != rows[0]['attempt_id']
        or launch.get('dispatch_id') != rows[0]['dispatch_id']
        or launch.get('dispatch_id') != state.get('ownership', {}).get('dispatch_id')
        or 'resource_id' in launch or launch.get('kind') != 'node'
        or launch.get('workspace_reservations', {}).get('resources') != [
            {'resource_id': resource, 'workspace_id': workspace_id(task, resource)}]):
        return False
    for request, receipt in receipts.items():
        operation = operations.get(receipt.get('operation_id'))
        kind, operation_state = expected[request]
        envelope = local[request].get('envelope', {})
        if (receipt.get('scope_id') != task or receipt.get('command_name') != kind or not operation
            or operation['kind'] != kind or operation['state'] != operation_state
            or operation.get('attempt_id') != rows[0]['attempt_id'] or operation.get('resource_id') != resource
            or receipt.get('schema_version') != 1 or envelope.get('schema_version') != 1
            or envelope.get('scope_id') != task or envelope.get('name') != kind or envelope.get('request_id') != request
            or local[request].get('digest_matches_bytes') is not True or receipt.get('digest_matches_bytes') is not True
            or local[request]['digest'] != receipt['digest'] or envelope != receipt.get('envelope')
            or kind == 'open_workspace' and envelope.get('payload') != {'resource_id': resource}):
            return False
        descriptor = operation.get('workspace_descriptor')
        if (not descriptor or descriptor.get('task_id') != task or descriptor.get('resource_id') != resource
            or descriptor.get('workspace_id') != workspace_id(task, resource)
            or descriptor.get('lease_id') != operation.get('workspace_lease_id')
            or descriptor.get('node_id') != launch.get('node_id') or descriptor.get('node_activation') != 1
            or descriptor.get('project_id') != launch['workspace_reservations'].get('project_id')
            or descriptor.get('resource', {}).get('resource_id') != resource
            or descriptor.get('open_operation_id') not in operations):
            return False
        raw = json.dumps(descriptor, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
        if hashlib.sha256(raw).hexdigest() != operation.get('workspace_digest'):
            return False
    return True


def receipts_bound(state, task, complete=False):
    resource = (state.get('driver') or {}).get('resource_id')
    expected = {key: ('open_workspace', 'succeeded') for key in ('workspace-open', 'workspace-open-second')}
    if complete:
        expected['workspace-complete'] = ('complete_node', 'succeeded')
    if not resource or not native_requests_bound(state, task, resource, expected):
        return False
    receipts = {row['request_id']: row for row in state['receipts']}
    operations = {row['id']: row for row in state['operations']}
    opened = operations[receipts['workspace-open']['operation_id']]
    return (receipts['workspace-open-second']['operation_id'] == opened['id']
        and opened['workspace_descriptor']['open_operation_id'] == opened['id']
        and all(row['workspace_descriptor'] == opened['workspace_descriptor'] for row in operations.values())
        and opened.get('result') == state['driver']['open']['result']
        and state['driver']['open'].get('operation_id') == opened['id']
        and state['driver']['duplicate'].get('operation_id') == opened['id']
        and state['driver']['duplicate'].get('result') == opened['result'])


def final_lineage(records, operation, actual_tree, task, resource, attempt):
    workspaces, leases, completions = (records.get(key, []) for key in ('workspaces', 'leases', 'completion_rows'))
    if len(workspaces) != 1 or len(leases) != 2 or len(completions) != 1:
        return False
    workspace, completion = workspaces[0], completions[0]
    result = operation.get('result') or {}
    metadata = result.get('workspace_metadata') or {}
    lease = next((row for row in leases if row['id'] == metadata.get('lease_id')), {})
    return (operation['state'] == 'succeeded' and result.get('writer_absent') is True
        and workspace['id'] == result.get('workspace_id') == workspace_id(task, resource)
        and workspace['finalized_commit'] == result.get('git_commit') == metadata.get('finalized_commit')
        and result.get('git_tree') == actual_tree and bool(actual_tree)
        and completion['operation_id'] == operation['id'] and completion['attempt_id'] == attempt
        and completion['result'] == result and completion['activation'] == 1
        and lease.get('settle_operation_id') == operation['id'] and lease.get('attempt_id') == attempt
        and all(row['state'] == 'released' for row in leases))


class WorkspaceProbe(DiscussionProbe):
    def idle_state(self):
        counts = {'queued': "SELECT count(*) FROM attempts WHERE state='QUEUED'",
            'unreleased': 'SELECT count(*) FROM attempts WHERE NOT process_released',
            'writable': 'SELECT count(*) FROM attempts WHERE mutation_allowed',
            'operations': "SELECT count(*) FROM operations WHERE state NOT IN ('succeeded','cancelled')",
            'leases': "SELECT count(*) FROM workspace_leases WHERE state<>'released'",
            'pending_outbox': 'SELECT count(*) FROM outbox WHERE NOT done',
            'pending_discussion': 'SELECT count(*) FROM todo_discussion_outbox WHERE NOT done',
            'unresolved_sources': 'SELECT count(*) FROM todo_discussion_controls WHERE source_message_id IS NOT NULL'}
        return self.query('SELECT jsonb_build_object(' + ','.join("'" + key + "',(" + sql + ')' for key, sql in counts.items()) + ');')

    def require_idle(self, name):
        counts = self.idle_state()
        self.require(name, {'counts': counts}, {'globally_idle': idle_checks(counts)})

    def git_object(self, task, resource, oid):
        if not isinstance(oid, str) or not re.fullmatch(r'(?:[a-f0-9]{40}|[a-f0-9]{64})', oid):
            return {}
        path = ROOT / 'tasks' / workspace_id(task, resource) / 'worktree'
        # Fixed local read through the execution identity, without inherited Git
        # overrides, helpers, hooks or network protocols.
        command = ['runuser', '-u', 'me', '--', '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin',
            'GIT_CONFIG_NOSYSTEM=1', 'GIT_CONFIG_GLOBAL=/dev/null', 'GIT_TERMINAL_PROMPT=0',
            'GIT_ALLOW_PROTOCOL=file', '/usr/bin/git', '-C', str(path), '-c', 'core.hooksPath=/dev/null',
            '--no-replace-objects', 'show', '-s', '--format=%T%n%P', oid + '^{commit}']
        lines = self.call(command).splitlines()
        return {'tree': lines[0], 'parents': lines[1].split() if len(lines) > 1 else []}

    def runner_identity(self):
        process = dict(line.split('=', 1) for line in self.call(['systemctl', 'show', 'monos-probe-runner.service',
            '--property=InvocationID,MainPID,ActiveEnterTimestampMonotonic']).splitlines())
        row = self.query("SELECT jsonb_build_object('incarnation',incarnation,'report_incarnation',runtime_report_incarnation,"
            "'backend',connection_instance,'connected',connected,'ready',ready,'last_seen',extract(epoch FROM last_seen)) "
            "FROM runners WHERE id='" + self.runner + "';")
        return {'process': process, 'registration': row}

    def restart_runner(self, attempt, ownership):
        previous, restart_at = self.runner_identity(), time.time()
        # A failed intent write prevents restart; a lost restart response leaves
        # this exclusive intent for inspection, never an automatic second try.
        self.save('runner-restart-intent', {'attempt_id': attempt, 'ownership': ownership, 'runner': previous, 'at': restart_at})
        self.call(['systemctl', 'restart', 'monos-probe-runner.service'])
        deadline = time.monotonic() + 45
        while True:
            current = self.runner_identity()
            if runner_restarted(previous, current, restart_at):
                return current
            if time.monotonic() >= deadline:
                self.save('runner-restart-deadline', {'previous': previous, 'current': current})
                raise RuntimeError('Runner readiness deadline after restart')
            time.sleep(1)

    def install_workspace_driver(self):
        self.install_driver()
        directory = ROOT / 'probe-tools'
        source = self.source / 'infra/probe/workspace_driver.py'
        target = directory / 'workspace_driver.py'
        if target.is_symlink() or target.exists() and (not target.is_file() or target.stat().st_uid != 0 or target.stat().st_mode & 0o022 or target.read_bytes() != source.read_bytes()):
            raise RuntimeError('Preserve and review previous workspace driver before replacing')
        if not target.exists():
            with target.open('xb') as output:
                output.write(source.read_bytes())
            target.chmod(0o644)

    def config_command(self, project, suffix):
        current = self.read('/v1/owner/configuration')
        body = {'schema_version': 1, 'request_id': checked_id(project['id'] + '-' + suffix),
            'expected_control_version': current['control_version'], 'name': 'save_project', 'payload': project}
        return self.exact_post('/v1/owner/configuration/commands', body)

    def exact_post(self, endpoint, body, receipt_path=None):
        self.save('request-' + body['request_id'], {'command': body})
        try:
            result = self.post(endpoint, body)
        except urllib.error.HTTPError as error:
            if error.code < 500:
                self.save('rejection-' + body['request_id'], {'http_status': error.code})
                raise
            result = self.read(receipt_path or endpoint + '/' + body['request_id'])
        except (OSError, TimeoutError, ValueError):
            result = self.read(receipt_path or endpoint + '/' + body['request_id'])
        self.save('receipt-' + body['request_id'], {'receipt': result})
        if result.get('request_id') != body['request_id'] or result.get('status') not in ('admitted', 'committed'):
            raise RuntimeError('Uncertain or rejected admission: inspect retained exact request')
        return result

    def task_control(self, task, attempt, action, suffix):
        overview = self.read('/v1/owner/tasks/' + task)
        body = {'schema_version': 1, 'request_id': checked_id(attempt + '-' + suffix),
            'scope_id': task, 'expected_control_version': overview['control_version'],
            'name': action, 'payload': {'attempt_id': attempt, 'node_id': 'node_' + task, 'node_activation': 1}}
        return self.exact_post('/v1/owner/commands', body, '/v1/owner/scopes/' + task + '/commands/' + body['request_id'])

    def start_workspace(self, task, project, resource, attempt, prior=None):
        catalog = self.catalog()
        self.install_workspace_driver()
        args = ' --attempt ' + attempt + ' --task ' + task + ' --resource ' + resource
        if prior:
            args += ' --prior-attempt ' + prior
        prompt = ('This is the authorized monos canonical workspace trial. Use your native bash tool to run exactly '
            'the following root-owned driver with a 600000 ms timeout. It invokes bundled monos, reads repository '
            'instructions, edits only private local work, and verifies Stop/recovery. Do not answer instead or '
            'retry a failed driver. Owner Stop or completion will terminate this process tree.\n'
            'python3 /var/lib/monos-probe/probe-tools/workspace_driver.py' + args)
        body = {'runner_id': self.runner, 'attempt_id': attempt, 'task_id': task,
            'project_id': project, 'prompt': prompt, 'create': prior is None}
        self.save('prepared-' + attempt, {'admission': body, 'model': catalog})
        output = self.call(self.compose + ['run', '--rm', '-T', 'tests', 'node',
            '--experimental-strip-types', 'infra/probe/workspace-attempt.ts'], json.dumps(body).encode())
        result = json.loads(output)
        self.save('started-' + attempt, {'selection': result})
        return result

    def workspace_snapshot(self, attempt):
        attempt = checked_id(attempt)
        state = super().snapshot(attempt)
        scratch = ROOT / 'execution' / attempt / 'scratch'
        report = scratch / 'workspace-driver.json'
        state['driver'] = json.loads(report.read_text()) if report.exists() else None
        state['physical'] = physical_state(state['ownership'], scratch)
        state['operations'] = self.query("SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY created_at,id),'[]'::jsonb) FROM operations o WHERE attempt_id='" + checked_id(attempt) + "';")
        state['receipts'] = self.query("SELECT coalesce(jsonb_agg(jsonb_build_object('request_id',request_id,'scope_id',scope_id,"
            "'command_name',command_name,'digest',digest,'schema_version',schema_version,'operation_id',operation_id,"
            "'envelope_json',envelope_json)),'[]'::jsonb) FROM command_receipts WHERE attempt_id='" + attempt + "';")
        for row in state['receipts']:
            raw = row.pop('envelope_json')
            row['digest_matches_bytes'] = hashlib.sha256(raw.encode()).hexdigest() == row['digest']
            row['envelope'] = json.loads(raw)
        journal = sqlite3.connect('file:' + self.config['journal'] + '?mode=ro', uri=True)
        try:
            state['journal_requests'] = [{'request_id': row[0], 'digest': row[1],
                'digest_matches_bytes': hashlib.sha256(row[2]).hexdigest() == row[1], 'envelope': json.loads(row[2])}
                for row in journal.execute('SELECT id,digest,envelope FROM requests WHERE attempt=?', (attempt,))]
            row = journal.execute('SELECT body FROM starts WHERE attempt=?', (attempt,)).fetchone()
            dispatch = json.loads(row[0])['dispatch'] if row else {}
            state['native_launch'] = {key: value for key, value in dispatch.items()
                if key in ('attempt_id', 'dispatch_id', 'task_id', 'kind', 'node_id', 'resource_id', 'workspace_reservations')}
        finally:
            journal.close()
        state.update(self.query("SELECT jsonb_build_object('start_count',(SELECT count(*) FROM outbox WHERE kind='start' AND attempt_id='"
            + attempt + "'),'legacy_count',(SELECT count(*) FROM legacy_probe_attempts WHERE attempt_id='" + attempt + "'));") )
        return state

    def wait_workspace(self, attempt, released=False):
        deadline = time.monotonic() + 240
        while True:
            state = self.workspace_snapshot(attempt)
            if (released and settled_checks(state)) or (not released and (state.get('driver') or {}).get('stage') == 'held_for_stop'):
                return state
            if any(op['state'] == 'recovery' for op in state['operations']):
                self.save('recovery-' + attempt, {'state': state})
                raise RuntimeError('Workspace requires recovery; preserve trial')
            if time.monotonic() >= deadline:
                self.save('deadline-' + attempt, {'state': state})
                raise RuntimeError('Fixture deadline exceeded; inspect retained ownership')
            time.sleep(1)

    def harness_hashes(self):
        return {name: hashlib.sha256((self.source / 'infra/probe' / name).read_bytes()).hexdigest() for name in HARNESS_FILES}

    def resume_after_stop(self, prefix):
        """Continue only the unperformed stages; retained evidence is not relaunch authority."""
        prefix = checked_id(prefix)
        task, project, resource = (checked_id(prefix + suffix) for suffix in ('-task', '-project', '-repo'))
        first, second = checked_id(prefix + '-first'), checked_id(prefix + '-second')
        future = ('resume-after-stop-intent', 'resumed-stopped', 'final', 'final-idle',
            'request-' + project + '-defaults', 'request-' + first + '-continue',
            'prepared-' + second, 'started-' + second, 'request-' + project + '-archive')
        if any((self.evidence / (name + '.json')).exists() for name in future):
            raise RuntimeError('Continuation or later stage already attempted; preserve and inspect evidence')
        retained_hashes = {}
        def load(name):
            path = self.evidence / (name + '.json')
            if path.is_symlink() or not path.is_file() or path.stat().st_uid != os.geteuid() or path.stat().st_mode & 0o022:
                raise RuntimeError('Missing or untrusted retained evidence: ' + name)
            raw = path.read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            if path.name in retained_hashes and retained_hashes[path.name] != digest:
                raise RuntimeError('Retained evidence changed during validation: ' + name)
            retained_hashes[path.name] = digest
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise RuntimeError('Malformed retained evidence: ' + name)
            return value
        def demand(condition, reason):
            if not condition:
                raise RuntimeError('Stop continuation refused: ' + reason)
        def passed(value, names):
            checks = value.get('checks', {})
            return value.get('outcome') == 'pass' and set(checks) == names and all(item is True for item in checks.values())
        def canonical(value):
            return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)

        manifest, initial = load('manifest'), load('initial-idle')
        opened, intent, restarted = load('first-open'), load('runner-restart-intent'), load('runner-restarted')
        prepared, started = load('prepared-' + first), load('started-' + first)
        command = load('request-' + first + '-stop')['command']
        receipt = load('receipt-' + first + '-stop')['receipt']
        create = load('request-' + project + '-create')['command']
        create_receipt = load('receipt-' + project + '-create')['receipt']
        hashes = self.harness_hashes()
        original_hashes = manifest.get('harness_sha256', {})
        demand(manifest.get('remote') == PUBLIC_REMOTE and set(original_hashes) == set(HARNESS_FILES)
            and all(isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) for value in original_hashes.values())
            and all(original_hashes[name] == hashes[name] for name in HARNESS_FILES if name != 'workspace_probe.py'),
            'original harness helpers changed')
        demand(passed(initial, {'globally_idle'}) and idle_checks(initial.get('counts')), 'initial idle proof')
        before, after = opened['state'], restarted['state']
        demand(passed(opened, {'public_source_matches_git', 'driver', 'live_hold', 'verified_native_identity',
            'two_native_children', 'receipt_provenance'})
            and driver_checks(before['driver'], task, resource, first, self.config['execution_uid'])
            and verified_live_identity(before['ownership'], before['live_identity'])
            and children_live(before) and receipts_bound(before, task), 'original first open')
        metadata = before['driver']['open']['result']['workspace_metadata']
        demand(public_source_checks(opened['public_source'], metadata, opened['base_object'])
            and self.git_object(task, resource, metadata['base_commit']) == opened['base_object'], 'retained public/base proof')
        demand(intent.get('attempt_id') == first and intent.get('ownership') == before['ownership']
            and type(intent.get('at')) in (int, float) and intent['at'] < before['driver']['hold_expires_at']
            and runner_restarted(intent['runner'], restarted['runner'], intent['at'])
            and passed(restarted, {'same_live_identity', 'original_open_retained', 'two_children_retained'})
            and retained_live_identity(before, after) and before['ownership'] == after['ownership']
            and before['driver'] == after['driver'] and before['operations'] == after['operations']
            and before['native_launch'] == after['native_launch'] and receipts_bound(after, task)
            and children_live(after) and before['physical']['descendants'] == after['physical']['descendants'],
            'original live restart and immutable open')
        admission, selection = prepared['admission'], started['selection']
        demand(admission.get('create') is True and all(admission.get(key) == value for key, value in {'attempt_id': first, 'task_id': task,
            'project_id': project, 'runner_id': self.runner, 'create': True}.items())
            and selection.get('dispatch_id') == before['ownership']['dispatch_id']
            and selection.get('runner_id') == self.runner, 'original canonical admission')
        config = create['payload']
        demand(create.get('name') == 'save_project' and create.get('request_id') == project + '-create'
            and config.get('id') == project and config.get('archived') is False
            and config.get('resources') == [{'id': resource, 'remote_url': PUBLIC_REMOTE, 'remote_preparation': 'after_acceptance'}]
            and create_receipt.get('request_id') == project + '-create' and create_receipt.get('status') == 'committed'
            and create_receipt.get('entity_id') == project, 'original Project creation')
        demand(type(command.get('schema_version')) is int and command['schema_version'] == 1 and command.get('request_id') == first + '-stop'
            and command.get('scope_id') == task and command.get('name') == 'stop_node'
            and type(command.get('expected_control_version')) is int
            and command.get('payload') == {'attempt_id': first, 'node_id': 'node_' + task, 'node_activation': 1}
            and type(receipt.get('schema_version')) is int and receipt['schema_version'] == 1 and receipt.get('request_id') == first + '-stop'
            and receipt.get('status') == 'admitted' and receipt.get('attempt_id') == first
            and receipt.get('node_id') == 'node_' + task and receipt.get('end_reason') == 'owner_stopped'
            and bool(receipt.get('operation_id')), 'exact original Stop admission')

        # Read-only revalidation. Do not wait/retry, restart, resubmit Stop or repair DB state.
        stopped = self.workspace_snapshot(first)
        records = self.query("SELECT jsonb_build_object('owner_receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM owner_command_receipts r WHERE scope_id='" + task
            + "'), 'attempts',(SELECT coalesce(jsonb_agg(id),'[]'::jsonb) FROM attempts WHERE task_id='" + task
            + "'), 'leases',(SELECT coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) FROM workspace_leases l WHERE task_id='" + task
            + "'), 'workspaces',(SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) FROM task_workspaces w WHERE task_id='" + task + "'));")
        owner_rows = records.get('owner_receipts', [])
        demand(len(owner_rows) == 1 and records.get('attempts') == [first], 'later Owner action or Attempt already exists')
        owner = owner_rows[0]
        raw = owner.get('envelope_json', '')
        demand(owner.get('request_id') == command['request_id'] and owner.get('scope_id') == task
            and hashlib.sha256(raw.encode()).hexdigest() == owner.get('digest') and raw == canonical(command)
            and canonical(owner.get('response')) == canonical(receipt)
            and canonical(self.read('/v1/owner/scopes/' + task + '/commands/' + command['request_id'])) == canonical(receipt),
            'Stop envelope/digest/receipt changed')
        stops = [op for op in stopped['operations'] if op['kind'] == 'stop']
        demand(len(stops) == 1 and len(stopped['operations']) == 2 and len(before['operations']) == 1,
            'expected only original open and Stop')
        stop, original_open = stops[0], before['operations'][0]
        demand(stop.get('id') == receipt['operation_id'] and stop.get('state') == 'succeeded'
            and stop.get('request_id') == command['request_id'] and stop.get('attempt_id') == first
            and stop.get('resource_id') == resource and stop.get('workspace_descriptor') == original_open['workspace_descriptor']
            and stop.get('workspace_digest') == original_open['workspace_digest']
            and stop.get('workspace_lease_id') == original_open['workspace_lease_id']
            and original_open in stopped['operations'] and stopped['driver'] == before['driver']
            and stopped['native_launch'] == before['native_launch'], 'same physical dispatch and terminal Stop operation')
        leases, workspaces = records.get('leases', []), records.get('workspaces', [])
        demand(len(leases) == 1 and len(workspaces) == 1, 'original sole workspace/lease')
        lease, workspace = leases[0], workspaces[0]
        demand(all(lease.get(key) == value for key, value in {'id': metadata['lease_id'], 'state': 'released',
            'workspace_id': workspace_id(task, resource), 'task_id': task, 'attempt_id': first,
            'dispatch_id': before['ownership']['dispatch_id'], 'node_id': 'node_' + task, 'node_activation': 1,
            'open_operation_id': original_open['id'], 'settle_operation_id': stop['id'], 'generation': metadata['generation'],
            'checkpoint': stop['result']['workspace_metadata']['checkpoint'], 'target_commit': metadata['target_commit']}.items())
            and workspace.get('id') == workspace_id(task, resource) and workspace.get('task_id') == task
            and workspace.get('project_id') == project and workspace.get('resource_id') == resource
            and workspace.get('runner_id') == self.runner and workspace.get('ever_materialized') is True
            and workspace.get('resource') == original_open['workspace_descriptor']['resource']
            and all(workspace.get(key) == metadata[key] for key in ('generation', 'storage_id', 'repository_identity',
                'provider_metadata', 'base_commit', 'target_branch', 'finalized_commit')), 'released original lease and fixed lineage')
        checkpoint_object = self.git_object(task, resource, stop['result']['workspace_metadata']['checkpoint']['commit_id'])
        checks = stopped_evidence_checks(before, stopped, checkpoint_object, task)
        demand(all(checks.values()), 'checkpoint/identity/descendant/native evidence')
        current_config = self.read('/v1/owner/configuration')
        demand([p for p in current_config.get('projects', []) if p['id'] == project] == [config], 'Project already changed')
        counts = self.idle_state()
        demand(idle_checks(counts), 'current global ownership not settled')
        # Hash all original JSON, including recovery/failure evidence, without rewriting it.
        for path in self.evidence.glob('*.json'):
            load(path.stem)
        self.save('resume-after-stop-intent', {'prefix': prefix, 'attempt_id': first, 'stop_operation_id': stop['id'],
            'at': time.time(), 'retained_sha256': retained_hashes, 'harness_sha256': hashes, 'state': stopped,
            'records': records, 'counts': counts, 'checkpoint_object': checkpoint_object, 'checks': checks})
        self.require('resumed-stopped', {'state': stopped, 'checkpoint_object': checkpoint_object}, checks)
        return self.after_stop(task, project, resource, first, second, config)

    def trial(self, prefix):
        task, project, resource = (checked_id(prefix + suffix) for suffix in ('-task', '-project', '-repo'))
        first, second = checked_id(prefix + '-first'), checked_id(prefix + '-second')
        self.require_idle('initial-idle')
        self.save('manifest', {'harness_sha256': self.harness_hashes(),
            'remote': PUBLIC_REMOTE, 'limitation': 'Public GitHub; no live private App-token claim; test-owned Plan/Node admission.'})
        config = {'id': project, 'name': 'Serial workspace native acceptance', 'context': 'Private local tests only; no remote publication.',
            'archived': False, 'role_ids': [], 'resources': [{'id': resource, 'remote_url': PUBLIC_REMOTE, 'remote_preparation': 'after_acceptance'}]}
        self.config_command(config, 'create')
        self.start_workspace(task, project, resource, first)
        before = self.wait_workspace(first)
        metadata = before['driver']['open']['result']['workspace_metadata']
        try:
            public_source = public_repository_evidence(metadata['base_commit'])
        except (OSError, ValueError, RuntimeError) as error:
            self.save('public-source-failure', {'state': before, 'error_type': type(error).__name__})
            raise
        actual_base = self.git_object(task, resource, metadata['base_commit'])
        self.require('first-open', {'state': before, 'public_source': public_source, 'base_object': actual_base}, {
            'public_source_matches_git': public_source_checks(public_source, metadata, actual_base),
            'driver': driver_checks(before['driver'], task, resource, first, self.config['execution_uid']),
            'live_hold': before['driver'].get('hold_expires_at', 0) > time.time() + 90,
            'verified_native_identity': verified_live_identity(before['ownership'], before['live_identity']),
            'two_native_children': children_live(before), 'receipt_provenance': receipts_bound(before, task)})
        current_runner = self.restart_runner(first, before['ownership'])
        after_restart = self.workspace_snapshot(first)
        self.require('runner-restarted', {'state': after_restart, 'runner': current_runner}, {'same_live_identity': retained_live_identity(before, after_restart),
            'original_open_retained': before['driver']['open'] == after_restart['driver']['open'],
            'two_children_retained': children_live(after_restart) and before['physical']['descendants'] == after_restart['physical']['descendants']})
        self.task_control(task, first, 'stop_node', 'stop')
        stopped = self.wait_workspace(first, released=True)
        stops = [op for op in stopped['operations'] if op['kind'] == 'stop']
        checkpoint = ((stops[0].get('result') or {}).get('workspace_metadata') or {}).get('checkpoint', {}) if len(stops) == 1 else {}
        checkpoint_object = self.git_object(task, resource, checkpoint.get('commit_id'))
        self.require('stopped', {'state': stopped, 'checkpoint_object': checkpoint_object},
            stopped_evidence_checks(before, stopped, checkpoint_object, task))
        return self.after_stop(task, project, resource, first, second, config)

    def after_stop(self, task, project, resource, first, second, config):
        # Changing defaults after materialization must not retarget/reset it.
        config['resources'][0].update(default_ref='monos-intentionally-missing-ref', default_branch='monos-intentionally-missing-branch')
        self.config_command(config, 'defaults')
        self.task_control(task, first, 'continue_node', 'continue')
        self.start_workspace(task, project, resource, second, prior=first)
        completed = self.wait_workspace(second, released=True)
        report = completed['driver'] or {}
        completions = [op for op in completed['operations'] if op['kind'] == 'complete_node']
        final = completions[0].get('result', {}) if len(completions) == 1 else {}
        records = self.query("SELECT jsonb_build_object('task',(SELECT jsonb_build_object('state',state,'project_id',project_id,'resource_id',resource_id) FROM tasks WHERE id='" + task + "'), 'completion_rows',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM node_completions c WHERE node_id='node_" + task + "'), 'leases',(SELECT coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) FROM workspace_leases l WHERE task_id='" + task + "'), 'workspaces',(SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) FROM task_workspaces w WHERE task_id='" + task + "'));")
        final_object = self.git_object(task, resource, final.get('git_commit'))
        actual_tree = final_object.get('tree')
        checks = {'driver': driver_checks(report, task, resource, second, self.config['execution_uid'], reuse=True),
            'physically_released': settled_checks(completed), 'exact_final_tree': bool(report.get('expected_git_tree')) and final.get('git_tree') == report['expected_git_tree'],
            'one_formal_completion': len(records['completion_rows']) == 1, 'local_review': records['task']['state'] == 'REVIEW',
            'canonical_project_task': records['task']['project_id'] == project and records['task']['resource_id'] is None,
            'one_workspace': len(records['workspaces']) == 1 and records['workspaces'][0]['id'] == workspace_id(task, resource),
            'receipt_provenance': receipts_bound(completed, task, complete=True),
            'finalized_git_and_database_lineage': len(completions) == 1 and final_lineage(records, completions[0], actual_tree, task, resource, second)}
        self.require('final', {'state': completed, 'records': records, 'actual_commit_tree': actual_tree}, checks)
        config['archived'] = True
        self.config_command(config, 'archive')
        self.require_idle('final-idle')
        return {'outcome': 'pass', 'task_id': task, 'attempt_ids': [first, second]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default='/root/monos-boundary-probe-src')
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--password-file', required=True)
    parser.add_argument('--resume-after-stop', action='store_true', help='Validate retained evidence and an already settled original Stop; continue remaining stages once')
    parser.add_argument('prefix')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Run only on the authorized test host as root')
    probe = WorkspaceProbe(args.source, args.evidence)
    probe.login(args.password_file)
    if args.resume_after_stop:
        probe.resume_after_stop(checked_id(args.prefix))
    else:
        probe.trial(checked_id(args.prefix))


if __name__ == '__main__':
    main()
