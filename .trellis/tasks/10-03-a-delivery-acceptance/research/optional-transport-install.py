#!/usr/bin/env python3
"""Once-only, root-run HTTP installation for the exact idle acceptance instance.

Usage: optional-transport-install.py --build-result FILE --build-sha256 SHA256
The externally bound pass receipt supplies candidate_commit, image_id, binaries
({name: {path, sha256}}), assets ({relative SPA path: sha256}), and
source_manifest_path/source_manifest_sha256. No build, enrollment, reset or Task
effect. Failed runs require explicit reconciliation, never another invocation.
"""
import argparse
import copy
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import time
import types
import urllib.request

WORK = Path('/root/monos-optional-transport-install-v1')
PROJECT = 'monos-delivery-acceptance-fresh-v1'
RECIPE = Path('/root') / PROJECT / 'infra/compose'
ORIGINAL, HTTP = RECIPE / 'compose.fresh.yaml', RECIPE / 'compose.http.yaml'
SERVER = '0dab0a79485db2932607b8074806553831e28e629227b7deb8e98ae0dadf2291'
OLD_IMAGE = 'sha256:9c7e9c4fea00180c8f4082eab5e7b296b4e9372df3c155c12ca9aa2f27f2e775'
DATABASE = 'a650c142fb83ff89b93de6ec4e5f3584a330927b4c40f4796bff4a2afcb0fa01'
RUN = '202fb6ec2742d96cf3cba5bd0fb11645'
STORAGE = '864d3d99-24dc-43fe-9a19-ffce52557648'
OBSERVER = Path('/root/monos-delivery-acceptance-readiness-controller-v1/current-runtime-ownership.py')
OBSERVER_SHA = 'ce2f7381ef5628cf638b3dba36c67b91b12aa8b999c34431a07a8d6252437669'
UNIT = 'monos-probe-runner.service'
DATA, CONFIG = Path('/var/lib/monos-probe'), Path('/etc/monos-probe/runner.json')
BINS = {n: Path('/usr/local/bin' if n == 'monos' else '/usr/local/libexec') / n
        for n in ('monos', 'monos-runner', 'monos-probe-launch', 'monos-probe-exec')}
EMPTY = ('tasks', 'attempts', 'operations', 'workspace_leases', 'runtime_events',
         'publication_candidates', 'delivery_operations', 'remote_preparation_operations',
         'owner_delivery_batches', 'owner_delivery_merge_operations', 'task_review_operations')
SERIAL, OBS, BUILD, BOOT, NEW, STARTED, RUNNER_ID = 0, None, None, None, None, False, None
CLAIMED, UP_ATTEMPTED = False, False
BASE_DB, BASE_FILES, BASE_CONFIG, BASE_COMPOSE, BASE_RUNNER = None, None, None, None, None


class Stop(Exception):
    pass


def need(ok, code):
    if not ok:
        raise Stop(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def signature(s):
    return (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def read(path, owner=0, group=None, mode=None):
    path = Path(path)
    need(path.is_absolute(), 'absolute_input_required')
    for parent in path.parents:
        s = parent.lstat()
        need(stat.S_ISDIR(s.st_mode) and s.st_uid in (0, owner) and not s.st_mode & 0o022, 'unsafe_parent')
    s = path.lstat()
    need(stat.S_ISREG(s.st_mode) and s.st_uid == owner and not s.st_mode & 0o022
         and (group is None or s.st_gid == group) and (mode is None or stat.S_IMODE(s.st_mode) == mode)
         and s.st_size <= 128 << 20, 'unsafe_input')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as f:
        need(signature(os.fstat(f.fileno())) == signature(s), 'input_changed')
        raw = f.read((128 << 20) + 1)
        need(signature(os.fstat(f.fileno())) == signature(s) and signature(path.lstat()) == signature(s)
             and len(raw) <= 128 << 20, 'input_changed')
    return raw


def save(path, value, uid=0, gid=0, mode=0o600):
    raw = value if isinstance(value, bytes) else (json.dumps(value, sort_keys=True) + '\n').encode()
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode), 'wb') as f:
        os.fchown(f.fileno(), uid, gid)
        os.fchmod(f.fileno(), mode)
        f.write(raw)
        f.flush()
        os.fsync(f.fileno())
    sync_directory(Path(path).parent)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def command(argv, data=None, effect=None, timeout=30):
    global SERIAL
    SERIAL += 1
    stem = WORK / ('%03d-%s' % (SERIAL, effect or 'read'))
    if effect:
        save(str(stem) + '.intent.json', {'argv': argv, 'stdin_present': data is not None})
    try:
        p = subprocess.run(argv, input=data, capture_output=True, timeout=timeout,
                           env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'SYSTEMD_COLORS': '0'})
    except (OSError, subprocess.TimeoutExpired):
        if effect:
            save(str(stem) + '.result.json', {'outcome': 'unknown; no automatic retry'})
        raise Stop('command_completion_unknown') from None
    if effect:
        save(str(stem) + '.result.json', {'exit': p.returncode, 'stdout_sha256': sha(p.stdout),
                                        'stderr_sha256': sha(p.stderr)})
    need(p.returncode == 0 and len(p.stdout) <= 16 << 20, 'command_failed')
    return p.stdout


