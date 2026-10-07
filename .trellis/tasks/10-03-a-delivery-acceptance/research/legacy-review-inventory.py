#!/usr/bin/env python3
"""Remote schema21 prospective REVIEW projection; no canonical authority or host writes."""
import hashlib
import json
import re
import subprocess
import sys

ID = re.compile(r'[A-Za-z0-9_-]{1,128}')
SHA256 = re.compile(r'[a-f0-9]{64}')
GIT_DIGEST = re.compile(r'(?:[a-f0-9]{40}|[a-f0-9]{64})')

def counter(value):
    if type(value) is not int or not 0 <= value <= 9007199254740991:
        raise ValueError('Invalid counter')
    return value

def identifier(value):
    if value is not None and (not isinstance(value, str) or not ID.fullmatch(value)):
        raise ValueError('Invalid identifier')
    return value

def safe_row(row):
    ids = {'task_id', 'project_id', 'specification_id', 'plan_id',
           'selected_source_operation_id', 'resource_id', 'runner_id', 'workspace_id',
           'storage_id', 'source_specification_id', 'source_plan_id', 'node_id',
           'accepted_delivery_operation_id', 'input_id'}
    counters = {'control_version', 'node_activation', 'current_node_activation',
                'accepted_delivery_input_cutoff'}
    booleans = {'no_accepted_pointer', 'no_publication_slot', 'no_pending_replan',
                'processes_released', 'leases_released', 'current_node_completed',
                'in_effective_plan', 'canonical_completion_current',
                'remote_preparation_automatic', 'remote_preparation_after_acceptance',
                'resource_available', 'github_identity', 'has_numeric_provider_repository'}
    for key, value in row.items():
        if key in ids:
            identifier(value)
        elif key in counters:
            if value is not None:
                counter(value)
        elif key in booleans:
            if value is not None and type(value) is not bool:
                raise ValueError('Invalid boolean')
        elif key == 'completion_manifest_digest':
            if value is not None and not SHA256.fullmatch(value):
                raise ValueError('Invalid source digest')
        elif key in {'git_commit', 'git_tree'}:
            if value is not None and not GIT_DIGEST.fullmatch(value):
                raise ValueError('Invalid Git digest')
        else:
            raise ValueError('Unexpected serialized field')
    if row.get('task_id') is None:
        raise ValueError('Missing Task identity')
    return row

