#!/usr/bin/env python3
"""Verify a selected Node exits without a formal result while descendants remain."""
import argparse
import hashlib
import os
import time

from logs_probe import LogsProbe
from probe import checked_id


def trial(probe, attempt):
    attempt = checked_id(attempt)
    catalog = probe.catalog()
    probe.install_driver()
    command = ('python3 /var/lib/monos-probe/probe-tools/driver.py --attempt '
               + attempt + ' --kind node --omit-handoff')
    prompt = ('This is an authorized monos recovery test. Use your native bash tool to execute exactly '
              'the following command with a 600000 ms tool timeout. The driver opens the workspace, '
              'starts detached test descendants, then deliberately exits without complete_node. '
              'Do not invoke complete_node or any other formal lifecycle command yourself. '
              'After the command exits, finish normally.\n' + command)
    probe.save('missing-prepared-' + attempt, {
        'attempt_id': attempt, 'catalog': catalog,
        'driver_sha256': hashlib.sha256((probe.source / 'infra/probe/driver.py').read_bytes()).hexdigest(),
    })
    launch = probe.admin({'action': 'attempt', 'runner_id': probe.runner, 'attempt_id': attempt,
                          'task_id': 'task_' + attempt, 'kind': 'node',
                          'resource_id': 'fixture-repo', 'prompt': prompt})
    probe.save('missing-started-' + attempt, {'attempt_id': attempt, 'dispatch_id': launch['dispatch_id']})
    deadline = time.monotonic() + 240
    while True:
        state = probe.snapshot(attempt)
        if state['attempts'] and state['attempts'][0]['process_released']:
            break
        if time.monotonic() >= deadline:
            raise RuntimeError('Missing-result execution did not physically settle')
        time.sleep(2)
    canonical = probe.query("SELECT jsonb_build_object('state',a.state,'end_reason',a.end_reason,"
                            "'node_state',n.state,'task_state',t.state,'completions',"
                            "(SELECT count(*) FROM node_completions WHERE attempt_id=a.id),'missing_events',"
                            "(SELECT count(*) FROM task_events WHERE attempt_id=a.id AND kind='missing_formal_outcome')) "
                            "FROM attempts a JOIN nodes n ON n.id=a.node_id JOIN tasks t ON t.id=a.task_id "
                            "WHERE a.id='" + attempt + "';")
    row = state['attempts'][0] if len(state['attempts']) == 1 else {}
    physical = state.get('physical', {})
    checks = {
        'selected_dispatch': bool(launch.get('dispatch_id')),
        'driver_exited_without_handoff': (state.get('driver') or {}).get('stage') == 'no_formal_handoff',
        'main_exit_reported': any(event['kind'] == 'exited' for event in state.get('events', [])),
        'no_formal_completion': canonical['completions'] == 0 and not any(
            receipt['command_name'] == 'complete_node' for receipt in state.get('receipts', [])),
        'node_blocked': canonical['state'] == 'FAILED' and canonical['end_reason'] == 'missing_formal_outcome'
                        and canonical['node_state'] == canonical['task_state'] == 'BLOCKED'
                        and canonical['missing_events'] == 1,
        'authority_revoked': row.get('mutation_allowed') is False,
        'physical_stop_verified': row.get('process_absent') is True and row.get('process_released') is True
                                  and physical.get('cgroup_populated') is False
                                  and len(physical.get('descendants', [])) == 2
                                  and all(item['alive'] is False for item in physical['descendants']),
    }
    result = {'outcome': 'pass' if all(checks.values()) else 'fail', 'checks': checks,
              'attempt': canonical, 'state': state}
    probe.save('missing-final-' + attempt, result)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default='/root/monos-boundary-probe-src')
    parser.add_argument('--evidence', required=True)
    parser.add_argument('attempt')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Run only as root on the authorized test host')
    probe = LogsProbe(args.source, args.evidence)
    return 0 if trial(probe, args.attempt)['outcome'] == 'pass' else 2


if __name__ == '__main__':
    raise SystemExit(main())
