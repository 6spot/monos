#!/usr/bin/env python3
"""Runs only inside the native Node's authenticated execution cgroup.

Records bounded evidence before Owner Stop or complete_node terminates it.
All formal actions use bundled monos. Never reads service credentials.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import subprocess
import time

from driver import formal, settled, spawn_descendants

ROOT = pathlib.Path('/var/lib/monos-probe')
NAMES = ('workspace-private.txt', 'workspace-staged.txt', 'workspace-untracked.txt', 'workspace-ignored.txt')


def workspace_id(task, resource):
    raw = json.dumps([task, resource], separators=(',', ':'), ensure_ascii=False).encode()
    return 'ws_' + hashlib.sha256(raw).hexdigest()


def local_git_environment():
    environment = {key: value for key, value in os.environ.items()
        if not key.startswith('GIT_') and key not in ('GH_TOKEN', 'GITHUB_TOKEN')}
    environment.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null',
        GIT_TERMINAL_PROMPT='0', GIT_ALLOW_PROTOCOL='file')
    return environment


def cache_write_denied(cache, attempt):
    # A unique, absent marker separates filesystem denial from Git trust errors.
    # Preserve an unexpectedly created marker as failed-trial evidence.
    marker = cache / ('monos-write-denial-' + attempt)
    try:
        descriptor = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except PermissionError:
        return not marker.exists()
    else:
        os.close(descriptor)
        return False


def git(path, *args, env=None):
    result = subprocess.run(['/usr/bin/git', '-C', str(path), '-c', 'core.hooksPath=/dev/null',
        '-c', 'user.name=monos workspace probe', '-c', 'user.email=probe@monos.invalid', *args],
        env=local_git_environment() if env is None else env, capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError('Local Git evidence command failed')
    return result.stdout


def cache_push_denied(path, cache, attempt):
    # Local URL rewrites could redirect even a literal file URL elsewhere.
    config = git(path, 'config', '--local', '--list').decode().lower()
    if any(line.startswith('url.') for line in config.splitlines()):
        raise RuntimeError('Refuse push test with local URL rewrites')
    ref = 'refs/heads/monos-negative-' + attempt
    def refs():
        return git(cache, '-c', 'safe.directory=' + str(cache),
            'for-each-ref', '--format=%(refname)', ref).decode().splitlines()
    if refs():
        raise RuntimeError('Negative push ref already exists; preserve prior trial')
    push = subprocess.run(['/usr/bin/git', '-C', str(path), '-c', 'core.hooksPath=/dev/null',
        '-c', 'credential.helper=', '-c', 'protocol.allow=never', '-c', 'protocol.file.allow=always',
        'push', cache.as_uri(), 'HEAD:' + ref], env=local_git_environment(), capture_output=True, timeout=20)
    return push.returncode != 0 and not refs()


def fingerprint(path):
    return {'head': git(path, 'rev-parse', 'HEAD').decode().strip(),
        'index_tree': git(path, 'write-tree').decode().strip(),
        'status_sha256': hashlib.sha256(git(path, 'status', '--porcelain=v1', '-z', '--untracked-files=all')).hexdigest(),
        'files': {name: hashlib.sha256((path / name).read_bytes()).hexdigest() for name in NAMES}}


def capture_tree(path, scratch):
    index = scratch / 'expected-tree.index'
    if index.exists():
        raise RuntimeError('Expected-tree index already exists')
    environment = dict(local_git_environment(), GIT_INDEX_FILE=str(index))
    git(path, 'read-tree', 'HEAD', env=environment)
    git(path, 'add', '-A', env=environment)
    return git(path, 'write-tree', env=environment).decode().strip()


def save(path, report, initial=False):
    target = path if initial else path.with_suffix('.tmp')
    with target.open('x' if initial else 'w') as output:
        json.dump(report, output, sort_keys=True)
        output.write('\n')
        output.flush()
        os.fsync(output.fileno())
    if not initial:
        target.replace(path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def request_replan(scratch, report_path, report, reason):
    payload = scratch / 'workspace-replan.json'
    body = {'reason': reason}
    payload.write_text(json.dumps(body))
    report.update(replan_payload=body, replan_submitted_at=time.time())
    save(report_path, report)
    code, receipt = formal('request_replan', 'workspace-replan', payload)
    if code or receipt.get('status') == 'error':
        raise RuntimeError('Native Replan request failed; inspect retained authority')


def run(args):
    scratch = ROOT / 'execution' / args.attempt / 'scratch'
    replan_reason = getattr(args, 'replan_reason', None)
    if replan_reason is not None:
        if args.prior_attempt or pathlib.Path.cwd().resolve() != scratch.resolve():
            raise RuntimeError('Replan fixture requires a fresh Node in its current scratch')
        with pathlib.Path(replan_reason).open('rb') as source:
            raw = source.read(16385)
        if len(raw) > 16384:
            raise ValueError('Replan reason exceeds fixture budget')
        replan_reason = raw.decode().strip()
        if not replan_reason or '\x00' in replan_reason:
            raise ValueError('Explicit semantic Replan reason required')
    report_path = scratch / 'workspace-driver.json'
    wid = workspace_id(args.task, args.resource)
    expected = ROOT / 'tasks' / wid / 'worktree'
    report = {'attempt_id': args.attempt, 'task_id': args.task, 'resource_id': args.resource,
        'workspace_id': wid, 'execution_uid': os.getuid(), 'stage': 'starting', 'checks': {}}
    save(report_path, report, initial=True)
    checks = report['checks']
    checks['lazy_or_retained'] = (expected / '.git').exists() is bool(args.prior_attempt)
    payload = scratch / 'workspace-open.json'
    payload.write_text(json.dumps({'resource_id': args.resource}))
    code, result = formal('open_workspace', 'workspace-open', payload)
    if code or result.get('status') == 'error':
        raise RuntimeError('Workspace admission failed')
    result = settled('workspace-open', result)
    if result.get('status') != 'committed':
        raise RuntimeError('Workspace open did not commit')
    value = result['result']
    path = pathlib.Path(value['path'])
    if path != expected or value.get('workspace_id') != wid:
        raise RuntimeError('Unexpected canonical workspace identity')
    report['open'] = result
    checks['stable_path'] = True
    instructions = value.get('instruction_files')
    checks['instructions_read'] = isinstance(instructions, list) and len(instructions) <= 2
    if checks['instructions_read']:
        for name in instructions:
            if name not in ('AGENTS.md', 'CLAUDE.md') or not (path / name).resolve().is_relative_to(path.resolve()):
                raise RuntimeError('Invalid instruction path')
            (path / name).read_bytes()
    metadata = value['workspace_metadata']
    checks['real_repository'] = metadata['repository_identity'] == 'github.com/6spot/monolab-feasibility-20260928-160020-public'
    code, duplicate = formal('open_workspace', 'workspace-open-second', payload)
    duplicate = settled('workspace-open-second', duplicate)
    checks['one_operation_for_two_requests'] = code == 0 and duplicate.get('operation_id') == result.get('operation_id') and duplicate.get('result') == value
    report['duplicate'] = duplicate
    cache = ROOT / 'cache/resources' / (args.resource + '.git')
    origin = git(path, 'remote', 'get-url', 'origin').decode().strip()
    checks['uncredentialed_cache_origin'] = origin == str(cache)
    checks['cache_read_only'] = (cache / 'HEAD').is_file() and os.access(cache / 'HEAD', os.R_OK) and not os.access(cache, os.W_OK)
    checks['cache_write_denied'] = cache_write_denied(cache, args.attempt)
    if not checks['uncredentialed_cache_origin']:
        raise RuntimeError('Refuse push test against an unexpected origin')
    # Test only the literal local cache. Restrict transports even if a Runtime's
    # Git configuration supplies pushurl/insteadOf rewrites; disable pre-push
    # hooks and credential helpers. No provider transport is available here.
    checks['cache_push_denied'] = cache_push_denied(path, cache, args.attempt)
    checks['separate_common'] = pathlib.Path(git(path, 'rev-parse', '--git-common-dir').decode().strip()) == expected.parent / 'common'
    # Exact known credentials are tested at provider integration boundaries.
    # This public native trial checks only prohibited credential-bearing names.
    checks['no_service_credentials_in_agent_environment'] = not any(
        name.upper() in ('GH_TOKEN', 'GITHUB_TOKEN', 'MONOS_RUNNER_TOKEN', 'MONOS_SIGNING_KEY')
        or name.startswith('GIT_CONFIG_VALUE_') and ('authorization' in value.lower() or 'bearer ' in value.lower())
        for name, value in os.environ.items())
    config = git(path, 'config', '--local', '--list').decode().lower()
    checks['no_auth_in_git_config'] = 'extraheader' not in config and 'credential.' not in config
    if args.prior_attempt:
        prior = json.loads((ROOT / 'execution' / args.prior_attempt / 'scratch/workspace-driver.json').read_text())
        report['fingerprint'] = fingerprint(path)
        checks['private_dirty_and_index_preserved'] = report['fingerprint'] == prior['fingerprint']
        checks['base_target_pinned'] = all(metadata[key] == prior['open']['result']['workspace_metadata'][key]
            for key in ('base_commit', 'target_branch', 'finalized_commit', 'storage_id', 'generation', 'repository_identity'))
        checks['new_lease_same_workspace'] = metadata['lease_id'] != prior['open']['result']['workspace_metadata']['lease_id'] and value['workspace_id'] == prior['workspace_id']
        report['expected_git_tree'] = capture_tree(path, scratch)
        checks['capture_preserves_index'] = fingerprint(path) == report['fingerprint']
        report['stage'] = 'completion_submitting'
        save(report_path, report)
        if not all(checks.values()):
            raise RuntimeError('Workspace reuse evidence failed')
        complete = scratch / 'workspace-complete.json'
        complete.write_text(json.dumps({'summary': 'Canonical workspace preserved private commit, staged/dirty/untracked/ignored files across Stop and fresh Attempt.'}))
        formal('complete_node', 'workspace-complete', complete)
        return
    for name in NAMES:
        if (path / name).exists():
            raise RuntimeError('Probe marker conflicts with repository contents')
    (path / NAMES[0]).write_text('private native commit\n')
    git(path, 'add', '--', NAMES[0])
    git(path, 'commit', '-m', 'Private workspace acceptance commit')
    (path / NAMES[0]).write_text('private native commit plus dirty working tree\n')
    (path / NAMES[1]).write_text('staged native data\n')
    git(path, 'add', '--', NAMES[1])
    (path / NAMES[1]).write_text('staged native data plus unstaged edit\n')
    (path / NAMES[2]).write_text('nonignored untracked data\n')
    common = expected.parent / 'common'
    with (common / 'info/exclude').open('a') as output:
        output.write('\n/' + NAMES[3] + '\n')
    (path / NAMES[3]).write_text('ignored private file retained only locally\n')
    report['fingerprint'] = fingerprint(path)
    report['expected_checkpoint_tree'] = capture_tree(path, scratch)
    checks['capture_preserves_index'] = fingerprint(path) == report['fingerprint']
    spawn_descendants(scratch)
    report.update(stage='held_for_stop', hold_expires_at=time.time() + 300)
    save(report_path, report)
    if not all(checks.values()):
        raise RuntimeError('Workspace first-open evidence failed')
    if replan_reason is not None:
        # A bounded fixture observation window lets the root harness record live
        # descendants before the native terminal handoff stops the whole tree.
        report['replan_handoff_after'] = time.time() + 10
        save(report_path, report)
        time.sleep(10)
        request_replan(scratch, report_path, report, replan_reason)
        return
    # Owner Stop should end the cgroup. Expiry is a fixture failure, not a
    # product Runtime silence decision, and never issues completion itself.
    time.sleep(300)
    raise RuntimeError('Workspace trial hold expired; inspect physical ownership')


def main():
    parser = argparse.ArgumentParser()
    for key in ('attempt', 'task', 'resource'):
        parser.add_argument('--' + key, required=True)
    parser.add_argument('--prior-attempt')
    parser.add_argument('--replan-reason', help='File containing the Agent semantic insufficiency reason')
    args = parser.parse_args()
    if os.getuid() == 0:
        raise RuntimeError('Run through the native execution account, never root')
    if any(not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value) for value in
            (args.attempt, args.task, args.resource, args.prior_attempt) if value is not None):
        raise RuntimeError('Invalid trial identity')
    run(args)


if __name__ == '__main__':
    main()
