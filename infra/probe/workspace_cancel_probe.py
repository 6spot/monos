#!/usr/bin/env python3
"""Native missing-ref open cancellation; no new service or provider mutation."""
import argparse
import hashlib
import json
import os
import time

from probe import ROOT, checked_id, verified_live_identity
from workspace_probe import WorkspaceProbe, PUBLIC_REMOTE, settled_checks, native_requests_bound


def cancellation_checks(before, after, leases, workspaces, receipt):
    opens = [row for row in after['operations'] if row['kind'] == 'open_workspace']
    stops = [row for row in after['operations'] if row['kind'] == 'stop']
    if len(opens) != 1 or len(stops) != 1 or len(leases) != 1 or len(workspaces) != 1:
        return False
    opened, stop = opens[0], stops[0]
    task, resource = before.get('native_launch', {}).get('task_id'), before['driver'].get('resource_id')
    return (verified_live_identity(before['ownership'], before['live_identity'])
        and bool(task) and bool(resource)
        and native_requests_bound(before, task, resource, {'unavailable-open': ('open_workspace', 'recovery')})
        and native_requests_bound(after, task, resource, {'unavailable-open': ('open_workspace', 'cancelled')})
        and settled_checks(after)
        and all(before['ownership'][key] == after['ownership'][key] for key in ('pid', 'birth', 'boot_id', 'cgroup', 'dispatch_id'))
        and opened['id'] == before['driver']['open']['operation_id']
        and opened['state'] == 'cancelled' and opened['cancelled_by_operation_id'] == stop['id']
        and opened['workspace_lease_id'] == stop['workspace_lease_id'] == leases[0]['id']
        and stop['state'] == 'succeeded' and stop['result'].get('writer_absent') is True
        and opened['result'].get('writer_absent') is True
        and not any(key in opened['result'] or key in stop['result'] for key in ('workspace_id', 'path', 'workspace_metadata', 'git_commit', 'git_tree'))
        and leases[0]['state'] == 'released' and leases[0]['settle_operation_id'] == stop['id']
        and leases[0].get('attempt_id') == before['driver'].get('attempt_id')
        and leases[0].get('workspace_id') == workspaces[0].get('id') == opened['workspace_descriptor']['workspace_id']
        and leases[0].get('open_operation_id') == opened['id']
        and stop.get('workspace_descriptor') == opened['workspace_descriptor']
        and workspaces[0]['ever_materialized'] is False
        and receipt.get('status') == 'error' and receipt.get('request_id') == 'unavailable-open'
        and receipt.get('operation_id') == opened['id'])


