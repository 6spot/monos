#!/usr/bin/env python3
"""Root-owned isolated populated upgrade preflight. No service replacement."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import time

LOG_ROOT = None
CURRENT_STAGE = None


def save(path, value):
    with path.open('x') as file:
        json.dump(value, file, indent=2)
        file.write('\n')
        file.flush()
        os.fsync(file.fileno())
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def run(args, timeout=40, data=None, label=None):
    global CURRENT_STAGE
    if label is not None:
        CURRENT_STAGE = label
    try:
        process = subprocess.run(args, input=data, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        if label is not None:
            retain_stage(label, error.stdout or b'', error.stderr or b'', {'failure': 'timeout'})
        raise
    if label is not None:
        retain_stage(label, process.stdout, process.stderr, {'exit': process.returncode})
    if process.returncode:
        raise RuntimeError('Isolated preflight command failed: ' + args[0])
    return process.stdout


def retain_stage(label, stdout, stderr, outcome):
    record = dict(outcome)
    for suffix, body in [('stdout', stdout), ('stderr', stderr)]:
        path = LOG_ROOT / (label + '.' + suffix)
        with path.open('xb') as file:
            file.write(body)
            file.flush()
            os.fsync(file.fileno())
        record[suffix + '_sha256'] = hashlib.sha256(body).hexdigest()
    save(LOG_ROOT / (label + '.json'), record)


def inventory(nonce=None, role=None):
    args = ['docker', 'ps', '-a', '--no-trunc', '--format', '{{.ID}}\t{{.Names}}']
    if nonce is not None:
        args += ['--filter', 'label=monos.acceptance.run=' + nonce, '--filter', 'label=monos.acceptance.role=' + role]
    rows = run(args).decode().splitlines()
    found = {}
    for row in rows:
        identity, name = row.split('\t', 1)
        if not re.fullmatch('[a-f0-9]{64}', identity) or name in found:
            raise RuntimeError('Docker inventory identity is malformed')
        found[name] = identity
    return found


def cleanup(name, role, expected_image, nonce, captured_id=None):
    observation = {'name': name, 'role': role, 'confirmed_absent': False}
    try:
        before = inventory()
        identity = before.get(name)
        if not identity:
            if captured_id and captured_id in before.values() or inventory(nonce, role):
                raise RuntimeError('Original task container remains under a different name')
            observation['confirmed_absent'] = True
            observation['basis'] = 'successful Docker inventory before cleanup'
            return observation
        actual = json.loads(run(['docker', 'inspect', identity]))[0]
        labels = actual['Config'].get('Labels', {})
        if actual['Id'] != identity or captured_id and captured_id != identity or labels.get('monos.acceptance.run') != nonce or labels.get('monos.acceptance.role') != role or actual['Config']['Image'] != expected_image:
            raise RuntimeError('Original task container ownership differs')
        observation['id'] = identity
        stopped = subprocess.run(['docker', 'stop', '--time', '5', identity], capture_output=True, timeout=15)
        observation['stop_returncode'] = stopped.returncode
        for attempt in range(20):
            after = inventory()
            observation['confirmed_absent'] = name not in after and identity not in after.values() and not inventory(nonce, role)
            observation['post_stop_observations'] = attempt + 1
            if observation['confirmed_absent']:
                break
            time.sleep(0.1)
        observation['basis'] = 'successful Docker inventory after exact owned stop'
    except Exception as error:
        observation['failure'] = {'type': type(error).__name__}
    return observation


def main():
    global LOG_ROOT, CURRENT_STAGE
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--server-image', required=True)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--prior-directory')
    args = parser.parse_args()
    if os.geteuid() != 0 or not re.fullmatch(r'sha256:[a-f0-9]{64}', args.server_image):
        raise SystemExit('Root and exact immutable server image required')
    evidence = Path(args.directory)
    if evidence.parent != Path('/root') or not evidence.name.startswith('monos-delivery-populated-upgrade-'):
        raise SystemExit('Private task-owned root directory required')
    evidence.mkdir(mode=0o700)
    LOG_ROOT = evidence
    script = Path(__file__).with_name('populated-upgrade.mjs')
    password = secrets.token_urlsafe(32)
    for name, body in [('clone-password', password), ('clone-url', 'postgresql://acceptance_clone:' + password + '@127.0.0.1:5432/acceptance_clone')]:
        (evidence / name).write_text(body)
        (evidence / name).chmod(0o600)
    nonce = secrets.token_hex(8)
    name = 'monos-delivery-upgrade-' + nonce
    observer_name = 'monos-delivery-upgrade-observer-' + nonce
    postgres_image = 'postgres:17.11-trixie@sha256:d74eeac9a635390a49bc21bd49fccd973de707e2a53a76ac49b552b8712ec46f'
    prior = None
    prior_dump = None
    if args.prior_directory:
        prior = Path(args.prior_directory)
        if prior.parent != Path('/root') or not prior.name.startswith('monos-delivery-populated-upgrade-') or prior.is_symlink() or prior.stat().st_uid != 0 or prior.stat().st_mode & 0o077:
            raise SystemExit('Original private snapshot directory mismatch')
        original = json.loads((prior / 'result.json').read_text())
        dump_path = prior / 'source.dump'
        if dump_path.is_symlink() or dump_path.stat().st_uid != 0 or dump_path.stat().st_mode & 0o077:
            raise SystemExit('Original source dump identity mismatch')
        prior_dump = dump_path.read_bytes()
        if hashlib.sha256(prior_dump).hexdigest() != original['source_dump_sha256']:
            raise SystemExit('Original source dump identity mismatch')
    save(evidence / 'intent.json', {'scope': 'Private source pg_dump and isolated populated clone upgrade, not coordinated installation backup', 'server_image': args.server_image, 'postgres_image': postgres_image, 'container_name': name, 'observer_name': observer_name, 'run_nonce': nonce, 'prior_directory': str(prior) if prior else None, 'helper_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'migration_observer_sha256': hashlib.sha256(script.read_bytes()).hexdigest()})
    created = None
    result = {'scope': 'Read source snapshot; mutate isolated clone only', 'outcome': 'fail'}
    try:
        original_inventory = inventory()
        if name in original_inventory or observer_name in original_inventory:
            raise RuntimeError('Task container name already exists')
        dump = prior_dump if prior else run(['docker', 'exec', 'monos-boundary-probe-database-1', 'sh', '-c', 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], timeout=90, label='source-dump')
        (evidence / 'source.dump').write_bytes(dump)
        (evidence / 'source.dump').chmod(0o600)
        result['source_dump_sha256'] = hashlib.sha256(dump).hexdigest()
        created = run(['docker', 'run', '--rm', '-d', '--name', name, '--label', 'monos.acceptance=delivery-populated-upgrade', '--label', 'monos.acceptance.run=' + nonce, '--label', 'monos.acceptance.role=database', '--network', 'none', '--cpus', '2', '--memory', '1g', '--tmpfs', '/var/lib/postgresql/data:rw,size=512m', '-e', 'POSTGRES_DB=acceptance_clone', '-e', 'POSTGRES_USER=acceptance_clone', '-e', 'POSTGRES_PASSWORD_FILE=/run/clone-password', '-v', str(evidence / 'clone-password') + ':/run/clone-password:ro', postgres_image], label='create-clone').decode().strip()
        if not re.fullmatch('[a-f0-9]{64}', created):
            raise RuntimeError('Isolated container identity unavailable')
        ready = False
        CURRENT_STAGE = 'wait-clone-ready'
        for _ in range(30):
            check = subprocess.run(['docker', 'exec', created, 'pg_isready', '-U', 'acceptance_clone', '-d', 'acceptance_clone'], capture_output=True, timeout=5)
            if check.returncode == 0:
                ready = True
                break
            time.sleep(0.5)
        if not ready:
            raise RuntimeError('Isolated PostgreSQL not ready')
        run(['docker', 'exec', '-i', created, 'pg_restore', '-U', 'acceptance_clone', '-d', 'acceptance_clone', '--no-owner', '--no-acl', '--exit-on-error'], timeout=90, data=dump, label='restore-clone')
        run(['docker', 'run', '--rm', '--name', observer_name, '--label', 'monos.acceptance.run=' + nonce, '--label', 'monos.acceptance.role=observer', '--network', 'container:' + created, '--cpus', '2', '--memory', '1g', '-v', str(evidence) + ':/evidence', '-v', str(evidence / 'clone-url') + ':/run/clone-url:ro', '-v', str(script) + ':/run/populated-upgrade.mjs:ro', args.server_image, 'node', '--experimental-strip-types', '/run/populated-upgrade.mjs'], timeout=90, label='migrate-clone')
        observation = json.loads((evidence / 'populated-upgrade.json').read_text())
        if observation['outcome'] != 'pass':
            raise RuntimeError('Populated clone preservation failed')
        result['outcome'] = 'pass'
        result['observation_sha256'] = hashlib.sha256((evidence / 'populated-upgrade.json').read_bytes()).hexdigest()
    except Exception as error:
        result['failure'] = {'type': type(error).__name__, 'stage': CURRENT_STAGE}
        if created and re.fullmatch('[a-f0-9]{64}', created):
            try:
                run(['docker', 'logs', created], label='clone-database-log')
            except Exception as diagnostic_error:
                result['diagnostic_failure'] = {'type': type(diagnostic_error).__name__}
        raise
    finally:
        result['cleanup'] = [
            cleanup(observer_name, 'observer', args.server_image, nonce),
            cleanup(name, 'database', postgres_image, nonce, created if created and re.fullmatch('[a-f0-9]{64}', created) else None),
        ]
        result['clone_cleanup_confirmed'] = all(row['confirmed_absent'] for row in result['cleanup'])
        save(evidence / 'result.json', result)
        if not result['clone_cleanup_confirmed']:
            raise RuntimeError('Isolated cleanup not confirmed; retain original container identity')
    print(json.dumps({'outcome': result['outcome'], 'report': str(evidence / 'result.json')}))


if __name__ == '__main__':
    main()
