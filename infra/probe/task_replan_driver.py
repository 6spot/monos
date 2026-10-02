#!/usr/bin/env python3
"""Native replacement-work observer; declared IDs are evidence, never authority.

The root-side acceptance must separately bind this report to actual source,
publication, lease descriptor and completion receipts. This driver cannot grant
cross-Node access: only the installed monos command admits workspace effects.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import time

from driver import formal, settled
from task_conversation_driver import checked_id, preserved_checks
from task_specification_driver import declared_guidance
from workspace_driver import ROOT, capture_tree, fingerprint, git, save, workspace_id


def predecessor_report(scratch, task, resource, attempt, mode):
    candidates = [scratch / name for name in ('workspace-driver.json',
        'task-specification-driver.json', 'task-replan-driver.json')
        if (scratch / name).is_file()]
    if len(candidates) != 1:
        raise RuntimeError('Exactly one predecessor report is required')
    raw = candidates[0].read_bytes()
    report = json.loads(raw)
    if any(report.get(k) != v for k, v in
            (('task_id', task), ('resource_id', resource), ('attempt_id', attempt))):
        raise RuntimeError('Predecessor identity differs')
    stage = {'unfinished': 'held_for_stop', 'completed': 'completion_submitting'}.get(mode)
    if stage is None or report.get('stage') != stage or not report.get('checks') \
            or any(v is not True for v in report['checks'].values()):
        raise RuntimeError('Predecessor has no verified matching boundary')
    # completion_submitting proves submission only. Completed mode additionally
    # compares actual finalized Git; the root observer must prove the receipt.
    return report, hashlib.sha256(raw).hexdigest()


def completed_checks(path, prior, opened, task, resource, commit, tree):
    for value in (commit, tree):
        if not isinstance(value, str) or not re.fullmatch(r'(?:[a-f0-9]{40}|[a-f0-9]{64})', value):
            raise ValueError('Exact finalized Git object identity required')
    before = fingerprint(path)
    metadata = opened['workspace_metadata']
    old = prior['open']['result']['workspace_metadata']
    keys = ('base_commit', 'target_branch', 'storage_id', 'generation', 'repository_identity')
    return {
        'same_workspace': opened.get('workspace_id') == workspace_id(task, resource),
        'same_fixed_lineage': all(metadata.get(k) is not None and metadata[k] == old.get(k) for k in keys),
        'new_lease': bool(metadata.get('lease_id')) and metadata['lease_id'] != old.get('lease_id'),
        'finalized_head': before['head'] == metadata.get('finalized_commit') == commit,
        'finalized_tree': git(path, 'rev-parse', commit + '^{tree}').decode().strip() == tree
            and before['index_tree'] == tree,
        'tracked_work_clean': not git(path, 'status', '--porcelain=v1', '--untracked-files=all'),
        'private_files_preserved': before['files'] == prior['fingerprint']['files'],
    }


def run(args):
    scratch = ROOT / 'execution' / args.attempt / 'scratch'
    if pathlib.Path.cwd().resolve() != scratch.resolve():
        raise RuntimeError('Invoke only from the current Attempt scratch')
    prior, digest = predecessor_report(ROOT / 'execution' / args.prior_attempt / 'scratch',
        args.task, args.resource, args.prior_attempt, args.predecessor)
    guidance = declared_guidance(pathlib.Path(args.guidance))
    report_path = scratch / 'task-replan-driver.json'
    report = dict(attempt_id=args.attempt, task_id=args.task, resource_id=args.resource,
        expected_node_id=args.node, expected_plan_id=args.plan,
        expected_specification_id=args.specification, prior_attempt_id=args.prior_attempt,
        predecessor=args.predecessor, prior_evidence_sha256=digest, execution_uid=os.getuid(),
        guidance_ids=guidance, stage='starting', checks={})
    save(report_path, report, initial=True)
    payload = scratch / 'replan-open.json'
    payload.write_text(json.dumps({'resource_id': args.resource}))
    code, admitted = formal('open_workspace', 'replan-open', payload)
    if code or admitted.get('status') == 'error':
        raise RuntimeError('Replacement workspace admission failed')
    result = settled('replan-open', admitted)
    if result.get('status') != 'committed':
        raise RuntimeError('Replacement workspace open did not commit')
    opened = result['result']
    path = pathlib.Path(opened['path'])
    if path != ROOT / 'tasks' / workspace_id(args.task, args.resource) / 'worktree':
        raise RuntimeError('Unexpected canonical workspace path')
    report.update(open=result, workspace_id=opened['workspace_id'], fingerprint=fingerprint(path))
    instructions = opened.get('instruction_files')
    if not isinstance(instructions, list) or len(instructions) > 2:
        raise RuntimeError('Missing bounded repository instructions')
    for name in instructions:
        if name not in ('AGENTS.md', 'CLAUDE.md') or not (path / name).resolve().is_relative_to(path.resolve()):
            raise RuntimeError('Invalid repository instruction path')
        (path / name).read_bytes()
    if args.predecessor == 'unfinished':
        report['checks'] = preserved_checks(report['fingerprint'], prior, opened, args.task, args.resource)
    else:
        report['checks'] = completed_checks(path, prior, opened, args.task, args.resource,
            args.finalized_commit, args.finalized_tree)
    report['checks']['instructions_read'] = True
    report['expected_git_tree'] = capture_tree(path, scratch)
    report['checks']['capture_keeps_private_work'] = fingerprint(path) == report['fingerprint']
    save(report_path, report)
    if not all(report['checks'].values()):
        raise RuntimeError('Replacement changed predecessor Git input')
    body = {'summary': 'Verified explicit historical private-work input under replacement Plan '
        + args.plan + ' and Specification ' + args.specification + '.',
        'artifact_ids': [], 'handled_guidance_ids': guidance}
    payload = scratch / 'replan-complete.json'
    payload.write_text(json.dumps(body))
    report.update(stage='completion_submitting', completion_payload=body, submitted_at=time.time())
    save(report_path, report)
    formal('complete_node', 'replan-complete', payload)


def main():
    parser = argparse.ArgumentParser()
    identities = ('attempt', 'task', 'resource', 'prior-attempt', 'node', 'plan', 'specification')
    for key in (*identities, 'guidance'):
        parser.add_argument('--' + key, required=True)
    parser.add_argument('--predecessor', choices=('unfinished', 'completed'), required=True)
    parser.add_argument('--finalized-commit')
    parser.add_argument('--finalized-tree')
    args = parser.parse_args()
    if os.getuid() == 0:
        raise RuntimeError('Run only inside the native Agent execution account')
    for key in identities:
        checked_id(getattr(args, key.replace('-', '_')))
    if args.attempt == args.prior_attempt:
        raise RuntimeError('A fresh replacement Attempt is required')
    if args.predecessor == 'completed' and not (args.finalized_commit and args.finalized_tree):
        raise ValueError('Completed inheritance needs exact finalized commit and tree')
    run(args)


if __name__ == '__main__':
    main()