def inspect(identity):
    rows = json.loads(command(['docker', 'inspect', identity]))
    need(len(rows) == 1 and rows[0]['Id'] == identity, 'container_identity_changed')
    return rows[0]


def identify_new_server():
    row = json.loads(command(['docker', 'inspect', PROJECT + '-server-1']))[0]
    need(re.fullmatch('[0-9a-f]{64}', row['Id']) and row['Id'] != SERVER and row['RestartCount'] == 0, 'server_not_replaced_once')
    container_policy(row, 'server', BUILD['image_id'], row['State']['Running'])
    return (row['Id'], row['State']['StartedAt'], row['RestartCount'])


def env_map(value):
    if isinstance(value, dict):
        return value.copy()
    result = dict(item.split('=', 1) for item in value)
    need(len(result) == len(value), 'duplicate_environment')
    return result


def http_recipe(before):
    after = copy.deepcopy(before)
    service = after['services']['server']
    service['image'] = BUILD['image_id']
    service['environment'] = env_map(service['environment'])
    for key in ('MONOS_TLS_KEY_FILE', 'MONOS_TLS_CERT_FILE'):
        need(key in service['environment'], 'original_tls_missing')
        del service['environment'][key]
    service['secrets'] = [v for v in service['secrets'] if (v if isinstance(v, str) else v['source']) not in ('tls_key', 'tls_cert')]
    for key in ('tls_key', 'tls_cert'):
        del after['secrets'][key]
    return after


def semantic(value, key=''):
    if key == 'environment':
        return env_map(value)
    if isinstance(value, dict):
        return {k: semantic(v, k) for k, v in value.items()}
    if isinstance(value, list):
        rows = [semantic(v) for v in value]
        return sorted(rows, key=lambda v: json.dumps(v, sort_keys=True)) if key in ('secrets', 'volumes', 'networks', 'ports') else rows
    return value