def main():
    if len(sys.argv) != 1:
        raise ValueError('No arguments accepted')
    command = ['docker', 'exec', '-i', '-e', 'PGOPTIONS=-c default_transaction_read_only=on',
               CONTAINER, 'sh', '-c',
               'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"']
    process = subprocess.run(command, input=SQL.encode(), stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL, timeout=25)
    if process.returncode or len(process.stdout) > MAX_OUTPUT_BYTES:
        raise ValueError('Read-only query failed or exceeded bound')
    lines = process.stdout.splitlines()
    if len(lines) != 2:
        raise ValueError('Incomplete snapshot')
    connection, snapshot = (json.loads(line) for line in lines)
    if set(connection) != {'schema_is_public', 'search_path_is_expected',
                           'transaction_read_only', 'repeatable_read'}:
        raise ValueError('Unexpected connection metadata')
    if not all(value is True for value in connection.values()):
        raise ValueError('Unexpected schema or transaction mode')
    expected_keys = {'migrations', 'relations', 'review_task_count', 'review_rows',
                     'legacy_accepted_tasks', 'legacy_accepted_inputs',
                     'legacy_task_rows', 'legacy_input_rows'}
    if set(snapshot) != expected_keys:
        raise ValueError('Unexpected snapshot metadata')
    relations = snapshot['relations']
    if set(relations) != set(BASE_RELATIONS) | set(FUTURE_RELATIONS):
        raise ValueError('Missing relation discovery')
    if not all(type(value) is bool for value in relations.values()):
        raise ValueError('Invalid relation discovery')
    if not all(relations[name] for name in BASE_RELATIONS):
        raise ValueError('Required schema21 relation unavailable')
    migrations = snapshot['migrations']
    for row in migrations:
        if set(row) != {'version', 'checksum'} or not SHA256.fullmatch(row['checksum']):
            raise ValueError('Invalid migration metadata')
        counter(row['version'])
    if [row['version'] for row in migrations] != list(range(1, 22)):
        raise ValueError('Only exact schema21 is supported')
    if any(row['checksum'] != EXPECTED_MIGRATIONS[row['version']] for row in migrations):
        raise ValueError('Migration checksums differ from frozen source')
    for count, rows in (('review_task_count', 'review_rows'),
                        ('legacy_accepted_tasks', 'legacy_task_rows'),
                        ('legacy_accepted_inputs', 'legacy_input_rows')):
        measured = counter(snapshot[count])
        if measured > MAX_ROWS or len(snapshot[rows]) != measured:
            raise ValueError('Inventory identity bound exceeded or incomplete')
        snapshot[rows] = [safe_row(row) for row in snapshot[rows]]
    for row in snapshot['review_rows']:
        eligible = all(row.get(key) is True for key in (
            'no_accepted_pointer', 'no_publication_slot', 'no_pending_replan',
            'processes_released', 'leases_released', 'canonical_completion_current'))
        eligible = eligible and row['git_commit'] is not None and row['git_tree'] is not None
        row['prospective_local_candidate_projection'] = eligible
        row['prospective_automatic_remote_configuration'] = eligible and all(
            row.get(key) is True for key in ('resource_available', 'remote_preparation_automatic',
                                           'github_identity', 'has_numeric_provider_repository'))
        row['blockers'] = {
            'accepted_pointer_present': row['no_accepted_pointer'] is not True,
            'publication_slot_present': row['no_publication_slot'] is not True,
            'pending_replan_present': row['no_pending_replan'] is not True,
            'unreleased_process_record': row['processes_released'] is not True,
            'unreleased_lease_record': row['leases_released'] is not True,
            'selected_source_missing': row['selected_source_operation_id'] is None,
            'canonical_completion_projection_not_current': row['canonical_completion_current'] is not True,
            'git_identity_missing': row['git_commit'] is None or row['git_tree'] is None,
            'canonical_source_validation_required': True,
            'public_parent_and_configuration_validation_required': True,
            'physical_absence_unverified': True,
        }
    report = {'ok': True, 'schema_id': 'public', 'schema_version': 21,
              **connection, **snapshot,
              'canonical_authority': False, 'global_quiescence_checked': False,
              'physical_ownership_checked': False, 'future_family_counts': {},
              'legacy_acceptance_blocks_migration24': bool(
                  snapshot['legacy_accepted_tasks'] or snapshot['legacy_accepted_inputs']),
              'unexpected_future_relations_present': any(relations[name] for name in FUTURE_RELATIONS),
              'prospective_local_candidate_count': sum(
                  row['prospective_local_candidate_projection'] for row in snapshot['review_rows']),
              'observer_sql_sha256': hashlib.sha256(SQL.encode()).hexdigest()}
    for version in (22, 23, 24, 25):
        report['future_family_counts'][str(version)] = {
            'available': all(relations[name] for name, introduced in FUTURE_RELATIONS.items() if introduced == version),
            'measured': False, 'value': None}
    report['ok'] = not report['unexpected_future_relations_present']
    print(json.dumps(report, sort_keys=True))
    return 0 if report['ok'] else 2

