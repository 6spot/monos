#!/usr/bin/env python3
"""Reuse accepted isolated Linux build transport for the remote preparation gate.

The retained-output fixture proves the current full remote lane against a
synthetic bare Git receiver, with independent account and exact object checks.
This helper does not install binaries, restart services or invoke a Runtime.
"""
import importlib.util
from pathlib import Path


REMOTE_RETAINED = r'''
remote_retained=fixture/'remote-retained'
remote_retained.mkdir(mode=0o700)
os.chown(remote_retained,service.pw_uid,service.pw_gid)
run('native-remote-retained',['runuser','-u',service.pw_name,'--','env',
 'TMPDIR='+str(temporary),
 'MONOS_REMOTE_PREPARATION_EVIDENCE_DIR='+str(remote_retained),str(binary),
 '-test.v','-test.run','^TestRemotePreparationNativeRetainedPermissionFixture$'],cwd=fixture)
remote_proof_path=remote_retained/'proof.json'
assert remote_proof_path.stat().st_size<=16384
remote_proof=json.loads(remote_proof_path.read_text())
assert remote_proof['schema_version']==1
assert remote_proof['fixture_scope']=='full_lane_actual_git_synthetic_baseline'
assert remote_proof['service_uid']==service.pw_uid
assert remote_proof['head']==remote_proof['observed_head']
expected_modes={k:0o700 for k in ['root','journal','item','operation','hooks',
 'pre_push','public_object_store','original_source_export']}
# This contains only synthetic public data and remains behind the private root.
expected_modes['synthetic_remote']=0o755
expected_modes.update({k:0o600 for k in ['intent','result','lock','started','worker','absence','ack','published',
 'candidate_intent','candidate_manifest','scan_pages']})
paths=list(remote_proof['paths'])
assert len(paths)==len(expected_modes)
assert {p['kind'] for p in paths}==set(expected_modes)
paths.append({'kind':'proof','path':str(remote_proof_path),'mode':'0600'})
expected_modes['proof']=0o600
remote_checks=[]
for entry in paths:
 p=pathlib.Path(entry['path']);mode=expected_modes[entry['kind']]
 assert p.is_absolute() and p==p.resolve() and p.is_relative_to(remote_retained)
 st=p.lstat()
 assert not stat.S_ISLNK(st.st_mode)
 assert st.st_uid==service.pw_uid and st.st_gid==service.pw_gid
 assert stat.S_IMODE(st.st_mode)==mode==int(entry['mode'],8)
 assert stat.S_ISREG(st.st_mode) if mode==0o600 or entry['kind']=='pre_push' else stat.S_ISDIR(st.st_mode)
 parent=p.parent
 while parent!=fixture:
  ancestor=parent.lstat()
  assert not stat.S_ISLNK(ancestor.st_mode) and stat.S_ISDIR(ancestor.st_mode)
  assert ancestor.st_uid==service.pw_uid and stat.S_IMODE(ancestor.st_mode)==0o700
  parent=parent.parent
 denied={permission:subprocess.run(['runuser','-u',execution.pw_name,'--',
  'test',permission,str(p)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==1
  for permission in ['-r','-w']}
 assert all(denied.values()),'execution account unexpectedly has remote fixture access'
 remote_checks.append({'kind':entry['kind'],'path':str(p),'uid':st.st_uid,
  'gid':st.st_gid,'mode':oct(mode),'execution_read_denied':denied['-r'],
  'execution_write_denied':denied['-w'],'sha256':digest(p) if p.is_file() else None})
result['remote_native_proof']=remote_proof
result['remote_permissions']=remote_checks
by_kind={p['kind']:pathlib.Path(p['path']) for p in paths}
for kind,key in [('intent','request_digest'),('result','result_digest'),
 ('candidate_manifest','candidate_manifest_digest'),('published','published_proof_digest')]:
 assert digest(by_kind[kind])==remote_proof[key]
candidate=json.loads(by_kind['candidate_manifest'].read_text())
assert candidate['head']==remote_proof['head'] and candidate['tree']==remote_proof['tree']
git=['git','--no-replace-objects','--git-dir='+str(by_kind['synthetic_remote']),
 '-c','safe.directory='+str(by_kind['synthetic_remote']),'-c','core.hooksPath=/dev/null']
observed=subprocess.check_output(git+['rev-parse','--verify',remote_proof['remote_ref']],text=True).strip()
tree=subprocess.check_output(git+['rev-parse','--verify',observed+'^{tree}'],text=True).strip()
parents=subprocess.check_output(git+['show','-s','--format=%P',observed],text=True).strip().split()
assert observed==remote_proof['head'] and tree==remote_proof['tree']
assert parents==candidate['parents']==remote_proof['parents']
source_git=['git','--no-replace-objects','--git-dir='+str(by_kind['original_source_export']),
 '-c','safe.directory='+str(by_kind['original_source_export']),'-c','core.hooksPath=/dev/null']
source_tree=subprocess.check_output(source_git+['rev-parse','--verify',remote_proof['source_head']+'^{tree}'],text=True).strip()
assert source_tree==remote_proof['source_tree']==tree
result['remote_independent_git']={'head':observed,'tree':tree,'parents':parents,
 'source_head':remote_proof['source_head'],'source_tree':source_tree,
 'scope':'actual retained synthetic bare repository ref/tree/parents and original result tree, root observation'}
'''


def main():
    repository = Path.cwd()
    accepted = repository / (
        '.trellis/tasks/archive/2026-10/10-03-a-publication-candidate/'
        'research/native-linux-validation.py'
    )
    spec = importlib.util.spec_from_file_location('accepted_linux_validation', accepted)
    if spec is None or spec.loader is None:
        raise RuntimeError('Accepted isolated Linux validation helper unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    program = module.REMOTE
    program = program.replace(
        'isolated Linux CGO and service-account actual Git fixture; '
        'no installation, Runtime, provider or production state mutation',
        'isolated remote preparation Linux CGO and service-account actual Git '
        'fixtures; no installation, Runtime, provider or production state mutation',
    )
    program = program.replace('monos-publication-', 'monos-remote-preparation-')
    # Reap orphaned controlled test helpers in the isolated container. Physical
    # worker absence still requires actual ESRCH from the implementation.
    program = program.replace(
        "['docker','run','--rm','--network','none'",
        "['docker','run','--rm','--init','--network','none'",
    )
    program = program.replace(
        "'-test.run','^TestPublication'",
        "'-test.run','^Test(Publication|RemotePreparation)'",
    )
    # Keep original publication checks and independently inspect the additional
    # concrete remote fixture paths as root and a distinct execution account.
    marker = "result['permissions']=checks;"
    if program.count(marker) != 1:
        raise RuntimeError('Accepted isolated validation integration seam changed')
    program = program.replace(marker, REMOTE_RETAINED + '\n' + marker)
    module.REMOTE = program
    module.main()


if __name__ == '__main__':
    main()
