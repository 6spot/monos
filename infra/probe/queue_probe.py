#!/usr/bin/env python3
"""Selected two-slot queue acceptance using the existing authorized host services.

Snapshots are observations, not a second scheduler or permission to relaunch.
Polling bounds never classify a product Runtime as hung.
"""
import argparse
import hashlib
import json
import os
import time

from logs_probe import append_page
from probe import MODEL, ROOT, checked_id, retained_live_identity, verified_live_identity
from stop_probe import StopProbe


def rows_by_id(canonical):
    rows = canonical['attempts']
    result = {row['attempt_id']: row for row in rows}
    if len(result) != len(rows):
        raise RuntimeError('Duplicate Attempt in canonical inventory')
    return result


def selection(row):
    return {key: row.get(key) for key in
            ('attempt_id', 'dispatch_id', 'kind', 'queue_digest', 'selection_context', 'log_mode')}


def held_checks(state, row, execution_uid, now=None):
    driver = state.get('driver') or {}
    physical = state.get('physical', {})
    descendants = physical.get('descendants', [])
    identity = state.get('live_identity', {})
    return {
        'held_native_driver': driver.get('attempt_id') == row['attempt_id']
        and driver.get('kind') == row['kind'] and driver.get('stage') == 'ready_for_handoff'
        and (driver.get('hold_expires_at') or 0) > (time.time() if now is None else now) + 45,
        'live_identity': verified_live_identity(state.get('ownership', {}), identity)
        and state['ownership'].get('dispatch_id') == row['dispatch_id']
        and identity.get('uid') == execution_uid,
        'physical_reservation': row['state'] == 'RUNNING' and row['started'] is True
        and row['mutation_allowed'] is True and row['process_released'] is False
        and row['process_absent'] is False and physical.get('cgroup_populated') is True,
        'native_descendants': row['kind'] == 'planner' or len(descendants) == 2
        and all(item.get('alive') is True for item in descendants),
        'one_start': len(row['starts']) == 1,
    }


def queue_checks(checkpoint, attempts, execution_uid):
    node, planner, queued = attempts
    canonical = checkpoint['canonical']
    rows = rows_by_id(canonical)
    if set(rows) != set(attempts):
        return {'exact_trial_inventory': False}
    checks = {}
    for attempt in (node, planner):
        checks.update({attempt + ':' + key: value for key, value in held_checks(
            checkpoint['states'][attempt], rows[attempt], execution_uid).items()})
    identities = [checkpoint['states'][attempt]['live_identity'] for attempt in (node, planner)]
    checks['distinct_physical_executions'] = (identities[0].get('pid') != identities[1].get('pid')
                                             and identities[0].get('cgroup') != identities[1].get('cgroup'))
    checks['two_shared_slots'] = canonical['runner']['capacity'] == 2 and sum(
        row['process_released'] is False for row in rows.values()) == 2
    checks['selected_ordered_attempts'] = all(
        row['selection_context'] and row['queue_digest'] and row['log_mode'] == 'ordered_v1'
        and row['selection_context'].get('target') == {
            'runner_id': canonical['runner']['runner_id'], 'runtime_id': 'opencode', 'model_id': MODEL}
        for row in rows.values())
    row = rows[queued]
    state = checkpoint['states'][queued]
    status = checkpoint['owner_status']
    listing = checkpoint['owner_list']
    page = checkpoint['logs'][queued]['page']
    checks['queued_without_start_or_claim'] = (row['state'] == 'QUEUED' and row['started'] is False
        and row['process_released'] is True and row['mutation_allowed'] is False and not row['starts']
        and not state['ownership'] and state['live_identity'].get('present') is False
        and not state['events'] and not state['driver'])
    checks['owner_queue_visible'] = (status.get('attempt_id') == queued
        and status.get('task_id') == 'task_' + queued and status.get('state') == 'QUEUED'
        and status.get('started') is False and status.get('process_released') is True
        and status.get('mutation_allowed') is False and status.get('visible_sequence') == 0
        and status.get('latest_sequence') == 0 and 'activity_at' not in status
        and listing.get('task_id') == 'task_' + queued and listing.get('attempts') == [status]
        and listing.get('has_more') is False)
    checks['queued_logs_empty'] = not page['events'] and page['gap_after'] == 0 and page['has_more'] is False
    checks['held_logs_visible'] = all(checkpoint['logs'][attempt]['events'] for attempt in (node, planner))
    return checks


def restart_checks(before, after, attempts):
    old = rows_by_id(before['canonical'])
    new = rows_by_id(after['canonical'])
    return {
        'new_ready_connection': after['canonical']['runner']['ready'] is True
        and after['canonical']['runner']['connected'] is True
        and after['canonical']['runner']['incarnation'] != before['canonical']['runner']['incarnation'],
        'unchanged_selection_and_start_ids': set(old) == set(new) == set(attempts)
        and all(selection(old[a]) == selection(new[a])
                and [s['id'] for s in old[a]['starts']] == [s['id'] for s in new[a]['starts']]
                for a in attempts),
        'same_live_processes': all(retained_live_identity(before['states'][a], after['states'][a])
                                   for a in attempts[:2]),
    }


