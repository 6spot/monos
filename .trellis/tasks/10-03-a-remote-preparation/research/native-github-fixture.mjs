/** One authorized, exact synthetic GitHub lower-kernel trial. No product source. */
import {createHash, randomUUID} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {spawn} from 'node:child_process';
import {lstat, mkdir, readFile} from 'node:fs/promises';
import {basename, isAbsolute, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalJSON} from '../../../../packages/protocol/src/index.ts';
import {NativeProviderKernel, fixture} from './native-provider-kernel.ts';

const argv = process.argv.slice(2);
if (![6, 8].includes(argv.length) || argv[0] !== '--control-socket' || argv[2] !== '--linux-evidence' || argv[4] !== '--output' || argv.length === 8 && argv[6] !== '--resume-from') throw new Error('Exact fixture arguments required');
const socket = argv[1], linuxEvidence = resolve(argv[3]), output = resolve(argv[5]);
if (!isAbsolute(socket)) throw new Error('Private task transport required');
const location = JSON.parse(await readFile(linuxEvidence + '/remote-location.json', 'utf8'));
const linux = JSON.parse(await readFile(linuxEvidence + '/result.json', 'utf8'));
if (!/^\/root\/monos-publication-validation-[0-9a-f]{32}$/.test(location.directory) || linux.complete !== true || linux.source_unchanged !== true || linux.source_manifest_sha256 !== location.source_manifest_sha256 || !/^[0-9a-f]{64}$/.test(linux.binaries?.['host.test']?.sha256 ?? '')) throw new Error('Final-source Linux evidence required');
const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const manifestBytes = await readFile(linuxEvidence + '/manifest.json');
if (createHash('sha256').update(manifestBytes).digest('hex') !== linux.source_manifest_sha256) throw new Error('Linux manifest digest differs');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
let originalInput;
if (argv.length === 8) {
  const previous = resolve(argv[7]), stat = await lstat(previous);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid?.()) throw new Error('Private original trial required');
  const read = async name => {
    const path = previous + '/' + name, info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o600 || info.uid !== process.getuid?.() || info.size > 512 * 1024) throw new Error('Original evidence invalid');
    return JSON.parse(await readFile(path, 'utf8'));
  };
  const boundary = await read('failed-trial-boundary.json'), observed = await read('failed-trial-ref-observation.json');
  const input = boundary.input, intent = await read('native-' + input.operation_id + '-intent.json');
  if (boundary.fixture_scope !== 'oauth_injected_remote_kernel' || input.action !== 'prepare_push' || canonicalJSON(intent.input) !== canonicalJSON(input) || ['timestamp.json', 'candidate.json', 'started.json', 'worker.json', 'result.json', 'proof.json'].some(name => boundary.facts[name].exists) || !boundary.facts['intent.json'].exists || boundary.facts['intent.json'].sha256 !== createHash('sha256').update(canonicalJSON(input)).digest('hex') || observed.repository_id !== fixture.id || observed.status !== 'absent' || observed.delivery_ref !== 'refs/heads/monos/task/' + input.task_id + '/' + input.resource_id) throw new Error('Original effect is not proven pre-push; reconcile instead of repeating');
  originalInput = input;
}
const providerPaths = ['apps/server/src/github-remote.ts', 'apps/server/src/github.ts', 'apps/server/src/publication-policy.ts', 'packages/domain/src/repositories.ts', 'packages/protocol/src/index.ts', 'packages/protocol/src/validation.ts', 'packages/protocol/schemas/v1/contracts.json', 'packages/protocol/generated/types.ts', 'pnpm-lock.yaml', '.trellis/tasks/10-03-a-remote-preparation/research/native-provider-kernel.ts', '.trellis/tasks/10-03-a-remote-preparation/research/native-github-fixture.mjs'];
const inputs = new Map(manifest.files.map(file => [file.path, file.sha256]));
for (const path of providerPaths) inputs.set(path, createHash('sha256').update(await readFile(resolve(repository, path))).digest('hex'));
async function verifyCurrentSource() {
  for (const [path, expected] of inputs) {
    const absolute = resolve(repository, path), stat = await lstat(absolute);
    if (!absolute.startsWith(repository) || !stat.isFile() || stat.isSymbolicLink() || createHash('sha256').update(await readFile(absolute)).digest('hex') !== expected) throw new Error('Current source differs from native/provider evidence');
  }
}
await verifyCurrentSource();
await mkdir(output, {mode: 0o700});
const kernel = await NativeProviderKernel.create(output);
await kernel.saveExclusive('source-inputs.json', {fixture_scope: 'oauth_injected_remote_kernel', linux_source_manifest_sha256: linux.source_manifest_sha256, inputs: Object.fromEntries(inputs)});
if (originalInput) await kernel.saveExclusive('original-trial-continuation.json', {fixture_scope: 'oauth_injected_remote_kernel', previous: resolve(argv[7]), original_operation_id: originalInput.operation_id, scope: 'same original pre-push operation after retained early failure; no started operation or POST replay'});
const remoteFixture = '/var/lib/monos-probe/service/' + basename(location.directory);
const python = String.raw`
import hashlib,json,os,pathlib,pwd,stat,subprocess,sys
raw=sys.stdin.buffer.read(32769)
assert len(raw)<=32768
envelope=json.loads(raw)
token=envelope['token'].encode()
assert 0<len(token)<=4096 and b'\x00' not in token and b'\r' not in token and b'\n' not in token
fixture=pathlib.Path(sys.argv[1]); expected=sys.argv[2]
assert fixture.parent==pathlib.Path('/var/lib/monos-probe/service')
assert fixture.name.startswith('monos-publication-validation-')
service=pwd.getpwnam('monos-probe');execution=pwd.getpwnam('me')
assert service.pw_uid!=execution.pw_uid
binary=fixture/'host.test'
assert hashlib.sha256(binary.read_bytes()).hexdigest()==expected
for p in [fixture,binary]:
 s=p.lstat();assert not stat.S_ISLNK(s.st_mode) and s.st_uid==service.pw_uid
assert stat.S_IMODE(binary.stat().st_mode)==0o500
root=fixture/'native-github'
try:
 root.mkdir(mode=0o700);os.chown(root,service.pw_uid,service.pw_gid)
except FileExistsError:
 s=root.lstat();assert stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode) and s.st_uid==service.pw_uid and stat.S_IMODE(s.st_mode)==0o700
credential_read,credential_write=os.pipe()
if credential_read!=3:
 os.dup2(credential_read,3);os.close(credential_read)
os.write(credential_write,token);os.close(credential_write)
metadata=json.dumps(envelope['input'],separators=(',',':')).encode()
environment={'PATH':'/usr/bin:/bin','TMPDIR':str(fixture/'temp'),'MONOS_REMOTE_GITHUB_EVIDENCE_DIR':str(root)}
child=subprocess.Popen([str(binary),'-test.v','-test.run','^TestRemotePreparationGitHubKernelFixture$'],cwd=fixture,env=environment,
 stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,pass_fds=(3,),user=service.pw_uid,group=service.pw_gid,extra_groups=[])
os.close(3)
try:log,_=child.communicate(metadata,timeout=150)
except subprocess.TimeoutExpired:
 child.kill();log,_=child.communicate();raise RuntimeError('Native fixture timed out; retained effect requires reconciliation')
assert len(log)<=65536 and token not in log
if child.returncode:
 sys.stdout.write(json.dumps({'ok':False,'exit_code':child.returncode,'log':log.decode('utf-8')}));sys.exit(0)
operation=root/'remote/items'/envelope['input']['item_id']/'operations'/envelope['input']['operation_id']
facts={};paths=[]
for name in ['intent','candidate','scan','absence','result','proof']:
 p=operation/(name+'.json');s=p.lstat()
 assert p==p.resolve() and p.is_relative_to(root) and stat.S_ISREG(s.st_mode) and not stat.S_ISLNK(s.st_mode)
 assert s.st_uid==service.pw_uid and s.st_gid==service.pw_gid and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<=524288
 b=p.read_bytes();assert token not in b;facts[name]=json.loads(b)
 denied={flag:subprocess.run(['runuser','-u',execution.pw_name,'--','test',flag,str(p)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==1 for flag in ['-r','-w']}
 assert all(denied.values())
 paths.append({'name':name,'uid':s.st_uid,'gid':s.st_gid,'mode':'0600','sha256':hashlib.sha256(b).hexdigest(),'execution_read_denied':denied['-r'],'execution_write_denied':denied['-w']})
sys.stdout.write(json.dumps({'ok':True,'evidence':facts,'log':log.decode('utf-8'),'boundary':{'fixture_scope':'oauth_injected_remote_kernel','service_uid':service.pw_uid,'execution_uid':execution.pw_uid,'binary_sha256':expected,'paths':paths}}))
`;
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

