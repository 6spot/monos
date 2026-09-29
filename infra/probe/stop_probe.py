#!/usr/bin/env python3
"""Real selected-Attempt Owner Stop/Continue proof on the authorized Linux host."""
import argparse
import hashlib
import json
import os
import pathlib
import time
import urllib.error
import urllib.request

from logs_probe import LogsProbe
from probe import checked_id, retained_live_identity, verified_live_identity


class StopProbe(LogsProbe):
    def read(self, path):
        with self.browser.open(self.endpoint + path, timeout=20) as response:
            return json.load(response)

    def command(self, attempt, name, version, payload, request_id=None):
        body = {
            'schema_version': 1, 'request_id': request_id or name + '-' + attempt,
            'scope_id': 'task_' + attempt, 'expected_control_version': version,
            'name': name, 'payload': payload,
        }
        request = urllib.request.Request(self.endpoint + '/v1/owner/commands',
            data=json.dumps(body, separators=(',', ':')).encode(),
            headers={'Content-Type': 'application/json', 'Origin': self.endpoint})
        with self.browser.open(request, timeout=20) as response:
            return json.load(response)

    def receipt(self, attempt, request_id):
        return self.read('/v1/owner/scopes/task_' + attempt + '/commands/' + request_id)

    def operation(self, attempt, operation_id):
        return self.read('/v1/owner/tasks/task_' + attempt + '/operations/' + operation_id)

    def overview(self, attempt):
        return self.read('/v1/owner/tasks/task_' + attempt)

    def owner_rejection(self, attempt, name, version, payload, request_id):
        try:
            self.command(attempt, name, version, payload, request_id)
        except urllib.error.HTTPError as error:
            with error:
                return json.load(error).get('error', {}).get('code')
        return None

    def wait_released(self, attempt, seconds=90):
        deadline = time.monotonic() + seconds
        last = None
        while time.monotonic() < deadline:
            last = self.snapshot(attempt)
            if last['attempts'] and last['attempts'][0]['process_released']:
                return last
            time.sleep(2)
        self.save('stop-timeout-' + attempt, {'outcome': 'fail', 'state': last})
        raise RuntimeError('Owner Stop did not release physical ownership within trial bound')

    def trial(self, attempt, kind):
        attempt = checked_id(attempt)
        pre_plan = kind == 'planner'
        self.save('stop-harness-' + attempt, {'sha256': {
            name: hashlib.sha256((self.source / 'infra/probe' / name).read_bytes()).hexdigest()
            for name in ('stop_probe.py', 'probe.py', 'logs_probe.py', 'selected-attempt.ts')}})
        trial = self.start(attempt, kind, hold=True, pre_plan=pre_plan)
        before = self.wait(attempt, ready_only=True)
        if (before.get('driver') or {}).get('stage') != 'ready_for_handoff':
            self.save('stop-not-ready-' + attempt, {'outcome': 'fail', 'state': before})
            raise RuntimeError('Selected native driver did not reach held checkpoint')
        if not verified_live_identity(before['ownership'], before['live_identity']):
            raise RuntimeError('Held process identity is not verified')
        self.save('stop-before-' + attempt, {'state': before, 'overview': self.overview(attempt)})

        restart_check = None
        if kind == 'node':
            old_connection = self.query("SELECT to_json(connection_instance) FROM runners WHERE id='" + self.runner + "';")
            self.call(self.compose + ['restart', 'server'])
            self.call(['systemctl', 'restart', 'monos-probe-runner.service'])
            deadline = time.monotonic() + 60
            while True:
                current = self.query("SELECT to_json(connection_instance) FROM runners WHERE id='" + self.runner + "';")
                ready = self.query("SELECT to_json(ready) FROM runners WHERE id='" + self.runner + "';")
                if current and current != old_connection and ready is True:
                    break
                if time.monotonic() >= deadline:
                    raise RuntimeError('Runner did not become Ready after paired service restart')
                time.sleep(1)
            resumed = self.snapshot(attempt)
            restart_check = {'old_connection': old_connection, 'new_connection': current,
                             'same_live_identity': retained_live_identity(before, resumed),
                             'still_held': resumed['attempts'][0]['process_released'] is False}
            self.save('stop-after-restart-' + attempt, {'checks': restart_check, 'state': resumed})
            if not restart_check['same_live_identity'] or not restart_check['still_held']:
                raise RuntimeError('Live Attempt did not retain identity and ownership across service restart')

        overview = self.overview(attempt)
        payload = {'attempt_id': attempt}
        if kind == 'node':
            payload.update(node_id='node_task_' + attempt, node_activation=1)
        name = 'stop_node' if kind == 'node' else 'stop_initial_planning'
        request_id = name + '-' + attempt
        admitted = self.command(attempt, name, overview['control_version'], payload, request_id)
        replay = self.command(attempt, name, overview['control_version'], payload, request_id)
        lookup = self.receipt(attempt, request_id)
        changed = dict(payload)
        changed['attempt_id'] = attempt + '-changed'
        conflict = self.owner_rejection(attempt, name, overview['control_version'], changed, request_id)
        self.save('stop-admitted-' + attempt, {'command': admitted, 'replay': replay, 'lookup': lookup,
                                               'conflicting_replay_error': conflict})
        if admitted != replay or lookup.get('operation_id') != admitted.get('operation_id') or conflict != 'payload_conflict':
            raise RuntimeError('Stop receipt replay or conflict guard failed')

        after = self.wait_released(attempt)
        stopped = self.overview(attempt)
        operation = self.operation(attempt, admitted['operation_id']) if admitted.get('operation_id') else None
        resume_name = 'continue_node' if kind == 'node' else 'retry_initial_planning'
        resumed_command = self.command(attempt, resume_name, stopped['control_version'], payload)
        resumed = self.overview(attempt)
        canonical = self.query("SELECT jsonb_build_object('attempt_count',count(*),'node_state',max(n.state),'task_state',max(t.state),'formal_completions',(SELECT count(*) FROM node_completions c WHERE c.node_id='node_task_" + attempt + "')) FROM attempts a JOIN tasks t ON t.id=a.task_id LEFT JOIN nodes n ON n.id=a.node_id WHERE a.task_id='task_" + attempt + "';")
        checks = {
            'selected_native_attempt': bool(trial.get('dispatch_id')),
            'same_receipt_after_retry': admitted == replay and lookup.get('operation_id') == admitted.get('operation_id'),
            'changed_payload_conflicts': conflict == 'payload_conflict',
            'stop_operation_succeeded': operation is None or operation.get('state') == 'succeeded',
            'authority_revoked': after['attempts'][0]['mutation_allowed'] is False,
            'whole_tree_absent': after['attempts'][0]['process_absent'] is True and after['physical']['cgroup_populated'] is False and all(not descendant['alive'] for descendant in after['physical']['descendants']),
            'physical_claim_released': after['attempts'][0]['process_released'] is True,
            'resume_same_owner': resumed_command.get('status') == 'committed' and canonical['attempt_count'] == 1,
            'no_formal_completion': canonical['formal_completions'] == 0,
        }
        if kind == 'node':
            checks['node_blocked_before_continue'] = stopped['nodes']['blocked'] == 1
            checks['node_pending_after_continue'] = resumed['nodes']['pending'] == 1 and resumed['state'] == 'RUNNING'
            checks['live_restart_preserved_identity'] = bool(restart_check and restart_check['same_live_identity'] and restart_check['still_held'])
        else:
            checks['pre_plan_stop_returned_planning'] = stopped['state'] == 'PLANNING' and 'plan_id' not in stopped
            checks['pre_plan_retry_returned_running'] = resumed['state'] == 'RUNNING' and 'plan_id' not in resumed
        result = {'outcome': 'pass' if all(checks.values()) else 'fail', 'checks': checks,
                  'trial': trial, 'restart': restart_check, 'stop': admitted, 'operation': operation,
                  'before': before, 'after': after, 'stopped_overview': stopped,
                  'resume': resumed_command, 'resumed_overview': resumed, 'canonical': canonical}
        self.save('stop-final-' + attempt, result)
        return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default='/root/monos-boundary-probe-src')
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--password-file')
    parser.add_argument('--action', choices=('trial', 'reboot-hold', 'reboot-verify'), default='trial')
    parser.add_argument('--kind', choices=('node', 'planner'))
    parser.add_argument('attempt')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Run only as root on the authorized test host')
    probe = StopProbe(args.source, args.evidence)
    attempt = checked_id(args.attempt)
    if args.action == 'trial':
        if not args.password_file or not args.kind:
            parser.error('trial requires --password-file and --kind')
        probe.login(args.password_file)
        return 0 if probe.trial(attempt, args.kind)['outcome'] == 'pass' else 2
    if args.action == 'reboot-hold':
        return 0 if probe.reboot_hold(attempt)['outcome'] == 'ready' else 2
    before = json.loads((pathlib.Path(args.evidence) / ('reboot-before-' + attempt + '.json')).read_text())
    state = probe.wait(attempt, seconds=120)
    result = probe.reboot_verify(attempt, before, state)
    recovery = probe.recovery(attempt, 'shared-open')
    unknown = probe.recovery(attempt, 'probe-handoff')
    result['checks']['existing_result_readable_unsent_unknown'] = (
        recovery.get('status') == 'committed' and recovery.get('request_id') == 'shared-open'
        and unknown.get('status') == 'unknown')
    result['outcome'] = 'pass' if all(result['checks'].values()) else 'fail'
    probe.save('reboot-after-' + attempt, result)
    return 0 if result['outcome'] == 'pass' else 2


if __name__ == '__main__':
    raise SystemExit(main())
