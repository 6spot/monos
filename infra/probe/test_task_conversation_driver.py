import copy
import json
import pathlib
import tempfile
import unittest

from task_conversation_driver import guidance_ids, preserved_checks, prior_report
from workspace_driver import workspace_id


class GuidanceDriverTests(unittest.TestCase):
    def test_declaration_cannot_infer_handling_from_empty_or_invalid_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'ids.json'
            for value in ([], None, {}, ['same', 'same'], ['../another-task'], [True], list(range(257))):
                path.write_text(json.dumps(value))
                with self.assertRaises(ValueError):
                    guidance_ids(path)
            path.write_text(json.dumps(['guidance-2', 'guidance-1']))
            self.assertEqual(guidance_ids(path), ['guidance-2', 'guidance-1'])
            path.write_bytes(b' ' * 65537)
            with self.assertRaisesRegex(ValueError, 'budget'):
                guidance_ids(path)

    def test_prior_identity_or_failed_boundary_cannot_authorize_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            scratch = pathlib.Path(directory)
            path = scratch / 'workspace-driver.json'
            good = {'task_id': 'task', 'resource_id': 'repo', 'attempt_id': 'prior',
                'checks': {'private_work': True}, 'stage': 'held_for_stop'}
            path.write_text(json.dumps(good))
            self.assertEqual(prior_report(scratch, 'task', 'repo', 'prior')[0], good)
            for change in ({'task_id': 'other'}, {'resource_id': 'other'},
                    {'attempt_id': 'different'}, {'stage': 'starting'},
                    {'stage': 'completion_submitting'}, {'checks': {}}, {'checks': {'private_work': False}}):
                path.write_text(json.dumps(good | change))
                with self.assertRaises(RuntimeError):
                    prior_report(scratch, 'task', 'repo', 'prior')
            path.write_text(json.dumps(good))
            (scratch / 'task-conversation-driver.json').write_text(json.dumps(good))
            with self.assertRaisesRegex(RuntimeError, 'Exactly one'):
                prior_report(scratch, 'task', 'repo', 'prior')

    def test_new_lease_does_not_hide_lost_dirty_or_index_work(self):
        metadata = {'base_commit': 'base', 'target_branch': 'main',
            'finalized_commit': 'old-final', 'storage_id': 'storage',
            'generation': 1, 'repository_identity': 'repo', 'lease_id': 'old-lease'}
        before = {'head': 'private', 'index_tree': 'staged',
            'status_sha256': 'dirty', 'files': {'tracked': 'bytes', 'untracked': 'private'}}
        prior = {'fingerprint': before, 'open': {'result': {'workspace_metadata': metadata}}}
        opened = {'workspace_id': workspace_id('task', 'repo'),
            'workspace_metadata': metadata | {'lease_id': 'new-lease'}}
        self.assertTrue(all(preserved_checks(before, prior, opened, 'task', 'repo').values()))
        for field in ('head', 'index_tree', 'status_sha256', 'files'):
            changed = copy.deepcopy(before)
            changed[field] = {} if field == 'files' else 'changed'
            self.assertFalse(all(preserved_checks(changed, prior, opened, 'task', 'repo').values()))
        for field in metadata:
            changed = copy.deepcopy(opened)
            changed['workspace_metadata'][field] = metadata[field] if field == 'lease_id' else 'changed'
            self.assertFalse(all(preserved_checks(before, prior, changed, 'task', 'repo').values()))
        self.assertFalse(all(preserved_checks(before, prior,
            opened | {'workspace_id': workspace_id('other', 'repo')}, 'task', 'repo').values()))


if __name__ == '__main__':
    unittest.main()
