#!/usr/bin/env python3
"""Isolated CGO/tests and code-produced account permissions; no installation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tarfile
import tempfile
import uuid

REMOTE = r'''
import hashlib,json,os,pathlib,pwd,shutil,stat,subprocess,sys,time
root=pathlib.Path(sys.argv[1]); source=root/'source'; out=root/'out'
manifest=json.loads((root/'manifest.json').read_text())
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def unchanged():return all(digest(source/x['path'])==x['sha256'] for x in manifest['files'])
assert unchanged(), 'source mismatch before admission'
result={'scope':'isolated Linux CGO and service-account actual Git fixture; no installation, Runtime, provider or production state mutation','source_manifest_sha256':digest(root/'manifest.json'),'steps':[]}
def save():
 p=root/'result.json'; temporary=root/'result.tmp'
 with temporary.open('w') as f:json.dump(result,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 os.replace(temporary,p)
def run(name,args,cwd=None,env=None):
 log=root/(name+'.log');start=time.time()
 with log.open('xb') as f:r=subprocess.run(args,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT)
 result['steps'].append({'name':name,'exit_code':r.returncode,'seconds':time.time()-start,'log_sha256':digest(log)})
 save()
 if r.returncode:raise RuntimeError('isolated stage failed: '+name)
image='golang:1.27.1-bookworm'
result['image']=json.loads(subprocess.check_output(['docker','image','inspect',image]))[0]['Id']
result['host']=subprocess.check_output(['uname','-srm'],text=True).strip()
result['native_git']=subprocess.check_output(['git','--version'],text=True).strip()
for d in ['out','module-cache','build-cache','private-temp']:(root/d).mkdir(mode=0o700)
import tarfile
tarfile.open(root/'module-cache.tar.gz').extractall(root/'module-cache',filter='data')
def container(name,command):
 args=['docker','run','--rm','--network','none','--name','monos-publication-'+root.name.rsplit('-',1)[-1]+'-'+name,
  '-v',str(source)+':/src','-v',str(out)+':/out','-v',str(root/'module-cache')+':/go/pkg/mod',
  '-v',str(root/'build-cache')+':/root/.cache/go-build','-v',str(root/'private-temp')+':/private-temp',
  '-w','/src/runner','-e','TMPDIR=/private-temp','-e','CGO_ENABLED=1','-e','GOPROXY=off','-e','GOSUMDB=off',image]+command
 run(name,args)
container('dependency-verify',['go','mod','verify'])
container('module',['go','test','./...'])
container('race',['go','test','-race','./...'])
container('vet',['go','vet','./...'])
container('host-build',['go','test','-c','-o','/out/host.test','./internal/host'])
for executable in ['monos','monos-runner','monos-probe-launch','monos-probe-exec']:
 container('build-'+executable,['go','build','-trimpath','-o','/out/'+executable,'./cmd/'+executable])
assert unchanged(), 'source changed during container tests'
result['binaries']={p.name:{'sha256':digest(p),'bytes':p.stat().st_size} for p in out.iterdir() if p.is_file()}
service=pwd.getpwnam('monos-probe');execution=pwd.getpwnam('me');assert service.pw_uid!=execution.pw_uid
fixture=pathlib.Path('/var/lib/monos-probe/service')/root.name
fixture.mkdir(mode=0o700);os.chown(fixture,service.pw_uid,service.pw_gid)
binary=fixture/'host.test';shutil.copyfile(out/'host.test',binary);os.chmod(binary,0o500);os.chown(binary,service.pw_uid,service.pw_gid)
retained=fixture/'retained';retained.mkdir(mode=0o700);os.chown(retained,service.pw_uid,service.pw_gid)
temporary=fixture/'temp';temporary.mkdir(mode=0o700);os.chown(temporary,service.pw_uid,service.pw_gid)
run('native-git',['runuser','-u',service.pw_name,'--','env','TMPDIR='+str(temporary),str(binary),'-test.v','-test.run','^TestPublication'],cwd=fixture)
run('native-retained',['runuser','-u',service.pw_name,'--','env','TMPDIR='+str(temporary),'MONOS_PUBLICATION_EVIDENCE_DIR='+str(retained),str(binary),'-test.v','-test.run','^TestPublicationNativeRetainedPermissionFixture$'],cwd=fixture)
proof=json.loads((retained/'proof.json').read_text());result['native_proof']=proof;checks=[]
for key,mode in [('export',0o700),('journal',0o700),('intent_path',0o600),('pages_path',0o600),('candidate_path',0o600)]:
 p=pathlib.Path(proof[key]);assert p.resolve().is_relative_to(fixture.resolve())
 st=p.lstat();assert not stat.S_ISLNK(st.st_mode) and st.st_uid==service.pw_uid and stat.S_IMODE(st.st_mode)==mode
 denied={permission:subprocess.run(['runuser','-u',execution.pw_name,'--','test',permission,str(p)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==1 for permission in ['-r','-w']}
 assert all(denied.values()),'execution account unexpectedly has access'
 checks.append({'kind':key,'path':str(p),'uid':st.st_uid,'gid':st.st_gid,'mode':oct(mode),'execution_read_denied':denied['-r'],'execution_write_denied':denied['-w'],'sha256':digest(p) if p.is_file() else None})
result['permissions']=checks;result['source_unchanged']=unchanged();result['complete']=True;save()
'''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--auth-file', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    repository = Path.cwd()
    paths = sorted(subprocess.check_output(['rg', '--files', 'runner', 'packages/protocol/generated/go', 'packages/protocol/fixtures'], text=True).splitlines())
    files = []
    for path in paths:
        p = repository / path
        assert p.is_file() and not p.is_symlink()
        files.append({'path': path, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest(), 'mode': oct(p.stat().st_mode & 0o777)})
    manifest = output / 'manifest.json'
    manifest.write_text(json.dumps({'files': files}, indent=2) + '\n')
    archive = output / 'source.tar.gz'
    with tarfile.open(archive, 'w:gz') as tar:
        for path in paths:
            tar.add(repository / path, arcname=path, recursive=False)
    program = output / 'remote-validation.py'
    program.write_text(REMOTE)
    go = '/Users/me/.local/share/mise/installs/go/1.27.1/bin/go'
    cache = Path(subprocess.check_output([go, 'env', 'GOMODCACHE'], text=True).strip()) / 'cache/download'
    versions = {}
    for line in (repository / 'runner/go.sum').read_text().splitlines():
        module, version, checksum = line.split()
        if not version.endswith('/go.mod'):
            versions[(module, version)] = checksum
    dependencies = []
    dependency_archive = output / 'module-cache.tar.gz'
    with tarfile.open(dependency_archive, 'w:gz') as tar:
        for (module, version), checksum in sorted(versions.items()):
            encoded = ''.join('!' + c.lower() if c.isupper() else c for c in module)
            stem = Path(encoded) / '@v' / version
            assert (cache / (str(stem) + '.ziphash')).read_text().strip() == checksum
            for suffix in ['.zip', '.ziphash', '.mod', '.info']:
                path = Path(str(stem) + suffix)
                original = cache / path
                assert original.is_file() and not original.is_symlink()
                tar.add(original, arcname='cache/download/' + str(path), recursive=False)
                dependencies.append({'path': str(path), 'sha256': hashlib.sha256(original.read_bytes()).hexdigest()})
    (output / 'dependency-cache-manifest.json').write_text(json.dumps({'files': dependencies, 'go_sum_sha256': hashlib.sha256((repository / 'runner/go.sum').read_bytes()).hexdigest()}, indent=2) + '\n')
    auth_path = Path(args.auth_file)
    assert not auth_path.is_symlink() and (auth_path.stat().st_mode & 0o777) == 0o600
    auth = json.loads(auth_path.read_text())
    assert auth['host'] == '100.120.14.84' and auth['user'] == 'root'
    secret = auth['credential']
    escaped = secret.replace('\\', '\\\\').replace('"', '\\"').replace('$', '\\$').replace('[', '\\[').replace(']', '\\]')
    control = Path(tempfile.mkdtemp(dir='/private/tmp', prefix='monos-pub-'))
    socket = control / 's'
    remote = '/root/monos-publication-validation-' + uuid.uuid4().hex
    script = 'set timeout 15\nlog_user 0\nspawn ssh -o BatchMode=no -o NumberOfPasswordPrompts=1 -o ConnectTimeout=8 -o ControlPersist=600 -M -S ' + str(socket) + ' -fN root@100.120.14.84\nexpect {\n -re {(?i)password:} {send -- "' + escaped + '\\r"; exp_continue}\n eof {set r [wait]; puts "AUTH_EXIT:[lindex $r 3]"}\n timeout {puts {AUTH_TIMEOUT}; exit 1}\n}\n'
    def ssh(command, timeout=30):
        return subprocess.run(['ssh', '-S', str(socket), '-o', 'BatchMode=yes', 'root@100.120.14.84', command], check=True, capture_output=True, text=True, timeout=timeout)
    try:
        authentication = subprocess.run(['expect'], input=script, text=True, capture_output=True, timeout=20)
        assert 'AUTH_EXIT:0' in authentication.stdout, 'private SSH authentication failed'
        mkdir = 'import os;os.mkdir(' + repr(remote) + ',0o700);os.mkdir(' + repr(remote + '/source') + ',0o700)'
        ssh('python3 -c ' + shlex.quote(mkdir))
        for p in [archive, manifest, program, dependency_archive]:
            subprocess.run(['scp', '-q', '-o', 'ControlPath=' + str(socket), '-o', 'BatchMode=yes', str(p), 'root@100.120.14.84:' + remote + '/' + p.name], check=True, capture_output=True, timeout=45)
        extraction = 'import tarfile;tarfile.open(' + repr(remote + '/source.tar.gz') + ').extractall(' + repr(remote + '/source') + ',filter="data")'
        ssh('python3 -c ' + shlex.quote(extraction))
        command = 'nohup python3 ' + shlex.quote(remote + '/remote-validation.py') + ' ' + shlex.quote(remote) + ' >' + shlex.quote(remote + '/job.log') + ' 2>&1 </dev/null &'
        ssh(command)
        (output / 'remote-location.json').write_text(json.dumps({'directory': remote, 'control_directory': str(control), 'source_manifest_sha256': hashlib.sha256(manifest.read_bytes()).hexdigest()}, indent=2) + '\n')
        print('Isolated Linux job started:', remote, flush=True)
        print('Local evidence:', output, flush=True)
        # Keep only the bounded task transport; main polls and explicitly closes it.
    except BaseException:
        subprocess.run(['ssh', '-S', str(socket), '-O', 'exit', 'root@100.120.14.84'], capture_output=True, timeout=10)
        if socket.exists():
            socket.unlink()
        control.rmdir()
        raise


if __name__ == '__main__':
    main()
