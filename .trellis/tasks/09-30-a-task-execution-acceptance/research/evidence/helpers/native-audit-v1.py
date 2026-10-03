"""Read-only new native Task/Todo observations; root runs explicit stages.
Evidence writes are exclusive. No Owner/model/driver/admission/service commands.
"""
import base64,hashlib,json,os,pathlib,re,subprocess,sys,time
sys.path.insert(0,'/root')
import monos_replan_audit_common_v3 as a
from discussion_probe import DiscussionProbe
from workspace_probe import WorkspaceProbe
from probe import checked_id
EVIDENCE=pathlib.Path('/root/monos-execution-native-evidence-v1')

class NativeProbe(a.AuditProbe,WorkspaceProbe):
    """Keep SQL read-only and satisfy WorkspaceProbe's native snapshot MRO."""
    pass

def save(name,value):
    path=EVIDENCE/(checked_id(name)+'.json')
    with path.open('x') as f:
        os.fchmod(f.fileno(),0o600);json.dump(value,f,sort_keys=True,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    fd=os.open(EVIDENCE,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)

def probe():
    p=NativeProbe(str(a.SOURCE),str(EVIDENCE));p.compose+=['-f','/root/monos-boundary-probe-ports.yaml'];return p

def scope_records(p,todo):
    todo=checked_id(todo)
    tables={'messages':'todo_discussion_messages','controls':'todo_discussion_controls','sources':'todo_discussion_outbox','resolutions':'todo_discussion_resolutions','requirements':'todo_requirement_cache','confirmations':'task_creation_confirmations','preview_resolutions':'task_preview_resolutions','attempts':'attempts','tasks':'tasks'}
    fields=["'todo',(SELECT to_jsonb(t) FROM todos t WHERE id='"+todo+"')"]
    for key,table in tables.items():fields.append("'"+key+"',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM "+table+" r WHERE todo_id='"+todo+"')")
    fields.extend([
      "'execution_policies',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM execution_policies r)",
      "'tool_receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM command_receipts r WHERE scope_id='"+todo+"')",
      "'todo_receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM todo_command_receipts r WHERE response#>>'{todo,todo_id}'='"+todo+"')",
      "'discussion_receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM discussion_command_receipts r WHERE response->>'todo_id'='"+todo+"')",
      "'preview_receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM task_preview_command_receipts r WHERE response->>'todo_id'='"+todo+"' OR response->>'proposal_message_id' IN (SELECT id FROM todo_discussion_messages WHERE todo_id='"+todo+"'))",
      "'project',(SELECT to_jsonb(p) FROM projects p JOIN todos t ON t.project_id=p.id WHERE t.id='"+todo+"')",
      "'resources',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM project_resources r JOIN todos t ON t.project_id=r.project_id WHERE t.id='"+todo+"')",
      "'roles',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM roles r JOIN project_roles pr ON pr.role_id=r.id JOIN todos t ON t.project_id=pr.project_id WHERE t.id='"+todo+"')",
      "'configuration_receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM configuration_receipts r WHERE response->>'entity_id' IN (SELECT project_id FROM todos WHERE id='"+todo+"' UNION SELECT pr.role_id FROM project_roles pr JOIN todos t ON t.project_id=pr.project_id WHERE t.id='"+todo+"'))",
    ])
    return p.query('SELECT jsonb_build_object('+','.join(fields)+');')

def scope_normalized(records):
    # Poll timestamps are observational bookkeeping only; all other bytes retained.
    return {k:a.ordered([{n:v for n,v in row.items() if n!='last_checked_at'} for row in rows] if k=='sources' else rows) for k,rows in records.items()}

def todo_capture(p,todo):
    records=scope_records(p,todo);audit=DiscussionProbe.audit(p,todo)
    native={row['id']:DiscussionProbe.snapshot(p,row['id']) for row in records['attempts']}
    confirmed=scope_records(p,todo)
    return {'records':records,'confirmed':confirmed,'audit':audit,'native':native,'stable_read':scope_normalized(records)==scope_normalized(confirmed)}

def git_bytes(p,args):
    result=subprocess.run(args,capture_output=True,check=True,timeout=30,cwd=a.SOURCE);return result.stdout

def git_facts(p,records):
    facts={}
    for workspace in records['workspace_records']:
        ident=checked_id(workspace['id']);manifest=pathlib.Path('/var/lib/monos-probe/launch/workspaces')/(ident+'.json');info=manifest.lstat()
        a.require(manifest.is_file() and not manifest.is_symlink() and info.st_uid==0 and not info.st_mode&0o022,'Untrusted workspace root manifest')
        worktree=pathlib.Path('/var/lib/monos-probe/tasks')/ident/'worktree'
        a.require(worktree.is_dir() and not worktree.is_symlink(),'Unexpected workspace worktree')
        git=['runuser','-u','me','--','/usr/bin/env','-i','PATH=/usr/bin:/bin','GIT_CONFIG_NOSYSTEM=1','GIT_CONFIG_GLOBAL=/dev/null','GIT_TERMINAL_PROMPT=0','GIT_ALLOW_PROTOCOL=file','GIT_OPTIONAL_LOCKS=0','/usr/bin/git','-C',str(worktree),'-c','core.hooksPath=/dev/null','--no-replace-objects']
        head=p.call(git+['rev-parse','HEAD']).strip();commits={head}
        for op in records['operations']:
            if (op.get('result') or {}).get('git_commit'):commits.add(op['result']['git_commit'])
        objects={}
        for oid in sorted(commits):
            a.require(re.fullmatch('[a-f0-9]{40}|[a-f0-9]{64}',oid),'Invalid observed Git object identity')
            entries=git_bytes(p,git+['ls-tree','-rz','--full-tree',oid]);files={};total=0
            for entry in entries.split(b'\0'):
                if not entry:continue
                metadata,name=entry.split(b'\t',1);mode,kind,blob=metadata.decode().split()
                if kind!='blob':continue
                data=git_bytes(p,git+['cat-file','blob',blob]);total+=len(data)
                a.require(total<=2*1024*1024,'Result file evidence exceeds reviewed bound')
                files[os.fsdecode(name)]={'mode':mode,'blob':blob,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'base64':base64.b64encode(data).decode()}
            objects[oid]={'tree':p.call(git+['rev-parse',oid+'^{tree}']).strip(),'commit':p.call(git+['show','-s','--format=%H%n%T%n%P',oid]),'files':files}
        exports={}
        for completion in records['completions']:
            op=a.one([r for r in records['operations'] if r['id']==completion['operation_id']])
            result=op.get('result') or {};oid=result.get('git_commit')
            if op.get('resource_id')!=workspace['resource_id'] or not oid:continue
            exported=p.exported_git_object(op['id'],oid)
            exports[op['id']]={'commit':oid,'actual_export':exported,'tree_matches_worktree':exported.get('tree')==objects[oid]['tree'],'result_ref_matches_commit':exported.get('result_ref')==oid}
        facts[ident]={'exports':exports,'root_manifest':a.load(manifest),'root_manifest_sha256':a.file_sha(manifest),'worktree':str(worktree),'head':head,'objects':objects,'refs':p.call(git+['show-ref']),'status':p.call(git+['status','--porcelain=v1','-z','--untracked-files=all']),'index_sha256':hashlib.sha256(git_bytes(p,git+['ls-files','--stage','-z'])).hexdigest()}
    return facts

def task_capture(p,task,with_git=False):
    records=p.records(checked_id(task));a.require(records['task'] is not None,'Task missing')
    native={row['id']:WorkspaceProbe.workspace_snapshot(p,row['id']) for row in records['attempts']}
    git=git_facts(p,records) if with_git else None;confirmed=p.records(task)
    return {'records':records,'confirmed':confirmed,'native':native,'git':git,'stable_read':a.normalized(records)==a.normalized(confirmed)}

def checks_for(stage,task,todo,counts):
    checks={'todo_stable_read':todo['stable_read'],'todo_exists':todo['records']['todo'] is not None,'capture_receipt_present':bool(todo['records']['todo_receipts'])}
    if stage=='passive':checks.update({'zero_todo_attempts':not todo['records']['attempts'],'zero_discussion_sources':not todo['records']['sources'],'zero_discussion_messages':not todo['records']['messages'],'zero_tasks':not todo['records']['tasks']})
    else:
        records=task['records'];checks['task_stable_read']=task['stable_read'];checks['exact_todo_task']=records['task']['todo_id']==todo['records']['todo']['id']
        if stage=='prestart':checks.update({'canonical_PLANNING':records['task']['state']=='PLANNING','zero_attempts':not records['attempts'],'zero_plans':not records['plans'],'zero_nodes':not records['nodes'],'zero_planning_sources':not records['planning_sources'],'zero_starts':not records['starts'],'zero_workspaces':not records['workspace_records'],'zero_leases':not records['lease_records'],'zero_operations':not records['operations']})
        if stage=='final':checks.update({'REVIEW':records['task']['state']=='REVIEW','completed_manifests':bool(records['manifests']) and bool(records['completions']),'task_native_released':bool(task['native']) and all(a.settled_checks(n) for n in task['native'].values()),'todo_native_released':bool(todo['native']) and all(a.settled_checks(n) for n in todo['native'].values()),'global_owned_work_zero':all(v==0 for v in counts.values()),'repository_result_observed':bool(task['git']),'finalized_export_matches':bool(task['git']) and any(w['exports'] for w in task['git'].values()) and all(e['tree_matches_worktree'] and e['result_ref_matches_commit'] for w in task['git'].values() for e in w['exports'].values())})
    return checks

def main():
    args=sys.argv[1:];a.require(bool(args) and args[0] in ('passive','prestart','task','final'),'Explicit observed stage required')
    stage=args[0];task_id=None
    if stage=='passive':a.require(len(args)==2,'passive TODO');todo_id=checked_id(args[1]);name='passive'
    elif stage=='prestart':a.require(len(args)==2,'prestart TASK');task_id=checked_id(args[1]);name='prestart'
    elif stage=='task':a.require(len(args)==3,'task LABEL TASK');name='task-'+checked_id(args[1]);task_id=checked_id(args[2])
    else:a.require(len(args)==3,'final TASK TODO');task_id=checked_id(args[1]);todo_id=checked_id(args[2]);name='final'
    EVIDENCE.mkdir(mode=0o700,exist_ok=True)
    provenance={'script_sha256':a.file_sha(__file__),'common_sha256':a.file_sha(a.__file__),'workspace_probe_sha256':a.file_sha(sys.modules[WorkspaceProbe.__module__].__file__),'discussion_probe_sha256':a.file_sha(sys.modules[DiscussionProbe.__module__].__file__)}
    save(name+'-intent',{'at':time.time(),'argv':args,'provenance':provenance})
    p=probe();task=task_capture(p,task_id,stage=='final') if task_id else None
    if stage in ('task','prestart'):todo_id=checked_id(task['records']['task']['todo_id'])
    todo=todo_capture(p,todo_id);counts=a.idle(p);checks=checks_for(stage,task,todo,counts)
    outcome=('pass' if all(checks.values()) else 'fail') if stage!='task' else 'observed'
    save(name,{'at':time.time(),'outcome':outcome,'checks':checks,'task':task,'todo':todo,'counts':counts,'runner':WorkspaceProbe.runner_identity(p),'provenance':provenance})
    print(json.dumps({'stage':stage,'name':name,'outcome':outcome,'task_id':task_id,'todo_id':todo_id,'checks':checks,'counts':counts}))
    if stage!='task':a.require(outcome=='pass','Observed gate failed; retain evidence and inspect exact IDs')
if __name__=='__main__':main()
