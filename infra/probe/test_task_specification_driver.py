import hashlib
import json
import pathlib
import tempfile
import unittest

from task_specification_driver import completion_payload, declared_guidance, prior_report


class SpecificationDriverTests(unittest.TestCase):
    def test_resume_requires_actual_matching_unfinished_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            path = root / 'workspace-driver.json'
            good = {'task_id': 'task', 'resource_id': 'repo', 'attempt_id': 'old',
                'stage': 'held_for_stop', 'checks': {'private_work': True}}
            path.write_text(json.dumps(good))
            value, digest = prior_report(root, 'task', 'repo', 'old')
            self.assertEqual(value, good)
            self.assertEqual(digest, hashlib.sha256(path.read_bytes()).hexdigest())
            for changed in ({'task_id': 'other'}, {'resource_id': 'other'}, {'attempt_id': 'other'},
                    {'stage': 'completion_submitting'}, {'stage': 'starting'},
                    {'checks': {}}, {'checks': {'private_work': False}}, {'checks': {'private_work': 'yes'}}):
                path.write_text(json.dumps(good | changed))
                with self.assertRaises(RuntimeError):
                    prior_report(root, 'task', 'repo', 'old')
            path.write_text(json.dumps(good))
            (root / 'task-specification-driver.json').write_text(json.dumps(good))
            with self.assertRaisesRegex(RuntimeError, 'Exactly one'):
                prior_report(root, 'task', 'repo', 'old')

    def test_guidance_handling_is_explicit_not_inferred_from_new_revision(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'guidance.json'
            for valid in ([], ['guidance-a', 'guidance-b']):
                path.write_text(json.dumps(valid))
                self.assertEqual(declared_guidance(path), valid)
            for invalid in (None, {}, ['a', 'a'], [True], ['../foreign'], list(range(257))):
                path.write_text(json.dumps(invalid))
                with self.assertRaises(ValueError):
                    declared_guidance(path)
            path.write_bytes(b' ' * 65537)
            with self.assertRaisesRegex(ValueError, 'budget'):
                declared_guidance(path)
        self.assertEqual(completion_payload('new-revision', [])['handled_guidance_ids'], [])
        self.assertEqual(completion_payload('new-revision', ['g'])['handled_guidance_ids'], ['g'])
        with self.assertRaises(ValueError):
            completion_payload('../other-revision', [])


if __name__ == '__main__':
    unittest.main()
