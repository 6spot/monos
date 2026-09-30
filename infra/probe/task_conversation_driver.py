#!/usr/bin/env python3
"""Native guidance continuation fixture invoked inside the Agent's own cgroup.

Only the installed monos CLI admits effects. This fixture checks retained private
work and records exact guidance declarations before completion can stop its tree.
It never reads backend credentials or decides which guidance the program assigns.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import time

from driver import formal, settled, spawn_descendants
from workspace_driver import ROOT, capture_tree, fingerprint, save, workspace_id


def checked_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value):
        raise ValueError('Invalid native trial identity')
    return value


def guidance_ids(path):
    """Read the Agent's explicit declaration, never infer all IDs as handled."""
    with path.open('rb') as source:
        raw = source.read(65537)
    if len(raw) > 65536:
        raise ValueError('Guidance declaration exceeds fixture budget')
    values = json.loads(raw)
    if not isinstance(values, list) or not values or len(values) > 256:
        raise ValueError('Expected nonempty explicit guidance ID list')
    values = [checked_id(value) for value in values]
    if len(set(values)) != len(values):
        raise ValueError('Duplicate guidance declaration')
    return values


def prior_report(scratch, task, resource, attempt):
    candidates = [scratch / name for name in
        ('task-conversation-driver.json', 'workspace-driver.json')]
    existing = [path for path in candidates if path.is_file()]
    if len(existing) != 1:
        raise RuntimeError('Exactly one prior native report is required')
    path = existing[0]
    raw = path.read_bytes()
    value = json.loads(raw)
    if value.get('task_id') != task or value.get('resource_id') != resource or value.get('attempt_id') != attempt:
        raise RuntimeError('Prior report belongs to another Task/resource/Attempt')
    if not value.get('checks') or not all(value['checks'].values()):
        raise RuntimeError('Prior native report did not pass its checks')
    if value.get('stage') != 'held_for_stop':
        raise RuntimeError('Prior report is not an unfinished Stop boundary')
    return value, hashlib.sha256(raw).hexdigest()


def preserved_checks(before, prior, opened, task, resource):
    metadata = opened['workspace_metadata']
    old = prior['open']['result']['workspace_metadata']
    return {
        'same_private_head_index_files': before == prior['fingerprint'],
        'same_workspace': opened.get('workspace_id') == workspace_id(task, resource),
        'same_fixed_lineage': all(metadata.get(key) == old.get(key)
            for key in ('base_commit', 'target_branch', 'finalized_commit',
                'storage_id', 'generation', 'repository_identity')),
        'new_lease': bool(metadata.get('lease_id')) and metadata['lease_id'] != old.get('lease_id'),
    }


def run(args):
    scratch = ROOT / 'execution' / args.attempt / 'scratch'
    # An explicit Task ID cannot redirect evidence to some other current process.
    if pathlib.Path.cwd().resolve() != scratch.resolve():
        raise RuntimeError('Invoke from this Attempt scratch directory')
    declared = guidance_ids(pathlib.Path(args.guidance))
    prior, prior_hash = prior_report(ROOT / 'execution' / args.prior_attempt / 'scratch',
        args.task, args.resource, args.prior_attempt)
    report_path = scratch / 'task-conversation-driver.json'
    report = {'attempt_id': args.attempt, 'task_id': args.task,
        'resource_id': args.resource, 'prior_attempt_id': args.prior_attempt,
        'prior_evidence_sha256': prior_hash, 'mode': args.mode,
        'execution_uid': os.getuid(), 'guidance_ids': declared,
        'stage': 'starting', 'checks': {}}
    save(report_path, report, initial=True)
    payload = scratch / 'conversation-open.json'
    payload.write_text(json.dumps({'resource_id': args.resource}))
    code, result = formal('open_workspace', 'conversation-open', payload)
    if code or result.get('status') == 'error':
        raise RuntimeError('Workspace admission failed')
    result = settled('conversation-open', result)
    if result.get('status') != 'committed':
        raise RuntimeError('Workspace open did not commit')
    opened = result['result']
    path = pathlib.Path(opened['path'])
    if path != ROOT / 'tasks' / workspace_id(args.task, args.resource) / 'worktree':
        raise RuntimeError('Unexpected canonical workspace path')
    report['open'] = result
    instructions = opened.get('instruction_files')
    if not isinstance(instructions, list) or len(instructions) > 2:
        raise RuntimeError('Missing bounded repository instruction list')
    for name in instructions:
        if name not in ('AGENTS.md', 'CLAUDE.md') or not (path / name).resolve().is_relative_to(path.resolve()):
            raise RuntimeError('Invalid repository instruction path')
        (path / name).read_bytes()
    report['fingerprint'] = fingerprint(path)
    report['checks'] = preserved_checks(report['fingerprint'], prior, opened, args.task, args.resource)
    report['checks']['instructions_read'] = True
    report['expected_git_tree'] = capture_tree(path, scratch)
    report['checks']['capture_keeps_index_and_files'] = fingerprint(path) == report['fingerprint']
    save(report_path, report)
    if not all(report['checks'].values()):
        raise RuntimeError('Guidance continuation changed retained private work')
    if args.mode == 'hold':
        spawn_descendants(scratch)
        report.update(stage='held_for_stop', hold_expires_at=time.time() + 300)
        save(report_path, report)
        time.sleep(300)
        raise RuntimeError('Native guidance hold expired; inspect existing authority')
    complete = scratch / 'conversation-complete.json'
    body = {'summary': 'Verified exact private work after controlled Task guidance and Owner Stop/Continue.',
        'artifact_ids': [], 'handled_guidance_ids': declared}
    complete.write_text(json.dumps(body))
    report.update(stage='completion_submitting', completion_payload=body, submitted_at=time.time())
    save(report_path, report)
    formal('complete_node', 'conversation-complete', complete)


def main():
    parser = argparse.ArgumentParser()
    for field in ('attempt', 'task', 'resource', 'prior-attempt', 'guidance'):
        parser.add_argument('--' + field, required=True)
    parser.add_argument('--mode', choices=('hold', 'complete'), required=True)
    args = parser.parse_args()
    if os.getuid() == 0:
        raise RuntimeError('Run only inside the native Agent execution account')
    for name in ('attempt', 'task', 'resource', 'prior_attempt'):
        checked_id(getattr(args, name))
    if args.attempt == args.prior_attempt:
        raise RuntimeError('Continuation requires a distinct Attempt')
    run(args)


if __name__ == '__main__':
    main()
