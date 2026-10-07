import argparse
import hashlib
import json
import os
import pathlib
import re
import shlex
import socket
import stat
import subprocess
import tarfile
import time
import traceback

os.umask(0o077)
E = pathlib.Path('/root/monos-delivery-acceptance-build-v2')
SOURCE = pathlib.Path('/root/monos-delivery-acceptance-src-v2')
TAGS = {'tests': 'monos-delivery-acceptance-tests:v2',
        'server': 'monos-delivery-acceptance-server:v2'}
NAMES = ('monos', 'monos-runner', 'monos-probe-launch', 'monos-probe-exec')
CANDIDATE = '63eaa285ab90fdd6de018671a47ba5583f87bc75'
sha = lambda p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
load = lambda p: json.loads(pathlib.Path(p).read_bytes())

def save(name, value):
    with (E / name).open('x') as target:
        json.dump(value, target, indent=2, sort_keys=True)
        target.write('\n')

def inspected(tag):
    value = subprocess.run(['docker', 'image', 'inspect', tag], capture_output=True)
    return json.loads(value.stdout)[0] if value.returncode == 0 else None

def run(label, command):
    started = time.time()
    print(json.dumps({'stage': label, 'state': 'started'}), flush=True)
    with (E / (label + '.log')).open('xb') as log:
        result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
    record = {'exit': result.returncode, 'started_epoch': started,
              'finished_epoch': time.time(), 'log_sha256': sha(E / (label + '.log'))}
    save(label + '.result.json', record)
    print(json.dumps({'stage': label, 'exit': result.returncode,
                      'seconds': round(record['finished_epoch'] - started, 2)}), flush=True)
    if result.returncode:
        raise RuntimeError(label + ' failed; retained private log and result')
    return record

def verify_source(m):
    actual = {p.relative_to(SOURCE).as_posix() for p in SOURCE.rglob('*') if p.is_file()}
    assert actual == set(m['files']), 'staged source contains missing or extra files'
    for name, expected in m['files'].items():
        path = SOURCE / name
        attrs = path.lstat()
        assert stat.S_ISREG(attrs.st_mode) and sha(path) == expected, name
        assert stat.S_IMODE(attrs.st_mode) == (int(m['git_modes'][name], 8) & 0o777), name

