import { expect, it } from 'vitest';
import { ResultReadBroker } from '../src/result-read-broker.ts';
import { canonicalJSON, digest } from '../../../packages/protocol/src/index.ts';
import type { Frame, ResultReadRequest } from '../../../packages/protocol/src/index.ts';
export function brokerRequest(runner = 'runner'): ResultReadRequest {
 const identity={task_id:'task',operation_id:'operation',attempt_id:'attempt',dispatch_id:'dispatch',node_id:'node',node_activation:1,specification_id:'spec',plan_id:'plan',workspace_id:'workspace',resource_id:'repo',runner_id:runner,storage_id:'storage',lease_id:'lease',generation:1,repository_identity:'repo',manifest_digest:'a'.repeat(64),operation_identity_digest:'b'.repeat(64),base_commit:'a'.repeat(40),git_commit:'b'.repeat(40),git_tree:'c'.repeat(40)};
 return {identity,identity_digest:digest(canonicalJSON(identity)),mode:'diff',path:'safe.txt'};
}
function response(f: Frame, text='exact'):Frame {return {schema_version:1,type:'result_read_result',incarnation:f.incarnation!,correlation_id:f.correlation_id!,result_read_result:{schema_version:1,request:f.result_read!,status:'available',text}};}
it('matches full request, socket, incarnation and correlation, drops duplicates and cleans on disconnect',async()=>{
 const b=new ResultReadBroker(1000),socket={},other={};let sent!:Frame;
 b.register('runner',1,socket,true,f=>{sent=f;return true});const waiting=b.read(brokerRequest(),1);
 b.response('runner',other,response(sent));b.response('wrong',socket,response(sent));
 b.response('runner',socket,{...response(sent),incarnation:2});
 const wrong=response(sent);wrong.result_read_result!.request={...wrong.result_read_result!.request,path:'other.txt'};b.response('runner',socket,wrong);
 b.response('runner',socket,response(sent));expect((await waiting).text).toBe('exact');b.response('runner',socket,response(sent,'duplicate'));
 const second=b.read(brokerRequest(),1);b.disconnect('runner',other);b.disconnect('runner',socket);expect((await second).status).toBe('offline');b.shutdown();
});
it('bounds capacity, expires waiting reads and refuses unsupported/off-instance/old incarnations',async()=>{
 const b=new ResultReadBroker(25),socket={};expect((await b.read(brokerRequest())).status).toBe('offline');
 b.register('runner',2,socket,false,()=>true);expect((await b.read(brokerRequest(),2)).status).toBe('unsupported');
 b.register('runner',3,socket,true,()=>true);expect((await b.read(brokerRequest(),2)).status).toBe('offline');
 b.register('runner',2,{},true,()=>{throw Error('stale socket')});
 const waiting=Array.from({length:4},()=>b.read(brokerRequest(),3));expect((await b.read(brokerRequest(),3)).status).toBe('busy');expect((await Promise.all(waiting)).every(v=>v.status==='timeout')).toBe(true);
 b.register('runner-2',1,{},true,()=>true);b.register('runner-3',1,{},true,()=>true);
 const global=[...Array.from({length:4},()=>b.read(brokerRequest('runner-2'),1)),...Array.from({length:4},()=>b.read(brokerRequest('runner-3'),1))];
 expect((await b.read(brokerRequest(),3)).status).toBe('busy');b.shutdown();expect((await Promise.all(global)).every(v=>v.status==='offline')).toBe(true);
});
it('immediately releases read ownership when send throws or returns false',async()=>{
 const b=new ResultReadBroker(10000),socket={};b.register('runner',1,socket,true,()=>{throw Error('private transport details');});
 for(let i=0;i<9;i++)expect((await b.read(brokerRequest(),1)).status).toBe('offline');
 b.register('runner',2,socket,true,()=>false);expect((await b.read(brokerRequest(),2)).status).toBe('offline');b.shutdown();
});
it('rejects nested raw UTF-8 overflow and incomplete responses before resolving a read',async()=>{
 const b=new ResultReadBroker(1000),socket={};let sent!:Frame;b.register('runner',1,socket,true,f=>{sent=f;return true});const waiting=b.read(brokerRequest(),1);
 expect(()=>b.response('runner',socket,response(sent,'界'.repeat(65536)))).toThrow('raw byte');
 const missing=response(sent);delete missing.result_read_result!.text;expect(()=>b.response('runner',socket,missing)).toThrow();
 b.response('runner',socket,response(sent));expect((await waiting).text).toBe('exact');b.shutdown();
});

it('validates canonical changed-file cursor position and selected-result scope',async()=>{
 const {resultChangeCursor}=await import('../src/result-content-reads.ts');
 const d='a'.repeat(64),encode=(v:unknown)=>Buffer.from(canonicalJSON(v)).toString('base64url');
 expect(resultChangeCursor(d,encode({version:1,identity:d,after:64}))).toBe(64);
 expect(()=>resultChangeCursor(d,encode({version:1,identity:'b'.repeat(64),after:64}))).toThrow('another result');
 for(const v of [{version:1,identity:d,after:-1},{version:1,identity:d,after:1.5},{version:1,identity:d,after:Number.MAX_SAFE_INTEGER+1},{version:1,identity:d,after:1,extra:true}])expect(()=>resultChangeCursor(d,encode(v))).toThrow('Invalid changed-files cursor');
 expect(()=>resultChangeCursor(d,'not-json')).toThrow();
});