async function bridge(input, token) {
  await verifyCurrentSource();
  const command = ['python3', '-c', python, remoteFixture, linux.binaries['host.test'].sha256].map(quote).join(' ');
  const child = spawn('ssh', ['-S', socket, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'root@100.120.14.84', command], {stdio: ['pipe', 'pipe', 'pipe']});
  const chunks = []; let size = 0;
  child.stdout.on('data', chunk => {size += chunk.length; if (size > 1024 * 1024) child.kill(); else chunks.push(chunk);});
  child.stderr.resume();
  const finished = new Promise((accept, reject) => {child.on('error', reject); child.on('close', code => code === 0 && size <= 1024 * 1024 ? accept() : reject(new Error('Native transport failed; retained effect requires reconciliation')));});
  // Token travels only through anonymous stdin -> SSH -> anonymous FD3. It is
  // absent from arguments, environment, files, HTTP audit and Git configuration.
  child.stdin.end(JSON.stringify({input, token}));
  await finished;
  const bytes = Buffer.concat(chunks).toString('utf8');
  if (bytes.includes(token)) throw new Error('Unsafe native transport output refused');
  const result = JSON.parse(bytes);
  await kernel.saveExclusive('native-' + input.operation_id + '-transport.json', result);
  if (result.ok !== true) throw new Error('Native bridge failed; inspect retained safe transport evidence');
  return result.evidence;
}

