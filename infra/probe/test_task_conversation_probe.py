import copy
import hashlib
import unittest

from task_conversation_probe import busy_input_checks, execution_unchanged, handling_checks, ordered_turn_checks
from task_preview_probe import canonical_bytes


class ConversationEvidenceTests(unittest.TestCase):
    def fixture(self):
        context = {'task_id': 'task', 'batch': ['owner-input']}
        digest = hashlib.sha256(canonical_bytes(context)).hexdigest()
        source = {'id': 'source', 'task_id': 'task', 'input_id': 'input',
            'planned_attempt_id': 'attempt', 'source_watermark': 1,
            'expected_version': 2, 'reply_only': False, 'context': context,
            'prompt': canonical_bytes(context).decode(), 'context_digest': digest}
        wire_source = {'source_id': 'source', 'input_id': 'input', 'source_watermark': 1,
            'conversation_version': 2, 'reply_only': False, 'context_digest': digest}
        envelope = {'schema_version': 1, 'scope_id': 'task', 'request_id': 'commit',
            'name': 'commit_task_turn', 'expected_control_version': 2,
            'payload': {'source_id': 'source', 'input_id': 'input', 'source_watermark': 1,
                'reply': 'Formal reply', 'routing': {'kind': 'reply'}}}
        encoded = canonical_bytes(envelope)
        receipt = {'attempt_id': 'attempt', 'request_id': 'commit', 'command_name': 'commit_task_turn',
            'envelope_json': encoded.decode(), 'digest': hashlib.sha256(encoded).hexdigest(),
            'response': {'status': 'committed'}, 'operation_id': 'stop'}
        attempt = {'id': 'attempt', 'task_id': 'task', 'kind': 'planner',
            'task_conversation_source_id': 'source', 'owner_key': 'planner:task', 'dispatch_id': 'dispatch',
            'launch': {'task_conversation_source': wire_source, 'prompt': source['prompt'],
                'workspace_reservations': {'resources': []}}, 'started': True,
            'state': 'SUCCEEDED', 'process_absent': True, 'process_released': True, 'mutation_allowed': False}
        records = {'task': {'id': 'task', 'state': 'PLANNING', 'control_version': 1},
            'inputs': [{'id': 'input', 'task_id': 'task', 'message_id': 'owner', 'status': 'replied'}],
            'conversation_sources': [source], 'attempts': [attempt], 'receipts': [receipt],
            'messages': [{'id': 'owner', 'author': 'owner', 'sequence': 1},
                {'id': 'reply', 'author': 'assistant', 'sequence': 2, 'input_id': 'input',
                    'source_id': 'source', 'source_watermark': 1, 'content': 'Formal reply'}],
            'resolutions': [{'input_id': 'input', 'source_id': 'source', 'reply_message_id': 'reply',
                'disposition': 'replied', 'request_id': 'commit', 'attempt_id': 'attempt',
                'routing': {'kind': 'reply'}}],
            'starts': [{'attempt_id': 'attempt'}],
            'operations': [{'id': 'stop', 'attempt_id': 'attempt', 'kind': 'stop', 'state': 'succeeded'}]}
        for key in ('specifications', 'plans', 'planning_sources', 'nodes', 'node_sources', 'completions', 'manifests',
                'workspace_records', 'lease_records'):
            records[key] = []
        native = {'attempt': {'attempts': [{'attempt_id': 'attempt', 'dispatch_id': 'dispatch',
            'process_absent': True, 'process_released': True, 'mutation_allowed': False}],
            'ownership': {'pid': 123, 'birth': '1234', 'boot_id': 'boot',
                'cgroup': '/system.slice/native.service', 'dispatch_id': 'dispatch'},
            'live_identity': {'present': False}, 'physical': {'cgroup_populated': False},
            'planning_requests': [{'request_id': 'commit', 'digest': receipt['digest'],
                'digest_matches_bytes': True, 'envelope': envelope}]}}
        return records, native

    def test_missing_or_misattributed_evidence_rejects_positive_trial(self):
        records, native = self.fixture()
        self.assertTrue(all(ordered_turn_checks(records, ['input'], native).values()))
        changes = [
            lambda r, n: r['receipts'].clear(),
            lambda r, n: r['receipts'][0].update(digest='0' * 64),
            lambda r, n: r['receipts'].append(copy.deepcopy(r['receipts'][0])),
            lambda r, n: r['resolutions'][0].update(routing={'kind': 'guidance'}),
            lambda r, n: r['messages'][1].update(source_watermark=2),
            lambda r, n: r['messages'][1].update(content='Raw stdout'),
            lambda r, n: r['conversation_sources'][0].update(prompt='changed'),
            lambda r, n: r['attempts'][0]['launch']['task_conversation_source'].update(input_id='other'),
            lambda r, n: r['attempts'][0].update(owner_key='separate-planner:task'),
            lambda r, n: r['attempts'][0]['launch']['workspace_reservations'].update(resources=[{}]),
            lambda r, n: r['starts'].append(copy.deepcopy(r['starts'][0])),
            lambda r, n: r['operations'][0].update(state='recovery'),
            lambda r, n: n['attempt']['planning_requests'].clear(),
            lambda r, n: n['attempt']['physical'].update(cgroup_populated=True),
            lambda r, n: n['attempt']['attempts'][0].update(attempt_id='other'),
            lambda r, n: n['attempt']['ownership'].update(dispatch_id='other'),
        ]
        for index, change in enumerate(changes):
            with self.subTest(index=index):
                broken, observed = copy.deepcopy((records, native))
                change(broken, observed)
                self.assertFalse(all(ordered_turn_checks(broken, ['input'], observed).values()))
        self.assertFalse(all(ordered_turn_checks(records, [], native).values()))

    def test_status_reply_must_not_change_any_node_authority_field(self):
        before, _ = self.fixture()
        before['attempts'].append({'id': 'node-attempt', 'kind': 'node', 'launch': {'prompt': 'frozen'},
            'future_identity_field': 'original', 'activity_at': 'old', 'state': 'RUNNING'})
        after = copy.deepcopy(before)
        after['messages'].append({'id': 'another-reply', 'content': 'hello'})
        after['attempts'][-1]['activity_at'] = 'new'
        self.assertTrue(execution_unchanged(before, after))
        for change in (
                lambda r: r['task'].update(control_version=2),
                lambda r: r['task'].update(state='RUNNING'),
                lambda r: r['planning_sources'].append({'id': 'unauthorized'}),
                lambda r: r['attempts'].append({'id': 'initial', 'kind': 'planner', 'planning_intent_id': 'new'}),
                lambda r: r['starts'].append({'attempt_id': 'node-attempt', 'id': 'unexpected-start'}),
                lambda r: r['operations'].append({'attempt_id': 'node-attempt', 'id': 'unexpected-stop'}),
                lambda r: r['nodes'].append({'id': 'node'}),
                lambda r: r['attempts'][-1].update(future_identity_field='changed'),
                lambda r: r['attempts'][-1]['launch'].update(prompt='changed')):
            broken = copy.deepcopy(after)
            change(broken)
            self.assertFalse(execution_unchanged(before, broken))

    def test_final_order_alone_cannot_prove_queued_while_busy(self):
        before, native = self.fixture()
        before['task'].update(conversation_input_id='input', conversation_source_id='source')
        before['inputs'][0]['status'] = 'pending'
        before['messages'] = before['messages'][:1]
        before['resolutions'] = []
        before['attempts'][0].update(state='RUNNING', mutation_allowed=True, process_released=False)
        observed = native['attempt']
        observed['live_identity'] = observed['ownership'] | {'present': True}
        after = copy.deepcopy(before)
        after['inputs'].append({'id': 'second', 'message_id': 'second-message', 'status': 'pending'})
        after['messages'].append({'id': 'second-message', 'sequence': 2, 'author': 'owner'})
        self.assertTrue(all(busy_input_checks(before, after, 'input', 'second', observed).values()))
        for change in (
                lambda r: r['task'].update(conversation_input_id='second'),
                lambda r: r['attempts'][0].update(mutation_allowed=False),
                lambda r: r['resolutions'].append({'input_id': 'second'}),
                lambda r: r['messages'][1].update(sequence=1),
                lambda r: r['conversation_sources'][0].update(prompt='refreshed')):
            broken = copy.deepcopy(after)
            change(broken)
            self.assertFalse(all(busy_input_checks(before, broken, 'input', 'second', observed).values()))

    def test_transport_or_admission_cannot_count_as_guidance_handled(self):
        text = 'Preserve private files and verify them.'
        digest = hashlib.sha256(text.encode()).hexdigest()
        manifest = {'manifest_version': 2, 'handled_guidance_ids': ['guide'], 'task_id': 'task',
            'node_id': 'node', 'node_activation': 1, 'attempt_id': 'attempt', 'source_id': 'source',
            'specification_id': 'spec', 'plan_id': 'plan', 'summary': 'Checked', 'artifact_ids': []}
        manifest_hash = hashlib.sha256(canonical_bytes(manifest)).hexdigest()
        records = {'task': {'id': 'task'}, 'manifests': [manifest | {'operation_id': 'complete', 'content_digest': manifest_hash}],
            'operations': [{'id': 'complete', 'kind': 'complete_node', 'state': 'succeeded', 'attempt_id': 'attempt',
                'completion_manifest_digest': manifest_hash}],
            'completions': [{'node_id': 'node', 'activation': 1, 'operation_id': 'complete', 'attempt_id': 'attempt',
                'result': {'completion_manifest_digest': manifest_hash, 'handled_guidance_ids': ['guide']}}],
            'node_sources': [{'id': 'source', 'task_id': 'task', 'node_id': 'node', 'node_activation': 1,
                'planned_attempt_id': 'attempt', 'context': {'guidance': {'items': [{'guidance_id': 'guide',
                    'obligation_id': 'obligation', 'text': text, 'content_digest': digest}]}}}],
            'guidance': [{'id': 'guide', 'task_id': 'task', 'text': text, 'content_digest': digest}],
            'obligations': [{'id': 'obligation', 'task_id': 'task', 'guidance_id': 'guide', 'status': 'handled',
                'node_id': 'node', 'node_activation': 1, 'completion_operation_id': 'complete'}],
            'assignments': [{'source_id': 'source', 'guidance_id': 'guide', 'obligation_id': 'obligation'}]}
        self.assertTrue(all(handling_checks(records, 'complete', ['guide']).values()))
        for change in (
                lambda r: r['operations'][0].update(state='admitted'),
                lambda r: r['obligations'][0].update(status='pending'),
                lambda r: r['obligations'][0].update(status='withdrawn'),
                lambda r: r['obligations'][0].update(node_activation=2),
                lambda r: r['obligations'][0].update(completion_operation_id='old'),
                lambda r: r['assignments'][0].update(source_id='other'),
                lambda r: r['guidance'][0].update(text='changed'),
                lambda r: r['manifests'][0].update(handled_guidance_ids=[]),
                lambda r: r['completions'][0]['result'].update(handled_guidance_ids=[])):
            broken = copy.deepcopy(records)
            change(broken)
            self.assertFalse(all(handling_checks(broken, 'complete', ['guide']).values()))


if __name__ == '__main__':
    unittest.main()
