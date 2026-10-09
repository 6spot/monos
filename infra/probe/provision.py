#!/usr/bin/env python3
"""Prepare only reviewed monos probe configuration and a local Git fixture.

Run after infra/runner/bootstrap.sh. This never starts a service, installs or
authenticates a Runtime, publishes Git, or overwrites differing existing data.
"""
import argparse
import grp
import json
import os
import pathlib
import pwd
import ssl
import stat
import subprocess
import sys

from transport import endpoint_origin, tls_context

SOURCE = pathlib.Path("/root/monos-boundary-probe-src")
ROOT = pathlib.Path("/var/lib/monos-probe")
CONFIG = pathlib.Path("/etc/monos-probe")
MARKER = ROOT / "launch/installed-by-boundary-probe"


def directory(path, owner, group=None, mode=None):
    value = path.lstat()
    if not stat.S_ISDIR(value.st_mode) or value.st_uid != owner or value.st_mode & 0o022:
        raise RuntimeError("unexpected directory ownership/type/permissions: " + str(path))
    if group is not None and value.st_gid != group:
        raise RuntimeError("unexpected directory group: " + str(path))
    if mode is not None and stat.S_IMODE(value.st_mode) != mode:
        raise RuntimeError("unexpected private directory mode: " + str(path))


def regular(path, owner, mode=None):
    value = path.lstat()
    if not stat.S_ISREG(value.st_mode) or value.st_uid != owner or value.st_mode & 0o022:
        raise RuntimeError("unexpected file ownership/type/permissions: " + str(path))
    if mode is not None and stat.S_IMODE(value.st_mode) != mode:
        raise RuntimeError("unexpected file mode: " + str(path))


def check_existing(path, content, owner, group, mode):
    if not os.path.lexists(path):
        return False
    regular(path, owner, mode)
    if path.stat().st_gid != group or path.read_bytes() != content:
        raise RuntimeError("existing provisioned file differs; preserved: " + str(path))
    return True


def create_file(path, content, owner, group, mode):
    # The parent is root-owned and prevalidated. O_EXCL never follows a late
    # symlink or replaces an existing credential/configuration file.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(content)
        output.flush()
        os.fchown(output.fileno(), owner, group)
        os.fchmod(output.fileno(), mode)
        os.fsync(output.fileno())
    parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