def finish_after_images(args):
    global E
    prior = E
    E = pathlib.Path(__file__).resolve().parent
    assert E == pathlib.Path('/root/monos-delivery-acceptance-build-v3')
    assert sha(prior / 'build.py') == '8cfef033b47f368c0481360118a2c8f58e45c8a507f8bd744e4901b9ef91a94c'
    assert sha(E / 'manifest.json') == sha(prior / 'manifest.json') == args.manifest_sha256
    m = load(E / 'manifest.json')
    assert m['candidate_commit'] == CANDIDATE and len(m['files']) == 493
    assert sha(prior / 'source.tar') == args.archive_sha256 == m['source_tar_sha256']
    assert sha(E / 'package.py') == m['package_script_sha256']
    stages = ('linux-go', 'docker-test-build', 'docker-server-build', 'verify-tests-image', 'verify-server-image')
    reused = {}
    for stage in stages:
        result = load(prior / (stage + '.result.json'))
        assert result['exit'] == 0 and sha(prior / (stage + '.log')) == result['log_sha256']
        reused[stage] = {'result_sha256': sha(prior / (stage + '.result.json')), **result}
    assert load(prior / 'targeted-postgres.result.json')['exit'] == 1
    assert not (prior / 'built.json').exists()
    intent = load(prior / 'build-intent.json')
    assert intent['candidate_commit'] == CANDIDATE and intent['manifest_sha256'] == args.manifest_sha256
    assert all(sha(prior / name) == digest for name, digest in intent['utilities_sha256'].items())
    verify_source(m)
    binaries = {p.name: sha(p) for p in (prior / 'bin').iterdir()}
    assert set(binaries) == set(NAMES)
    assert all((prior / 'bin' / name).read_bytes()[:4] == b'\x7fELF' and stat.S_IMODE((prior / 'bin' / name).stat().st_mode) == 0o755 for name in NAMES)
    images = {label: inspected(tag)['Id'] for label, tag in TAGS.items()}
    for label, image in images.items():
        stage = 'docker-test-build' if label == 'tests' else 'docker-server-build'
        exported = re.findall(r'exporting (?:config|manifest list) (sha256:[0-9a-f]{64})', (prior / (stage + '.log')).read_text())
        assert image in exported, 'Current tag differs from the closed successful Docker build'
    audits = {label: load(prior / ('verify-' + label + '-image.log')) for label in TAGS}
    assert audits['tests']['asset_hashes'] == audits['server']['asset_hashes']
    assert all(audit['native_imports_verified'] and audit['node'] == 'v24.21.0' for audit in audits.values())
    assert all(not any(e.split('=')[0].lower() in ('http_proxy', 'https_proxy', 'no_proxy') for e in inspected(tag)['Config']['Env']) for tag in TAGS.values())
    utilities = {name: sha(E / name) for name in ('package.py', 'build.py', 'targeted-db.mjs')}
    save('build-intent.json', {'candidate_commit': CANDIDATE, 'manifest_sha256': args.manifest_sha256,
        'source_tar_sha256': args.archive_sha256, 'reused_stage_directory': str(prior),
        'reused_stages': reused, 'binaries': binaries, 'images': images, 'utilities_sha256': utilities,
        'boundary': 'Only corrected targeted PG helper; reuse unchanged closed successful build stages; no install'})
    (E / 'build.claim').open('x').close()
    run('targeted-postgres', ['docker', 'run', '--rm', '--name', 'monos-delivery-acceptance-pg-v3',
        '--network', 'monos-boundary-probe_control', '--cpus', '2', '--memory', '4g',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '-v', '/root/monos-boundary-probe-src/infra/compose/private/database_url:/run/secrets/database_url:ro',
        '-v', str(E / 'targeted-db.mjs') + ':/targeted-db.mjs:ro', '-v', str(E) + ':/evidence',
        '-e', 'MONOS_DATABASE_URL_FILE=/run/secrets/database_url', '--entrypoint', 'node',
        images['tests'], '--experimental-strip-types', '/targeted-db.mjs'])
    pg = load(E / 'targeted-postgres-summary.json')
    assert pg['exit'] == 0 and pg['passed'] == 2 and pg['schema_set_preserved'] and pg['test_schema_removed']
    verify_source(m)
    assert all(sha(prior / 'bin' / name) == digest for name, digest in binaries.items())
    assert all(inspected(TAGS[label])['Id'] == image for label, image in images.items())
    assert all(sha(E / name) == digest for name, digest in utilities.items())
    assert sha(E / 'manifest.json') == sha(prior / 'manifest.json') == args.manifest_sha256
    assert all(sha(prior / name) == digest for name, digest in intent['utilities_sha256'].items())
    for stage, record in reused.items():
        assert sha(prior / (stage + '.result.json')) == record['result_sha256']
        assert sha(prior / (stage + '.log')) == record['log_sha256']
    remaining = subprocess.check_output(['docker', 'ps', '-a', '--format', '{{.Names}}'], text=True).splitlines()
    assert not any(name.startswith('monos-delivery-acceptance-') for name in remaining)
    save('cleanup.json', {'task_owned_containers': [], 'source_and_tags_retained': True, 'no_service_mutation': True})
    save('built.json', {'outcome': 'pass', 'candidate_commit': CANDIDATE,
        'source_tar_sha256': args.archive_sha256, 'manifest_sha256': args.manifest_sha256,
        'source_directory': str(SOURCE), 'binary_directory': str(prior / 'bin'),
        'binaries': binaries, 'binary_modes': {name: '0o755' for name in NAMES},
        'images': images, 'image_tags': TAGS, 'go_image_id': intent['go_image_id'],
        'asset_hashes': audits['server']['asset_hashes'], 'image_verification': audits,
        'reused_stage_directory': str(prior), 'reused_stages': reused, 'utilities_sha256': utilities,
        'targeted_postgres': pg, 'finished_epoch': time.time(), 'cleanup_sha256': sha(E / 'cleanup.json'),
        'current_stage_result_sha256': sha(E / 'targeted-postgres.result.json'),
        'limitations': ['V1 read-only fixture failure and V2 wrong pg package lookup retained; no product source changes.',
            'No installation/service restart/native model/provider acceptance performed.']})
    print(json.dumps({'outcome': 'pass', 'built_json': str(E / 'built.json'), 'built_sha256': sha(E / 'built.json'), 'images': images}), flush=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--archive-sha256', required=True)
    parser.add_argument('--finish-after-image-build', action='store_true')
    args = parser.parse_args()
    if args.finish_after_image_build:
        finish_after_images(args)
        return
    assert E == pathlib.Path(__file__).resolve().parent
    assert sha(E / 'manifest.json') == args.manifest_sha256
    m = load(E / 'manifest.json')
    assert m['candidate_commit'] == CANDIDATE and len(m['files']) == 493
    assert sha(E / 'source.tar') == args.archive_sha256 == m['source_tar_sha256']
    assert sha(E / 'installed-manifest.json') == m['installed_manifest_sha256']
    assert sha(E / 'package.py') == m['package_script_sha256']
    old = load(E / 'installed-manifest.json')
    delta = sorted(p for p in set(old['files']) | set(m['files'])
                   if old['files'].get(p) != m['files'].get(p))
    assert len(old['files']) == 372 and not set(old['files']) - set(m['files'])
    retained_migrations = [p for p in old['files'] if p.startswith('packages/db/migrations/')]
    assert len(retained_migrations) == 21
    assert all(old['files'][p] == m['files'][p] and old['git_modes'][p] == m['git_modes'][p] for p in retained_migrations)
    assert all(inspected(tag) is None for tag in TAGS.values()), 'candidate image tag already exists'
    assert not SOURCE.exists(), 'source staging path already exists'
    (E / 'build.claim').open('x').close()
    SOURCE.mkdir(mode=0o700)
    with tarfile.open(E / 'source.tar') as archive:
        members = archive.getmembers()
        assert len(members) == len(m['files'])
        assert {member.name for member in members} == set(m['files'])
        for member in members:
            assert member.isfile() and member.mode == (int(m['git_modes'][member.name], 8) & 0o777)
            assert not pathlib.PurePosixPath(member.name).is_absolute()
            assert '..' not in pathlib.PurePosixPath(member.name).parts
        archive.extractall(SOURCE, filter='data')
    verify_source(m)
    go_image = inspected('golang:1.27.1-bookworm')
    assert go_image and go_image['Id'] == 'sha256:69a7b9788769bec032d238959b61854e9ae87f57be9029ec04e9885fabf99195'
    try:
        with socket.create_connection(('127.0.0.1', 7890), timeout=2):
            proxy = True
    except OSError:
        proxy = False
    utilities = {name: sha(E / name) for name in ('package.py', 'build.py', 'targeted-db.mjs')}
    save('build-intent.json', {'candidate_commit': CANDIDATE,
        'source_tar_sha256': m['source_tar_sha256'], 'manifest_sha256': args.manifest_sha256,
        'installed_manifest_sha256': m['installed_manifest_sha256'],
        'source_directory': str(SOURCE), 'binary_directory': str(E / 'bin'),
        'changed_or_added_files': delta, 'go_image_id': go_image['Id'],
        'image_tags': TAGS, 'proxy_available': proxy, 'utilities_sha256': utilities,
        'boundary': 'isolated packaging/build/test only; no install, services, Owner settings or native model work'})
    (E / 'bin').mkdir(mode=0o700)
    with (E / 'source-checksums').open('x') as checksums:
        for name, digest in sorted(m['files'].items()):
            assert '\n' not in name and '\\' not in name
            checksums.write(digest + '  ' + name + '\n')
    go_script = """set -eu
mkdir -m 700 /work
cp -a /src/. /work/
cd /work
sha256sum -c --quiet /source-checksums
#VERIFY_MODES#
echo 'Frozen work copy bytes and modes verified'
mkdir -m 700 /work/tmp
export TMPDIR=/work/tmp
cd /work/runner
test "$(go env GOVERSION)" = go1.27.1
test "$(go env CGO_ENABLED)" = 1
go env GOVERSION GOOS GOARCH CGO_ENABLED
go mod verify
go test -race -p 2 -timeout 180s ./...
go vet ./...
for name in monos monos-runner monos-probe-launch monos-probe-exec; do
  go build -trimpath -o /out/$name ./cmd/$name
done
go version -m /out/monos /out/monos-runner /out/monos-probe-launch /out/monos-probe-exec
"""
    go_script = go_script.replace('#VERIFY_MODES#', '\n'.join(
        'test "$(stat -c %a ' + shlex.quote('/work/' + name) + ')" = ' + oct(int(mode, 8) & 0o777)[2:]
        for name, mode in sorted(m['git_modes'].items())))
    go_command = ['docker', 'run', '--rm', '--name', 'monos-delivery-acceptance-go-v2',
        '--network', 'none', '--cpus', '2', '--memory', '4g',
        '-e', 'GOPROXY=off', '-e', 'GOTOOLCHAIN=local', '-e', 'GOFLAGS=-mod=readonly',
        '-v', '/root/monos-logs-gomod-cache:/go/pkg/mod',
        '-v', '/root/monos-planning-go-build-cache:/root/.cache/go-build',
        '-v', str(SOURCE) + ':/src:ro', '-v', str(E / 'bin') + ':/out',
        '-v', str(E / 'source-checksums') + ':/source-checksums:ro',
        '-w', '/src/runner', go_image['Id'], 'sh', '-c', go_script]
    run('linux-go', go_command)
    binaries = {p.name: sha(p) for p in (E / 'bin').iterdir()}
    assert set(binaries) == set(NAMES)
    assert all((E / 'bin' / name).read_bytes()[:4] == b'\x7fELF' and stat.S_IMODE((E / 'bin' / name).stat().st_mode) == 0o755 for name in NAMES)
    for target, label in [('test', 'tests'), ('server', 'server')]:
        command = ['docker', 'build', '--network', 'host', '--target', target, '-t', TAGS[label]]
        if proxy:
            for value in ('HTTP_PROXY=http://127.0.0.1:7890',
                          'HTTPS_PROXY=http://127.0.0.1:7890', 'NO_PROXY=localhost,127.0.0.1'):
                command += ['--build-arg', value]
        command += ['-f', str(SOURCE / 'infra/compose/Dockerfile'), str(SOURCE)]
        run('docker-' + target + '-build', command)
    images = {}
    for label, tag in TAGS.items():
        meta = inspected(tag)
        assert meta
        assert not any(e.split('=')[0].lower() in ('http_proxy', 'https_proxy', 'no_proxy')
                       for e in meta['Config']['Env'])
        images[label] = meta['Id']
    verify_js = """
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const m=JSON.parse(fs.readFileSync('/manifest.json','utf8')),label=process.argv[1];
const fixed=new Set(['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','tsconfig.build.json','eslint.config.mjs','infra/compose/test-db.mjs']);
if(label==='tests'){fixed.add('infra/probe/selected-attempt.ts');fixed.add('infra/probe/workspace-attempt.ts');}
let count=0;
for(const [p,h] of Object.entries(m.files)){
 if(!(fixed.has(p)||['packages/','apps/server/','apps/web/','scripts/'].some(prefix=>p.startsWith(prefix))))continue;
 const f='/app/'+p,actual=crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
 if(actual!==h||(fs.statSync(f).mode&511)!==(parseInt(m.git_modes[p],8)&511))throw new Error('Image source mismatch: '+p);
 count++;
}
const assets={};
function scan(base,sub=''){
 for(const item of fs.readdirSync(path.join(base,sub),{withFileTypes:true})){
  const rel=path.join(sub,item.name);
  if(item.isDirectory())scan(base,rel);
  else if(item.isFile())assets[rel]=crypto.createHash('sha256').update(fs.readFileSync(path.join(base,rel))).digest('hex');
  else throw new Error('Unexpected asset type');
 }
}
scan('/app/apps/web/dist');
if(!assets['index.html']||!Object.keys(assets).some(x=>x.endsWith('.js'))||!Object.keys(assets).some(x=>x.endsWith('.css')))throw new Error('Missing built assets');
if(process.version!=='v24.21.0')throw new Error('Pinned Node version mismatch');
Promise.all([import('/app/apps/server/src/app.ts'),import('/app/apps/server/src/task-review-coordinator.ts')]).then(()=>console.log(JSON.stringify({source_files_verified:count,asset_hashes:assets,node:process.version,native_imports_verified:true}))).catch(()=>{console.error('Native app/coordinator import failed');process.exitCode=1;});
"""
    image_checks = {}
    for label, image in images.items():
        run('verify-' + label + '-image', ['docker', 'run', '--rm',
            '--name', 'monos-delivery-acceptance-verify-' + label + '-v2',
            '--network', 'none', '--read-only', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges',
            '-v', str(E / 'manifest.json') + ':/manifest.json:ro',
            '--entrypoint', 'node', image, '-e', verify_js, label])
        image_checks[label] = load(E / ('verify-' + label + '-image.log'))
    assert image_checks['tests']['asset_hashes'] == image_checks['server']['asset_hashes']
    secret = '/root/monos-boundary-probe-src/infra/compose/private/database_url'
    assert pathlib.Path(secret).is_file()
    run('targeted-postgres', ['docker', 'run', '--rm',
        '--name', 'monos-delivery-acceptance-pg-v2',
        '--network', 'monos-boundary-probe_control', '--cpus', '2', '--memory', '4g',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '-v', secret + ':/run/secrets/database_url:ro',
        '-v', str(E / 'targeted-db.mjs') + ':/targeted-db.mjs:ro',
        '-v', str(E) + ':/evidence',
        '-e', 'MONOS_DATABASE_URL_FILE=/run/secrets/database_url',
        '--entrypoint', 'node', images['tests'], '--experimental-strip-types', '/targeted-db.mjs'])
    pg = load(E / 'targeted-postgres-summary.json')
    assert pg['exit'] == 0 and pg['schema_set_preserved']
    verify_source(m)
    assert sha(E / 'manifest.json') == args.manifest_sha256
    assert all(sha(E / name) == value for name, value in utilities.items())
    assert all(sha(E / 'bin' / name) == value for name, value in binaries.items())
    for label, tag in TAGS.items():
        assert inspected(tag)['Id'] == images[label]
    results = {p.name: sha(p) for p in E.glob('*.result.json')}
    logs = {p.name: sha(p) for p in E.glob('*.log')}
    # Driver output is still being written by the SSH caller, so bind only closed stage logs.
    logs.pop('driver.log', None)
    built = {'outcome': 'pass', 'candidate_commit': CANDIDATE,
        'source_tar_sha256': m['source_tar_sha256'], 'manifest_sha256': args.manifest_sha256,
        'source_directory': str(SOURCE), 'binary_directory': str(E / 'bin'),
        'binaries': binaries, 'binary_modes': {name: oct((E / 'bin' / name).stat().st_mode & 0o777) for name in NAMES},
        'images': images, 'image_tags': TAGS, 'go_image_id': go_image['Id'],
        'asset_hashes': image_checks['server']['asset_hashes'], 'image_verification': image_checks,
        'utilities_sha256': utilities, 'result_hashes': results, 'log_hashes': logs,
        'targeted_postgres': pg, 'finished_epoch': time.time(),
        'checks': {'exact_source_and_modes_before_after': True,
            'linux_module_race_vet_four_fresh_binaries': True,
            'fresh_unique_images': True, 'image_source_and_mode_match': True,
            'server_test_assets_identical': True, 'no_runtime_proxy_environment': True,
            'targeted_postgres_passed_and_schemas_preserved': True},
        'limitations': ['No installation/service restart or native model work performed.',
            'Linux container tests do not establish host cgroup/native CLI lifecycle.',
            'Historical full fault suites were not repeated.']}
    remaining = subprocess.check_output(['docker','ps','-a','--format','{{.Names}}'], text=True).splitlines()
    assert not any(name.startswith('monos-delivery-acceptance-') for name in remaining), 'task-owned container remains'
    save('cleanup.json', {'task_owned_containers': [], 'source_and_tags_retained': True, 'no_service_mutation': True})
    built['cleanup_sha256'] = sha(E / 'cleanup.json')
    save('built.json', built)
    print(json.dumps({'outcome': 'pass', 'built_json': str(E / 'built.json'),
                      'built_sha256': sha(E / 'built.json'), 'images': images}), flush=True)

if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        if E.exists() and not (E / 'failure.json').exists():
            save('failure.json', {'outcome': 'fail', 'error_type': type(error).__name__,
                  'message': str(error), 'epoch': time.time()})
        traceback.print_exc()
        raise
