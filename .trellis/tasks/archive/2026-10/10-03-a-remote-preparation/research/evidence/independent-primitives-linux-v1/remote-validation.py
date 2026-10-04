
import hashlib,json,os,pathlib,pwd,shutil,stat,subprocess,sys,time
root=pathlib.Path(sys.argv[1]); source=root/'source'; out=root/'out'
manifest=json.loads((root/'manifest.json').read_text())
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def unchanged():return all(digest(source/x['path'])==x['sha256'] for x in manifest['files'])
assert unchanged(), 'source mismatch before admission'
result={'scope':'accepted commit 2095660 plus four independent primitive files; isolated Linux UID/process/Git/permissions proof, not integrated protocol/lane or App proof','source_manifest_sha256':digest(root/'manifest.json'),'steps':[]}
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
 args=['docker','run','--rm','--network','none','--name','monos-remote-primitives-'+root.name.rsplit('-',1)[-1]+'-'+name,
  '-v',str(source)+':/src','-v',str(out)+':/out','-v',str(root/'module-cache')+':/go/pkg/mod',
  '-v',str(root/'build-cache')+':/root/.cache/go-build','-v',str(root/'private-temp')+':/private-temp',
  '-w','/src/runner','-e','TMPDIR=/private-temp','-e','CGO_ENABLED=1','-e','GOPROXY=off','-e','GOSUMDB=off',image]+command
 run(name,args)
container('dependency-verify',['go','mod','verify'])
container('primitives',['go','test','./internal/host','-run','^TestRemotePreparation','-count=1'])
container('race',['go','test','-race','./internal/host','-run','^TestRemotePreparation','-count=1'])
container('vet',['go','vet','./internal/host'])
container('host-build',['go','test','-c','-o','/out/host.test','./internal/host'])
for executable in []:
 container('build-'+executable,['go','build','-trimpath','-o','/out/'+executable,'./cmd/'+executable])
assert unchanged(), 'source changed during container tests'
result['binaries']={p.name:{'sha256':digest(p),'bytes':p.stat().st_size} for p in out.iterdir() if p.is_file()}
service=pwd.getpwnam('monos-probe');execution=pwd.getpwnam('me');assert service.pw_uid!=execution.pw_uid
fixture=pathlib.Path('/var/lib/monos-probe/service')/root.name
fixture.mkdir(mode=0o700);os.chown(fixture,service.pw_uid,service.pw_gid)
binary=fixture/'host.test';shutil.copyfile(out/'host.test',binary);os.chmod(binary,0o500);os.chown(binary,service.pw_uid,service.pw_gid)
retained=fixture/'retained';retained.mkdir(mode=0o700);os.chown(retained,service.pw_uid,service.pw_gid)
temporary=fixture/'temp';temporary.mkdir(mode=0o700);os.chown(temporary,service.pw_uid,service.pw_gid)
run('native-git',['runuser','-u',service.pw_name,'--','env','TMPDIR='+str(temporary),str(binary),'-test.v','-test.run','^TestRemotePreparation'],cwd=fixture)
run('native-retained',['runuser','-u',service.pw_name,'--','env','TMPDIR='+str(temporary),'MONOS_PUBLICATION_EVIDENCE_DIR='+str(retained),str(binary),'-test.v','-test.run','^TestPublicationNativeRetainedPermissionFixture$'],cwd=fixture)
proof=json.loads((retained/'proof.json').read_text());result['native_proof']=proof;checks=[]
for key,mode in [('export',0o700),('journal',0o700),('intent_path',0o600),('pages_path',0o600),('candidate_path',0o600)]:
 p=pathlib.Path(proof[key]);assert p.resolve().is_relative_to(fixture.resolve())
 st=p.lstat();assert not stat.S_ISLNK(st.st_mode) and st.st_uid==service.pw_uid and stat.S_IMODE(st.st_mode)==mode
 denied={permission:subprocess.run(['runuser','-u',execution.pw_name,'--','test',permission,str(p)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==1 for permission in ['-r','-w']}
 assert all(denied.values()),'execution account unexpectedly has access'
 checks.append({'kind':key,'path':str(p),'uid':st.st_uid,'gid':st.st_gid,'mode':oct(mode),'execution_read_denied':denied['-r'],'execution_write_denied':denied['-w'],'sha256':digest(p) if p.is_file() else None})

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
assert remote_proof['fixture_scope']=='actual_candidate_and_remote_primitives_synthetic_baseline'
assert remote_proof['service_uid']==service.pw_uid
assert remote_proof['head']==remote_proof['observed_head']
expected_modes={k:0o700 for k in ['root','journal','item','operation','hooks',
 'pre_push','public_object_store','synthetic_remote']}
expected_modes.update({k:0o600 for k in ['intent','result','lock','started','worker',
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
 ('candidate_manifest','candidate_manifest_digest')]:
 assert digest(by_kind[kind])==remote_proof[key]
candidate=json.loads(by_kind['candidate_manifest'].read_text())
assert candidate['head']==remote_proof['head'] and candidate['tree']==remote_proof['tree']
git=['git','--no-replace-objects','--git-dir='+str(by_kind['synthetic_remote']),
 '-c','safe.directory='+str(by_kind['synthetic_remote']),'-c','core.hooksPath=/dev/null']
observed=subprocess.check_output(git+['rev-parse','--verify',remote_proof['remote_ref']],text=True).strip()
tree=subprocess.check_output(git+['rev-parse','--verify',observed+'^{tree}'],text=True).strip()
parents=subprocess.check_output(git+['show','-s','--format=%P',observed],text=True).strip().split()
assert observed==remote_proof['head'] and tree==remote_proof['tree']
assert parents==candidate['parents']
result['remote_independent_git']={'head':observed,'tree':tree,'parents':parents,
 'scope':'actual retained synthetic bare repository ref/tree/parents, root observation'}

result['permissions']=checks;result['source_unchanged']=unchanged();result['complete']=True;save()
