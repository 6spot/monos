#!/usr/bin/env python3
"""Canonical Node acceptance on the existing authorized installation.

SQL/journal access is read-only evidence. All product decisions use authenticated
Owner commands; preserve exact requests and failed/uncertain trial records.
"""
import argparse
import hashlib
import json
import os
import pathlib
import pwd
import re
import shlex
import time

from probe import checked_id
from task_planning_probe import TaskPlanningProbe, canonical_bytes
from workspace_probe import (PUBLIC_REMOTE, WorkspaceProbe, checkpoint_checks, children_live,
    children_settled, settled_checks)


CARRYOVER_TASK = 'e14ad4bb-4688-4647-981c-70911889e17b'
CARRYOVER_NODE = '04fb910d-fdf9-4e2d-9ae2-ae269f53ca74'
CARRYOVER_PLAN = '5c99259e-d5d5-4b1f-a784-dc5d2027ddae'
CARRYOVER_PLAN_DIGEST = 'c4a032128eb2052be317fb3585b3d3a778b0e4e1f01d7cfd3fc6e2f561439df3'
ARTIFACT_ROLE = """Implement and verify the specified reading-list interface.
PRIVATE_ROLE_SENTINEL is a synthetic context marker, not a credential.
The Project has no repository. Publish the complete usable interface as one
self-contained HTML Artifact with inline CSS and JavaScript using publish_artifact.
Use no external libraries or network requests. Users can add book titles and mark
each finished. The primary button label is exactly Add book, as already resolved
by the Owner and recorded in the Node. Escape user titles as text, give controls
accessible labels, and keep keyboard submission usable. Read back the Artifact
using read_artifact and verify the exact stored content before complete_node.
Complete formally with a concise summary and that exact artifact_ids selection.
Scratch files or prose alone are not the requested delivered interface.
"""
GIT_SPECIFICATION = """# Preserve and recover one private Git result

Use the Project's one authorized public repository. Keep all work in one Node.
Implement and verify private tracked, staged, unstaged and untracked changes and
retain ignored private local data. Exercise explicit Owner Stop/Continue without
losing work. A later explicit Agent correction must preserve the original fixed
Git ancestry before successful formal completion. This is local work only: no
remote push, pull request or delivery. Follow the selected Role's current native
verification instructions. A valid finalized local result is the required output.
"""


def driver_instructions(resource, mode='prepare', prior_attempt=None, task_id=None):
    if mode not in ('prepare', 'break-ancestry', 'repair-ancestry'):
        raise ValueError('Unknown native driver mode')
    script = 'workspace_driver.py' if mode == 'prepare' else 'node_execution_driver.py'
    suffix = '' if mode == 'prepare' else ' --mode ' + mode + ' --prior-attempt ' + checked_id(prior_attempt)
    if task_id is not None:
        arguments = ['--task', checked_id(task_id), '--resource', checked_id(resource)]
        if mode != 'prepare':
            arguments += ['--mode', mode, '--prior-attempt', checked_id(prior_attempt)]
        program = ('import pathlib,runpy,sys; p=pathlib.Path.cwd(); '
            'assert p.name=="scratch" and p.parent.parent==pathlib.Path("/var/lib/monos-probe/execution"); '
            'sys.argv=[' + repr(script) + ',"--attempt",p.parent.name]+' + repr(arguments) + '; '
            'runpy.run_path(' + repr('/var/lib/monos-probe/probe-tools/' + script) + ',run_name="__main__")')
        return ('Run this exact authorized native acceptance command through bash with timeout 600000 ms. '
            'It derives only the current Attempt ID from this process working directory and binds the exact '
            'Task/resource IDs below. Do not substitute or transcribe IDs, start another driver after failure, '
            'read other Task state or publish remotely. It performs formal monos calls and verifies local Git; '
            'Owner Stop or complete_node terminates the process tree.\npython3 -c ' + shlex.quote(program))
    return ('This is the authorized canonical Node Git acceptance. Use native bash to run the root-owned driver '
        'with a 600000 ms timeout. Substitute ATTEMPT and TASK with the exact planned_attempt_id/attempt_id '
        'and task_id from your immutable Node context binding. Do not guess IDs, read credentials or start '
        'another driver after failure. The driver performs formal monos calls, reads repository instructions '
        'and creates/verifies local private changes. Owner Stop or complete_node terminates the process tree. '
        'No remote publication is allowed. Run:\npython3 /var/lib/monos-probe/probe-tools/' + script
        + ' --attempt ATTEMPT --task TASK --resource ' + checked_id(resource) + suffix)


def git_specification_matches(preview):
    text = preview.get('specification')
    return isinstance(text, str) and (text.strip() == GIT_SPECIFICATION.strip()
        or '# ' + str(preview.get('title')) + '\n\n' + text.strip() == GIT_SPECIFICATION.strip())


def carryover_checks(records, role):
    task = records.get('task') or {}
    nodes, plans = records.get('nodes', []), records.get('plans', [])
    definitions = records.get('plan_nodes', [])
    definition = definitions[0].get('definition', {}) if len(definitions) == 1 else {}
    return {
        'exact_canonical_task': task.get('id') == CARRYOVER_TASK
            and bool(task.get('creation_confirmation_id') and task.get('todo_id'))
            and task.get('state') == 'RUNNING' and task.get('plan_id') == CARRYOVER_PLAN,
        'exact_published_plan': len(plans) == 1 and plans[0].get('id') == CARRYOVER_PLAN
            and plans[0].get('content_digest') == CARRYOVER_PLAN_DIGEST,
        'one_pending_node': len(nodes) == 1 and nodes[0].get('id') == CARRYOVER_NODE
            and nodes[0].get('state') == 'PENDING' and definition.get('node_id') == CARRYOVER_NODE
            and definition.get('dependencies') == [] and definition.get('role_id') == role.get('id')
            and bool(definition.get('hard_requirements') and definition.get('expected_outputs')),
        'no_node_or_workspace_started': all(records.get(key) == 0 for key in ('node_attempts', 'workspaces', 'leases')),
        'planner_physical_release': bool(records.get('attempts')) and all(
            a.get('kind') == 'planner' and a.get('process_absent') is True
            and a.get('process_released') is True and a.get('mutation_allowed') is False
            for a in records['attempts']),
        'resolved_label': any(e.get('kind') == 'planning_retried'
            and "Use 'Add book'" in e.get('body', {}).get('answer', '') for e in records.get('events', [])),
        'current_role_recorded': role.get('id') == 'planning-native-v1-role'
            and isinstance(role.get('instructions'), str) and bool(role['instructions']),
    }


