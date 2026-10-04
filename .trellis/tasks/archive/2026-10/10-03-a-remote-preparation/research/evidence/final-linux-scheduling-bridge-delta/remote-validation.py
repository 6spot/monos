import hashlib,json,os,pathlib,pwd,shutil,subprocess,sys,time
root=pathlib.Path(sys.argv[1]);source=root/'source';out=root/'out'
manifest=json.loads((root/'manifest.json').read_text())
prior_root=pathlib.Path('/root/monos-publication-validation-e17a612252084a74b0f3d0be1c50ddd0')
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def unchanged():return all(digest(source/x['path'])==x['sha256'] for x in manifest['files'])
assert unchanged()
assert digest(prior_root/'result.json')=='5d52cce1b7ac922bdfa444f937442d226955cc36b11bc797fbee854dcda54d68'
prior=json.loads((prior_root/'result.json').read_text());assert prior['complete'] and prior['source_unchanged']
old=json.loads((prior_root/'manifest.json').read_text());before={x['path']:x['sha256'] for x in old['files']}
changed=[x['path'] for x in manifest['files'] if x['sha256']!=before[x['path']]]
assert set(changed)==set(json.loads((root/'changed-paths.json').read_text()))
assert set(changed)<=set(['runner/internal/control/publication_remote.go','runner/internal/control/publication_remote_test.go','runner/internal/host/publication_remote.go','runner/internal/host/publication_remote_test.go','runner/internal/host/publication_remote_native_test.go'])
result={'scope':'isolated native Linux scheduling fix and test-only timestamp fixture delta; previous full process/Git/service-permission gates reused for unchanged behavior','source_manifest_sha256':digest(root/'manifest.json'),'reused_gate':{'result_sha256':digest(prior_root/'result.json'),'source_manifest_sha256':prior['source_manifest_sha256'],'unchanged_inputs':len(manifest['files'])-len(changed),'changed_paths':changed,'remote_permissions_denials':len(prior['remote_permissions'])*2},'steps':[]}
def save():
 with (root/'result.tmp').open('w') as f:json.dump(result,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 os.replace(root/'result.tmp',root/'result.json')
def run(name,args):
 start=time.time();log=root/(name+'.log')
 with log.open('xb') as f:r=subprocess.run(args,stdout=f,stderr=subprocess.STDOUT)
 result['steps'].append({'name':name,'exit_code':r.returncode,'seconds':time.time()-start,'log_sha256':digest(log)});save()
 assert r.returncode==0,name+' failed'
image='golang:1.27.1-bookworm';result['image']=json.loads(subprocess.check_output(['docker','image','inspect',image]))[0]['Id'];assert result['image']==prior['image']
result['host']=subprocess.check_output(['uname','-srm'],text=True).strip();result['native_git']=subprocess.check_output(['git','--version'],text=True).strip()
for d in ['out','private-temp']:(root/d).mkdir(mode=0o700)
def container(name,cmd):
 run(name,['docker','run','--rm','--init','--network','none','--name','monos-delta-'+root.name.rsplit('-',1)[-1]+'-'+name,'-v',str(source)+':/src','-v',str(out)+':/out','-v','/root/monos-publication-validation-2909d8cda31040b8a4a09db3ecb21f65/module-cache:/go/pkg/mod','-v','/root/monos-publication-validation-2909d8cda31040b8a4a09db3ecb21f65/build-cache:/root/.cache/go-build','-v',str(root/'private-temp')+':/private-temp','-w','/src/runner','-e','TMPDIR=/private-temp','-e','CGO_ENABLED=1','-e','GOPROXY=off','-e','GOSUMDB=off',image]+cmd)
patterns=json.loads((root/'patterns.json').read_text())
container('scheduling',['go','test','./internal/control','./internal/host','-run',patterns,'-count=1'])
container('scheduling-race',['go','test','-race','./internal/control','./internal/host','-run',patterns,'-count=1'])
container('affected-vet',['go','vet','./internal/control','./internal/host'])
container('host-build',['go','test','-c','-o','/out/host.test','./internal/host'])
for executable in ['monos','monos-runner','monos-probe-launch','monos-probe-exec']:container('build-'+executable,['go','build','-trimpath','-o','/out/'+executable,'./cmd/'+executable])
assert unchanged()
result['binaries']={p.name:{'sha256':digest(p),'bytes':p.stat().st_size} for p in out.iterdir() if p.is_file()}
service=pwd.getpwnam('monos-probe');execution=pwd.getpwnam('me');assert service.pw_uid!=execution.pw_uid
fixture=pathlib.Path('/var/lib/monos-probe/service')/root.name;fixture.mkdir(mode=0o700);os.chown(fixture,service.pw_uid,service.pw_gid)
binary=fixture/'host.test';shutil.copyfile(out/'host.test',binary);os.chmod(binary,0o500);os.chown(binary,service.pw_uid,service.pw_gid)
temp=fixture/'temp';temp.mkdir(mode=0o700);os.chown(temp,service.pw_uid,service.pw_gid)
result['native_bridge']={'fixture':str(fixture),'service_uid':service.pw_uid,'execution_uid':execution.pw_uid,'binary_sha256':digest(binary),'scope':'fresh current host.test, native live opt-in effect fixture deferred to exact authorized GitHub trial; previous permission fixture not repeated'}
result['source_unchanged']=unchanged();result['complete']=True;save()