const base = await kernel.preflight();
if (originalInput && originalInput.base !== base) throw new Error('Original public baseline drifted; reconciliation required');
const scope = {repository: fixture.name, repository_id: fixture.id, task_id: originalInput?.task_id ?? randomUUID(), resource_id: originalInput?.resource_id ?? randomUUID(), item_id: originalInput?.item_id ?? randomUUID(), base};
await kernel.saveExclusive('trial-scope.json', {fixture_scope: 'oauth_injected_remote_kernel', scope, linux_source_manifest_sha256: linux.source_manifest_sha256});
const first = await kernel.nativePush(originalInput ?? {...scope, action: 'prepare_push', operation_id: randomUUID(), expected_head: null, synthetic_text: 'first controlled synthetic result'}, bridge);
const review = await kernel.openWithLostResponse(first);
await kernel.checks(first, review.review);
const correction = await kernel.nativePush({...scope, action: 'correction_push', operation_id: randomUUID(), previous_operation_id: first.input.operation_id, expected_head: first.candidate.head, synthetic_text: 'second controlled synthetic result'}, bridge);
if (correction.candidate.parents[0] !== first.candidate.head || correction.candidate.head === first.candidate.head) throw new Error('Exact fast-forward correction missing');
const updated = await kernel.update(correction, review.review);
await kernel.checks(correction, updated.review);
await kernel.close(correction, updated.review);
await verifyCurrentSource();
await kernel.saveExclusive('trial-result.json', {fixture_scope: 'oauth_injected_remote_kernel', repository: fixture.name, repository_id: fixture.id, delivery_ref: correction.delivery_ref, pr: updated.review, first_head: first.candidate.head, correction_head: correction.candidate.head, branch_retained: true, pr_closed: true, production_app_issuance: 'not_proven', installed_coordinator: 'not_proven', owner_acceptance: 'not_performed', merge: 'not_performed'});
process.stdout.write('PASS: exact synthetic branch, withheld create recovery, same PR FF correction/checks, close with retained branch; OAuth kernel only\n');