def duplicate_artifact_checks(records, reads, retained):
    """Audit the observed identical republish; do not silently relax output count."""
    artifacts = records.get('artifacts', [])
    publications = [r for r in records.get('receipts', []) if r.get('command_name') == 'publish_artifact']
    if len(artifacts) != 2 or len(reads) != 2 or len(publications) != 2 \
            or sorted(artifacts, key=canonical_bytes) != sorted(retained, key=canonical_bytes):
        return False
    if len({a.get('id') for a in artifacts}) != 2 or len({r.get('metadata', {}).get('artifact_id') for r in reads}) != 2:
        return False
    if artifacts[0].get('content') != artifacts[1].get('content'):
        return False
    attribution = ('task_id', 'node_id', 'node_activation', 'attempt_id', 'source_id', 'specification_id', 'plan_id')
    if any(artifacts[0].get(key) != artifacts[1].get(key) for key in attribution):
        return False
    for artifact in artifacts:
        matched = [r for r in publications if json.loads(r['envelope_json']).get('payload', {}).get('artifact_id') == artifact['id']]
        read = next((r for r in reads if r.get('metadata', {}).get('artifact_id') == artifact['id']), {})
        if len(matched) != 1:
            return False
        receipt = matched[0]
        payload = json.loads(receipt['envelope_json'])['payload']
        content = {'text': artifact['content'], 'media_type': artifact['media_type']}
        if json.loads(receipt['envelope_json']).get('scope_id') != artifact['task_id'] \
                or receipt.get('attempt_id') != artifact['attempt_id'] or payload.get('title') != artifact['title'] \
                or payload.get('content') != content or payload.get('references', []) != artifact.get('external_references', []) \
                or payload.get('supersedes') != artifact.get('supersedes') \
                or receipt.get('response', {}).get('status') != 'committed' \
                or receipt.get('response', {}).get('result', {}).get('artifact_id') != artifact['id'] \
                or read.get('content') != content \
                or read.get('metadata', {}).get('references', []) != artifact.get('external_references', []) \
                or read.get('metadata', {}).get('supersedes') != artifact.get('supersedes') \
                or any(read.get('metadata', {}).get(key) != artifact.get(key) for key in
                    (*[k for k in attribution if k != 'source_id'], 'title', 'media_type', 'size_bytes', 'content_digest')) \
                or artifact['size_bytes'] != len(artifact['content'].encode()) \
                or artifact['content_digest'] != hashlib.sha256(artifact['content'].encode()).hexdigest():
            return False
    return True


