"""Read-only final history/installation audit; evidence writes exclusive.

No Owner/model calls, service actions or lifecycle admission. Root executes.
"""
import importlib.util,json,os,pathlib,re,sys,time

ROOT=pathlib.Path('/root/monos-execution-acceptance-deploy-v1')
BASELINE=ROOT/'after-v4.json'
INSTALL=ROOT/'install-complete.json'
MANIFEST=pathlib.Path('/root/monos-execution-acceptance-build-v1/manifest.json')
OBSERVER=pathlib.Path('/root/monos-execution-observer-v4.py')
EXPECTED={
    BASELINE:'88e1abec25cb531132da97358533de29f4c6db97a8f0b7e0401ac4d598d0818c',
    INSTALL:'d9be3280def641aa0f333abef1f0df579af03920e5f7a4cfa93a348284dcd325',
    MANIFEST:'aeb0d0c92ecb02788dc2bc881d603de0ab34cbaa0a0a9ed2e217aa030e4c5ffb',
    OBSERVER:'d4c26530d8e90ae3929801e87d0979c6a3da6896937f527b9fd480dffc581a3b',
}
sys.path.insert(0,'/root')
import monos_replan_audit_common_v3 as a

def observer():
    for path,digest in EXPECTED.items():a.require(a.file_sha(path)==digest,'Frozen evidence/helper hash changed: '+str(path))
    spec=importlib.util.spec_from_file_location('execution_observer_final',OBSERVER)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    baseline=a.load(BASELINE,passed=True)
    a.require(a.file_sha(a.__file__)==baseline['provenance']['common_sha256'],'Common dependency changed')
    a.require(a.file_sha(module.never.__file__)==baseline['provenance']['never_started_sha256'],'Never-started dependency changed')
    return module,baseline['snapshot']

def receipt_preservation(old,new):
    return set(old)==set(new) and all(isinstance(n,int) and n>0 and new[table].get(digest,0)>=n for table,rows in old.items() for digest,n in rows.items())

def checks_for(o,before,current,manifest,installed):
    checks=o.baseline_checks(current)
    for name,task in before['tasks'].items():
        latest=current['tasks'][name]
        checks[name+':canonical_exact']=a.normalized(task['records'])==a.normalized(latest['records'])
        checks[name+':native_exact']=o.native_equal(task,latest)
        checks[name+':git_exact']=task['git']==latest['git']
    checks['previous_receipt_multiplicities_retained']=receipt_preservation(before['receipts'],current['receipts'])
    for key in ('legacy','private_config_hashes','database','binaries','source','containers'):
        checks[key+':installed_baseline_exact']=before[key]==current[key]
    checks['candidate_all_source_files_exact']=current['candidate_source']==manifest['files']
    checks['candidate_binaries_exact']=current['binaries']==installed['binaries']
    checks['candidate_image_exact']=current['containers']['/monos-boundary-probe-server-1']['image']==installed['server_image']
    server=current['containers']['/monos-boundary-probe-server-1']
    checks['candidate_server_running']=server['running'] is True and server['pid']>0
    checks['runner_process_exact']=before['runner']['process']==current['runner']['process']
    registration=lambda s:{k:v for k,v in s['runner']['registration'].items() if k!='last_seen'}
    checks['runner_registration_identity_exact']=registration(before)==registration(current)
    checks['ownership_dimensions_exact']=set(current['counts'])==set(before['counts']) and len(current['counts'])==19
    return checks

def save(name,value):
    path=ROOT/(name+'.json')
    with path.open('x') as out:
        os.fchmod(out.fileno(),0o600);json.dump(value,out,sort_keys=True,indent=2);out.write('\n');out.flush();os.fsync(out.fileno())
    fd=os.open(ROOT,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)

def main():
    a.require(len(sys.argv)==2 and re.fullmatch('[a-z][a-z0-9-]{0,63}',sys.argv[1]),'Explicit unique LABEL required')
    name='final-preservation-'+sys.argv[1];o,before=observer();installed=a.load(INSTALL);manifest=a.load(MANIFEST)
    a.require(installed['manifest_path']==str(MANIFEST),'Installed manifest path changed')
    provenance={str(path):digest for path,digest in EXPECTED.items()}
    provenance.update({'script_sha256':a.file_sha(__file__),'common_sha256':a.file_sha(a.__file__),'never_started_sha256':a.file_sha(o.never.__file__)})
    save(name+'-intent',{'at':time.time(),'argv':sys.argv[1:],'provenance':provenance})
    p=o.probe();current=o.capture(p)
    current['candidate_source']={n:a.file_sha(o.SOURCE/n) for n in manifest['files']}
    checks=checks_for(o,before,current,manifest,installed)
    outcome='pass' if all(checks.values()) else 'fail'
    save(name,{'at':time.time(),'outcome':outcome,'checks':checks,'snapshot':current,'provenance':provenance})
    print(json.dumps({'name':name,'outcome':outcome,'checks':len(checks),'failures':[k for k,v in checks.items() if not v],'counts':current['counts']}))
    a.require(outcome=='pass','Final preservation gate failed; retain exact evidence')

if __name__=='__main__':main()
