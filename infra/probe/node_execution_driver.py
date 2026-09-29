#!/usr/bin/env python3
"""Native Git correction fixture, invoked by the Agent inside its own cgroup.

The Program must reject the deliberately invalid ancestry. Only a later Agent
invocation performs the explicit repair, after Owner-authorized trusted settlement.
No backend writes, service credentials, resets or provider operations are used.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import time

from driver import formal, settled
from workspace_driver import ROOT, capture_tree, fingerprint, git, save, workspace_id


def run(args):
    scratch = ROOT / 'execution' / args.attempt / 'scratch'
    report_path = scratch / 'node-execution-driver.json'
    previous = ROOT / 'execution' / args.prior_attempt / 'scratch'
    prior_path = previous / ('workspace-driver.json' if args.mode == 'break-ancestry' else 'node-execution-driver.json')
    prior = json.loads(prior_path.read_text())
    if prior.get('task_id') != args.task or prior.get('resource_id') != args.resource:
        raise RuntimeError('Prior evidence belongs to another Task/resource')
    report = {'attempt_id': args.attempt, 'task_id': args.task, 'resource_id': args.resource,
        'prior_attempt_id': args.prior_attempt, 'mode': args.mode, 'execution_uid': os.getuid(),
        'stage': 'starting', 'checks': {}, 'prior_evidence_sha256': hashlib.sha256(prior_path.read_bytes()).hexdigest()}
    save(report_path, report, initial=True)
    payload = scratch / 'node-open.json'
    payload.write_text(json.dumps({'resource_id': args.resource}))
    code, result = formal('open_workspace', 'node-open', payload)
    if code or result.get('status') == 'error':
        raise RuntimeError('Workspace admission failed')
    result = settled('node-open', result)
    if result.get('status') != 'committed':
        raise RuntimeError('Workspace did not open')
    value = result['result']
    path = pathlib.Path(value['path'])
    expected = ROOT / 'tasks' / workspace_id(args.task, args.resource) / 'worktree'
    if path != expected or value.get('workspace_id') != workspace_id(args.task, args.resource):
        raise RuntimeError('Unexpected workspace identity')
    report['open'] = result
    checks = report['checks']
    instructions = value.get('instruction_files')
    checks['repository_instructions_read'] = isinstance(instructions, list) and len(instructions) <= 2
    if checks['repository_instructions_read']:
        for name in instructions:
            if name not in ('AGENTS.md', 'CLAUDE.md') or not (path / name).resolve().is_relative_to(path.resolve()):
                raise RuntimeError('Invalid repository instruction path')
            (path / name).read_bytes()
    before = fingerprint(path)
    checks['private_work_preserved'] = before == prior['fingerprint']
    metadata, previous_metadata = value['workspace_metadata'], prior['open']['result']['workspace_metadata']
    checks['same_fixed_lineage'] = all(metadata.get(key) == previous_metadata.get(key)
        for key in ('base_commit', 'finalized_commit', 'storage_id', 'generation', 'repository_identity'))
    checks['new_lease'] = metadata['lease_id'] != previous_metadata['lease_id']
    if not all(checks.values()):
        save(report_path, report)
        raise RuntimeError('Prior private work or lineage changed')
    # commit-tree writes a new object without replacing working files or index.
    # Deliberately create a readable unrelated HEAD; the system must not repair it.
    if args.mode == 'break-ancestry':
        tree = git(path, 'rev-parse', 'HEAD^{tree}').decode().strip()
        broken = git(path, 'commit-tree', tree, '-m', 'Native explicit unrelated history fixture').decode().strip()
        git(path, 'update-ref', 'HEAD', broken, before['head'])
        report['required_ancestor'] = metadata['finalized_commit']
    else:
        # This is an explicit Agent-side merge preserving the current tree, with
        # both existing private history and required finalized history as parents.
        # Trusted settlement alone must never execute this semantic correction.
        required = prior['required_ancestor']
        if required != metadata['finalized_commit']:
            raise RuntimeError('Required correction ancestor changed')
        tree = git(path, 'rev-parse', 'HEAD^{tree}').decode().strip()
        repaired = git(path, 'commit-tree', tree, '-p', before['head'], '-p', required,
            '-m', 'Native Agent correction preserves both histories').decode().strip()
        git(path, 'update-ref', 'HEAD', repaired, before['head'])
        git(path, 'merge-base', '--is-ancestor', required, 'HEAD')
        report['required_ancestor'] = required
    report['fingerprint'] = fingerprint(path)
    checks['index_and_files_unchanged'] = all(report['fingerprint'][key] == before[key] for key in ('index_tree', 'files'))
    report['expected_git_tree'] = capture_tree(path, scratch)
    checks['capture_preserves_private_work'] = fingerprint(path) == report['fingerprint']
    report.update(stage='completion_submitting', submitted_at=time.time())
    save(report_path, report)
    if not all(checks.values()):
        raise RuntimeError('Git correction fixture changed private work')
    complete = scratch / 'node-complete.json'
    complete.write_text(json.dumps({'summary': 'Native same-Node Git ' + args.mode + ' trial.', 'artifact_ids': []}))
    formal('complete_node', 'node-complete', complete)


def main():
    parser = argparse.ArgumentParser()
    for field in ('attempt', 'task', 'resource', 'prior-attempt'):
        parser.add_argument('--' + field, required=True)
    parser.add_argument('--mode', choices=('break-ancestry', 'repair-ancestry'), required=True)
    args = parser.parse_args()
    if os.getuid() == 0:
        raise RuntimeError('Run only inside the native Agent execution account')
    if any(not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value) for value in vars(args).values()):
        raise RuntimeError('Invalid native trial identity')
    run(args)


if __name__ == '__main__':
    main()