def promotion_checks(canonical, attempts, original):
    """Use one DB statement: separate reads could combine incompatible instants."""
    node, planner, queued = attempts
    rows = rows_by_id(canonical)
    if set(rows) != set(attempts):
        return {'exact_trial_inventory': False}
    promoted = bool(rows[queued]['starts']) or rows[queued]['state'] != 'QUEUED'
    return {
        'capacity_never_exceeded_in_sample': canonical['runner']['capacity'] == 2
        and sum(row['process_released'] is False for row in rows.values()) <= 2,
        'promotion_after_release_in_sample': not promoted or rows[node]['process_released'] is True
        and rows[node]['process_absent'] is True and rows[node]['mutation_allowed'] is False,
        'other_slot_still_held': rows[planner]['process_released'] is False and rows[planner]['state'] == 'RUNNING',
        'immutable_selection': all(selection(rows[a]) == selection(original[a]) for a in attempts),
        'single_start': all(len(rows[a]['starts']) == 1 for a in attempts[:2])
        and len(rows[queued]['starts']) == (1 if promoted else 0),
        'held_start_ids_unchanged': all([s['id'] for s in rows[a]['starts']]
            == [s['id'] for s in original[a]['starts']] for a in attempts[:2]),
        'queued_or_running': rows[queued]['state'] in ('QUEUED', 'RUNNING'),
    }


