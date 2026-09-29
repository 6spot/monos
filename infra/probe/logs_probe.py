#!/usr/bin/env python3
"""Selected Attempt + authenticated Owner cursor acceptance on the authorized host.

Uses the existing native OpenCode driver, zero-price preflight and immutable
admission evidence. Restarts only this checkout's Compose backend, never Runner.
"""
import argparse
import hashlib
import http.cookiejar
import json
import os
import pathlib
import ssl
import time
import urllib.parse
import urllib.request

from probe import Probe, ROOT, checked_id


def append_page(events, page, attempt):
    if page.get('attempt_id') != attempt or page.get('task_id') != 'task_' + attempt:
        raise RuntimeError('Owner page has wrong scope')
    for event in page['events']:
        if event.get('attempt_id') != attempt or event.get('order_sequence') != len(events) + 1:
            raise RuntimeError('Owner history skipped or duplicated an entry')
        events.append(event)
    return page['cursor']


class LogsProbe(Probe):
    def admin(self, data):
        if data['action'] != 'attempt':
            return super().admin(data)
        output = self.call(self.compose + ['run', '--rm', '-T', 'tests', 'node', '--experimental-strip-types', 'infra/probe/selected-attempt.ts'], json.dumps(data).encode())
        return json.loads(output)

    def login(self, password_file):
        path = pathlib.Path(password_file)
        if path.is_symlink() or path.stat().st_uid != 0 or path.stat().st_mode & 0o077:
            raise RuntimeError('Owner password file must be root-private')
        self.endpoint = self.config['endpoint'].rstrip('/')
        if not self.endpoint.startswith('https://'):
            raise RuntimeError('HTTPS Owner endpoint required')
        self.browser = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=self.config['ca_file'])),
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        request = urllib.request.Request(self.endpoint + '/v1/owner/login',
            data=json.dumps({'schema_version': 1, 'password': path.read_text().strip()}).encode(),
            headers={'Content-Type': 'application/json', 'Origin': self.endpoint})
        with self.browser.open(request, timeout=20) as response:
            if json.load(response).get('authenticated') is not True:
                raise RuntimeError('Owner login failed')

    def owner(self, attempt, cursor=None, status=False):
        url = self.endpoint + '/v1/owner/tasks/task_' + attempt + '/attempts/' + attempt
        if not status:
            url += '/logs' + ('?' + urllib.parse.urlencode({'cursor': cursor}) if cursor else '')
        with self.browser.open(url, timeout=20) as response:
            return json.load(response)

    def trial(self, attempt, kind):
        attempt = checked_id(attempt)
        # Preserve hashes before the inherited start can admit any work.
        self.save('log-harness-' + attempt, {'sha256': {name: hashlib.sha256((self.source / 'infra/probe' / name).read_bytes()).hexdigest() for name in ('logs_probe.py', 'selected-attempt.ts')}})
        trial = self.start(attempt, kind, hold=True)
        ready = self.wait(attempt, ready_only=True)
        if ready.get('driver', {}).get('stage') != 'ready_for_handoff':
            self.save('logs-failed-ready-' + attempt, {'outcome': 'fail', 'state': ready})
            raise RuntimeError('Driver did not reach held checkpoint; inspect retained ownership')
        page = self.owner(attempt)
        events = []
        cursor = append_page(events, page, attempt)
        if not events:
            raise RuntimeError('Held execution has no visible logs')
        self.save('logs-before-restart-' + attempt, {'cursor': cursor, 'events': events, 'status': self.owner(attempt, status=True), 'state': ready})
        connection = self.query("SELECT to_json(connection_instance) FROM runners WHERE id='" + self.runner + "';")
        if not connection:
            raise RuntimeError('Runner was not connected before backend restart')
        self.call(self.compose + ['restart', 'server'])
        deadline = time.monotonic() + 45
        while True:
            try:
                resumed = self.owner(attempt, cursor)
                break
            except (OSError, ValueError):
                if time.monotonic() >= deadline:
                    raise
                time.sleep(1)
        cursor = append_page(events, resumed, attempt)
        self.save('logs-resumed-' + attempt, {'cursor': cursor, 'page': resumed})
        while True:
            reconnected = self.query("SELECT to_json(connection_instance) FROM runners WHERE id='" + self.runner + "';")
            if reconnected and reconnected != connection:
                break
            if time.monotonic() >= deadline:
                raise RuntimeError('Runner did not reconnect after backend restart')
            time.sleep(1)
        self.save('logs-runner-reconnected-' + attempt, {'before': connection, 'after': reconnected})
        # The existing driver owns a bounded hold. Release only after the durable
        # reconnect checkpoint; a failure retains all evidence for inspection.
        (ROOT / 'execution' / attempt / 'scratch' / 'probe-release').touch(exist_ok=False)
        state = self.wait(attempt)
        baseline = self.verify(attempt, state)
        deadline = time.monotonic() + 45
        last_latest = -1
        stable_since = time.monotonic()
        while True:
            page = self.owner(attempt, cursor)
            cursor = append_page(events, page, attempt)
            status = self.owner(attempt, status=True)
            if status['latest_sequence'] != last_latest:
                last_latest = status['latest_sequence']
                stable_since = time.monotonic()
            if (not page['has_more'] and page['gap_after'] == 0
                    and len(events) == status['visible_sequence'] == status['latest_sequence']
                    and time.monotonic() - stable_since >= 6):
                break
            if time.monotonic() >= deadline:
                raise RuntimeError('Log delivery did not settle within fixture bound')
            time.sleep(1)
        canonical = self.query("SELECT coalesce(jsonb_agg(body ORDER BY order_sequence),'[]'::jsonb) FROM attempt_log_entries WHERE attempt_id='" + attempt + "';")
        selection = self.query("SELECT jsonb_build_object('selection',selection_context,'queue_digest',queue_digest,'log_mode',launch->>'log_mode') FROM attempts WHERE id='" + attempt + "';")
        # Compare raw texts, not generic field names: formal events may have a
        # legitimate summary but must never contain Runtime output envelopes.
        formal = self.query("SELECT coalesce(jsonb_agg(body),'[]'::jsonb) FROM task_events WHERE task_id='task_" + attempt + "';")
        texts = [event['text'] for event in events if event.get('text')]
        checks = {
            'installed_cli_and_formal_completion': baseline['outcome'] == 'pass',
            'selected_ordered_dispatch': bool(selection['selection'] and selection['queue_digest']) and selection['log_mode'] == 'ordered_v1',
            'resumed_exact_complete_history': bool(events) and events == canonical and page['gap_after'] == 0,
            'raw_output_present': bool(texts),
            'raw_output_absent_from_formal_history': all(text not in json.dumps(formal, ensure_ascii=False) for text in texts if len(text) > 30),
        }
        result = {'outcome': 'pass' if all(checks.values()) else 'fail', 'checks': checks,
                  'trial': trial, 'baseline': baseline, 'events': events, 'cursor': cursor,
                  'selection': selection, 'formal_events': formal, 'status': self.owner(attempt, status=True)}
        self.save('logs-final-' + attempt, result)
        return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default='/root/monos-boundary-probe-src')
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--password-file', required=True)
    parser.add_argument('--kind', choices=('node', 'planner'), required=True)
    parser.add_argument('attempt')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Run only as root on the authorized test host')
    probe = LogsProbe(args.source, args.evidence)
    probe.login(args.password_file)
    return 0 if probe.trial(args.attempt, args.kind)['outcome'] == 'pass' else 2


if __name__ == '__main__':
    raise SystemExit(main())