def container_policy(row, service, image, running):
    labels, host = row['Config']['Labels'], row['HostConfig']
    need(row['Name'] == '/' + PROJECT + '-' + service + '-1' and row['Image'] == image
         and row['State']['Running'] is running and not row['State']['Paused'] and not row['State']['Restarting']
         and labels.get('com.docker.compose.project') == PROJECT and labels.get('com.docker.compose.service') == service
         and labels.get('io.monos.delivery.task') == 'a-delivery-acceptance' and labels.get('io.monos.delivery.run') == RUN,
         'container_policy_changed')
    if service == 'server':
        need(labels.get('com.docker.compose.project.working_dir') == str(RECIPE)
             and host['PortBindings'] == {'18443/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '18445'}]}
             and host['ReadonlyRootfs'] and host['CapDrop'] == ['ALL']
             and host['SecurityOpt'] == ['no-new-privileges:true'] and host['Tmpfs'] == {'/tmp': ''}
             and host['RestartPolicy']['Name'] == 'unless-stopped', 'server_policy_changed')
        keys = ('database_url', 'signing_key') if image != OLD_IMAGE else ('database_url', 'signing_key', 'tls_key', 'tls_cert')
        paths = {'tls_key': 'server.key', 'tls_cert': 'server.crt'}
        mounts = {m['Destination']: m for m in row['Mounts']}
        need(len(mounts) == len(row['Mounts']) == len(keys), 'unexpected_server_mount')
        for key in keys:
            mount = mounts.get('/run/secrets/' + key, {})
            need(mount.get('Type') == 'bind' and mount.get('RW') is False
                 and mount.get('Source') == str(RECIPE / 'private' / paths.get(key, key)), 'server_secret_changed')
        expected = env_map((http_recipe(BASE_COMPOSE) if image != OLD_IMAGE else BASE_COMPOSE)['services']['server']['environment'])
        actual = env_map(row['Config']['Env'])
        need(all(actual.get(k) == v for k, v in expected.items()) and (image == OLD_IMAGE or
             not {'MONOS_TLS_KEY_FILE', 'MONOS_TLS_CERT_FILE'} & actual.keys()), 'server_environment_changed')


def db_guard():
    row = inspect(DATABASE)
    need(row['State']['Running'] and not row['State']['Paused'] and not row['State']['Restarting'], 'database_not_running')
    binding = {k: row[k] for k in ('Id', 'Image', 'Name', 'Created', 'Config', 'HostConfig', 'Mounts', 'RestartCount')}
    binding['started_at'] = row['State']['StartedAt']
    need(BASE_DB is None or binding == BASE_DB, 'database_changed')
    return binding


def canonical():
    db_guard()
    counts = ','.join("'%s',(SELECT count(*) FROM %s)" % (t, t) for t in EMPTY)
    token_sha = sha(read(CONFIG.parent / 'runner-token', 997, 986, 0o600).strip())
    sql = ("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT json_build_object('counts',json_build_object(" + counts +
           "),'n',(SELECT count(*) FROM runners),'runner',(SELECT json_build_object('id',id,'capacity',capacity,"
           "'incarnation',incarnation,'report',runtime_report_incarnation,'connected',connected,'ready',ready,"
           "'connection',connection_instance,'boot',boot_id,'recent',last_seen>clock_timestamp()-interval '15 seconds',"
           "'credential_matches',credential_hash='" + token_sha + "') FROM runners WHERE id='delivery-fresh-runner-v1'),"
           "'runtimes',(SELECT coalesce(json_agg(json_build_object('runner',runner_id,'incarnation',incarnation,"
           "'observation',observation)),'[]'::json) FROM runtime_installations)); COMMIT;")
    row = json.loads(command(['docker', 'exec', '-i', DATABASE, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'monos', '-d', 'monos'], sql.encode()))
    r = row['runner']
    need(all(type(v) is int and v == 0 for v in row['counts'].values()) and row['n'] == 1
         and r['capacity'] == 2 and r['credential_matches'] is True, 'unexpected_work_or_enrollment')
    db_guard()
    return row


def journal(stopped=True):
    path = DATA / 'service/journal.sqlite'
    sides = [Path(str(path) + tail) for tail in ('-wal', '-shm', '-journal')]
    before = read(path, 997, 986, 0o600)
    need(not stopped or not any(os.path.lexists(p) for p in sides), 'journal_sidecars_present')
    if not stopped:
        need(not os.path.lexists(sides[2]), 'journal_rollback_sidecar')
        for p in sides[:2]:
            read(p, 997, 986, 0o600)  # Do not let this observer create root-owned sidecars.
    with closing(sqlite3.connect(path.as_uri() + ('?mode=ro&immutable=1' if stopped else '?mode=ro'), uri=True)) as c:
        c.execute('PRAGMA query_only=ON')
        c.execute('BEGIN')
        counts = {t: c.execute('SELECT count(*) FROM ' + t).fetchone()[0] for t in ('starts', 'requests', 'effects', 'events', 'log_offsets')}
        c.rollback()
    need(not any(counts.values()), 'journal_work_present')
    need(not stopped or (read(path, 997, 986, 0o600) == before and not any(os.path.lexists(p) for p in sides)), 'journal_changed')
    return counts


def namespace():
    root = Path('/sys/fs/cgroup/system.slice')
    need(root.is_dir() and not root.is_symlink(), 'kernel_namespace_unavailable')
    with os.scandir(root) as rows:
        return sorted(r.name for r in rows if r.name.startswith('monos-probe-'))


def physical(label, ready=False):
    for attempt in range(3):
        OBS.UNKNOWN.clear()
        before = namespace()
        report = OBS.observe()  # Never omit the installer itself from /proc attribution.
        after = namespace()
        save(WORK / ('%s-%d.json' % (label, attempt)), {'before': before, 'physical': report, 'after': after})
        need(report['boot_id'] == BOOT and report['current_accounts'] == {'service_uid': 997, 'execution_uid': 1000, 'read_group_gid': 986}, 'physical_identity_changed')
        need(not report['jobs'] and not report['unexpected_target_name_count'], 'physical_owner_present')
        units, processes = report['units'], report['processes']['selected']
        need(len(units) == 1 and units[0]['unit'] == UNIT, 'unexpected_unit')
        unit = units[0]
        if ready:
            need(before == after == [UNIT] and unit['ActiveState'] == 'active' and unit['SubState'] == 'running'
                 and (unit['main_pid'], unit['invocation_id']) == RUNNER_ID, 'runner_identity_changed')
            need(len(processes) <= 1 and all(p['pid'] == RUNNER_ID[0] and p['unit'] == UNIT for p in processes), 'additional_writer')
            need(all(all(pid == RUNNER_ID[0] for pid in n.get('pids', [])) for n in unit.get('cgroup', {}).get('nodes', [])), 'additional_cgroup_writer')
            for p in processes:
                need(p['uid'] == [997] * 4 and p['gid'] == [986] * 4 and p['birth_ticks'] > 0
                     and p['executable']['selected_binary'] == 'monos-runner' and not p['executable']['deleted']
                     and p['executable']['installed_inode_matches'], 'daemon_binary_identity_changed')
            socket = report['selected_files']['command_socket']
            complete = (report['physical_observation_complete'] and len(processes) == 1 and
                        socket.get('socket') and not socket.get('symlink') and socket.get('uid') == 997 and
                        socket.get('gid') == 986 and socket.get('mode') == '0o660' and
                        len(report['selected_socket_inodes']) == 1 and report['selected_socket_inodes'][0]['listener'] and
                        'selected_socket_fd' in processes[0]['references'])
        else:
            socket = report['selected_files']['command_socket']
            need(not processes and not before and not after and not report['selected_socket_inodes']
                 and not unit.get('main_pid', 0) and unit.get('ActiveState') not in ('active', 'activating', 'deactivating')
                 and socket.get('status') != 'present' and not any(n.get('populated') or n.get('pids') or n.get('thread_ids')
                     for n in unit['cgroup'].get('nodes', [])), 'physical_owner_present')
            complete = (report['processes']['complete'] and unit.get('main_pid') == 0 and unit.get('ActiveState') == 'inactive'
                        and unit.get('SubState') == 'dead' and socket == {'status': 'missing'}
                        and (unit['cgroup'].get('status') == 'missing' or unit['cgroup'].get('empty_proven') is True)
                        and all(x == {'code': 'cgroup_missing_not_empty_proof', 'unit': UNIT} for x in report['unknown']))
        if complete:
            return report
        need(attempt < 2, 'physical_observation_incomplete')
        time.sleep(0.2)


def private_files():
    result = {}
    s = (RECIPE / 'private').lstat()
    need(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and stat.S_IMODE(s.st_mode) == 0o700, 'private_staging_changed')
    for name in ('db_password', 'database_url', 'signing_key', 'ca.key', 'server.key', 'server.crt', 'ca.crt',
                 'runner_credential', 'owner-bootstrap.json', 'runner-enrollment.json'):
        result[name] = sha(read(RECIPE / 'private' / name, mode=None if name.endswith('.crt') else 0o600))
    result['token'] = sha(read(CONFIG.parent / 'runner-token', 997, 986, 0o600))
    result['installed_ca'] = sha(read(CONFIG.parent / 'ca.pem', mode=0o644))
    for relative, uid, mode in (('launch/storage-id', 0, 0o644), ('service/storage-id', 997, 0o600)):
        need(read(DATA / relative, uid, 986, mode) == (STORAGE + '\n').encode(), 'storage_identity_changed')
    return result


def build_inputs(path, expected):
    raw = read(path)
    need(re.fullmatch('[0-9a-f]{64}', expected) and sha(raw) == expected, 'build_receipt_changed')
    b = json.loads(raw)
    need(b['outcome'] == 'pass' and re.fullmatch('[0-9a-f]{40}', b['candidate_commit'])
         and re.fullmatch('sha256:[0-9a-f]{64}', b['image_id']) and b['image_id'] != OLD_IMAGE
         and set(b['binaries']) == set(BINS) and 'index.html' in b['assets'], 'invalid_build_receipt')
    manifest = read(b['source_manifest_path'])
    m = json.loads(manifest)
    need(sha(manifest) == b['source_manifest_sha256'] and m['candidate_commit'] == b['candidate_commit']
         and m['files'] and set(m['files']) == set(m['git_modes'])
         and all(re.fullmatch('[0-9a-f]{64}', h) for h in m['files'].values()), 'source_manifest_changed')
    for name, value in b['binaries'].items():
        binary = read(value['path'])
        need(Path(value['path']).name == name and sha(binary) == value['sha256'] and binary[:4] == b'\x7fELF', 'binary_build_changed')
    need(all(re.fullmatch(r'(?:index\.html|assets/[A-Za-z0-9_.-]+)', p) and re.fullmatch('[0-9a-f]{64}', h) for p, h in b['assets'].items()), 'invalid_asset_manifest')
    image = json.loads(command(['docker', 'image', 'inspect', b['image_id']]))[0]
    need(image['Id'] == b['image_id'] and image['Config']['Labels'].get('io.monos.candidate_commit') == b['candidate_commit'], 'image_build_changed')
    return b


def replace(path, raw, uid=0, gid=0, mode=0o755):
    save(WORK / (path.name + '.intent.json'), {'path': str(path), 'sha256': sha(raw), 'uid': uid, 'gid': gid, 'mode': oct(mode)})
    temporary = path.with_name(path.name + '.http-install-v1')
    save(temporary, raw, uid, gid, mode)
    os.replace(temporary, path)
    sync_directory(path.parent)
    save(WORK / (path.name + '.result.json'), {'sha256': sha(read(path, uid, gid, mode))})


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def health_assets():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    for path in ('health', *BUILD['assets']):
        deadline = time.monotonic() + 45
        while True:
            try:
                with opener.open('http://127.0.0.1:18445/' + ('' if path == 'index.html' else path), timeout=3) as response:
                    raw = response.read((12 << 20) + 1)
                    need(response.status == 200 and len(raw) <= 12 << 20, 'http_read_failed')
                break
            except OSError:
                need(path == 'health' and time.monotonic() < deadline, 'http_unavailable')
                time.sleep(0.5)
        need(json.loads(raw) == {'schema_version': 1, 'database': 'ready', 'probe': True} if path == 'health'
             else sha(raw) == BUILD['assets'][path], 'served_content_changed')


def install(args):
    global OBS, BUILD, BOOT, BASE_DB, BASE_FILES, BASE_CONFIG, BASE_COMPOSE, BASE_RUNNER, NEW, STARTED, RUNNER_ID
    global CLAIMED, UP_ATTEMPTED
    need(os.geteuid() == 0 and os.uname().sysname == 'Linux', 'linux_root_required')
    os.mkdir(WORK, 0o700)  # Exclusive once-only claim, including failed preflight.
    CLAIMED = True
    save(WORK / 'intent.json', {'helper_sha256': sha(read(Path(__file__).absolute())), 'build_sha256': args.build_sha256,
                              'old_server': SERVER, 'database': DATABASE, 'automatic_effect_retry': False})
    raw = read(OBSERVER)
    need(sha(raw) == OBSERVER_SHA, 'observer_changed')
    OBS = types.ModuleType('ownership'); OBS.__file__ = str(OBSERVER)
    exec(compile(raw, str(OBSERVER), 'exec'), OBS.__dict__)
    BOOT = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    BUILD = build_inputs(args.build_result, args.build_sha256)
    need(not os.path.lexists(HTTP), 'http_compose_collision')
    BASE_COMPOSE = json.loads(read(ORIGINAL, mode=0o600))
    old = inspect(SERVER)
    container_policy(old, 'server', OLD_IMAGE, False)
    need(old['RestartCount'] == 0, 'old_server_restarted')
    db = inspect(DATABASE)
    container_policy(db, 'database', 'sha256:d74eeac9a635390a49bc21bd49fccd973de707e2a53a76ac49b552b8712ec46f', True)
    ids = command(['docker', 'ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=' + PROJECT]).decode().split()
    need(len(ids) == 2 and set(ids) == {SERVER, DATABASE}, 'unexpected_project_container')
    BASE_DB, BASE_FILES = db_guard(), private_files()
    BASE_CONFIG = json.loads(read(CONFIG, 997, 986, 0o640))
    expected = {'endpoint': 'https://127.0.0.1:18445', 'ca_file': '/etc/monos-probe/ca.pem', 'token_file': '/etc/monos-probe/runner-token',
                'runner_id': 'delivery-fresh-runner-v1', 'journal': str(DATA / 'service/journal.sqlite'), 'socket': '/run/monos-probe/command.sock', 'execution_uid': 1000}
    need(BASE_CONFIG == expected, 'runner_config_changed')
    baseline = canonical()
    BASE_RUNNER = baseline['runner']
    need(BASE_RUNNER['connected'] is False and BASE_RUNNER['ready'] is False, 'runner_not_offline')
    counts = journal(); physical('preflight')
    save(WORK / 'preflight.json', {'canonical': baseline, 'journal_counts': counts, 'private_sha256': BASE_FILES})
    for path in BINS.values():
        read(path, 0, 0, 0o755)
    for path in (*BINS.values(), CONFIG):
        need(not os.path.lexists(path.with_name(path.name + '.http-install-v1')), 'replacement_collision')
    save(HTTP, http_recipe(BASE_COMPOSE))
    compose = ['docker', 'compose', '-p', PROJECT, '-f', str(HTTP)]
    before = json.loads(command(['docker', 'compose', '-p', PROJECT, '-f', str(ORIGINAL), 'config', '--format', 'json']))
    after = json.loads(command([*compose, 'config', '--format', 'json']))
    need(semantic(http_recipe(before)) == semantic(after), 'compose_delta_changed')
    need(build_inputs(args.build_result, args.build_sha256) == BUILD and private_files() == BASE_FILES, 'inputs_changed')
    container_policy(inspect(SERVER), 'server', OLD_IMAGE, False)
    canonical()
    journal(); physical('before-install')
    for name, path in BINS.items():
        raw = read(BUILD['binaries'][name]['path'])
        need(sha(raw) == BUILD['binaries'][name]['sha256'], 'staged_binary_changed')
        replace(path, raw)
    config = dict(BASE_CONFIG, endpoint='http://127.0.0.1:18445'); del config['ca_file']
    replace(CONFIG, (json.dumps(config) + '\n').encode(), 997, 986, 0o640)
    container_policy(inspect(SERVER), 'server', OLD_IMAGE, False)
    canonical()
    UP_ATTEMPTED = True
    command([*compose, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'server'], effect='server-up', timeout=60)
    NEW = identify_new_server()
    need(inspect(NEW[0])['State']['Running'], 'new_server_not_running')
    health_assets(); journal(); physical('before-start')
    r = canonical()['runner']
    need(r['incarnation'] == BASE_RUNNER['incarnation'] and not r['connected'] and not r['ready'], 'runner_changed_before_start')
    STARTED = True
    command(['/usr/bin/systemctl', 'start', UNIT], effect='runner-start', timeout=45)
    unit = OBS.show(UNIT)
    RUNNER_ID = (int(unit['MainPID']), unit['InvocationID'])
    need(RUNNER_ID[0] > 0 and re.fullmatch('[0-9a-f]{32}', RUNNER_ID[1]), 'runner_start_identity_unknown')
    deadline = time.monotonic() + 60
    while True:
        state = canonical(); r = state['runner']
        need(r['incarnation'] in (BASE_RUNNER['incarnation'], BASE_RUNNER['incarnation'] + 1), 'unexpected_reconnection')
        if r['ready'] and r['connected'] and r['recent']:
            break
        need(time.monotonic() < deadline, 'runner_readiness_timeout')
        time.sleep(0.5)
    need(r['incarnation'] == r['report'] == BASE_RUNNER['incarnation'] + 1 and r['boot'] == BOOT
         and r['connection'] != BASE_RUNNER['connection'] and len(state['runtimes']) == 1, 'runner_readiness_identity_changed')
    runtime = state['runtimes'][0]
    need(runtime['runner'] == r['id'] and runtime['incarnation'] == r['incarnation']
         and runtime['observation']['runtime_id'] == 'opencode' and runtime['observation']['availability'] == 'detected'
         and runtime['observation']['executable'] == '/home/linuxbrew/.linuxbrew/bin/opencode'
         and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?', runtime['observation']['version']), 'native_discovery_unavailable')
    physical('ready', True); journal(False)
    row = inspect(NEW[0]); container_policy(row, 'server', BUILD['image_id'], True)
    need((row['Id'], row['State']['StartedAt'], row['RestartCount']) == NEW and db_guard() == BASE_DB
         and private_files() == BASE_FILES and json.loads(read(CONFIG, 997, 986, 0o640)) == config
         and json.loads(read(ORIGINAL, mode=0o600)) == BASE_COMPOSE, 'installation_changed')
    need(all(sha(read(p, 0, 0, 0o755)) == BUILD['binaries'][n]['sha256'] for n, p in BINS.items()), 'installed_binary_changed')
    return {'outcome': 'pass', 'candidate_commit': BUILD['candidate_commit'], 'build_sha256': args.build_sha256,
            'server_image': BUILD['image_id'], 'binaries': BUILD['binaries'], 'server': NEW, 'database': DATABASE,
            'storage': STORAGE, 'endpoint': config['endpoint'], 'ready': state, 'assets': BUILD['assets'], 'automatic_effect_retry': False}


def contain():
    global NEW
    result = {'admissions': 'unidentified', 'runner': 'not_stopped', 'canonical_release': 'not_claimed'}
    if NEW is None and UP_ATTEMPTED:
        try:
            NEW = identify_new_server()  # Read-only recovery of an uncertain Compose reply.
        except Exception:
            return result
    if NEW is None:
        return result
    try:
        row = inspect(NEW[0]); container_policy(row, 'server', BUILD['image_id'], row['State']['Running'])
        need((row['Id'], row['State']['StartedAt'], row['RestartCount']) == NEW, 'containment_identity_changed')
        if row['State']['Running']:
            command(['docker', 'stop', '--time', '30', NEW[0]], effect='contain-server', timeout=45)
        need(not inspect(NEW[0])['State']['Running'], 'server_stop_unconfirmed')
        result['admissions'] = 'excluded'
        if STARTED and RUNNER_ID:
            physical('contain-runner', True)
            need((int(OBS.show(UNIT)['MainPID']), OBS.show(UNIT)['InvocationID']) == RUNNER_ID, 'runner_containment_identity_changed')
            command(['/usr/bin/systemctl', 'stop', UNIT], effect='contain-runner', timeout=45)
            result['runner'] = 'stop_returned; absence_not_claimed'
    except Exception:
        result['containment'] = 'incomplete; reconcile_exact_current_identity'
    return result


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build-result', required=True, type=Path)
    parser.add_argument('--build-sha256', required=True)
    args = parser.parse_args()
    try:
        result = install(args)
        save(WORK / 'result.json', result)
    except Exception as error:
        result = {'outcome': 'failed', 'reason': str(error) if isinstance(error, Stop) else type(error).__name__, 'automatic_effect_retry': False}
        if CLAIMED:
            result['containment'] = contain()
            save(WORK / 'failure.json', result)
    print(json.dumps(result, sort_keys=True))
    raise SystemExit(0 if result['outcome'] == 'pass' else 1)
