import {createInterface} from 'node:readline';
import {database} from '../../../../packages/db/src/index.ts';
import {OwnerDeliveryCommands} from '../../src/owner-delivery-commands.ts';
import {ownerDeliveryHooks} from '../../src/owner-delivery-control.ts';
import {TaskConversation} from '../../src/task-conversation.ts';

// Test-only independent backend process. Credentials arrive only on stdin.
const input=createInterface({input:process.stdin}),lines=input[Symbol.asyncIterator]();
const first=await lines.next();
const config=JSON.parse(first.value!) as {database_url:string;token:string;command:unknown;family:'delivery'|'conversation';mode:'hold'|'kill_before'|'kill_after'};
const db=database(config.database_url),connect=db.pool.connect.bind(db.pool);
db.pool.connect=(async()=>{
 const client=await connect(),query=client.query.bind(client) as (...args:unknown[])=>Promise<unknown>;
 client.query=(async(...args:unknown[])=>{
  if(args[0]==='COMMIT'){
   const pid=(await query('SELECT pg_backend_pid() pid')) as {rows:{pid:number}[]};
   process.stdout.write(JSON.stringify({boundary:'before_commit',pid:pid.rows[0]!.pid})+'\n');
   if(config.mode==='kill_before')process.kill(process.pid,'SIGKILL');
   if(config.mode==='hold')await lines.next();
  }
  const result=await query(...args);
  if(args[0]==='COMMIT'&&config.mode==='kill_after')process.kill(process.pid,'SIGKILL');
  return result;
 }) as typeof client.query;
 return client;
}) as typeof db.pool.connect;
try{
 const result=config.family==='delivery'?await new OwnerDeliveryCommands(db,ownerDeliveryHooks).command(config.token,config.command):await new TaskConversation(db,'cutoff-independent-worker').command(config.token,config.command);
 process.stdout.write(JSON.stringify({boundary:'result',result})+'\n');
}finally{input.close();await db.pool.end();}
