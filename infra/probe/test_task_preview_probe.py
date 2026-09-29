import copy
import hashlib
import json
import pathlib
import tempfile
import unittest
import urllib.error
from unittest.mock import Mock

from task_preview_probe import (TaskPreviewProbe, canonical_bytes, creation_checks,
    native_checks, preview_content, provenance_checks, task_receipt_matches)


class PreviewEvidenceTests(unittest.TestCase):
    def preview(self):
        # Digest independently produced by the shared TypeScript canonicalJSON/digest.
        return {'todo_id': 'todo', 'proposal_message_id': 'proposal', 'source_message_id': 'source',
            'source_watermark': 1, 'project_context_version': 0, 'selected_project_id': 'project',
            'content_digest': '976263278782dc9f7b241cc0028a7209aef6a330b39d14bb1f2ce35a4ebbe67c',
            'preview': {'title': 'Exact title', 'specification': '# Exact Markdown\n\n- Keep whitespace.\n'}}

    def command_receipt(self):
        command = {'schema_version': 1, 'request_id': 'create-one', 'todo_id': 'todo-one', 'name': 'create_execution_task',
            'payload': {'proposal_message_id': 'proposal-one', 'confirmation_id': 'confirmation-one', 'content_digest': 'a' * 64}}
        result = {'schema_version': 1, 'request_id': 'create-one', 'todo_id': 'todo-one', 'proposal_message_id': 'proposal-one',
            'status': 'committed', 'outcome': 'created', 'confirmation_id': 'confirmation-one',
            'content_digest': 'a' * 64, 'task_id': 'task-one', 'specification_id': 'spec-one'}
        return command, result

    def test_receipt_requires_exact_scope_content_and_created_result(self):
        command, result = self.command_receipt()
        self.assertTrue(task_receipt_matches(result, command))
        for field, value in [('request_id', 'another'), ('todo_id', 'another'), ('proposal_message_id', 'another'),
                             ('content_digest', 'b' * 64), ('confirmation_id', 'another'),
                             ('outcome', 'confirmed'), ('status', 'unknown'), ('task_id', ''), ('schema_version', 2)]:
            with self.subTest(field=field):
                self.assertFalse(task_receipt_matches({**result, field: value}, command))

    def test_creation_evidence_rejects_duplicate_tasks_inheritance_and_execution(self):
        preview = self.preview()
        confirmations = [{'confirmation_id': 'confirmation', 'content_digest': preview['content_digest']}] * 2
        creations = [{'task_id': 'task', 'specification_id': 'spec'}] * 2
        task = {'task_id': 'task', 'title': 'Exact title', 'todo_id': 'todo', 'project_id': 'project',
            'specification': '# Exact Markdown\n\n- Keep whitespace.\n', 'state': 'PLANNING',
            'initial_specification_id': 'spec', 'specification_id': 'spec',
            'queued_attempts': 0, 'held_attempts': 0, 'open_operations': 0}
        footprint = {'tasks': 1, 'revisions': 1, 'plans': 0, 'nodes': 0, 'attempts': 0, 'starts': 0}
        self.assertTrue(all(creation_checks(preview, confirmations, creations, task, footprint).values()))
        bad_pairs = [
            ({**task, 'specification': task['specification'].rstrip()}, footprint),
            ({**task, 'specification': {'requirement_state': task['specification']}}, footprint),
            ({**task, 'project_id': 'other'}, footprint),
            ({**task, 'state': 'RUNNING'}, footprint),
            ({**task, 'plan_id': 'plan'}, footprint),
            (task, {**footprint, 'tasks': 2}),
            (task, {**footprint, 'attempts': 1, 'starts': 1}),
        ]
        for value, count in bad_pairs:
            with self.subTest(value=value, count=count):
                self.assertFalse(all(creation_checks(preview, confirmations, creations, value, count).values()))
        duplicate = copy.deepcopy(creations)
        duplicate[1]['task_id'] = 'second-task'
        self.assertFalse(creation_checks(preview, confirmations, duplicate, task, footprint)['one_task_across_requests'])
        for patch in [{'source_watermark': 2}, {'source_message_id': 'other'}, {'source_project_id': 'old-project'},
                      {'project_context_version': 1}, {'selected_project_id': 'other'}, {'content_digest': 'f' * 64}]:
            with self.subTest(patch=patch):
                self.assertFalse(creation_checks(preview | patch, confirmations, creations, task, footprint)['exact_confirmation_digest'])

    def test_same_request_replay_preserves_original_evidence_and_rejects_changed_values(self):
        command, result = self.command_receipt()
        with tempfile.TemporaryDirectory() as directory:
            probe = object.__new__(TaskPreviewProbe)
            probe.evidence = pathlib.Path(directory)
            probe.post = Mock(return_value=result)
            self.assertEqual(probe.task_command(command), result)
            originals = {path.name: (path.read_bytes(), path.stat().st_mtime_ns) for path in probe.evidence.iterdir()}
            self.assertEqual(probe.task_command(command), result)
            self.assertEqual(originals, {path.name: (path.read_bytes(), path.stat().st_mtime_ns) for path in probe.evidence.iterdir()})
            with self.assertRaisesRegex(RuntimeError, 'Existing immutable evidence differs'):
                probe.task_command(command | {'todo_id': 'other'})
            self.assertEqual(probe.post.call_count, 2)
            probe.post.return_value = result | {'task_id': 'another'}
            with self.assertRaisesRegex(RuntimeError, 'Existing immutable evidence differs'):
                probe.task_command(command)
            self.assertEqual(json.loads((probe.evidence / 'receipt-create-one.json').read_text()), {'receipt': result})

    def test_uncertain_formal_write_recovers_before_replay_and_never_changes_identity(self):
        command, result = self.command_receipt()
        for error in [urllib.error.HTTPError('https://test', 503, 'unavailable', {}, None),
                      ValueError('bad JSON'), OSError('closed')]:
            probe = object.__new__(TaskPreviewProbe)
            probe.preserve = Mock()
            probe.post = Mock(side_effect=[error, result])
            probe.read = Mock(return_value={'schema_version': 1, 'request_id': command['request_id'], 'status': 'unknown'})
            self.assertEqual(probe.task_command(command), result)
            self.assertEqual(probe.post.call_args_list[0], probe.post.call_args_list[1])
            probe.read.assert_called_once_with('/v1/owner/task-previews/commands/' + command['request_id'])

    def native(self):
        reply = {'content': 'A committed reply', 'task_preview': self.preview()['preview']}
        return reply, {'ownership': {'pid': 123, 'birth': '42', 'boot_id': 'boot',
                'cgroup': '/system.slice/monos-probe-attempt.service', 'dispatch_id': 'dispatch'},
            'live_identity': {'present': False}, 'physical': {'cgroup_populated': False, 'descendants': []},
            'attempts': [{'todo_id': 'todo', 'dispatch_id': 'dispatch'}],
            'journal_requests': [{'request_id': 'handoff', 'digest': 'digest', 'digest_matches_bytes': True}],
            'handoffs': [{'request_id': 'handoff', 'scope_id': 'todo', 'source_message_id': 'source',
                'source_watermark': 1, 'digest': 'digest', 'payload': {'reply': reply['content'], 'task_preview': reply['task_preview']}}],
            'receipts': [{'request_id': 'handoff', 'digest': 'digest', 'scope_id': 'todo',
                'command_name': 'commit_discussion_turn', 'status': 'committed'}]}

    def test_native_evidence_requires_exact_journal_payload_and_retained_process_identity(self):
        reply, native = self.native()
        self.assertTrue(all(native_checks(native, 'todo', 'source', 1, reply).values()))
        for section, patch in [('ownership', {'pid': 0}), ('ownership', {'birth': ''}),
                               ('ownership', {'dispatch_id': 'other'}), ('live_identity', {'present': None}),
                               ('physical', {'cgroup_populated': True}),
                               ('physical', {'descendants': [{'alive': True}]})]:
            value = copy.deepcopy(native)
            value[section].update(patch)
            self.assertFalse(native_checks(value, 'todo', 'source', 1, reply)['physical_source_absence'])
        value = copy.deepcopy(native)
        value['live_identity'] = value['ownership'] | {'present': True, 'cgroup': '/escaped'}
        self.assertFalse(native_checks(value, 'todo', 'source', 1, reply)['physical_source_absence'])
        value['live_identity']['birth'] = '43'
        self.assertTrue(native_checks(value, 'todo', 'source', 1, reply)['physical_source_absence'])
        for patch in [{'source_message_id': 'other'}, {'source_watermark': 2}, {'digest': 'other'},
                      {'payload': {'reply': reply['content'], 'task_preview': {'title': 'Changed', 'specification': 'Changed'}}}]:
            value = copy.deepcopy(native)
            value['handoffs'][0].update(patch)
            self.assertFalse(native_checks(value, 'todo', 'source', 1, reply)['native_journal_handoff'])

    def test_persisted_provenance_binds_confirmation_consumption_and_initial_revision(self):
        preview = self.preview()
        content = preview_content(preview)
        confirmations = [{'request_id': 'confirm', 'confirmation_id': 'confirmation'}]
        creations = [{'request_id': 'create', 'task_id': 'task', 'specification_id': 'spec'}]
        commands = [{'request_id': 'confirm'}, {'request_id': 'create'}]
        records = {'confirmations': [{'id': 'confirmation', 'todo_id': 'todo', 'proposal_message_id': 'proposal',
                    'project_id': 'project', 'request_id': 'confirm', 'content': content, 'content_digest': preview['content_digest']}],
            'resolutions': [{'disposition': 'created', 'todo_id': 'todo', 'proposal_message_id': 'proposal',
                'task_id': 'task', 'confirmation_id': 'confirmation', 'request_id': 'create'}],
            'task': {'source_proposal_message_id': 'proposal', 'creation_confirmation_id': 'confirmation',
                'todo_id': 'todo', 'project_id': 'project', 'resource_id': None, 'initial_specification_id': 'spec'},
            'revision': {'id': 'spec', 'task_id': 'task', 'content': preview['preview']['specification'],
                'content_digest': '1eedc11864ecb7c24dab4688ce25a4347722eca946019521b8fd0708794001b4'},
            'receipts': [{'request_id': command['request_id'], 'digest': hashlib.sha256(canonical_bytes(command)).hexdigest(),
                'response': result} for command, result in zip(commands, confirmations + creations)]}
        self.assertTrue(all(provenance_checks(preview, confirmations, creations, records, commands).values()))
        for section, field, changed in [('confirmations', 'content_digest', 'other'), ('confirmations', 'content', {}),
                                       ('resolutions', 'confirmation_id', 'other'), ('resolutions', 'request_id', 'other'),
                                       ('receipts', 'digest', 'other')]:
            value = copy.deepcopy(records)
            value[section][0][field] = changed
            self.assertFalse(all(provenance_checks(preview, confirmations, creations, value, commands).values()))
        for section, patch in [('task', {'resource_id': 'fixture'}), ('task', {'source_proposal_message_id': 'other'}),
                               ('revision', {'content': {'inherited_context': 'unexpected'}}),
                               ('revision', {'content_digest': 'other'}), ('revision', {'task_id': 'other'})]:
            value = copy.deepcopy(records)
            value[section].update(patch)
            self.assertFalse(all(provenance_checks(preview, confirmations, creations, value, commands).values()))


if __name__ == '__main__':
    unittest.main()
