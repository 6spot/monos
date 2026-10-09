"""Build an exact commit and run isolated Linux adapter/native no-model checks."""

import hashlib
import importlib.util
import json
from pathlib import Path
import shlex
import subprocess
import sys


HERE = Path(__file__).resolve().parent
commit = subprocess.check_output(["git", "rev-parse", sys.argv[1] + "^{commit}"], text=True).strip()
archive = subprocess.check_output(["git", "archive", "--format=tar", commit,
                                   "runner", "packages/protocol/generated/go"])
test_source = (HERE / "native_catalog_preflight_linux_test.go").read_text()
supervisor = (HERE / "supervise.py").read_text()
code = r'''
import hashlib,io,json,os,shutil,subprocess,sys,tarfile,time
from pathlib import Path
os.umask(0o077)
root=Path('/root/monos-free-catalog-release-v2')
root.mkdir(mode=0o700)
raw=sys.stdin.buffer.read()
assert hashlib.sha256(raw).hexdigest()==ARCHIVE_SHA
(root/'source.tar').write_bytes(raw)
src=root/'src'; src.mkdir(); (root/'bin').mkdir(); (root/'cache').mkdir()
archive=tarfile.open(fileobj=io.BytesIO(raw))
files={}
for member in archive.getmembers():
 if member.isfile(): files[member.name]=hashlib.sha256(archive.extractfile(member).read()).hexdigest()
 elif member.issym(): files[member.name]=hashlib.sha256(member.linkname.encode()).hexdigest()
archive.extractall(src,filter='data')
manifest={'candidate_commit':COMMIT,'archive_sha256':ARCHIVE_SHA,'archive_scope':['runner','packages/protocol/generated/go'],'files':files}
manifest_path=root/'source-manifest.json'
manifest_path.write_text(json.dumps(manifest,indent=2,sort_keys=True)+'\n')
result={'outcome':'failed','candidate_commit':COMMIT,'source_manifest_path':str(manifest_path),'source_manifest_sha256':hashlib.sha256(manifest_path.read_bytes()).hexdigest(),'binaries':{}}
(root/'intent.json').write_text(json.dumps({'candidate_commit':COMMIT,'archive_sha256':ARCHIVE_SHA,'no_installation':True,'no_model_inference':True},indent=2)+'\n')
def run(name,args,timeout):
 (root/(name+'.intent.json')).write_text(json.dumps({'args':args},indent=2)+'\n')
 with (root/(name+'.log')).open('xb') as log:
  p=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
 (root/(name+'.result.json')).write_text(json.dumps({'exit':p.returncode})+'\n')
 if p.returncode: raise RuntimeError(name+'_failed')
image='sha256:69a7b9788769bec032d238959b61854e9ae87f57be9029ec04e9885fabf99195'
docker=['docker','run','--rm','--pull','never','--network','none','--cpus','2','--memory','4g','-e','GOPROXY=off','-e','GOSUMDB=off','-e','GOTOOLCHAIN=local','-e','GOFLAGS=-mod=readonly','-e','CGO_ENABLED=1','-e','GOCACHE=/cache','-v','/root/monos-logs-gomod-cache:/go/pkg/mod:ro','-v',str(root/'cache')+':/cache','-v',str(src)+':/src:ro','-v',str(root/'bin')+':/out','-w','/src/runner',image]
unit='monos-free-catalog-verify-v1.service'
attempt='native-free-catalog-'+COMMIT[:12]+'-v1'
fixture=Path('/var/lib/monos-probe/execution')/attempt
unit_started=False
fixture_created=False
def unit_values():
 p=subprocess.run(['systemctl','show',unit,'-p','LoadState','-p','ActiveState','-p','SubState','-p','ExecMainCode','-p','ExecMainStatus','-p','ControlGroup'],text=True,capture_output=True)
 values=dict(line.split('=',1) for line in p.stdout.splitlines() if '=' in line)
 if p.returncode and values.get('LoadState')!='not-found': raise RuntimeError('validation_unit_state_unknown')
 return values
try:
 if unit_values().get('LoadState')!='not-found': raise RuntimeError('validation_unit_already_exists')
 run('go-build',docker+['sh','-c','set -eu\nfor name in monos monos-runner monos-probe-launch monos-probe-exec; do go build -trimpath -o /out/$name ./cmd/$name; done'],240)
 for name in ('monos','monos-runner','monos-probe-launch','monos-probe-exec'):
  path=root/'bin'/name; result['binaries'][name]={'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
 added=src/'runner/internal/adapter/native_catalog_preflight_linux_test.go'
 if added.exists(): raise RuntimeError('verification_source_collision')
 added.write_text(TEST_SOURCE)
 (root/'verification-source.json').write_text(json.dumps({'path':str(added),'sha256':hashlib.sha256(added.read_bytes()).hexdigest(),'product_binary_input':False},indent=2)+'\n')
 run('go-adapter-race-build',docker+['go','test','-race','-c','-trimpath','-o','/out/adapter.test','./internal/adapter'],240)
 (root/'supervise.py').write_text(SUPERVISOR)
 fixture.mkdir(mode=0o711); fixture.chmod(0o711); fixture_created=True
 for name in ('scratch','data','cache','config','state','tmp','test-tmp'):
  p=fixture/name; p.mkdir(mode=0o700); os.chown(p,1000,1000)
 (fixture/'native-opt-in').write_text(attempt); (fixture/'native-opt-in').chmod(0o444)
 shutil.copyfile(root/'bin/adapter.test',fixture/'adapter.test'); (fixture/'adapter.test').chmod(0o555)
 native=Path('/home/linuxbrew/.linuxbrew/bin/opencode').resolve()
 result['runtime']={'path':str(native),'sha256':hashlib.sha256(native.read_bytes()).hexdigest()}
 if result['runtime']['sha256']!='90e905f6e9b6babd60e6bb1ad3b87e8405421cb84a64b088550620f8e9011051': raise RuntimeError('native_cli_changed_since_source_observation')
 (root/'verification-intent.json').write_text(json.dumps({'attempt_id':attempt,'fixture':str(fixture),'unit':unit,'test_sha256':hashlib.sha256((fixture/'adapter.test').read_bytes()).hexdigest()},indent=2)+'\n')
 unit_started=True
 run('validation-launch',['systemd-run','--quiet','--unit='+unit,'--property=Type=exec','--property=User=root','--property=Group=root','--property=KillMode=control-group','--property=TimeoutStopSec=8s','--property=RuntimeMaxSec=120s','--property=RemainAfterExit=yes','--property=Restart=no','--property=StandardOutput=append:'+str(root/'supervisor.log'),'--property=StandardError=append:'+str(root/'supervisor.log'),'/usr/bin/python3',str(root/'supervise.py')],15)
 deadline=time.monotonic()+115
 while time.monotonic()<deadline:
  values=unit_values()
  if values.get('SubState') in ('exited','failed') or values.get('ActiveState') in ('failed','inactive'): break
  time.sleep(.2)
 else: raise RuntimeError('validation_unit_deadline')
 result['unit_before_cleanup']=values
 result['verification']=json.loads((root/'verification-result.json').read_text())
 if result['verification']['outcome']!='pass': raise RuntimeError('linux_or_native_validation_failed')
 if values.get('ExecMainCode')!='1' or values.get('ExecMainStatus')!='0': raise RuntimeError('validation_supervisor_failed')
 result['outcome']='pass'
except Exception as error:
 result['failure']=str(error) if isinstance(error,RuntimeError) else type(error).__name__
finally:
 cleanup={'fixture_created':fixture_created,'unit_started':unit_started}
 if unit_started:
  try:
   subprocess.run(['systemctl','stop',unit],check=True,timeout=12,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   values=unit_values(); cleanup['unit_after_stop']=values
   cgroup=Path('/sys/fs/cgroup/system.slice')/unit
   absent=not cgroup.exists()
   cleanup['cgroup_absent']=absent
   if not absent: raise RuntimeError('validation_cgroup_cleanup_unknown')
  except Exception as error:
   result['outcome']='failed'; cleanup['failure']=type(error).__name__
 if fixture_created and (not unit_started or cleanup.get('cgroup_absent')):
  shutil.rmtree(fixture); cleanup['fixture_removed']=not fixture.exists()
 result['cleanup']=cleanup
 (root/'result.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result))
'''
code = code.replace("ARCHIVE_SHA", repr(hashlib.sha256(archive).hexdigest())).replace("COMMIT", repr(commit)).replace("TEST_SOURCE", repr(test_source)).replace("SUPERVISOR", repr(supervisor))
spec = importlib.util.spec_from_file_location("transport", "/tmp/monos-delivery-transport-session.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with module.Transport() as transport:
    completed = transport.execute("python3 -c " + shlex.quote(code), archive, timeout=700)
    if completed.returncode:
        print(json.dumps({"outcome": "remote_operation_failed", "exit": completed.returncode, "root": "/root/monos-free-catalog-release-v2"}))
        raise SystemExit(completed.returncode)
    result = json.loads(completed.stdout)
    (HERE / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
    raise SystemExit(0 if result["outcome"] == "pass" else 1)
