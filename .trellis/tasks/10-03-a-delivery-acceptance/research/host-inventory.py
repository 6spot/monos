#!/usr/bin/env python3
"""Bounded read-only installed prerequisite inventory; never serialize secrets."""
import json
import argparse
from pathlib import Path
import shlex
import subprocess
import tempfile

REMOTE = r'''
import datetime,json,pathlib,subprocess
def run(args):
 p=subprocess.run(args,text=True,capture_output=True,timeout=25)
 if p.returncode: raise RuntimeError('inventory command failed: '+args[0])
 return p.stdout.strip()
result={'observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'read-only installed service identities and prerequisites; no credentials serialized','containers':[],'units':[]}
names=run(['docker','ps','-a','--format','{{.Names}}']).splitlines()
for name in sorted(n for n in names if n.startswith(('monos-boundary-probe-','monolab-boundary-probe-'))):
 c=json.loads(run(['docker','inspect',name]))[0]
 safe={'name':name,'id':c['Id'],'image_id':c['Image'],'status':c['State']['Status'],'started_at':c['State']['StartedAt'],'compose_working_dir':c['Config'].get('Labels',{}).get('com.docker.compose.project.working_dir'),'mounts':[{'type':m['Type'],'source':m['Source'],'destination':m['Destination'],'read_write':m['RW']} for m in c['Mounts']]}
 if '-database-' in name and safe['status']=='running':
  query="BEGIN READ ONLY; SELECT json_build_object('migrations',(SELECT json_agg(row_to_json(m) ORDER BY version) FROM schema_migrations m),'github_app_rows',(SELECT count(*) FROM github_configuration),'task_count',(SELECT count(*) FROM tasks),'attempt_count',(SELECT count(*) FROM attempts)); COMMIT;"
  data=run(['docker','exec',name,'sh','-c','psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '+__import__('shlex').quote(query)])
  safe['database']=json.loads(data)
 result['containers'].append(safe)
units=run(['systemctl','list-unit-files','--type=service','--no-legend','--no-pager']).splitlines()
for line in units:
 name=line.split()[0]
 if name in ['monos-probe-runner.service','monolab-probe-runner.service']:
  fields=run(['systemctl','show',name,'--property=ActiveState,SubState,MainPID,InvocationID,FragmentPath,User,Group,ExecMainStartTimestamp']).splitlines()
  result['units'].append({'name':name,**dict(f.split('=',1) for f in fields)})
result['host']=run(['uname','-srm'])
result['boot_id']=pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip()
print(json.dumps(result))
'''

