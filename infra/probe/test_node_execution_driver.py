import argparse
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

import node_execution_driver as driver
from workspace_driver import NAMES, fingerprint, git, workspace_id


class NativeCorrectionDriverTests(unittest.TestCase):
    def test_real_git_break_and_explicit_repair_preserve_index_and_private_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            path = root / 'tasks' / workspace_id('task', 'resource') / 'worktree'
            path.mkdir(parents=True)
            git(path, 'init', '--quiet')
            (path / 'base.txt').write_text('fixed base\n')
            git(path, 'add', '.')
            git(path, 'commit', '--quiet', '-m', 'Fixed base')
            base = git(path, 'rev-parse', 'HEAD').decode().strip()
            (path / NAMES[0]).write_text('committed private\n')
            git(path, 'add', NAMES[0])
            git(path, 'commit', '--quiet', '-m', 'Private work')
            (path / NAMES[0]).write_text('dirty private\n')
            (path / NAMES[1]).write_text('staged version\n')
            git(path, 'add', NAMES[1])
            (path / NAMES[1]).write_text('unstaged version\n')
            (path / NAMES[2]).write_text('untracked\n')
            (path / '.git/info/exclude').write_text('/' + NAMES[3] + '\n')
            (path / NAMES[3]).write_text('ignored local data\n')
            original = fingerprint(path)
            meta = {'base_commit': base, 'finalized_commit': base, 'storage_id': 'storage',
                'generation': 1, 'repository_identity': 'local-test', 'lease_id': 'first-lease'}
            prior = {'task_id': 'task', 'resource_id': 'resource', 'fingerprint': original,
                'open': {'result': {'workspace_metadata': meta}}}
            scratch = root / 'execution' / 'first' / 'scratch'
            scratch.mkdir(parents=True)
            (scratch / 'workspace-driver.json').write_text(json.dumps(prior))
            completed = []
            def formal(name, _request_id, payload):
                if name == 'complete_node':
                    completed.append(json.loads(payload.read_text()))
                    return 0, {'status': 'admitted'}
                return 0, {'status': 'committed', 'result': {'path': str(path),
                    'instruction_files': [],
                    'workspace_id': workspace_id('task', 'resource'),
                    'workspace_metadata': {**meta, 'lease_id': str(len(completed) + 2)}}}
            for attempt, prior_attempt, mode in (('broken', 'first', 'break-ancestry'),
                ('repaired', 'broken', 'repair-ancestry')):
                (root / 'execution' / attempt / 'scratch').mkdir(parents=True)
                args = argparse.Namespace(attempt=attempt, task='task', resource='resource',
                    prior_attempt=prior_attempt, mode=mode)
                with patch.object(driver, 'ROOT', root), patch.object(driver, 'formal', formal):
                    driver.run(args)
                current = fingerprint(path)
                self.assertEqual(current['index_tree'], original['index_tree'])
                self.assertEqual(current['files'], original['files'])
                if mode == 'break-ancestry':
                    with self.assertRaises(RuntimeError):
                        git(path, 'merge-base', '--is-ancestor', base, 'HEAD')
                else:
                    git(path, 'merge-base', '--is-ancestor', base, 'HEAD')
                report = json.loads((root / 'execution' / attempt / 'scratch/node-execution-driver.json').read_text())
                self.assertTrue(all(report['checks'].values()))
                self.assertEqual(report['stage'], 'completion_submitting')
            self.assertEqual(len(completed), 2)
            self.assertTrue(all(c['artifact_ids'] == [] for c in completed))
            broken = json.loads((root / 'execution/broken/scratch/node-execution-driver.json').read_text())
            repaired = json.loads((root / 'execution/repaired/scratch/node-execution-driver.json').read_text())
            self.assertEqual(broken['expected_git_tree'], repaired['expected_git_tree'])


if __name__ == '__main__':
    unittest.main()
