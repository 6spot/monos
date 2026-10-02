import copy
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

from task_replan_driver import completed_checks, predecessor_report
from workspace_driver import NAMES, fingerprint, git, request_replan, workspace_id


class ReplanDriverTests(unittest.TestCase):
    def test_terminal_request_evidence_precedes_cli_and_uncertainty_is_not_retried(self):
        with tempfile.TemporaryDirectory() as folder:
            scratch = pathlib.Path(folder)
            report_path = scratch / 'workspace-driver.json'
            report = {'stage': 'held_for_stop', 'checks': {'private_work': True}}
            def lost_reply(name, request, payload):
                self.assertEqual((name, request), ('request_replan', 'workspace-replan'))
                self.assertEqual(json.loads(payload.read_text()), {'reason': 'Role must change'})
                saved = json.loads(report_path.read_text())
                self.assertEqual(saved['replan_payload'], {'reason': 'Role must change'})
                self.assertEqual(saved['stage'], 'held_for_stop')
                raise TimeoutError('response unknown')
            with patch('workspace_driver.formal', side_effect=lost_reply) as command:
                with self.assertRaises(TimeoutError):
                    request_replan(scratch, report_path, report, 'Role must change')
                command.assert_called_once()
            with patch('workspace_driver.save', side_effect=OSError('full')), \
                    patch('workspace_driver.formal') as command:
                with self.assertRaises(OSError):
                    request_replan(scratch, report_path, report, 'Role must change')
                command.assert_not_called()

    def test_predecessor_modes_cannot_confuse_submission_with_held_work(self):
        with tempfile.TemporaryDirectory() as folder:
            scratch = pathlib.Path(folder)
            path = scratch / 'workspace-driver.json'
            report = dict(task_id='t', resource_id='r', attempt_id='a',
                stage='held_for_stop', checks={'observed': True})
            path.write_text(json.dumps(report))
            self.assertEqual(predecessor_report(scratch, 't', 'r', 'a', 'unfinished')[0], report)
            with self.assertRaises(RuntimeError):
                predecessor_report(scratch, 't', 'r', 'a', 'completed')
            report['stage'] = 'completion_submitting'
            path.write_text(json.dumps(report))
            self.assertEqual(predecessor_report(scratch, 't', 'r', 'a', 'completed')[0], report)
            for mode in ('unfinished', 'unknown'):
                with self.assertRaises(RuntimeError):
                    predecessor_report(scratch, 't', 'r', 'a', mode)
            with self.assertRaises(RuntimeError):
                predecessor_report(scratch, 'foreign', 'r', 'a', 'completed')
            report['checks']['observed'] = 'true'
            path.write_text(json.dumps(report))
            with self.assertRaises(RuntimeError):
                predecessor_report(scratch, 't', 'r', 'a', 'completed')

    def test_completed_input_uses_real_finalized_git_and_preserves_ignored_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder)
            git(path, 'init')
            (path / '.git/info/exclude').write_text('/' + NAMES[3] + '\n')
            for name in NAMES:
                (path / name).write_text(name + '\n')
            git(path, 'add', '-A')
            git(path, 'commit', '-m', 'initial')
            base = git(path, 'rev-parse', 'HEAD').decode().strip()
            (path / NAMES[0]).write_text('private dirty change\n')
            old_metadata = dict(base_commit=base, target_branch='main', storage_id='storage',
                generation=1, repository_identity='repo', lease_id='old', finalized_commit=base)
            prior = dict(fingerprint=fingerprint(path),
                open={'result': {'workspace_metadata': old_metadata}})
            git(path, 'add', '-A')
            git(path, 'commit', '-m', 'finalized')
            commit = git(path, 'rev-parse', 'HEAD').decode().strip()
            tree = git(path, 'rev-parse', 'HEAD^{tree}').decode().strip()
            opened = dict(workspace_id=workspace_id('t', 'r'),
                workspace_metadata=old_metadata | dict(lease_id='new', finalized_commit=commit))
            checks = lambda: completed_checks(path, prior, opened, 't', 'r', commit, tree)
            self.assertNotEqual(prior['fingerprint']['head'], commit)
            self.assertNotEqual(prior['fingerprint']['index_tree'], tree)
            self.assertTrue(all(checks().values()))
            for key, value in [('finalized_commit', base), ('lease_id', 'old'),
                    ('generation', 2), ('base_commit', None), ('storage_id', 'other')]:
                changed = copy.deepcopy(opened)
                changed['workspace_metadata'][key] = value
                self.assertFalse(all(completed_checks(path, prior, changed, 't', 'r', commit, tree).values()))
            (path / NAMES[3]).write_text('lost ignored private bytes\n')
            self.assertFalse(checks()['private_files_preserved'])
            (path / NAMES[3]).write_text(NAMES[3] + '\n')
            (path / NAMES[0]).write_text('late writer\n')
            self.assertFalse(checks()['tracked_work_clean'])
            with self.assertRaises(ValueError):
                completed_checks(path, prior, opened, 't', 'r', '--help', tree)


if __name__ == '__main__':
    unittest.main()