class CancellationProbe(WorkspaceProbe):
    def trial(self, prefix):
        task, project, resource, attempt = (checked_id(prefix + suffix) for suffix in ('-task', '-project', '-repo', '-node'))
        self.require_idle('initial-idle')
        self.install_workspace_driver()
        source = self.source / 'infra/probe/workspace_cancel_driver.py'
        target = ROOT / 'probe-tools/workspace_cancel_driver.py'
        if target.is_symlink() or target.exists() and (target.stat().st_uid != 0 or target.stat().st_mode & 0o022 or target.read_bytes() != source.read_bytes()):
            raise RuntimeError('Previous cancellation driver requires review before replacement')
        if not target.exists():
            with target.open('xb') as output:
                output.write(source.read_bytes())
            target.chmod(0o644)
        self.save('manifest', {'sha256': {name: hashlib.sha256((self.source / 'infra/probe' / name).read_bytes()).hexdigest()
            for name in ('workspace_cancel_driver.py', 'workspace_cancel_probe.py', 'workspace_driver.py', 'workspace_probe.py',
                'workspace-attempt.ts', 'driver.py', 'probe.py', 'discussion_probe.py')},
            'remote': PUBLIC_REMOTE})
        config = {'id': project, 'name': 'Unavailable workspace Stop acceptance', 'context': 'No remote publication.',
            'archived': False, 'role_ids': [], 'resources': [{'id': resource, 'remote_url': PUBLIC_REMOTE,
                'remote_preparation': 'after_acceptance', 'default_ref': 'monos-ref-that-does-not-exist', 'default_branch': 'main'}]}
        self.config_command(config, 'create')
        catalog = self.catalog()
        prompt = ('This is the authorized monos unavailable-workspace trial. Use native bash to run this root-owned driver '
            'with a 600000 ms timeout. It admits open_workspace for an unavailable ref and waits for Owner Stop. '
            'Do not retry or substitute a text response.\npython3 /var/lib/monos-probe/probe-tools/workspace_cancel_driver.py '
            '--attempt ' + attempt + ' --resource ' + resource)
        body = {'runner_id': self.runner, 'attempt_id': attempt, 'task_id': task, 'project_id': project, 'create': True, 'prompt': prompt}
        self.save('prepared-' + attempt, {'admission': body, 'catalog': catalog})
        selected = json.loads(self.call(self.compose + ['run', '--rm', '-T', 'tests', 'node', '--experimental-strip-types',
            'infra/probe/workspace-attempt.ts'], json.dumps(body).encode()))
        self.save('started-' + attempt, {'selection': selected})
        deadline = time.monotonic() + 180
        while True:
            before = self.workspace_snapshot(attempt)
            opened = next((row for row in before['operations'] if row['kind'] == 'open_workspace'), None)
            if opened and opened['state'] == 'recovery' and (before['driver'] or {}).get('stage') == 'unavailable_open_admitted':
                break
            if time.monotonic() >= deadline:
                self.save('deadline', {'state': before})
                raise RuntimeError('Unavailable-open observation deadline; inspect retained Attempt')
            time.sleep(1)
        self.require('unavailable-open', {'state': before}, {'ref_failure': opened['result'].get('workspace_unavailable_reason') == 'ref_unavailable',
            'native_live': verified_live_identity(before['ownership'], before['live_identity']),
            'native_request': native_requests_bound(before, task, resource, {'unavailable-open': ('open_workspace', 'recovery')}),
            'driver_identity': before['driver'].get('attempt_id') == attempt and before['driver'].get('resource_id') == resource
                and before['driver'].get('execution_uid') == self.config['execution_uid'],
            'hold_active': before['driver']['hold_expires_at'] > time.time() + 60})
        self.task_control(task, attempt, 'stop_node', 'stop')
        # Recovery on the earlier open is expected until Stop cancels it.
        deadline = time.monotonic() + 90
        while True:
            after = self.workspace_snapshot(attempt)
            if settled_checks(after):
                break
            if time.monotonic() >= deadline:
                self.save('stop-deadline', {'state': after})
                raise RuntimeError('Unavailable open did not settle after Stop')
            time.sleep(1)
        records = self.query("SELECT jsonb_build_object('leases',(SELECT jsonb_agg(to_jsonb(l)) FROM workspace_leases l WHERE task_id='" + task + "'), 'workspaces',(SELECT jsonb_agg(to_jsonb(w)) FROM task_workspaces w WHERE task_id='" + task + "'));")
        receipt = self.recovery(attempt, 'unavailable-open')
        self.require('final', {'state': after, 'records': records, 'receipt': receipt},
            {'exact_unexposed_cancellation': cancellation_checks(before, after, records['leases'], records['workspaces'], receipt)})
        config['archived'] = True
        self.config_command(config, 'archive')
        self.require_idle('final-idle')
        return {'outcome': 'pass', 'task_id': task, 'attempt_id': attempt}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default='/root/monos-boundary-probe-src')
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--password-file', required=True)
    parser.add_argument('prefix')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Run only as root on the authorized test host')
    instance = CancellationProbe(args.source, args.evidence)
    instance.login(args.password_file)
    instance.trial(checked_id(args.prefix))


if __name__ == '__main__':
    main()