DETAILS = r'''
import datetime,hashlib,json,pathlib,pwd,sqlite3,subprocess
def run(args):
 p=subprocess.run(args,text=True,capture_output=True,timeout=25)
 if p.returncode: raise RuntimeError('read-only details failed: '+args[0])
 return p.stdout.strip()
def file(path):
 p=pathlib.Path(path);s=p.lstat()
 if not p.is_file() or p.is_symlink(): raise RuntimeError('unexpected inventory file')
 return {'path':path,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'uid':s.st_uid,'gid':s.st_gid,'mode':oct(s.st_mode&0o777)}
binary_paths=['/usr/local/bin/monos','/usr/local/libexec/monos-runner','/usr/local/libexec/monos-probe-launch','/usr/local/libexec/monos-probe-exec']
result={'observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'read-only binaries, nonsecret configuration fields, storage, CA validity, SQLite table counts and actual process identities','binaries':[file(p) for p in binary_paths]}
config_path='/etc/monos-probe/runner.json';config=json.loads(pathlib.Path(config_path).read_text())
result['runner_configuration']={k:config[k] for k in ['endpoint','ca_file','runner_id','journal','socket','execution_uid'] if k in config}
result['private_config_hashes']=[file(p) for p in [config_path,'/etc/systemd/system/monos-probe-runner.service','/etc/sudoers.d/monos-probe','/root/monos-boundary-probe-ports.yaml']]
result['service_and_execution_accounts']=[{'name':name,'uid':pwd.getpwnam(name).pw_uid,'gid':pwd.getpwnam(name).pw_gid} for name in ['monos-probe','me']]
result['ca_certificate']=run(['openssl','x509','-in',config['ca_file'],'-noout','-dates','-fingerprint','-sha256'])
result['execution_groups']=run(['id','me'])
result['owned_units']=run(['systemctl','list-units','--all','--plain','--no-legend','--no-pager','monos-probe-*']).splitlines()
db=sqlite3.connect('file:'+config['journal']+'?mode=ro',uri=True);db.execute('BEGIN')
tables=[row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
result['journal_table_counts']={name:db.execute('SELECT count(*) FROM "'+name.replace('"','""')+'"').fetchone()[0] for name in tables}
db.rollback();db.close()
result['retained_helper_files']=[file(str(p)) for p in [pathlib.Path('/root/monos_replan_audit_common_v3.py'),pathlib.Path('/root/monos_replan_never_started_v1.py'),pathlib.Path('/root/monos-execution-acceptance-build-v1/build.py'),pathlib.Path('/root/monos-execution-acceptance-build-v1/package.py')] if p.exists()]
print(json.dumps(result))
'''

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--details', action='store_true')
    parser.add_argument('--output', default=str(Path(__file__).with_name('host-inventory.json')))
    args = parser.parse_args()
    output = Path(args.output)
    if output.exists():
        raise SystemExit('Refusing to replace retained inventory')
    auth_path = Path('/tmp/monos-publication-host-auth.json')
    if auth_path.is_symlink() or auth_path.stat().st_mode & 0o777 != 0o600:
        raise SystemExit('Private transport credential mode mismatch')
    auth = json.loads(auth_path.read_text())
    assert auth['host'] == '100.120.14.84' and auth['user'] == 'root'
    secret = auth['credential']
    escaped = secret.replace('\\', '\\\\').replace('"', '\\"').replace('$', '\\$').replace('[', '\\[').replace(']', '\\]')
    with tempfile.TemporaryDirectory(prefix='monos-delivery-inventory-', dir='/private/tmp') as directory:
        socket = str(Path(directory) / 's')
        script = 'set timeout 15\nlog_user 0\nspawn ssh -o BatchMode=no -o NumberOfPasswordPrompts=1 -o ConnectTimeout=8 -o ControlPersist=60 -M -S ' + socket + ' -fN root@100.120.14.84\nexpect {\n -re {(?i)password:} {send -- "' + escaped + '\\r"; exp_continue}\n eof {set r [wait]; puts "AUTH_EXIT:[lindex $r 3]"}\n timeout {puts {AUTH_TIMEOUT}; exit 1}\n}\n'
        try:
            login = subprocess.run(['expect'], input=script, text=True, capture_output=True, timeout=20)
            if login.returncode or 'AUTH_EXIT:0' not in login.stdout:
                raise RuntimeError('Private SSH authentication failed')
            result = subprocess.run(['ssh', '-S', socket, '-o', 'BatchMode=yes', 'root@100.120.14.84', 'python3 -c ' + shlex.quote(DETAILS if args.details else REMOTE)], text=True, capture_output=True, timeout=55)
            if result.returncode:
                raise RuntimeError('Read-only host inventory failed; no credential output retained')
            inventory = json.loads(result.stdout)
        finally:
            closed = subprocess.run(['ssh', '-S', socket, '-O', 'exit', 'root@100.120.14.84'], capture_output=True, timeout=10)
            if closed.returncode:
                raise RuntimeError('Task transport closure was not confirmed')
        inventory['transport_closed'] = True
        with output.open('x') as file:
            file.write(json.dumps(inventory, indent=2) + '\n')
    print(json.dumps({'report': str(output), 'transport_closed': inventory['transport_closed']}))

if __name__ == '__main__':
    main()