class QueueProbe(StopProbe):
    def inventory(self, attempts):
        ids = ','.join("'" + checked_id(a) + "'" for a in attempts)
        # Include unrelated queued/reserved work so a concurrent external trial
        # cannot silently invalidate the shared-capacity experiment.
        return self.query("SELECT jsonb_build_object('runner',(SELECT jsonb_build_object("
            "'runner_id',id,'capacity',capacity,'connected',connected,'ready',ready,'connection_instance',connection_instance,"
            "'incarnation',incarnation) FROM runners WHERE id='" + self.runner + "'),"
            "'attempts',(SELECT coalesce(jsonb_agg(jsonb_build_object('attempt_id',a.id,'dispatch_id',a.dispatch_id,"
            "'kind',a.kind,'state',a.state,'started',a.started,'process_absent',a.process_absent,"
            "'process_released',a.process_released,'mutation_allowed',a.mutation_allowed,"
            "'queue_digest',a.queue_digest,'selection_context',a.selection_context,'log_mode',a.launch->>'log_mode',"
            "'starts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'done',o.done) ORDER BY o.id),'[]'::jsonb) "
            "FROM outbox o WHERE o.attempt_id=a.id AND o.kind='start')) ORDER BY a.id),'[]'::jsonb) "
            "FROM attempts a WHERE a.id IN (" + ids + ") OR (a.runner_id='" + self.runner + "' "
            "AND (NOT a.process_released OR a.state='QUEUED'))),"
            "'unresolved_operations',(SELECT coalesce(jsonb_agg(o.id ORDER BY o.id),'[]'::jsonb) "
            "FROM operations o JOIN attempts a ON a.id=o.attempt_id WHERE a.runner_id='" + self.runner + "' "
            "AND o.state NOT IN ('succeeded','cancelled')));")

    def log_page(self, attempt, retained=None):
        events = list(retained['events']) if retained else []
        page = self.owner(attempt, retained['cursor'] if retained else None)
        return {'events': events, 'cursor': append_page(events, page, attempt), 'page': page}

    def checkpoint(self, attempts, retained=None):
        return {'observed_at': time.time(), 'canonical': self.inventory(attempts),
                'states': {a: self.snapshot(a) for a in attempts},
                'owner_status': self.owner(attempts[2], status=True),
                'owner_list': self.read('/v1/owner/tasks/task_' + attempts[2] + '/attempts'),
                'logs': {a: self.log_page(a, retained['logs'][a] if retained else None) for a in attempts}}

    def require(self, name, value, checks):
        value['checks'] = checks
        value['outcome'] = 'pass' if checks and all(checks.values()) else 'fail'
        self.save(name, value)
        if value['outcome'] != 'pass':
            raise RuntimeError('Queue trial evidence failed: ' + name)

    def release(self, prefix, attempt, state, row):
        # Check again immediately before normal formal completion, rather than
        # trusting a checkpoint that may have expired during a service restart.
        self.require('queue-release-' + prefix + '-' + attempt, {'state': state},
                     held_checks(state, row, self.config['execution_uid']))
        (ROOT / 'execution' / attempt / 'scratch' / 'probe-release').touch(exist_ok=False)

    def drain_logs(self, attempt, retained, dispatch_id):
        deadline = time.monotonic() + 45
        last_latest, stable_since = -1, time.monotonic()
        while True:
            retained = self.log_page(attempt, retained)
            status = self.owner(attempt, status=True)
            if status['latest_sequence'] != last_latest:
                last_latest, stable_since = status['latest_sequence'], time.monotonic()
            page = retained['page']
            if (not page['has_more'] and page['gap_after'] == 0
                    and len(retained['events']) == status['visible_sequence'] == status['latest_sequence']
                    and time.monotonic() - stable_since >= 6):
                break
            if time.monotonic() >= deadline:
                raise RuntimeError('Log delivery exceeded fixture observation bound')
            time.sleep(1)
        canonical = self.query("SELECT coalesce(jsonb_agg(body ORDER BY order_sequence),'[]'::jsonb) "
                               "FROM attempt_log_entries WHERE attempt_id='" + attempt + "';")
        events = retained['events']
        checks = {'exact_resumed_history': bool(events) and events == canonical,
                  'original_dispatch_observed': any(e['kind'] == 'started' for e in events)
                  and all(e['dispatch_id'] == dispatch_id for e in events),
                  'raw_output': any(e['kind'] == 'output' and e.get('text') for e in events),
                  'released_success': status['state'] == 'SUCCEEDED' and status['process_released'] is True
                  and status['process_absent'] is True and status['mutation_allowed'] is False}
        result = {'logs': retained, 'status': status}
        self.require('queue-logs-' + attempt, result, checks)
        return result

    def cleanup(self, prefix, attempted):
        """Revoke only this run's known admissions; never infer absence on error."""
        result = {}
        # Cancel the last queued selection before making any occupied slot free.
        for attempt in reversed(attempted):
            try:
                before = self.snapshot(attempt)
                self.save('queue-cleanup-before-' + attempt, {'state': before})
                if not before['attempts']:
                    result[attempt] = {'outcome': 'unknown', 'reason': 'Admission not observed; inspect prepared intent'}
                    break
                row = before['attempts'][0]
                status = self.owner(attempt, status=True)
                if status['state'] == 'QUEUED' or row['mutation_allowed']:
                    overview = self.overview(attempt)
                    payload = {'attempt_id': attempt}
                    if row['kind'] == 'node':
                        payload.update(node_id='node_task_' + attempt, node_activation=1)
                    receipt = self.command(attempt, 'stop_node' if row['kind'] == 'node' else 'stop_initial_planning',
                                           overview['control_version'], payload, 'queue-trial-cleanup')
                    self.save('queue-cleanup-receipt-' + attempt, {'receipt': receipt})
                after = self.wait_released(attempt)
                status = self.owner(attempt, status=True)
                self.save('queue-cleanup-after-' + attempt, {'state': after})
                row = after['attempts'][0]
                result[attempt] = {'outcome': 'released' if status['state'] != 'QUEUED'
                                   and row['process_released'] and row['process_absent'] and not row['mutation_allowed']
                                   and (not row['started'] or after['physical']['cgroup_populated'] is False
                                        and all(not d['alive'] for d in after['physical']['descendants'])) else 'unknown'}
                if result[attempt]['outcome'] != 'released':
                    break
            except Exception as error:
                # Exception text may include external credential-bearing data.
                result[attempt] = {'outcome': 'unknown', 'error_type': type(error).__name__}
                # If cancelling the queued selection is uncertain, releasing a
                # predecessor could launch it. Leave further ownership intact.
                break
        self.save('queue-cleanup-' + prefix, {'attempts': result})
        return result

    def trial(self, prefix):
        prefix = checked_id(prefix)
        attempts = [checked_id(prefix + suffix) for suffix in ('-node', '-planner', '-queued')]
        # Refuse reuse before any admission or service mutation, including a
        # previous failed run with no remaining physical claim.
        self.save('queue-harness-' + prefix, {'attempts': attempts, 'sha256': {
            name: hashlib.sha256((self.source / 'infra/probe' / name).read_bytes()).hexdigest()
            for name in ('queue_probe.py', 'probe.py', 'logs_probe.py', 'stop_probe.py', 'driver.py', 'selected-attempt.ts')}})
        preflight = self.inventory(attempts)
        self.require('queue-preflight-' + prefix, {'canonical': preflight}, {
            'idle_runner': not preflight['attempts'] and not preflight['unresolved_operations'],
            'ready_two_slot_runner': preflight['runner'] is not None and preflight['runner']['capacity'] == 2
            and preflight['runner']['connected'] is True and preflight['runner']['ready'] is True})
        attempted, trials = [], []
        try:
            for attempt, kind in zip(attempts, ('node', 'planner', 'planner')):
                attempted.append(attempt)  # A lost admission reply is still this run's intent.
                trials.append(self.start(attempt, kind, hold=True, pre_plan=kind == 'planner'))
                if attempt != attempts[2]:
                    state = self.wait(attempt, ready_only=True)
                    row = rows_by_id(self.inventory(attempts))[attempt]
                    self.require('queue-held-' + attempt, {'state': state},
                                 held_checks(state, row, self.config['execution_uid']))
            before = self.checkpoint(attempts)
            self.require('queue-before-restart-' + prefix, before,
                         queue_checks(before, attempts, self.config['execution_uid']))
            self.call(['systemctl', 'restart', 'monos-probe-runner.service'])
            self.call(self.compose + ['restart', 'server'])
            deadline = time.monotonic() + 60
            while True:
                canonical = self.inventory(attempts)
                runner = canonical['runner']
                if runner['ready'] and runner['connected'] and runner['incarnation'] != before['canonical']['runner']['incarnation']:
                    break
                if time.monotonic() >= deadline:
                    raise RuntimeError('Ready reconnect exceeded fixture observation bound')
                time.sleep(1)
            after = self.checkpoint(attempts, before)
            checks = queue_checks(after, attempts, self.config['execution_uid'])
            checks.update(restart_checks(before, after, attempts))
            self.require('queue-after-restart-' + prefix, after, checks)
            original = rows_by_id(after['canonical'])
            self.release(prefix, attempts[0], self.snapshot(attempts[0]), original[attempts[0]])
            deadline, sample = time.monotonic() + 90, 0
            while True:
                canonical = self.inventory(attempts)
                self.require('queue-promotion-' + prefix + '-' + str(sample),
                             {'observed_at': time.time(), 'canonical': canonical},
                             promotion_checks(canonical, attempts, original))
                sample += 1
                if rows_by_id(canonical)[attempts[2]]['started']:
                    break
                if time.monotonic() >= deadline:
                    raise RuntimeError('Promotion exceeded fixture observation bound')
                time.sleep(1)
            promoted_starts = {a: [s['id'] for s in row['starts']] for a, row in rows_by_id(canonical).items()}
            node_state = self.snapshot(attempts[0])
            node_result = self.verify(attempts[0], node_state)
            self.require('queue-predecessor-' + prefix, node_result, node_result['checks'])
            queued_state = self.wait(attempts[2], ready_only=True)
            current = rows_by_id(self.inventory(attempts))
            for attempt in attempts[1:]:
                state = queued_state if attempt == attempts[2] else self.snapshot(attempt)
                self.release(prefix, attempt, state, current[attempt])
            outcomes = {attempts[0]: node_result}
            for attempt in attempts[1:]:
                outcomes[attempt] = self.verify(attempt, self.wait(attempt))
                self.require('queue-completed-' + attempt, outcomes[attempt], outcomes[attempt]['checks'])
            logs = {a: self.drain_logs(a, after['logs'][a], original[a]['dispatch_id']) for a in attempts}
            final = self.inventory(attempts)
            rows = rows_by_id(final)
            checks = {
                'all_formal_outcomes': all(r['outcome'] == 'pass' for r in outcomes.values()),
                'all_ordered_logs': all(r['outcome'] == 'pass' for r in logs.values()),
                'all_released_no_effects': set(rows) == set(attempts) and not final['unresolved_operations']
                and all(r['process_released'] and r['process_absent'] and not r['mutation_allowed'] for r in rows.values()),
                'one_start_per_selection': all(selection(rows[a]) == selection(original[a])
                    and len(rows[a]['starts']) == 1 and rows[a]['starts'][0]['done'] is True
                    and [s['id'] for s in rows[a]['starts']] == promoted_starts[a] for a in attempts),
            }
            result = {'trials': trials, 'canonical': final, 'outcomes': outcomes, 'logs': logs,
                      'promotion_samples': sample,
                      'limit': 'Atomic capacity samples and physical snapshots do not observe every instant. '
                      'Concurrent promotion guards are separately covered by PostgreSQL race tests; no host reboot in this trial.'}
            self.require('queue-final-' + prefix, result, checks)
            return result
        except Exception as error:
            self.save('queue-failure-' + prefix, {'outcome': 'fail', 'error_type': type(error).__name__,
                      'attempted': attempted, 'acknowledged': trials})
            cleanup = self.cleanup(prefix, attempted)
            return {'outcome': 'fail', 'cleanup': cleanup}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default='/root/monos-boundary-probe-src')
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--password-file', required=True)
    parser.add_argument('prefix')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Run only as root on the authorized test host')
    probe = QueueProbe(args.source, args.evidence)
    probe.login(args.password_file)
    return 0 if probe.trial(args.prefix)['outcome'] == 'pass' else 2


if __name__ == '__main__':
    raise SystemExit(main())
