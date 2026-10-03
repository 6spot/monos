"""Read-only installation history observer. No Owner or lifecycle commands."""
import json, os, pathlib, sys, time
sys.path.insert(0, '/root')
import monos_replan_audit_common_v3 as a
import monos_replan_never_started_v1 as never
DEPLOY=pathlib.Path('/root/monos-execution-acceptance-deploy-v1')
SOURCE=a.SOURCE
OLD_MANIFEST=pathlib.Path('/root/monos-replan-manifest-v4.json')
TASKS={'specification':'89effbce-76d8-40c6-8702-70d856c369ba','replan':'dd67088b-1886-4d2c-b402-62c242f9f07b'}

def probe():
    p=a.AuditProbe(str(SOURCE),str(DEPLOY))
    p.compose += ['-f','/root/monos-boundary-probe-ports.yaml']
    return p

def save(name,value):
    p=DEPLOY/(name+'.json')
    with p.open('x') as f:
        json.dump(value,f,sort_keys=True,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    p.chmod(0o600)
    fd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)

def provenance():
    return {'script_sha256':a.file_sha(__file__),'common_sha256':a.file_sha(a.__file__),
      'never_started_sha256':a.file_sha(never.__file__)}

def baseline_provenance():
    return {'baseline_sha256':a.file_sha(DEPLOY/'before-v4.json'),
      'baseline_intent_sha256':a.file_sha(DEPLOY/'before-intent-v4.json')}

def container(p,name):
    row=json.loads(p.call(['docker','inspect',name]))[0]
    return {'id':row['Id'],'image':row['Image'],'started_at':row['State']['StartedAt'],'ports':row['HostConfig']['PortBindings'],'running':row['State']['Running'],'pid':row['State']['Pid']}

def capture(p,rollback=False):
    tasks={}
    for name,task in TASKS.items():
        records=p.records(task)
        native={r['id']:p.planning_snapshot(r['id']) for r in records['attempts']}
        resource=a.one(records['workspace_records'])['resource_id']
        tasks[name]={'records':records,'native':native,'git':a.git_facts(p,records,resource),'confirmed':p.records(task),'never_started':never.capture(p,records,native)}
    return {'at':time.time(),'tasks':tasks,'counts':a.idle(p),'receipts':a.receipt_hashes(p),
      'database':container(p,'monos-boundary-probe-database-1'),'containers':({'/monolab-boundary-probe-server-1':container(p,'monolab-boundary-probe-server-1')} if rollback else a.containers(p)),'runner':a.WorkspaceProbe.runner_identity(p),'legacy':a.legacy_pending(p),
      'binaries':{name:a.file_sha(path) for name,path in a.BINARIES.items()},
      'private_config_hashes':{name:a.file_sha(path) for name,path in {'config':'/etc/monos-probe/runner.json','unit':'/etc/systemd/system/monos-probe-runner.service','ports':'/root/monos-boundary-probe-ports.yaml','sudoers':'/etc/sudoers.d/monos-probe'}.items()},
      'source':{name:a.file_sha(SOURCE/name) for name in a.load(OLD_MANIFEST)['files']}}

def baseline_checks(s):
    checks={'database_running_private':s['database']['running'] is True and not s['database']['ports'],'idle':all(v==0 for v in s['counts'].values()),'ready':a.ready(s['runner']),
      'monolab_expected':all(s['containers']['/monolab-boundary-probe-server-1'][k]==v for k,v in a.MONOLAB.items()),
      'legacy_only':{r['task']['id'] for r in s['legacy']}==a.LEGACY_TASKS}
    for name,t in s['tasks'].items():
        checks[name+':REVIEW']=t['records']['task']['state']=='REVIEW'
        checks[name+':stable_read']=a.normalized(t['records'])==a.normalized(t['confirmed'])
        checks[name+':physical_release']=all(a.settled_checks(t['native'][r['id']]) if r['started'] else bool(t['never_started'].get(r['id'])) and all(t['never_started'][r['id']]['checks'].values()) for r in t['records']['attempts'])
    return checks

