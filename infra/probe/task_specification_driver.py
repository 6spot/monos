#!/usr/bin/env python3
"""Agent-invoked private-work verification after exact requirement publication.

The declared revision is evidence to compare against the backend's immutable
source, never an authority hint. All effects use the installed monos CLI.
Only an unfinished, physically stopped predecessor is supported by this fixture.
"""
import argparse
import hashlib
import json
import os
import pathlib
import time

from driver import formal, settled, spawn_descendants
from task_conversation_driver import checked_id, preserved_checks
from workspace_driver import ROOT, capture_tree, fingerprint, save, workspace_id


def prior_report(scratch, task, resource, attempt):
    paths = [scratch / name for name in ('workspace-driver.json', 'task-specification-driver.json')
        if (scratch / name).is_file()]
    if len(paths) != 1:
        raise RuntimeError('Exactly one unfinished predecessor report is required')
    raw = paths[0].read_bytes()
    value = json.loads(raw)
    if any(value.get(key) != expected for key, expected in
            (('task_id', task), ('resource_id', resource), ('attempt_id', attempt))):
        raise RuntimeError('Predecessor Task/resource/Attempt differs')
    if value.get('stage') != 'held_for_stop' or not value.get('checks') \
            or any(result is not True for result in value['checks'].values()):
        raise RuntimeError('Predecessor is not a verified unfinished Stop boundary')
    return value, hashlib.sha256(raw).hexdigest()


def declared_guidance(path):
    with path.open('rb') as source:
        raw = source.read(65537)
    if len(raw) > 65536:
        raise ValueError('Guidance declaration exceeds fixture budget')
    values = json.loads(raw)
    if not isinstance(values, list) or len(values) > 256:
        raise ValueError('Explicit guidance ID array required')
    values = [checked_id(value) for value in values]
    if len(values) != len(set(values)):
        raise ValueError('Duplicate guidance ID')
    return values


def completion_payload(revision, declared):
    checked_id(revision)
    return {'summary': 'Verified preserved private work and fixed lineage under Specification ' + revision + '.',
        'artifact_ids': [], 'handled_guidance_ids': declared}


def run(args):
    scratch = ROOT / 'execution' / args.attempt / 'scratch'
    if pathlib.Path.cwd().resolve() != scratch.resolve():
        raise RuntimeError('Invoke only from the current Attempt scratch directory')
    prior, digest = prior_report(ROOT / 'execution' / args.prior_attempt / 'scratch',
        args.task, args.resource, args.prior_attempt)
    declared = declared_guidance(pathlib.Path(args.guidance))
    report_path = scratch / 'task-specification-driver.json'
    report = {'attempt_id': args.attempt, 'task_id': args.task, 'resource_id': args.resource,
        'expected_specification_id': args.specification, 'prior_attempt_id': args.prior_attempt,
        'prior_evidence_sha256': digest, 'mode': args.mode, 'execution_uid': os.getuid(),
        'guidance_ids': declared, 'stage': 'starting', 'checks': {}}
    save(report_path, report, initial=True)
    payload = scratch / 'specification-open.json'
    payload.write_text(json.dumps({'resource_id': args.resource}))
    code, admitted = formal('open_workspace', 'specification-open', payload)
    if code or admitted.get('status') == 'error':
        raise RuntimeError('Workspace admission failed')
    result = settled('specification-open', admitted)
    if result.get('status') != 'committed':
        raise RuntimeError('Workspace open did not commit')
    opened = result['result']
    path = pathlib.Path(opened['path'])
    if path != ROOT / 'tasks' / workspace_id(args.task, args.resource) / 'worktree':
        raise RuntimeError('Unexpected canonical workspace path')
    report.update(open=result, workspace_id=opened['workspace_id'])
    instructions = opened.get('instruction_files')
    if not isinstance(instructions, list) or len(instructions) > 2:
        raise RuntimeError('Missing bounded repository instructions')
    for name in instructions:
        if name not in ('AGENTS.md', 'CLAUDE.md') or not (path / name).resolve().is_relative_to(path.resolve()):
            raise RuntimeError('Invalid repository instruction path')
        (path / name).read_bytes()
    report['fingerprint'] = fingerprint(path)
    report['checks'] = preserved_checks(report['fingerprint'], prior, opened, args.task, args.resource)
    report['checks']['instructions_read'] = True
    report['expected_checkpoint_tree'] = capture_tree(path, scratch)
    report['checks']['capture_keeps_private_work'] = fingerprint(path) == report['fingerprint']
    save(report_path, report)
    if not all(report['checks'].values()):
        raise RuntimeError('Requirement continuation changed retained private work')
    if args.mode == 'hold':
        spawn_descendants(scratch)
        report.update(stage='held_for_stop', hold_expires_at=time.time() + 300)
        save(report_path, report)
        time.sleep(300)
        raise RuntimeError('Fixture hold expired; inspect existing authority')
    payload = scratch / 'specification-complete.json'
    body = completion_payload(args.specification, declared)
    payload.write_text(json.dumps(body))
    report.update(stage='completion_submitting', completion_payload=body, submitted_at=time.time())
    save(report_path, report)
    formal('complete_node', 'specification-complete', payload)


def main():
    parser = argparse.ArgumentParser()
    for name in ('attempt', 'task', 'resource', 'prior-attempt', 'specification', 'guidance'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--mode', choices=('hold', 'complete'), required=True)
    args = parser.parse_args()
    if os.getuid() == 0:
        raise RuntimeError('Run only inside the native Agent execution account')
    for name in ('attempt', 'task', 'resource', 'prior_attempt', 'specification'):
        checked_id(getattr(args, name))
    if args.attempt == args.prior_attempt:
        raise RuntimeError('A fresh Attempt is required')
    run(args)


if __name__ == '__main__':
    main()