CONTAINER = 'monos-boundary-probe-database-1'
MAX_ROWS = 1000
MAX_OUTPUT_BYTES = 8 * 1024 * 1024
BASE_RELATIONS = ('schema_migrations', 'tasks', 'task_inputs', 'task_publication_slots', 'replan_requests', 'attempts', 'workspace_leases', 'operations', 'completion_manifests', 'node_completions', 'task_workspaces', 'nodes', 'plan_nodes', 'project_resources', 'specification_node_applicability', 'replan_node_applicability', 'replan_publications')
FUTURE_RELATIONS = {'delivery_operations': 22, 'remote_preparation_items': 23, 'remote_preparation_operations': 23, 'remote_preparation_observations': 23, 'owner_delivery_batches': 24, 'owner_delivery_batch_items': 24, 'owner_delivery_merge_operations': 24, 'owner_delivery_observations': 24, 'owner_delivery_finalizations': 24, 'task_review_feedback': 25, 'task_review_operations': 25, 'task_review_sources': 25, 'task_input_reconsiderations': 25, 'owner_delivery_revocations': 25, 'owner_delivery_revocation_settlements': 25, 'task_review_settlements': 25, 'task_review_input_successors': 25}
EXPECTED_MIGRATIONS = {1: '963b94c8e275cfa18b59d8f22ba692318408c874341272dd84064dc338118094', 2: '48bdf550c6696344df5880ab720b89a4b4410c96ae67339bc520454311d979dc', 3: '42c96433c75dcdfc98e4695d2f8f73a572185d982cbd3bdbac6d499c9b35db81', 4: '625b9d8ce2bb95f363be71bfa03bc9d770468bb66cc4dc455ab05dc22f498050', 5: 'b455ef5c4997ed03528e8056c2865bbf268f33e9ffcac0bbd89a1d91dbcdf84b', 6: '43bf609c9994ea81db61e279050025c4c5ce77e30e05c1661682b8ca7868baee', 7: '84c761eb51b7563f17405e6932bf552231da2759428e88c922e70429d5472f02', 8: '6980995cb33c59af1b305cf798181e5eef41c5269c5cddf8e7f598dba62f4c85', 9: '8ebea11b5e3f7e248f4607a4320db2ca1edbe0147b4011ee7326e31bba685f20', 10: '649ebe04a7afaad67a81d4af8f83cb4b3d9023bd7f6787bf7c13dd517ab030ad', 11: '79113cb3bb96e25c0e685bd4e6031db46bc1b6e6c927564a346fd5bb76f5898d', 12: '8cde381b9a5b08b6ac3f2db3649f42466d0e5747f6b6cdfe1f9b78f513cce168', 13: 'd385623498818ab7fedfd1640b5d4642b7c1a9c7ea5f06ecbf07cb2913a73e4c', 14: '84f1d58bfc5d154094adf01c37ca7ad6fd385e90d461810352e0925b21aa39aa', 15: '225ce4c3d172e97dd1ecc4cdb551ebf1260b3f5f02c543bbd6f0bdcc85bba7cb', 16: '6b38bcbb0c2f9561fa7cfca375fcb51c02556db919bc0e4bc281d607a7268d09', 17: 'f480a0358b5bb7a4cc9d867da3b1383ab539c00ec5e679219103cd4befc96dfe', 18: 'dbcc9192b11a77c653193fcf99ac2e0e426fdb6c6b521ccae405ad8825c0f115', 19: '908abd571dcee5a480d47d0473e0a0caac5967ed1c5b997e662444e3a4294925', 20: 'dcc0df95b445462b5388fb450a8cfca18e13ac8f06ede6e778fc4460653205d7', 21: '6cb142abed9a0994caae1714bbccdb2c090441d6e7c5c3865c3de10c9424a2ee'}
SQL = r"""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
SELECT jsonb_build_object(
 'schema_is_public',current_schema()='public',
 'search_path_is_expected',current_setting('search_path') IN ('"$user", public','public'),
 'transaction_read_only',current_setting('transaction_read_only')='on',
 'repeatable_read',current_setting('transaction_isolation')='repeatable read');
SET LOCAL search_path=public;
WITH projected AS (
SELECT t.id AS task_id, t.project_id, t.control_version,
       t.specification_id, t.plan_id,
       t.accepted_delivery_operation_id IS NULL AS no_accepted_pointer,
       NOT EXISTS(SELECT 1 FROM task_publication_slots x WHERE x.task_id=t.id)
         AS no_publication_slot,
       NOT EXISTS(SELECT 1 FROM replan_requests x
                  WHERE x.task_id=t.id AND x.status='pending') AS no_pending_replan,
       NOT EXISTS(SELECT 1 FROM attempts x
                  WHERE x.task_id=t.id AND NOT x.process_released) AS processes_released,
       NOT EXISTS(SELECT 1 FROM workspace_leases x
                  WHERE x.task_id=t.id AND x.state<>'released') AS leases_released,
       src.operation_id AS selected_source_operation_id,
       src.resource_id, src.runner_id, src.workspace_id, src.storage_id,
       src.content_digest AS completion_manifest_digest,
       src.source_specification_id, src.source_plan_id,
       src.node_id, src.node_activation, src.current_node_activation,
       src.current_node_completed,
       src.in_effective_plan,src.canonical_completion_current,
       src.git_commit, src.git_tree,
       COALESCE(src.remote_mode,'automatic')='automatic' AS remote_preparation_automatic,
       src.remote_mode='after_acceptance' AS remote_preparation_after_acceptance,
       src.resource_available,
       src.github_identity,
       src.has_numeric_provider_repository
FROM tasks t
LEFT JOIN LATERAL (
 SELECT o.id AS operation_id,o.resource_id,a.runner_id,w.id AS workspace_id,w.storage_id,
        m.content_digest,m.specification_id AS source_specification_id,
        m.plan_id AS source_plan_id,m.node_id,m.node_activation,
        n.activation AS current_node_activation,n.state='COMPLETED' AS current_node_completed,
        EXISTS(SELECT 1 FROM plan_nodes pn WHERE pn.plan_id=t.plan_id AND pn.node_id=m.node_id)
          AS in_effective_plan,
        (m.task_id=t.id AND m.attempt_id=a.id AND o.completion_manifest_digest=m.content_digest
         AND n.activation=m.node_activation AND n.state='COMPLETED'
         AND EXISTS(SELECT 1 FROM plan_nodes pn WHERE pn.plan_id=t.plan_id AND pn.node_id=m.node_id)
         AND EXISTS(SELECT 1 FROM node_completions c WHERE c.operation_id=m.operation_id
                      AND c.node_id=m.node_id AND c.activation=m.node_activation
                      AND c.attempt_id=m.attempt_id)
         AND EXISTS(SELECT 1 FROM workspace_leases l WHERE l.id=o.workspace_lease_id
                      AND l.attempt_id=m.attempt_id AND l.workspace_id=w.id)
         AND (WITH RECURSIVE edges(old_spec,old_plan,new_spec,new_plan) AS (
          SELECT x.parent_id,x.plan_id,x.specification_id,x.plan_id
          FROM specification_node_applicability x
          WHERE x.task_id=m.task_id AND x.node_id=m.node_id AND x.node_activation=m.node_activation
            AND x.disposition='carry' AND x.completion_operation_id=m.operation_id
            AND x.completion_manifest_digest=m.content_digest
          UNION ALL
          SELECT p.old_specification_id,p.old_plan_id,p.new_specification_id,p.new_plan_id
          FROM replan_node_applicability x JOIN replan_publications p ON p.id=x.publication_id
          WHERE x.task_id=m.task_id AND x.node_id=m.node_id AND x.node_activation=m.node_activation
            AND x.target_node_id=m.node_id AND x.target_node_activation=m.node_activation
            AND x.disposition='carry' AND x.completion_operation_id=m.operation_id
            AND x.completion_manifest_digest=m.content_digest
         ), path(spec,plan) AS (
          SELECT m.specification_id,m.plan_id
          UNION SELECT e.new_spec,e.new_plan FROM path p JOIN edges e
             ON e.old_spec=p.spec AND e.old_plan=p.plan
         ) SELECT EXISTS(SELECT 1 FROM path WHERE spec=t.specification_id AND plan=t.plan_id)))
          AS canonical_completion_current,
        o.result->>'git_commit' AS git_commit,o.result->>'git_tree' AS git_tree,
        r.settings->>'remote_preparation' AS remote_mode, r.id IS NOT NULL AS resource_available,
        r.repository_identity LIKE 'github.com/%' AS github_identity,
        COALESCE(r.settings->>'provider_repo_id','') ~ '^[1-9][0-9]{0,15}$'
          AS has_numeric_provider_repository
 FROM operations o JOIN attempts a ON a.id=o.attempt_id
 JOIN completion_manifests m ON m.operation_id=o.id
 JOIN task_workspaces w ON w.id=o.workspace_descriptor->>'workspace_id'
 LEFT JOIN nodes n ON n.id=m.node_id AND n.task_id=t.id
 LEFT JOIN project_resources r ON r.id=o.resource_id
 WHERE a.task_id=t.id AND o.kind='complete_node' AND o.state='succeeded'
   AND w.finalized_commit=o.result->>'git_commit'
 ORDER BY o.created_at DESC,o.id DESC LIMIT 1
) src ON true
WHERE t.state='REVIEW'
ORDER BY t.id
), relation_presence AS (
 SELECT name, EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname='public' AND c.relname=name AND c.relkind IN ('r','p')) available
 FROM unnest(ARRAY['schema_migrations','tasks','task_inputs','task_publication_slots','replan_requests','attempts','workspace_leases','operations','completion_manifests','node_completions','task_workspaces','nodes','plan_nodes','project_resources','specification_node_applicability','replan_node_applicability','replan_publications','delivery_operations','remote_preparation_items','remote_preparation_operations','remote_preparation_observations','owner_delivery_batches','owner_delivery_batch_items','owner_delivery_merge_operations','owner_delivery_observations','owner_delivery_finalizations','task_review_feedback','task_review_operations','task_review_sources','task_input_reconsiderations','owner_delivery_revocations','owner_delivery_revocation_settlements','task_review_settlements','task_review_input_successors']) AS required(name)
)
SELECT jsonb_build_object(
 'migrations',(SELECT COALESCE(jsonb_agg(jsonb_build_object('version',version,'checksum',checksum) ORDER BY version),'[]'::jsonb) FROM schema_migrations),
 'relations',(SELECT jsonb_object_agg(name,available) FROM relation_presence),
 'review_task_count',(SELECT count(*) FROM tasks WHERE state='REVIEW'),
 'review_rows',(SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY task_id),'[]'::jsonb) FROM (SELECT * FROM projected ORDER BY task_id LIMIT 1001) p),
 'legacy_accepted_tasks',(SELECT count(*) FROM tasks WHERE accepted_delivery_operation_id IS NOT NULL OR accepted_delivery_input_cutoff IS NOT NULL),
 'legacy_accepted_inputs',(SELECT count(*) FROM task_inputs WHERE accepted_delivery_operation_id IS NOT NULL),
 'legacy_task_rows',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY task_id),'[]'::jsonb) FROM (SELECT id AS task_id,accepted_delivery_operation_id,accepted_delivery_input_cutoff FROM tasks WHERE accepted_delivery_operation_id IS NOT NULL OR accepted_delivery_input_cutoff IS NOT NULL ORDER BY id LIMIT 1001) t),
 'legacy_input_rows',(SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY input_id),'[]'::jsonb) FROM (SELECT id AS input_id,task_id,accepted_delivery_operation_id FROM task_inputs WHERE accepted_delivery_operation_id IS NOT NULL ORDER BY id LIMIT 1001) i)
);
COMMIT;
"""

if __name__ == '__main__':
    try:
        code = main()
    except Exception:
        # Never emit query stderr, malformed row values, environment or connection secrets.
        print(json.dumps({'ok': False, 'query_or_validation_failed': True,
                          'projection_available': False, 'canonical_authority': False,
                          'global_quiescence_checked': False,
                          'future_family_counts': {str(v): {'available': None, 'measured': False, 'value': None}
                                                   for v in (22, 23, 24, 25)}}))
        code = 2
    sys.exit(code)