def no_repository_checks(records, native, artifact_read, headers, role, policy_retry=None, duplicate_review=None):
    task = records.get('task') or {}
    nodes = records.get('nodes', [])
    node = nodes[0] if len(nodes) == 1 else {}
    attempts = [a for a in records.get('attempts', []) if a.get('kind') == 'node']
    attempt = attempts[0] if len(attempts) == 1 else {}
    sources = records.get('node_sources', [])
    selected_sources = [s for s in sources if s.get('planned_attempt_id') == attempt.get('id')]
    source = selected_sources[0] if len(selected_sources) == 1 else {}
    history_matches = len(sources) == 1
    if policy_retry is not None:
        prior = policy_retry['source']
        receipt = policy_retry['receipt']
        history_matches = len(sources) == 2 and prior in sources \
            and prior.get('done') is True and prior.get('waiting_reason') == 'policy_missing' \
            and not any(a.get('id') == prior.get('planned_attempt_id') for a in records.get('attempts', [])) \
            and not any(s.get('attempt_id') == prior.get('planned_attempt_id') for s in records.get('starts', [])) \
            and source.get('previous_source_id') == prior.get('id') \
            and source.get('owner_request_id') == receipt.get('request_id') \
            and receipt.get('status') == 'committed' and receipt.get('source_id') == source.get('id') \
            and any(e.get('kind') == 'retry_node' and e.get('body', {}).get('source_id') == source.get('id')
                and e.get('body', {}).get('previous_source_id') == prior.get('id') for e in records.get('events', []))
    artifacts = records.get('artifacts', [])
    history_checked = duplicate_review is None
    if duplicate_review is not None:
        history_checked = duplicate_artifact_checks(records, duplicate_review['reads'], duplicate_review['retained'])
        artifacts = [a for a in artifacts if a['id'] == artifact_read.get('metadata', {}).get('artifact_id')]
    artifact = artifacts[0] if len(artifacts) == 1 else {}
    operations = [o for o in records.get('operations', []) if o.get('attempt_id') == attempt.get('id')]
    complete = operations[0] if len(operations) == 1 else {}
    manifests = records.get('manifests', [])
    manifest = manifests[0] if len(manifests) == 1 else {}
    completions = records.get('completions', [])
    completion = completions[0] if len(completions) == 1 else {}
    receipts = [r for r in records.get('receipts', []) if r.get('attempt_id') == attempt.get('id')]
    formal = [r for r in receipts if r.get('command_name') == 'complete_node']
    receipt = formal[0] if len(formal) == 1 else {}
    envelope = json.loads(receipt.get('envelope_json', '{}'))
    journal = {r['request_id']: r for r in native.get('planning_requests', [])}
    content = artifact_read.get('content', {})
    metadata = artifact_read.get('metadata', {})
    prompt = source.get('prompt')
    context = source.get('context') or {}
    result = complete.get('result') or {}
    expected_manifest = {key: manifest.get(key) for key in ('task_id', 'node_id', 'node_activation',
        'attempt_id', 'source_id', 'specification_id', 'plan_id', 'summary', 'artifact_ids')}
    publications = [r for r in receipts if r.get('command_name') == 'publish_artifact'
        and (duplicate_review is None or json.loads(r['envelope_json']).get('payload', {}).get('artifact_id') == artifact.get('id'))]
    publication = publications[0] if len(publications) == 1 else {}
    published = json.loads(publication.get('envelope_json', '{}')).get('payload', {})
    return {
        'retained_output_history': history_checked,
        'canonical_review': task.get('id') == CARRYOVER_TASK and task.get('state') == 'REVIEW'
            and task.get('plan_id') == CARRYOVER_PLAN and len(nodes) == 1
            and node.get('id') == CARRYOVER_NODE and node.get('state') == 'COMPLETED',
        'one_source_attempt_start': history_matches and len(selected_sources) == len(attempts) == 1
            and source.get('planned_attempt_id') == attempt.get('id')
            and source.get('id') == attempt.get('node_execution_source_id')
            and source.get('id') == node.get('execution_source_id')
            and len([s for s in records.get('starts', []) if s.get('attempt_id') == attempt.get('id')]) == 1,
        'exact_frozen_context': isinstance(prompt, str) and prompt == canonical_bytes(context).decode()
            and source.get('context_digest') == hashlib.sha256(prompt.encode()).hexdigest()
            and attempt.get('launch', {}).get('prompt') == prompt
            and context.get('role', {}).get('instructions') == role.get('instructions')
            and 'PRIVATE_ROLE_SENTINEL' in prompt and 'TODO_ONLY_SENTINEL' not in prompt,
        'honest_process_only_completion': complete.get('kind') == 'complete_node'
            and complete.get('state') == 'succeeded' and complete.get('repository_free') is True
            and complete.get('resource_id') is None and complete.get('workspace_descriptor') is None
            and result.get('writer_absent') is True and all(key not in result for key in
                ('git_commit', 'git_tree', 'workspace_id', 'workspace_metadata', 'path', 'instruction_files'))
            and all(records.get(key) == 0 for key in ('workspaces', 'leases')),
        'formal_exact_manifest': len(formal) == len(manifests) == len(completions) == 1
            and receipt.get('operation_id') == complete.get('id') == manifest.get('operation_id') == completion.get('operation_id')
            and completion.get('attempt_id') == attempt.get('id')
            and completion.get('result') == {**result, 'summary': manifest.get('summary'),
                'artifact_ids': manifest.get('artifact_ids'), 'completion_manifest_digest': manifest.get('content_digest')}
            and completion.get('activation') == manifest.get('node_activation') == node.get('activation')
            and envelope.get('payload', {}).get('summary') == manifest.get('summary')
            and bool(manifest.get('summary')) and manifest.get('artifact_ids') == [artifact.get('id')]
            and envelope.get('payload', {}).get('artifact_ids') == manifest.get('artifact_ids')
            and manifest.get('content_digest') == complete.get('completion_manifest_digest')
                == hashlib.sha256(canonical_bytes(expected_manifest)).hexdigest(),
        'native_receipt_provenance': bool(receipts) and all(r.get('request_id') in journal
            and journal[r['request_id']].get('digest_matches_bytes') is True
            and journal[r['request_id']].get('digest') == r.get('digest')
            and journal[r['request_id']].get('envelope') == json.loads(r['envelope_json']) for r in receipts),
        'one_managed_html_artifact': len(artifacts) == 1 and artifact.get('attempt_id') == attempt.get('id')
            and artifact.get('source_id') == source.get('id')
            and all(artifact.get(key) == expected_manifest.get(key) for key in
                ('task_id', 'node_id', 'node_activation', 'specification_id', 'plan_id'))
            and artifact.get('media_type') == content.get('media_type') == 'text/html'
            and isinstance(content.get('text'), str) and artifact.get('content') == content['text']
            and artifact.get('size_bytes') == metadata.get('size_bytes') == len(content['text'].encode())
            and artifact.get('content_digest') == metadata.get('content_digest')
                == hashlib.sha256(content['text'].encode()).hexdigest()
            and metadata.get('artifact_id') == artifact.get('id')
            and all(metadata.get(key) == artifact.get(key) for key in
                ('task_id', 'node_id', 'node_activation', 'attempt_id', 'specification_id', 'plan_id', 'media_type'))
            and metadata.get('references', []) == artifact.get('external_references', [])
            and metadata.get('supersedes') == artifact.get('supersedes'),
        'native_artifact_publication': len(publications) == 1
            and published.get('artifact_id') == artifact.get('id')
            and published.get('title') == artifact.get('title')
            and published.get('content') == content
            and published.get('references', []) == artifact.get('external_references', [])
            and published.get('supersedes') == artifact.get('supersedes')
            and publication.get('response', {}).get('status') == 'committed'
            and publication.get('response', {}).get('result', {}).get('artifact_id') == artifact.get('id'),
        'agent_read_back': any(r.get('command_name') == 'read_artifact'
            and json.loads(r['envelope_json']).get('payload', {}).get('artifact_id') == artifact.get('id')
            and r.get('response', {}).get('result', {}).get('artifact') == artifact_read for r in receipts),
        'owner_read_is_data': headers.get('content-type', '').startswith('application/json')
            and headers.get('x-content-type-options') == 'nosniff' and headers.get('cache-control') == 'no-store',
        'physical_release': attempt.get('state') == 'SUCCEEDED' and settled_checks(native),
    }


def durable_execution(records):
    """Compare canonical execution across restart, allowing late raw log drain.

    Activity/log sequence fields are not semantic execution. Every retained
    launch, receipt, output, operation, source and lifecycle fact is compared.
    """
    selected = {key: records[key] for key in ('task', 'nodes', 'plans', 'specifications',
        'plan_nodes', 'events', 'receipts', 'operations', 'starts', 'node_sources',
        'artifacts', 'manifests', 'blockers', 'workspace_records', 'lease_records', 'completions')}
    # Migration 11 permits late raw-log drain to update exactly these projections.
    # Keep every other field, including future immutable source/selection identity.
    selected['attempts'] = [{key: value for key, value in attempt.items()
        if key not in ('activity_at', 'log_visible_sequence', 'exit_observed')}
        for attempt in records['attempts']]
    return {key: sorted(value, key=canonical_bytes) if isinstance(value, list) else value
        for key, value in selected.items()}


def git_receipts_bound(records, native_by_attempt, completion_attempt_ids):
    """Require the native flow's commands before checking exact journal binding."""
    if len(native_by_attempt) != 3 or len(set(completion_attempt_ids)) != 2 \
            or not set(completion_attempt_ids).issubset(native_by_attempt):
        return False
    for attempt_id, snapshot in native_by_attempt.items():
        receipts = [r for r in records['receipts'] if r['attempt_id'] == attempt_id]
        required = ['open_workspace'] + (['complete_node'] if attempt_id in completion_attempt_ids else [])
        if any(not any(r['command_name'] == name for r in receipts) for name in required):
            return False
        journal = {r['request_id']: r for r in snapshot['planning_requests']}
        for receipt in receipts:
            local = journal.get(receipt['request_id'], {})
            if local.get('digest_matches_bytes') is not True or local.get('digest') != receipt['digest'] \
                    or local.get('envelope') != json.loads(receipt['envelope_json']):
                return False
    return True