def native_equal(t,n):
    proof=n['never_started']
    if set(proof)-{never.ATTEMPT} or set(t['native'])!=set(n['native']):return False
    if any(t['native'][i]!=n['native'][i] or not v['checks'] or not all(v['checks'].values()) for i,v in proof.items()):return False
    return a.native_unchanged({k:v for k,v in t['native'].items() if k not in proof},{k:v for k,v in n['native'].items() if k not in proof})

def preserved(before,after):
    checks={}
    for name,t in before['tasks'].items():
        n=after['tasks'][name]
        checks[name+':canonical_exact']=a.normalized(t['records'])==a.normalized(n['records'])
        checks[name+':native_exact']=native_equal(t,n)
        checks[name+':git_exact']=t['git']==n['git']
    for key in ('receipts','legacy','private_config_hashes','database'):
        checks[key+':exact']=before[key]==after[key]
    checks['monolab_exact']=before['containers']['/monolab-boundary-probe-server-1']==after['containers']['/monolab-boundary-probe-server-1']
    return checks

def unchanged_installation(before,current):
    checks=baseline_checks(current)|preserved(before,current)
    for key in ('source','binaries','containers'):checks[key+':unchanged']=before[key]==current[key]
    checks['same_runner']=before['runner']['process']==current['runner']['process'] and all(before['runner']['registration'][k]==current['runner']['registration'][k] for k in ('backend','incarnation'))
    return checks

def main():
    stage=sys.argv[1]
    a.require(stage in ('before','revalidate-before','after'), 'explicit stage required')
    DEPLOY.mkdir(mode=0o700,exist_ok=True)
    origin=provenance()
    if stage!='before':origin.update(baseline_provenance())
    save(stage+'-intent-v4',{'at':time.time(),**origin})
    p=probe();s=capture(p);checks=baseline_checks(s)
    if stage=='before':
        previous=a.load('/root/monos-replan-runtime-deploy-v4/installed.json',passed=True)['snapshot']['containers']['/monos-boundary-probe-server-1']
        server=s['containers']['/monos-boundary-probe-server-1']
        checks['installed_image_and_ports_v4']=server['image']==previous['image'] and server['running'] is True and server['pid']>0 and server['ports']==previous['ports']=={'18443/tcp':[{'HostIp':'127.0.0.1','HostPort':'18444'}]}
        checks['installed_source_v4']=s['source']==a.load(OLD_MANIFEST)['files']
        checks['installed_binaries_v4']=s['binaries']==a.load('/root/monos-replan-runtime-deploy-v4/installed.json')['binaries']
    elif stage=='revalidate-before':
        before=a.load(DEPLOY/'before-v4.json',passed=True)['snapshot'];checks=unchanged_installation(before,s)
    else:
        before=a.load(DEPLOY/'before-v4.json',passed=True)['snapshot'];checks.update(preserved(before,s))
        installed=a.load(DEPLOY/'install-complete.json')
        manifest=a.load(installed['manifest_path'])
        checks['candidate_sources_exact']=all(a.file_sha(SOURCE/n)==h for n,h in manifest['files'].items())
        checks['candidate_binaries_exact']=s['binaries']==installed['binaries']
        server=s['containers']['/monos-boundary-probe-server-1']
        checks['candidate_image_exact']=server['image']==installed['server_image']
        checks['candidate_server_running']=server['running'] is True and server['pid']>0
        checks['new_server_same_ports']=s['containers']['/monos-boundary-probe-server-1']['id']!=before['containers']['/monos-boundary-probe-server-1']['id'] and s['containers']['/monos-boundary-probe-server-1']['ports']==before['containers']['/monos-boundary-probe-server-1']['ports']
        checks['fresh_runner_registration']=s['runner']['process']['InvocationID']!=before['runner']['process']['InvocationID'] and s['runner']['registration']['backend']!=before['runner']['registration']['backend'] and s['runner']['registration']['incarnation']>before['runner']['registration']['incarnation']
    result={'outcome':'pass' if all(checks.values()) else 'fail','checks':checks,'snapshot':s,'provenance':origin}
    save(stage+'-v4',result)
    print(json.dumps({'stage':stage,'outcome':result['outcome'],'checks':len(checks),'failures':[k for k,v in checks.items() if not v],'counts':s['counts']}))
    a.require(result['outcome']=='pass','Observer gate failed; retained evidence requires inspection')
if __name__=='__main__':main()