# Executed as the service account through stdin; root does not run Git. Keep
# all paths fixed, with no external input and no remote repository operations.
FIXTURE_WORKER = r'''
import hashlib,json,os,pathlib,stat,subprocess,sys
os.umask(0o027)
root=pathlib.Path('/var/lib/monos-probe/cache')
seed=root/'fixture-seed'
repo=root/'fixture.git'
marker=root/'fixture.provision.json'
readme=b'# monos boundary fixture\n\nLocal, disposable probe repository. No remote publication.\n'
environment={'PATH':'/usr/bin:/bin','HOME':'/var/lib/monos-probe/service','LANG':'C.UTF-8','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_TERMINAL_PROMPT':'0','GIT_AUTHOR_NAME':'monos fixture','GIT_AUTHOR_EMAIL':'fixture@monos.invalid','GIT_COMMITTER_NAME':'monos fixture','GIT_COMMITTER_EMAIL':'fixture@monos.invalid','GIT_AUTHOR_DATE':'2026-09-28T00:00:00Z','GIT_COMMITTER_DATE':'2026-09-28T00:00:00Z'}
def git(cwd,*args):
    result=subprocess.run(['/usr/bin/git','-c','core.hooksPath=/dev/null',*args],cwd=cwd,env=environment,capture_output=True,timeout=30)
    if result.returncode: raise RuntimeError('local fixture Git command failed; existing data preserved')
    return result.stdout
def owned(path):
    info=path.lstat()
    if info.st_uid!=os.getuid() or info.st_gid!=os.getgid() or info.st_mode&0o022 or stat.S_ISLNK(info.st_mode):
        raise RuntimeError('fixture ownership/mode is unexpected')
owned(root)
if os.path.lexists(repo) or os.path.lexists(marker):
    if not repo.is_dir() or not marker.is_file(): raise RuntimeError('incomplete existing fixture; inspect before retry')
    owned(repo);owned(marker)
    expected=json.loads(marker.read_text())
    if expected.get('fixture_version')!=1 or expected.get('readme_sha256')!=hashlib.sha256(readme).hexdigest(): raise RuntimeError('unknown existing fixture marker')
    if git(root,'--git-dir='+str(repo),'show','HEAD:README.md')!=readme: raise RuntimeError('existing fixture README differs')
    if git(root,'--git-dir='+str(repo),'rev-list','--count','HEAD').strip()!=b'1': raise RuntimeError('existing fixture history differs')
    commit=git(root,'--git-dir='+str(repo),'rev-parse','HEAD').decode().strip()
    tree=git(root,'--git-dir='+str(repo),'rev-parse','HEAD^{tree}').decode().strip()
    if commit!=expected.get('commit') or tree!=expected.get('tree'): raise RuntimeError('existing fixture identity differs')
    if git(root,'--git-dir='+str(repo),'symbolic-ref','HEAD').strip()!=b'refs/heads/main': raise RuntimeError('existing fixture default branch differs')
    if git(root,'--git-dir='+str(repo),'show-ref').decode().strip()!=commit+' refs/heads/main': raise RuntimeError('existing fixture has unexpected refs')
    if git(root,'--git-dir='+str(repo),'remote').strip(): raise RuntimeError('fixture unexpectedly has a remote')
    result='verified-existing'
else:
    if os.path.lexists(seed): raise RuntimeError('unfinished fixture seed exists; preserved for inspection')
    seed.mkdir(mode=0o750)
    with (seed/'README.md').open('xb') as output: output.write(readme)
    git(seed,'init','--quiet','--initial-branch=main')
    git(seed,'add','README.md')
    git(seed,'commit','--quiet','-m','Initialize local monos boundary fixture')
    git(root,'clone','--quiet','--bare','--no-local',str(seed),str(repo))
    if b'origin' in git(root,'--git-dir='+str(repo),'remote').splitlines(): git(root,'--git-dir='+str(repo),'remote','remove','origin')
    commit=git(root,'--git-dir='+str(repo),'rev-parse','HEAD').decode().strip()
    tree=git(root,'--git-dir='+str(repo),'rev-parse','HEAD^{tree}').decode().strip()
    data={'fixture_version':1,'readme_sha256':hashlib.sha256(readme).hexdigest(),'commit':commit,'tree':tree}
    with marker.open('x') as output:
        json.dump(data,output,sort_keys=True);output.write('\n');output.flush();os.fsync(output.fileno())
    descriptor=os.open(root,os.O_RDONLY|os.O_DIRECTORY);os.fsync(descriptor);os.close(descriptor)
    result='created'
for parent,dirs,files in os.walk(repo,followlinks=False):
    for name in dirs+files: owned(pathlib.Path(parent)/name)
print(json.dumps({'fixture':result,'commit':commit,'tree':tree}))
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--endpoint', default='http://127.0.0.1:18443', help='backend HTTP(S) origin')
    parser.add_argument('--ca-file', type=pathlib.Path, help='optional public custom CA for HTTPS')
    args = parser.parse_args()
    endpoint = endpoint_origin(args.endpoint)
    if args.ca_file and endpoint.startswith('http://'):
        raise ValueError('--ca-file requires an HTTPS endpoint')
    if os.geteuid() != 0 or sys.platform != "linux":
        raise RuntimeError("run as root on the authorized Linux host")
    service = pwd.getpwnam("monos-probe")
    execution = pwd.getpwnam("me")
    shared = grp.getgrnam("monos-probe-read")
    if service.pw_uid in (0, execution.pw_uid) or execution.pw_uid == 0 or service.pw_gid != shared.gr_gid or service.pw_dir != str(ROOT / "service") or service.pw_shell != "/usr/sbin/nologin":
        raise RuntimeError("reviewed service/execution identity changed")
    if shared.gr_gid not in os.getgrouplist("me", execution.pw_gid):
        raise RuntimeError("execution identity lacks the reviewed read group")
    for path in [SOURCE, *SOURCE.parents, ROOT, *ROOT.parents, CONFIG, *CONFIG.parents]:
        directory(path, 0)
    for name in ("launch", "execution"):
        directory(ROOT / name, 0, 0)
    directory(ROOT / "logs", 0, shared.gr_gid)
    directory(ROOT / "service", service.pw_uid, shared.gr_gid, 0o700)
    directory(ROOT / "results", service.pw_uid, shared.gr_gid, 0o700)
    for name in ("cache", "inspection"):
        directory(ROOT / name, service.pw_uid, shared.gr_gid)
    directory(CONFIG, 0, shared.gr_gid, 0o750)
    regular(MARKER, 0, 0o600)
    if MARKER.read_text() != "monos-boundary-probe-v1\n":
        raise RuntimeError("reviewed bootstrap marker is missing or changed")
    for path in ("/usr/local/libexec/monos-probe-launch", "/usr/local/libexec/monos-probe-exec", "/usr/local/libexec/monos-runner", "/usr/local/bin/monos", "/etc/sudoers.d/monos-probe", "/etc/systemd/system/monos-probe-runner.service"):
        regular(pathlib.Path(path), 0)
    private = SOURCE / "infra/compose/private"
    for path in (SOURCE / "infra", SOURCE / "infra/compose"):
        directory(path, 0)
    directory(private, 0, mode=0o700)
    regular(private / "runner_credential", 0, 0o600)
    token = (private / "runner_credential").read_bytes()
    if len(token.strip()) < 32 or any(byte not in b"0123456789abcdef\n" for byte in token):
        raise RuntimeError("generated Runner credential has unexpected format")
    settings = {"endpoint": endpoint, "token_file": str(CONFIG / "runner-token"), "runner_id": "runner-a", "journal": str(ROOT / "service/journal.sqlite"), "socket": "/run/monos-probe/command.sock", "execution_uid": execution.pw_uid}
    ca = None
    if args.ca_file:
        regular(args.ca_file, 0)
        ca = args.ca_file.read_bytes()
        if b"PRIVATE KEY" in ca:
            raise RuntimeError("expected a public CA certificate")
        ssl.PEM_cert_to_DER_cert(ca.decode("ascii"))
        tls_context({'endpoint': endpoint, 'ca_file': str(args.ca_file)})
        settings['ca_file'] = str(CONFIG / 'ca.pem')
    config = (json.dumps(settings, indent=2, sort_keys=True) + "\n").encode()
    files = [(CONFIG / "runner-token", token, service.pw_uid, shared.gr_gid, 0o600),
             (CONFIG / "runner.json", config, service.pw_uid, shared.gr_gid, 0o640)]
    if ca is not None:
        files.append((CONFIG / "ca.pem", ca, 0, 0, 0o644))
    existing = [check_existing(*entry) for entry in files]
    # All conflicts are checked before any new target is created.
    for entry, present in zip(files, existing):
        if not present:
            create_file(*entry)
    result = subprocess.run(["/usr/sbin/runuser", "-u", "monos-probe", "--", "/usr/bin/python3", "-"], input=FIXTURE_WORKER.encode(), cwd=ROOT / "cache", capture_output=True, timeout=120,
                            env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"})
    if result.returncode:
        raise RuntimeError("service-owned fixture preparation failed; existing files/data preserved")
    fixture = json.loads(result.stdout)
    print(json.dumps({"configuration": "verified-or-created", "runner_id": "runner-a", "capacity_for_enrollment": 2, "execution_uid": execution.pw_uid, "fixture": fixture, "service_started": False}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"provision": "failed", "category": type(error).__name__, "message": str(error)[:240]}))
        sys.exit(1)
