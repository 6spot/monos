
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
for d in ['out','module-cache','build-cache']:(root/d).mkdir(mode=0o700)
import tarfile
tarfile.open(root/'module-cache.tar.gz').extractall(root/'module-cache',filter='data')
def container(name,command):
 args=['docker','run','--rm','--network','none','--name','monos-publication-'+root.name.rsplit('-',1)[-1]+'-'+name,
  '-v',str(source)+':/src','-v',str(out)+':/out','-v',str(root/'module-cache')+':/go/pkg/mod',
  '-v',str(root/'build-cache')+':/root/.cache/go-build','-w','/src/runner','-e','CGO_ENABLED=1','-e','GOPROXY=off','-e','GOSUMDB=off',image]+command
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
selected=['TestPublicationCandidateExactTreePrivateExclusionAndReplay','TestPublicationCandidateCrashStagesConcurrentCASAndRescan',
 'TestPublicationCandidateConflictingRefSourceAndIntent','TestPublicationNoChangeAndIncompleteRetryPreservesCandidate',
 'TestPublicationPagesRedactionDigestsAnd64Bound','TestPublicationRangeDeletedCredentialAndAllParents',
 'TestPublicationIgnoreExactVersionNegationAndWorkflowDeletion','TestPublicationStreamBoundariesAndProcessingLimits',
 'TestPublicationUnsupportedIgnoreAndInheritedFinalContent','TestPublicationKnownExposureCopyAndSensitiveFilenameRedaction',
 'TestPublicationPinOriginalCompletedCacheProofAndTamper','TestPublicationReconnectReplayAckLossAndJournalPermissions',
 'TestPublicationCandidateIntegratedTargetModesAndUnintegratedRejection','TestPublicationFiniteRuleCorpusStreamedWholeBlobDigest',
 'TestPublicationNonUTF8PathCoverageAndHistoricalPublicCopyDeletion']
run('native-git',['runuser','-u',service.pw_name,'--',str(binary),'-test.v','-test.run','^('+'|'.join(selected)+')$'],cwd=fixture)
run('native-retained',['runuser','-u',service.pw_name,'--','env','MONOS_PUBLICATION_EVIDENCE_DIR='+str(retained),str(binary),'-test.v','-test.run','^TestPublicationNativeRetainedPermissionFixture$'],cwd=fixture)
proof=json.loads((retained/'proof.json').read_text());result['native_proof']=proof;checks=[]
for key,mode in [('export',0o700),('journal',0o700),('intent_path',0o600),('pages_path',0o600),('candidate_path',0o600)]:
 p=pathlib.Path(proof[key]);assert p.resolve().is_relative_to(fixture.resolve())
 st=p.lstat();assert not stat.S_ISLNK(st.st_mode) and st.st_uid==service.pw_uid and stat.S_IMODE(st.st_mode)==mode
 denied={permission:subprocess.run(['runuser','-u',execution.pw_name,'--','test',permission,str(p)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==1 for permission in ['-r','-w']}
 assert all(denied.values()),'execution account unexpectedly has access'
 checks.append({'kind':key,'path':str(p),'uid':st.st_uid,'gid':st.st_gid,'mode':oct(mode),'execution_read_denied':denied['-r'],'execution_write_denied':denied['-w'],'sha256':digest(p) if p.is_file() else None})
result['permissions']=checks;result['source_unchanged']=unchanged();result['complete']=True;save()
