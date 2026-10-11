#!/usr/bin/env python3
"""Fresh single-host installer. Secrets enter through stdin or private files."""
import argparse
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import socket
import stat
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
HOST_ROOT = Path('/var/lib/monos-probe')
CONFIG = Path('/etc/monos-probe/runner.json')
IDENTITY = HOST_ROOT / 'service/runner-identity.json'
UNIT = 'monos-probe-runner.service'
BINARIES = ('monos', 'monos-runner', 'monos-probe-launch', 'monos-probe-exec')
STAGES = ('prepare', 'backend', 'owner', 'runner_host', 'runner_config', 'enroll', 'start')


class InstallError(Exception):
    pass


class PrivateArguments(argparse.ArgumentParser):
    def error(self, message):
        raise InstallError('Invalid installation arguments; use --help. Passwords must use stdin.')


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def private_read(path, owner=None, max_links=1, mode=0o600, group=None):
    uid = os.geteuid() if owner is None else owner
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != uid or info.st_mode & 0o777 != mode or not 1 <= info.st_nlink <= max_links or group is not None and info.st_gid != group:
            raise InstallError('Private file ownership or permissions do not match.')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            value = stream.read(65537)
        if len(value) > 65536:
            raise InstallError('Private file exceeds its limit.')
        return value
    finally:
        os.close(fd)


def publish_private(path, value, owner=None, mode=0o600, group=None):
    """Publish private state or the explicitly nonsecret service-readable config."""
    if mode not in (0o600, 0o640) or mode == 0o640 and (owner != 0 or group is None):
        raise InstallError('Invalid private publication permissions.')
    uid = os.geteuid() if owner is None else owner
    temporary = path.parent / ('.' + path.name + '.install-staging')
    if os.path.lexists(path):
        # Recover the exact publication after a crash between link and unlink.
        # An unrelated hardlink still fails the normal single-link check.
        if os.path.lexists(temporary):
            if private_read(path, uid, 2, mode, group) != value or private_read(temporary, uid, 2, mode, group) != value:
                raise InstallError('Retained private publication differs; preserving it.')
            final_info, staged_info = path.lstat(), temporary.lstat()
            if (final_info.st_dev, final_info.st_ino) != (staged_info.st_dev, staged_info.st_ino) or final_info.st_nlink != 2:
                raise InstallError('Retained private publication identity differs.')
            temporary.unlink()
            sync_directory(path.parent)
        if private_read(path, uid, mode=mode, group=group) != value:
            raise InstallError('Existing private file differs; preserving it.')
        with path.open('rb') as stream:
            os.fsync(stream.fileno())
        sync_directory(path.parent)
        return
    if os.path.lexists(temporary):
        if private_read(temporary, uid, mode=mode, group=group) != value:
            raise InstallError('Private staging is incomplete or changed; preserve it for explicit repair.')
        with temporary.open('rb') as stream:
            os.fsync(stream.fileno())
        os.link(temporary, path, follow_symlinks=False)
        temporary.unlink()
        sync_directory(path.parent)
        return
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(fd, mode)
        if uid != os.geteuid() or group is not None:
            os.fchown(fd, uid, group if group is not None else -1)
        with os.fdopen(fd, 'wb', closefd=False) as stream:
            stream.write(value)
            stream.flush()
            os.fsync(fd)
        os.link(temporary, path, follow_symlinks=False)
        temporary.unlink()
        sync_directory(path.parent)
    finally:
        os.close(fd)


def owner_input(stream):
    raw = stream.read(4097)
    if len(raw) > 4096:
        raise InstallError('Owner input exceeds its limit.')
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError):
        raise InstallError('Expected bounded Owner password JSON on stdin.') from None
    if not isinstance(value, dict) or set(value) != {'password'} or not isinstance(value['password'], str) or not 12 <= len(value['password']) <= 1024:
        raise InstallError('Expected a password of 12–1024 characters in stdin JSON.')
    return value


def trusted_directory(path, private=False):
    for parent in (path, *path.parents):
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise InstallError('Use root-owned directories with no group/other write access.')
    if private and path.stat().st_mode & 0o077:
        raise InstallError('The installation checkout must be private to root (mode 0700).')