class NodeExecutionProbe(TaskPlanningProbe):
    def current_role(self, role_id):
        return self.query("SELECT to_jsonb(r) FROM roles r WHERE id='" + checked_id(role_id) + "';")

    def execution_records(self, task):
        task = checked_id(task)
        records = self.records(task)
        records['attempts'] = self.query("SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.created_at,a.id),'[]') FROM attempts a WHERE task_id='" + task + "';")
        for key, table in (('node_sources', 'node_execution_outbox'), ('artifacts', 'artifacts'),
            ('manifests', 'completion_manifests'), ('blockers', 'node_blockers'),
            ('workspace_records', 'task_workspaces'), ('lease_records', 'workspace_leases')):
            records[key] = self.query("SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM " + table + " r WHERE task_id='" + task + "';")
        records['completions'] = self.query("SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM node_completions c JOIN nodes n ON n.id=c.node_id WHERE n.task_id='" + task + "';")
        return records

    def inspect_artifact(self, review_duplicate=False):
        self.claim('artifact-review' if review_duplicate else 'artifact')
        ready = json.loads((self.evidence / 'carryover-ready.json').read_text())
        if ready.get('outcome') != 'pass':
            raise RuntimeError('Carryover disposition did not pass')
        deadline = time.monotonic() + 300
        while True:
            records = self.execution_records(CARRYOVER_TASK)
            attempts = [a for a in records['attempts'] if a['kind'] == 'node']
            if len(attempts) == 1 and attempts[0]['state'] in ('SUCCEEDED', 'FAILED', 'CANCELLED') and attempts[0]['process_released']:
                break
            if any(o['state'] == 'recovery' for o in records['operations'] if attempts and o['attempt_id'] == attempts[0]['id']):
                self.save('artifact-recovery', {'records': records, 'outcome': 'fail'})
                raise RuntimeError('Artifact trial needs operation recovery; inspect original source')
            if time.monotonic() >= deadline:
                self.save('artifact-deadline', {'records': records, 'outcome': 'fail'})
                raise RuntimeError('Native trial deadline; no automatic replacement or Retry')
            time.sleep(2)
        native = self.planning_snapshot(attempts[0]['id'])
        page = self.read('/v1/owner/tasks/' + CARRYOVER_TASK + '/artifacts')
        artifacts = page.get('artifacts', [])
        duplicate_review = None
        if review_duplicate:
            failed = json.loads((self.evidence / 'artifact-count-failed.json').read_text())
            if failed.get('outcome') != 'fail' or len(artifacts) != 2 or len(records['manifests']) != 1 \
                    or len(records['manifests'][0]['artifact_ids']) != 1:
                raise RuntimeError('Duplicate review requires the retained exact failed trial and one final selection')
            reads = [self.read('/v1/owner/tasks/' + CARRYOVER_TASK + '/artifacts/' + checked_id(a['artifact_id'])) for a in artifacts]
            duplicate_review = {'retained': failed['records']['artifacts'], 'reads': reads}
            selected_id = records['manifests'][0]['artifact_ids'][0]
        elif len(artifacts) != 1:
            self.save('artifact-count-failed', {'records': records, 'native': native, 'page': page, 'outcome': 'fail'})
            raise RuntimeError('Expected one managed HTML result')
        else:
            selected_id = artifacts[0]['artifact_id']
        artifact_id = checked_id(selected_id)
        with self.browser.open(self.endpoint + '/v1/owner/tasks/' + CARRYOVER_TASK + '/artifacts/' + artifact_id, timeout=20) as response:
            headers = dict(response.headers.items())
            artifact = json.load(response)
        headers = {key.lower(): value for key, value in headers.items()}
        status = self.read('/v1/owner/tasks/' + CARRYOVER_TASK + '/nodes/' + CARRYOVER_NODE + '/execution')
        retry_path = self.evidence / 'artifact-policy-retry.json'
        policy_retry = json.loads(retry_path.read_text()) if retry_path.is_file() else None
        checks = no_repository_checks(records, native, artifact, headers, ready['role'], policy_retry, duplicate_review)
        reads = duplicate_review['reads'] if duplicate_review else [artifact]
        checks['exact_list_manifest'] = sorted(artifacts, key=canonical_bytes) == sorted(
            [r['metadata'] for r in reads], key=canonical_bytes) and 'next_cursor' not in page
        self.require('artifact', {'records': records, 'native': native, 'artifact': artifact, 'headers': headers,
            'status': status, 'duplicate_review': duplicate_review}, checks)
        target = self.evidence / 'reading-list.html'
        with target.open('x') as output:
            output.write(artifact['content']['text'])
            output.flush()
            os.fsync(output.fileno())
        target.chmod(0o600)

    def prepare_carryover(self):
        self.claim('carryover')
        self.idle('carryover-idle')
        self.save('catalog', self.catalog())
        records = self.records(CARRYOVER_TASK)
        role = self.current_role('planning-native-v1-role')
        self.require('carryover-before', {'records': records, 'role': role}, carryover_checks(records, role))
        configuration = self.read('/v1/owner/configuration')
        payload = {key: role[key] for key in ('id', 'name', 'description', 'archived')}
        payload['instructions'] = ARTIFACT_ROLE
        if role.get('execution_policy') is not None:
            payload['execution_policy'] = role['execution_policy']
        body = {'schema_version': 1, 'request_id': 'node-native-v1-artifact-role',
            'expected_control_version': configuration['control_version'], 'name': 'save_role', 'payload': payload}
        self.formal('/v1/owner/configuration/commands', body,
            lambda result, command: result.get('status') == 'committed'
                and result.get('request_id') == command['request_id'] and result.get('entity_id') == role['id'])
        after = self.current_role(role['id'])
        self.require('carryover-ready', {'task_id': CARRYOVER_TASK, 'node_id': CARRYOVER_NODE,
            'plan_id': CARRYOVER_PLAN, 'role': after, 'disposition': 'execute_with_production_node_pump'},
            {'current_instructions_saved': after.get('instructions') == ARTIFACT_ROLE,
                'immutable_plan_unchanged': self.records(CARRYOVER_TASK)['plans'] == records['plans']})

    def install_node_drivers(self):
        WorkspaceProbe.install_workspace_driver(self)
        source = self.source / 'infra/probe/node_execution_driver.py'
        target = pathlib.Path('/var/lib/monos-probe/probe-tools/node_execution_driver.py')
        if target.is_symlink() or target.exists() and (not target.is_file()
            or target.stat().st_uid != 0 or target.stat().st_mode & 0o022 or target.read_bytes() != source.read_bytes()):
            raise RuntimeError('Preserve and inspect previously installed native Node driver')
        if not target.exists():
            with target.open('xb') as output:
                output.write(source.read_bytes())
                output.flush()
                os.fsync(output.fileno())
            target.chmod(0o644)
        self.save('git-driver-hashes', {name: hashlib.sha256((target.parent / name).read_bytes()).hexdigest()
            for name in ('driver.py', 'workspace_driver.py', 'node_execution_driver.py')})

    def save_role(self, role, request_id):
        configuration = self.read('/v1/owner/configuration')
        return self.formal('/v1/owner/configuration/commands', {'schema_version': 1,
            'request_id': checked_id(request_id), 'expected_control_version': configuration['control_version'],
            'name': 'save_role', 'payload': role}, lambda result, body: result.get('status') == 'committed'
                and result.get('request_id') == body['request_id'] and result.get('entity_id') == role['id'])

    def create_git(self, prefix):
        self.claim('git-create')
        self.idle('git-create-idle')
        self.save('git-catalog', self.catalog())
        self.install_node_drivers()
        prefix = checked_id(prefix)
        project_id, role_id, resource_id = (checked_id(prefix + suffix) for suffix in ('-project', '-role', '-repo'))
        existing = self.query("SELECT jsonb_build_object('todo',EXISTS(SELECT 1 FROM todos WHERE id='" + prefix
            + "'),'project',EXISTS(SELECT 1 FROM projects WHERE id='" + project_id
            + "'),'role',EXISTS(SELECT 1 FROM roles WHERE id='" + role_id + "'));")
        self.require('git-fresh', {'existing': existing}, {'fresh': not any(existing.values())})
        role = {'id': role_id, 'name': 'Private Git recovery', 'description': 'Implements and verifies one retained local Git result.',
            'instructions': driver_instructions(resource_id), 'archived': False}
        self.save_role(role, prefix + '-save-role')
        self.project({'id': project_id, 'name': 'Canonical Node Git acceptance',
            'context': 'Authorized native local Git recovery. Preserve private work and exact original ancestry.',
            'role_ids': [role_id], 'resources': [{'id': resource_id, 'remote_url': PUBLIC_REMOTE,
                'remote_preparation': 'after_acceptance'}], 'archived': False}, prefix + '-save-project')
        self.execute({'schema_version': 1, 'request_id': prefix + '-capture', 'name': 'capture_todo',
            'payload': {'todo_id': prefix, 'original_capture': 'Canonical private Git execution acceptance.'}}, capture=True)
        source = self.submit(prefix, 'preview', 'Commit exactly one Task preview using the following specification '
            'verbatim. Leave Project unspecified. Do not execute work in Discussion.\n\n' + GIT_SPECIFICATION)
        self.observe(prefix, lambda status, audit: 'current_source' not in status and len(audit['attempts']) == 1
            and all(a['process_released'] for a in audit['attempts']))
        messages, audit = self.messages(prefix), self.audit(prefix)
        replies = [m for m in messages if m['author'] == 'assistant']
        if len(replies) != 1 or not replies[0].get('task_preview'):
            self.save('git-preview-failed', {'messages': messages, 'audit': audit, 'outcome': 'fail'})
            raise RuntimeError('Native Discussion did not commit one Git preview')
        reply = replies[0]
        self.require('git-preview', {'messages': messages, 'audit': audit, 'source_message_id': source},
            {'exact_specification': git_specification_matches(reply['task_preview']),
                'native_physical_release': settled_checks(self.snapshot(audit['attempts'][0]['attempt_id']))})
        selected = self.read('/v1/owner/todos/' + prefix + '/task-previews/' + reply['message_id'] + '?project_id=' + project_id)
        confirmation = self.task_command({'schema_version': 1, 'todo_id': prefix, 'request_id': prefix + '-confirm',
            'name': 'confirm_task_preview', 'payload': {'proposal_message_id': reply['message_id'],
                'project_id': project_id, 'content_digest': selected['content_digest']}})
        created = self.task_command({'schema_version': 1, 'todo_id': prefix, 'request_id': prefix + '-create',
            'name': 'create_execution_task', 'payload': {'proposal_message_id': reply['message_id'],
                'confirmation_id': confirmation['confirmation_id'], 'content_digest': selected['content_digest']}})
        task = self.read('/v1/owner/tasks/' + checked_id(created['task_id']))
        records = self.records(created['task_id'])
        self.require('git-created', {'task': task, 'records': records, 'project_id': project_id,
            'role_id': role_id, 'resource_id': resource_id, 'preview': selected, 'confirmation': confirmation, 'creation': created},
            {'canonical_planning': task['state'] == 'PLANNING' and task.get('project_id') == project_id
                and task.get('todo_id') == prefix and not records['attempts'] and not records['nodes'] and not records['plans'],
                'exact_specification': task['specification'] == reply['task_preview']['specification']
                    and git_specification_matches(reply['task_preview'])})

    def start_git(self):
        self.claim('git-start')
        created = json.loads((self.evidence / 'git-created.json').read_text())
        if created.get('outcome') != 'pass':
            raise RuntimeError('Git creation evidence did not pass')
        task = created['task']['task_id']
        # Bind the concrete Task before Start can publish and enqueue a Node.
        role = self.current_role(created['role_id'])
        payload = {key: role[key] for key in ('id', 'name', 'description', 'archived')}
        if role.get('execution_policy') is not None:
            payload['execution_policy'] = role['execution_policy']
        payload['instructions'] = driver_instructions(created['resource_id'], task_id=task)
        self.save_role(payload, checked_id(created['role_id'] + '-bind-task'))
        current = self.read('/v1/owner/tasks/' + task)
        body = {'schema_version': 1, 'request_id': checked_id(task + '-start'), 'scope_id': task,
            'expected_control_version': current['control_version'], 'name': 'start_task',
            'payload': {'specification_id': current['specification_id']}}
        WorkspaceProbe.exact_post(self, '/v1/owner/commands', body,
            '/v1/owner/scopes/' + task + '/commands/' + body['request_id'])
        self.save('git-started', {'task_id': task, 'at': time.time()})

    def git_binding(self):
        value = json.loads((self.evidence / 'git-created.json').read_text())
        if value.get('outcome') != 'pass':
            raise RuntimeError('Canonical Git creation did not pass')
        return value

    def node_status(self, task, node):
        return self.read('/v1/owner/tasks/' + checked_id(task) + '/nodes/' + checked_id(node) + '/execution')

    def node_snapshot(self, attempt, records):
        state = self.planning_snapshot(attempt)
        scratch = pathlib.Path('/var/lib/monos-probe/execution') / checked_id(attempt) / 'scratch'
        reports = [scratch / name for name in ('node-execution-driver.json', 'workspace-driver.json')]
        state['driver'] = next((json.loads(p.read_text()) for p in reports if p.is_file()), None)
        state['operations'] = [o for o in records['operations'] if o['attempt_id'] == attempt]
        return state

    def exported_git_object(self, operation, commit):
        if not isinstance(commit, str) or not re.fullmatch(r'(?:[a-f0-9]{40}|[a-f0-9]{64})', commit):
            return {}
        path = pathlib.Path('/var/lib/monos-probe/results') / checked_id(operation)
        info = path.lstat()
        if not path.is_dir() or path.is_symlink() or info.st_uid != pwd.getpwnam('monos-probe').pw_uid or info.st_mode & 0o077:
            raise RuntimeError('Export is not a private service-owned repository')
        command = ['runuser', '-u', 'monos-probe', '--', '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin',
            'GIT_CONFIG_NOSYSTEM=1', 'GIT_CONFIG_GLOBAL=/dev/null', 'GIT_TERMINAL_PROMPT=0',
            'GIT_ALLOW_PROTOCOL=file', '/usr/bin/git', '--git-dir=' + str(path),
            '-c', 'core.hooksPath=/dev/null', '--no-replace-objects']
        lines = self.call(command + ['show', '-s', '--format=%T%n%P', commit + '^{commit}']).splitlines()
        ref = self.call(command + ['rev-parse', 'refs/monos/result']).strip()
        return {'tree': lines[0], 'parents': lines[1].split() if len(lines) > 1 else [],
            'result_ref': ref, 'service_private': True}

    def observe_git(self, stage, count, predicate):
        task = self.git_binding()['task']['task_id']
        deadline = time.monotonic() + 300
        while True:
            records = self.execution_records(task)
            attempts = [a for a in records['attempts'] if a['kind'] == 'node']
            if len(attempts) == count:
                state = self.node_snapshot(attempts[-1]['id'], records)
                if predicate(records, attempts[-1], state):
                    # These read-only sources use separate DB/journal queries.
                    # A late release can otherwise pair a fresh Attempt with an
                    # earlier admitted operation. Require a stable canonical view.
                    confirmed = self.execution_records(task)
                    latest = [a for a in confirmed['attempts'] if a['kind'] == 'node']
                    if len(latest) == count and durable_execution(confirmed) == durable_execution(records):
                        final = self.node_snapshot(latest[-1]['id'], confirmed)
                        if predicate(confirmed, latest[-1], final):
                            return confirmed, latest[-1], final
            if len(attempts) > count or time.monotonic() >= deadline:
                self.save(stage + '-deadline', {'records': records, 'outcome': 'fail'})
                raise RuntimeError('Git observation bound exceeded; inspect exact source, no automatic retry')
            time.sleep(1)

    def exact_node_control(self, stage, name, status, extra=None):
        payload = {'node_id': status['node_id'], 'node_activation': status['node_activation'],
            'source_id': status['source']['source_id']}
        if status.get('blocker'):
            payload['blocker_id'] = status['blocker']['id']
        if extra:
            payload.update(extra)
        body = {'schema_version': 1, 'request_id': checked_id(status['task_id'] + '-' + stage),
            'scope_id': status['task_id'], 'expected_control_version': status['control_version'],
            'name': name, 'payload': payload}
        result = WorkspaceProbe.exact_post(self, '/v1/owner/commands', body,
            '/v1/owner/scopes/' + body['scope_id'] + '/commands/' + body['request_id'])
        replay = self.post('/v1/owner/commands', body)
        self.require(stage + '-replay', {'receipt': result, 'replay': replay}, {'exact_replay': result == replay})
        return result

    def stop_git(self):
        self.claim('git-stop')
        records, attempt, before = self.observe_git('git-held', 1, lambda _r, _a, s:
            (s.get('driver') or {}).get('stage') == 'held_for_stop')
        report = before['driver']
        self.require('git-held', {'records': records, 'native': before}, {
            'native_driver_passed': report.get('attempt_id') == attempt['id']
                and report.get('execution_uid') == self.config['execution_uid']
                and bool(report.get('checks')) and all(report['checks'].values()),
            'live_descendants': children_live(before),
            'hold_has_time': report.get('hold_expires_at', 0) - time.time() > 45,
            'canonical_source': attempt.get('node_execution_source_id') is not None
                and attempt.get('launch', {}).get('legacy_probe') is not True})
        status = self.node_status(attempt['task_id'], attempt['node_id'])
        self.exact_node_control('git-stop', 'stop_node', status)
        after_records, after_attempt, after = self.observe_git('git-stopped', 1,
            lambda _r, a, s: a['state'] == 'CANCELLED' and settled_checks(s))
        self.require('git-stopped', {'records': after_records, 'native': after}, {
            'same_attempt': after_attempt['id'] == attempt['id'],
            'checkpoint_preserves_tree': checkpoint_checks(report, after, after['operations']),
            'descendants_settled': children_settled(before, after),
            'no_completion': not after_records['completions'],
            'blocked_same_activation': len(after_records['nodes']) == 1
                and after_records['nodes'][0]['state'] == 'BLOCKED' and after_records['nodes'][0]['activation'] == 1})

    def update_git_driver_role(self, stage, mode, prior_attempt):
        binding = self.git_binding()
        role = self.current_role(binding['role_id'])
        payload = {key: role[key] for key in ('id', 'name', 'description', 'archived')}
        if role.get('execution_policy') is not None:
            payload['execution_policy'] = role['execution_policy']
        payload['instructions'] = driver_instructions(binding['resource_id'], mode, prior_attempt,
            task_id=binding['task']['task_id'])
        self.save_role(payload, checked_id(binding['role_id'] + '-' + stage))
        self.save(stage + '-role', {'role': payload, 'prior_instructions': role['instructions']})

    def audit_git_stop(self):
        self.claim('git-stop-audit')
        prior = json.loads((self.evidence / 'git-stopped.json').read_text())
        held = json.loads((self.evidence / 'git-held.json').read_text())
        if prior.get('outcome') != 'fail' or held.get('outcome') != 'pass' \
                or prior['checks'].get('checkpoint_preserves_tree') is not False \
                or not all(value for key, value in prior['checks'].items() if key != 'checkpoint_preserves_tree'):
            raise RuntimeError('Stop audit requires the retained stale-view failure and original held proof')
        records, attempt, native = self.observe_git('git-stopped-audit', 1,
            lambda r, a, s: a['state'] == 'CANCELLED' and a['process_released'] and settled_checks(s)
                and all(o['state'] in ('succeeded', 'cancelled') for o in s['operations'])
                and all(l['state'] == 'released' for l in r['lease_records']))
        report = held['native']['driver']
        stop = next(o for o in native['operations'] if o['kind'] == 'stop')
        checkpoint = stop['result']['workspace_metadata']['checkpoint']
        exported = self.exported_git_object(stop['id'], checkpoint['commit_id'])
        self.require('git-stopped-audit', {'records': records, 'native': native, 'service_export': exported,
            'prior_failed_evidence': 'git-stopped.json'}, {
            'same_attempt': attempt['id'] == report['attempt_id'],
            'checkpoint_preserves_tree': checkpoint_checks(report, native, native['operations']),
            'descendants_settled': children_settled(held['native'], native),
            'no_completion': not records['completions'],
            'blocked_same_activation': len(records['nodes']) == 1 and records['nodes'][0]['state'] == 'BLOCKED'
                and records['nodes'][0]['activation'] == 1,
            'actual_export_matches': exported['tree'] == checkpoint['tree_id']
                and exported['parents'] == [checkpoint['head_commit']] and exported['result_ref'] == checkpoint['commit_id']})

    def continue_git(self):
        self.claim('git-continue')
        stopped = json.loads((self.evidence / 'git-stopped.json').read_text())
        if stopped.get('outcome') == 'fail' and (self.evidence / 'git-stopped-audit.json').is_file():
            stopped = json.loads((self.evidence / 'git-stopped-audit.json').read_text())
        if stopped.get('outcome') != 'pass':
            raise RuntimeError('Git Stop did not pass')
        attempt = [a for a in stopped['records']['attempts'] if a['kind'] == 'node'][0]
        self.update_git_driver_role('break', 'break-ancestry', attempt['id'])
        self.save('git-second-catalog', self.catalog())
        self.exact_node_control('git-continue', 'continue_node', self.node_status(attempt['task_id'], attempt['node_id']))

    def correct_git(self):
        self.claim('git-correct')
        records, attempt, native = self.observe_git('git-hard-failure', 2, lambda _r, _a, s:
            any(o['kind'] == 'complete_node' and o['state'] == 'recovery' for o in s['operations']))
        original = next(o for o in native['operations'] if o['kind'] == 'complete_node')
        driver = native.get('driver') or {}
        self.require('git-hard-failure', {'records': records, 'native': native}, {
            'expected_hard_failure': original.get('failure_kind') == 'invalid_finalization'
                and original['state'] == 'recovery' and attempt['process_released'] is False,
            'explicit_agent_fixture': driver.get('mode') == 'break-ancestry'
                and driver.get('stage') == 'completion_submitting' and bool(driver.get('checks'))
                and all(driver['checks'].values()),
            'blocked_without_current_evidence': records['task']['state'] == 'BLOCKED'
                and records['nodes'][0]['activation'] == 1 and not records['completions'],
            'original_lease_held': any(l['attempt_id'] == attempt['id'] and l['state'] != 'released'
                and l.get('settle_operation_id') == original['id'] for l in records['lease_records'])})
        self.update_git_driver_role('repair', 'repair-ancestry', attempt['id'])
        self.save('git-third-catalog', self.catalog())
        status = self.node_status(attempt['task_id'], attempt['node_id'])
        operation = next(o for o in status['operations'] if o['operation_id'] == original['id'])
        # Recovery targets the exact completion identity; a blocker is not part
        # of this command's strict public payload.
        recovery_status = {**status, 'blocker': None}
        self.exact_node_control('git-correct', 'recover_completion', recovery_status, {
            'operation_id': operation['operation_id'],
            'completion_identity_digest': operation['completion_identity_digest'], 'mode': 'correct'})

    def finish_git(self):
        self.claim('git-final')
        records, attempt, native = self.observe_git('git-final', 3,
            lambda _r, a, s: a['state'] == 'SUCCEEDED' and settled_checks(s))
        binding = self.git_binding()
        driver = native.get('driver') or {}
        operation = next((o for o in native['operations'] if o['kind'] == 'complete_node'), {})
        result = operation.get('result') or {}
        actual = WorkspaceProbe.git_object(self, attempt['task_id'], binding['resource_id'], result.get('git_commit'))
        hard = json.loads((self.evidence / 'git-hard-failure.json').read_text())
        old = next(o for o in hard['native']['operations'] if o['kind'] == 'complete_node')
        original = next((o for o in records['operations'] if o['id'] == old['id']), {})
        settlement = next((o for o in records['operations'] if o.get('completion_operation_id') == old['id']), {})
        checkpoint = (settlement.get('result') or {}).get('workspace_metadata', {}).get('checkpoint', {})
        exported = self.exported_git_object(operation.get('id'), result.get('git_commit'))
        exported_checkpoint = self.exported_git_object(settlement.get('id'), checkpoint.get('commit_id'))
        completions = records['completions']
        previous_attempts = [a for a in records['attempts'] if a['kind'] == 'node' and a['id'] != attempt['id']]
        previous_native = [self.node_snapshot(a['id'], records) for a in previous_attempts]
        native_by_attempt = {a['id']: s for a, s in zip(previous_attempts, previous_native)}
        native_by_attempt[attempt['id']] = native
        receipts_bound = git_receipts_bound(records, native_by_attempt, [old['attempt_id'], attempt['id']])
        self.require('git-final', {'records': records, 'native': native, 'previous_native': previous_native,
            'actual_git': actual, 'service_export': exported, 'checkpoint_export': exported_checkpoint}, {
            'canonical_review': records['task']['state'] == 'REVIEW' and records['nodes'][0]['state'] == 'COMPLETED'
                and records['nodes'][0]['activation'] == 1,
            'corrected_exact_result': driver.get('mode') == 'repair-ancestry' and bool(driver.get('checks'))
                and all(driver['checks'].values()) and operation.get('state') == 'succeeded'
                and result.get('git_tree') == actual.get('tree') == driver.get('expected_git_tree'),
            'one_current_completion': len(completions) == 1 and completions[0]['operation_id'] == operation.get('id')
                and completions[0]['attempt_id'] == attempt['id'] and completions[0]['activation'] == 1,
            'trusted_old_settlement': settlement.get('state') == 'succeeded' and original.get('state') == 'cancelled'
                and original.get('cancelled_by_operation_id') == settlement.get('id')
                and checkpoint.get('operation_id') == settlement.get('id')
                and checkpoint.get('completion_operation_id') == old['id']
                and checkpoint.get('completion_identity_digest') == settlement.get('completion_identity_digest')
                and checkpoint.get('head_commit') == hard['native']['driver']['fingerprint']['head']
                and checkpoint.get('tree_id') == hard['native']['driver']['expected_git_tree'],
            'exact_service_exports': exported.get('result_ref') == result.get('git_commit')
                and exported.get('tree') == result.get('git_tree')
                and exported_checkpoint.get('result_ref') == checkpoint.get('commit_id')
                and exported_checkpoint.get('tree') == checkpoint.get('tree_id')
                and exported_checkpoint.get('parents') == [checkpoint.get('head_commit')],
            'native_command_provenance': receipts_bound,
            'original_settle_pointer_retained': any(l['attempt_id'] == old['attempt_id']
                and l.get('settle_operation_id') == old['id'] for l in records['lease_records']),
            'private_workspace_finalized': len(records['workspace_records']) == 1
                and records['workspace_records'][0]['finalized_commit'] == result.get('git_commit')
                and len(records['lease_records']) == 3 and all(l['state'] == 'released' for l in records['lease_records']),
            'all_native_processes_released': settled_checks(native) and all(settled_checks(s) for s in previous_native),
            'three_explicit_sources': len(records['node_sources']) == 3
                and len([a for a in records['attempts'] if a['kind'] == 'node']) == 3})

    def restart_audit(self):
        self.claim('restart-audit')
        for name in ('artifact', 'git-final'):
            if json.loads((self.evidence / (name + '.json')).read_text()).get('outcome') != 'pass':
                raise RuntimeError('Both native result gates must pass before idle restart')
        self.idle('restart-idle')
        if self.query('SELECT count(*) FROM node_execution_outbox WHERE NOT done;') != 0:
            raise RuntimeError('Unselected Node work prevents idle restart')
        tasks = [CARRYOVER_TASK, self.git_binding()['task']['task_id']]
        before = {task: durable_execution(self.execution_records(task)) for task in tasks}
        identities = {a['id']: self.planning_snapshot(a['id'])['ownership']
            for task in tasks for a in before[task]['attempts'] if a['kind'] == 'node'}
        runner_before = WorkspaceProbe.runner_identity(self)
        container_before = json.loads(self.call(['docker', 'inspect', 'monos-boundary-probe-server-1']))[0]['State']['StartedAt']
        self.save('restart-before', {'records': before, 'ownership': identities, 'runner': runner_before,
            'backend_started_at': container_before})
        self.save('backend-restart-intent', {'at': time.time(), 'backend_started_at': container_before})
        self.call(self.compose + ['restart', 'server'])
        deadline = time.monotonic() + 50
        while True:
            try:
                self.login('/etc/monos-probe/owner-password')
                current = WorkspaceProbe.runner_identity(self)
                registration = current['registration']
                if registration['connected'] and registration['ready'] and registration['backend'] != runner_before['registration']['backend']:
                    break
            except (OSError, ValueError, RuntimeError):
                pass
            if time.monotonic() >= deadline:
                raise RuntimeError('Backend restart readiness unresolved; retain intent and inspect')
            time.sleep(1)
        container_after = json.loads(self.call(['docker', 'inspect', 'monos-boundary-probe-server-1']))[0]['State']['StartedAt']
        self.require('after-backend-restart', {'runner': current, 'backend_started_at': container_after}, {
            'backend_restarted': container_after != container_before,
            'canonical_records_retained': all(durable_execution(self.execution_records(task)) == before[task] for task in tasks)})
        self.save('node-runner-restart-intent', {'at': time.time(), 'runner': current})
        self.call(['systemctl', 'restart', 'monos-probe-runner.service'])
        deadline = time.monotonic() + 50
        while True:
            after = WorkspaceProbe.runner_identity(self)
            registration = after['registration']
            if (registration['connected'] and registration['ready']
                and registration['incarnation'] > current['registration']['incarnation']
                and after['process']['InvocationID'] != current['process']['InvocationID']):
                break
            if time.monotonic() >= deadline:
                raise RuntimeError('Runner restart readiness unresolved; retain intent and inspect')
            time.sleep(1)
        recorded_artifact = json.loads((self.evidence / 'artifact.json').read_text())['artifact']
        artifact = self.read('/v1/owner/tasks/' + CARRYOVER_TASK + '/artifacts/' + recorded_artifact['metadata']['artifact_id'])
        native = {attempt: self.planning_snapshot(attempt) for attempt in identities}
        final = {task: durable_execution(self.execution_records(task)) for task in tasks}
        self.idle('restart-final-idle')
        self.require('restart-audit', {'records': final, 'native': native, 'runner': after, 'artifact': artifact}, {
            'canonical_records_retained': final == before,
            'managed_artifact_survives': artifact == recorded_artifact,
            'process_identity_retained': all(all(state['ownership'].get(key) == identities[attempt].get(key)
                for key in ('pid', 'birth', 'boot_id', 'cgroup', 'dispatch_id')) for attempt, state in native.items()),
            'all_original_trees_absent': all(settled_checks(state) for state in native.values())})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--password-file', required=True)
    parser.add_argument('--prefix', default='node-git-native-v1')
    parser.add_argument('stage', choices=('carryover', 'artifact', 'artifact-review', 'git-create', 'git-start',
        'git-stop', 'git-stop-audit', 'git-continue', 'git-correct', 'git-final', 'restart-audit'))
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Run only on the authorized test host as root')
    probe = NodeExecutionProbe('/root/monos-boundary-probe-src', args.evidence)
    probe.login(args.password_file)
    if args.stage == 'carryover':
        probe.prepare_carryover()
    elif args.stage in ('artifact', 'artifact-review'):
        probe.inspect_artifact(review_duplicate=args.stage == 'artifact-review')
    elif args.stage == 'git-create':
        probe.create_git(checked_id(args.prefix))
    elif args.stage == 'git-start':
        probe.start_git()
    elif args.stage == 'git-stop':
        probe.stop_git()
    elif args.stage == 'git-stop-audit':
        probe.audit_git_stop()
    elif args.stage == 'git-continue':
        probe.continue_git()
    elif args.stage == 'git-correct':
        probe.correct_git()
    elif args.stage == 'git-final':
        probe.finish_git()
    else:
        probe.restart_audit()


if __name__ == '__main__':
    main()