def file_digest(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise InstallError('Installation source or binary is not a trusted regular file.')
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


class Installer:
    def __init__(self, root, artifacts, state_dir, owner, execution_uid):
        self.root, self.artifacts, self.state_dir = root, artifacts, state_dir
        self.owner_payload, self.execution_uid = owner, execution_uid
        self.path = state_dir / 'installation.json'
        self.state = None
        self.compose = ['docker', 'compose', '-f', str(root / 'infra/compose/compose.yaml')]

    def run(self, args, data=None, accepted=(0,), timeout=1800):
        # Child diagnostics are never echoed: they may contain credentials.
        try:
            result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                    cwd=self.root, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise InstallError('Installation command unavailable or timed out; retained state is unchanged.') from None
        if result.returncode not in accepted:
            raise InstallError('Installation command failed; inspect the named stage privately and resume.')
        return result

    def save(self):
        temp = self.state_dir / ('.state-' + str(uuid.uuid4()))
        publish_private(temp, encode(self.state))
        os.replace(temp, self.path)
        sync_directory(self.state_dir)

    def manifest(self):
        sources = ['infra/install/install.py', 'infra/compose/compose.yaml', 'infra/compose/Dockerfile',
                   'infra/compose/prepare.mjs', 'infra/runner/bootstrap.sh', 'pnpm-lock.yaml']
        return {'checkout': str(self.root), 'artifacts': str(self.artifacts), 'execution_uid': self.execution_uid,
                'sources': {name: file_digest(self.root / name) for name in sources},
                'binaries': {name: file_digest(self.artifacts / name) for name in BINARIES}}

    def load(self, resume):
        manifest = self.manifest()
        if os.path.lexists(self.path):
            if not resume:
                raise InstallError('Installation state exists. Use --resume with the same checkout and binaries.')
            self.state = json.loads(private_read(self.path))
            if self.state.get('schema_version') != 1 or self.state.get('manifest') != manifest:
                raise InstallError('Installation identity or inputs changed; preserving the original state.')
            done = self.state.get('done')
            if not isinstance(done, list) or done != list(STAGES[:len(done)]) or len(done) > len(STAGES):
                raise InstallError('Invalid retained installation stages.')
            if self.state.get('pending') not in (None, STAGES[len(done)] if len(done) < len(STAGES) else None):
                raise InstallError('Invalid retained installation stage intent.')
            for stage, field in (('prepare', 'private_digests'), ('runner_config', 'config_digest'), ('enroll', 'identity_digest')):
                if stage in done and not self.state.get(field):
                    raise InstallError('Retained installation is missing its completed-stage evidence.')
        else:
            if resume:
                raise InstallError('No retained installation exists to resume.')
            self.fresh_preflight()
            self.state = {'schema_version': 1, 'installation_id': str(uuid.uuid4()), 'manifest': manifest, 'done': [], 'pending': None}
            self.save()

    def fresh_preflight(self):
        if set(path.name for path in self.state_dir.iterdir()) - {'install.lock'}:
            raise InstallError('Unowned files exist in the installation state directory.')
        if os.path.lexists(self.root / 'infra/compose/private'):
            raise InstallError('Compose credentials already exist without this installation identity.')
        for kind in ('container', 'volume', 'network'):
            args = ['docker', kind, 'ls', '-q', '--filter', 'label=com.docker.compose.project=monos-boundary-probe']
            if kind == 'container':
                args.append('--all')
            if self.run(args, timeout=30).stdout.strip():
                raise InstallError('An existing Compose deployment owns this project name.')
        if self.run(['docker', 'volume', 'ls', '-q', '--filter', 'name=^monos-boundary-probe_database_data$'], timeout=30).stdout.strip():
            raise InstallError('The database volume name is already in use.')
        with socket.socket() as probe:
            try:
                probe.bind(('127.0.0.1', 18443))
            except OSError:
                raise InstallError('The loopback backend port is already in use.') from None
        self.run(['sh', str(self.root / 'infra/runner/bootstrap.sh'), str(self.artifacts), '--check'], timeout=60)

    def local_docker_context(self):
        if any(os.environ.get(name) for name in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')):
            raise InstallError('Use the local host Docker context without environment overrides.')
        endpoint = json.loads(self.run(['docker', 'context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'], timeout=30).stdout)
        if not isinstance(endpoint, str) or not endpoint.startswith('unix:///'):
            raise InstallError('The single-host installer requires a local Docker socket context.')

    def execute(self):
        for stage in STAGES:
            if stage in self.state['done']:
                continue
            self.state['pending'] = stage
            self.save()
            print('Installing stage: ' + stage, flush=True)
            getattr(self, stage)()
            self.state['done'].append(stage)
            self.state['pending'] = None
            self.save()
        print('Installed monos at http://127.0.0.1:18443. Configure Roles, Projects and policies in the Web app.')
        print('Coding tool login, model/Git execution and native host recovery still require verification.')

    def prepare(self):
        private = self.root / 'infra/compose/private'
        expected = ('db_password', 'database_url', 'signing_key', 'runner_credential')
        if not private.exists():
            self.run(['node', str(self.root / 'infra/compose/prepare.mjs')], timeout=30)
        trusted_directory(private, private=True)
        if set(p.name for p in private.iterdir()) != set(expected):
            raise InstallError('Private preparation is incomplete or changed; preserve it for explicit repair.')
        values = {name: private_read(private / name) for name in expected}
        if values['database_url'].strip() != b'postgresql://monos:' + values['db_password'].strip() + b'@database:5432/monos':
            raise InstallError('Prepared database credentials do not match.')
        for name in expected:
            with (private / name).open('rb') as stream:
                os.fsync(stream.fileno())
        sync_directory(private)
        sync_directory(private.parent)
        self.state['private_digests'] = {name: hashlib.sha256(value).hexdigest() for name, value in values.items()}

    def backend(self):
        self.run(self.compose + ['build', 'server'])
        self.run(self.compose + ['up', '-d', '--wait', '--wait-timeout', '120', 'database', 'server'], timeout=180)
        for _ in range(30):
            result = self.run(self.compose + ['exec', '-T', 'server', 'node', '-e',
                              "fetch('http://127.0.0.1:18443/health',{signal:AbortSignal.timeout(2000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"],
                              accepted=(0, 1), timeout=10)
            if result.returncode == 0:
                return
            time.sleep(1)
        raise InstallError('Backend health did not recover. Preserve the volume and resume after repair.')

    def owner(self):
        admin = self.compose + ['exec', '-T', 'server', 'node', '--experimental-strip-types', 'apps/server/src/owner-admin.ts']
        result = self.run(admin, encode(self.owner_payload), accepted=(0, 1), timeout=60)
        # A crash can occur after the sole Owner was committed. Authenticate the
        # original password through doctor instead of rotating or inspecting SQL.
        doctor = self.compose + ['exec', '-T', 'server', 'node', '--experimental-strip-types', 'apps/server/src/setup-doctor.ts']
        try:
            self.run(doctor, encode({'endpoint': 'http://127.0.0.1:18443', **self.owner_payload}), accepted=(0, 2), timeout=60)
        except InstallError:
            if result.returncode:
                raise InstallError('Owner bootstrap was not confirmed; supply the original password and resume. No password was rotated.') from None
            raise

    def runner_host(self):
        marker = HOST_ROOT / 'launch/installed-by-boundary-probe'
        script = ['sh', str(self.root / 'infra/runner/bootstrap.sh'), str(self.artifacts)]
        if marker.exists():
            self.run(script + ['--check'], timeout=60)
        else:
            self.run(script, timeout=180)
        self.verify_runner_binaries()
        with marker.open('rb') as stream:
            os.fsync(stream.fileno())
        sync_directory(marker.parent)

    def verify_runner_binaries(self):
        for name in BINARIES:
            installed = Path('/usr/local/bin/monos') if name == 'monos' else Path('/usr/local/libexec') / name
            if file_digest(installed) != self.state['manifest']['binaries'][name]:
                raise InstallError('Installed Runner binaries differ from this installation.')

    def runner_config(self):
        service = pwd.getpwnam('monos-probe')
        value = {'endpoint': 'http://127.0.0.1:18443', 'token_file': str(IDENTITY), 'runner_id': '',
                 'journal': str(HOST_ROOT / 'service/journal.sqlite'), 'socket': '/run/monos-probe/command.sock',
                 'execution_uid': self.execution_uid,
                 'execution_limits': {'cpu_quota_percent': 200, 'memory_max_bytes': 4294967296, 'tasks_max': 512},
                 'storage_min_free_bytes': 1073741824, 'log_retention_hours': 168, 'inspection_retention_hours': 24}
        publish_private(CONFIG, encode(value), owner=0, mode=0o640, group=service.pw_gid)
        self.state['config_digest'] = hashlib.sha256(encode(value)).hexdigest()

    def enroll(self):
        service = pwd.getpwnam('monos-probe')
        pending = Path(str(IDENTITY) + '.enroll.pending')
        command = ['sudo', '-u', 'monos-probe', '/usr/local/libexec/monos-runner', 'enroll', '--config', str(CONFIG)]
        grant_file = self.state_dir / 'enrollment-grant.json'
        if pending.exists():
            self.run(command, b'', timeout=60)
        elif not IDENTITY.exists():
            if not grant_file.exists():
                grant = self.run(self.compose + ['exec', '-T', 'server', 'node', '--experimental-strip-types', 'apps/server/src/runner-enrollment-admin.ts'],
                                 encode({'schema_version': 1, 'capacity': 2, 'ttl_seconds': 3600}), timeout=60).stdout
                # Store the original grant before any enrollment request is sent.
                publish_private(grant_file, grant)
            self.run(command, private_read(grant_file), timeout=60)
        identity_raw = private_read(IDENTITY, service.pw_uid)
        identity, grant = json.loads(identity_raw), json.loads(private_read(grant_file))
        if not isinstance(identity, dict) or set(identity) != {'schema_version', 'runner_id', 'credential'} or identity['schema_version'] != 1 or not isinstance(identity['runner_id'], str) or not isinstance(identity['credential'], str):
            raise InstallError('The installed Runner identity is invalid.')
        proof = {'schema_version': 1, 'enrollment_id': grant['enrollment_id'], 'runner_id': identity['runner_id'],
                 'credential_hash': hashlib.sha256(identity['credential'].encode()).hexdigest()}
        verified = self.run(self.compose + ['exec', '-T', 'server', 'node', '--experimental-strip-types', 'apps/server/src/runner-enrollment-admin.ts', '--verify'], encode(proof), timeout=60)
        response = json.loads(verified.stdout)
        if response.get('schema_version') != 1 or response.get('runner_id') != identity['runner_id']:
            raise InstallError('The Runner identity does not match the original enrollment receipt.')
        self.state['identity_digest'] = hashlib.sha256(identity_raw).hexdigest()

    def start(self):
        self.run(['systemctl', 'enable', '--now', UNIT], timeout=60)
        self.run(['systemctl', 'is-active', '--quiet', UNIT], timeout=30)

    def verify_retained(self):
        if 'runner_host' in self.state['done']:
            self.verify_runner_binaries()
        for name, expected in self.state.get('private_digests', {}).items():
            if hashlib.sha256(private_read(self.root / 'infra/compose/private' / name)).hexdigest() != expected:
                raise InstallError('Compose credentials changed; refusing to continue.')
        if self.state.get('config_digest'):
            service = pwd.getpwnam('monos-probe')
            if hashlib.sha256(private_read(CONFIG, owner=0, mode=0o640, group=service.pw_gid)).hexdigest() != self.state['config_digest']:
                raise InstallError('Runner configuration changed; refusing to continue.')
        if self.state.get('identity_digest'):
            service = pwd.getpwnam('monos-probe')
            if hashlib.sha256(private_read(IDENTITY, service.pw_uid)).hexdigest() != self.state['identity_digest']:
                raise InstallError('Runner identity changed; refusing to continue.')


def main():
    parser = PrivateArguments(description=__doc__)
    parser.add_argument('--artifacts', required=True, type=Path, help='Root-owned directory containing the four Linux Runner binaries')
    parser.add_argument('--resume', action='store_true', help='Continue this exact retained installation')
    parser.add_argument('--plan', action='store_true', help='Print stages without reading secrets or running commands')
    options = parser.parse_args()
    if not options.artifacts.is_absolute() or '..' in options.artifacts.parts:
        raise InstallError('The binary directory must be an absolute normalized path.')
    if options.plan:
        print(' -> '.join(STAGES))
        return
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise InstallError('Installation requires the Linux host administrator.')
    os.umask(0o077)
    trusted_directory(ROOT, private=True)
    trusted_directory(options.artifacts)
    for executable in ('docker', 'node', 'sudo', 'systemctl'):
        if not shutil.which(executable):
            raise InstallError('Missing required host command: ' + executable)
    execution = pwd.getpwnam('me')
    if execution.pw_uid == 0:
        raise InstallError('The existing execution account me must be non-root.')
    try:
        docker_gid = grp.getgrnam('docker').gr_gid
    except KeyError:
        docker_gid = None
    if docker_gid in os.getgrouplist('me', execution.pw_gid):
        raise InstallError('Remove the execution account me from the control-plane Docker group before installation.')
    owner = owner_input(sys.stdin.buffer)
    state_dir = ROOT / 'infra/install/private'
    state_dir.mkdir(mode=0o700, exist_ok=True)
    trusted_directory(state_dir, private=True)
    sync_directory(state_dir.parent)
    lock = os.open(state_dir / 'install.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        installer = Installer(ROOT, options.artifacts, state_dir, owner, execution.pw_uid)
        installer.local_docker_context()
        installer.load(options.resume)
        installer.verify_retained()
        installer.execute()
    finally:
        os.close(lock)


if __name__ == '__main__':
    try:
        main()
    except (InstallError, OSError, KeyError, ValueError) as error:
        # OS/JSON errors can include private values; only our fixed errors print.
        print(str(error) if isinstance(error, InstallError) else 'Installation stopped; inspect private state and prerequisites before --resume.', file=sys.stderr)
        sys.exit(1)
