import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {conversationFixture} from './task-conversation-fixture.ts';
import {publicationFixture,publicationPages} from './publication-fixture.ts';
import {Configuration} from '../../src/configuration.ts';
import {GitHub} from '../../src/github.ts';
import {GitHubRemote,remoteProfile} from '../../src/github-remote.ts';
import {observePublicationPermission} from '../../src/remote-preparation-access.ts';
import {OwnerDeliveryCommands} from '../../src/owner-delivery-commands.ts';
import type {OwnerDeliveryHooks} from '../../src/owner-delivery-commands.ts';
import {OwnerDeliveryReads} from '../../src/owner-delivery-reads.ts';
import {publicationDigest as hash} from '../../src/publication-policy.ts';
import type {DeliveryAcceptanceBasis,OwnerDeliveryCommand,PublicationPrepareRequest} from '../../../../packages/protocol/src/index.ts';

export async function ownerDeliveryFixture(mode:'repository_free'|'modified'|'no_change'='repository_free',hooks:OwnerDeliveryHooks={},options:{runnerCredential?:string;artifactCount?:number}={}){
 const x=mode==='repository_free'?await conversationFixture(options):await publicationFixture(options);
 try{
  let grantCalls=0;
  if(mode==='repository_free'){
   await x.start();const n=await x.node();
   for(let i=0;i<(options.artifactCount??0);i++)await x.agent(n,'publish_artifact',{artifact_id:randomUUID(),title:'Selected output '+i,content:{text:'Exact artifact '+i,media_type:'text/plain'},references:[]});
   const done=await x.agent(n,'complete_node',{summary:'Exact repository-free accepted output'});await x.finish(done.operation_id!,n.dispatch.attempt_id);
  }else{
   const git=x as Awaited<ReturnType<typeof publicationFixture>>;
   if(mode==='modified'){
    const github=new GitHub(x.service.options.signingKey),config=new Configuration(x.db,github);
    const save=async(name:'save_github'|'save_project',payload:object)=>config.save(x.token,{schema_version:1,request_id:randomUUID(),name,payload,expected_control_version:(await config.read(x.token)).control_version});
    await save('save_github',{app_id:'7',installation_id:'8',private_key:generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString()});
    await save('save_project',{id:x.f.project,name:'Accepted delivery fixture',context:'Exact synthetic Git result',resources:[{id:git.resource,provider:'github',provider_repo_id:'42',remote_url:'https://github.com/example/result.git',remote_preparation:'automatic',default_branch:'main'}],role_ids:[x.f.role],archived:false});
    const provider=new GitHubRemote(github,{acquireGrant:async(scope,profile)=>{grantCalls++;return {token:'ephemeral-owner-delivery-test-grant',expires_at:new Date(Date.now()+3600_000).toISOString(),repository_id:scope.repository_id,permissions:remoteProfile(scope,profile)};}});
    await observePublicationPermission(x.db,provider,git.deliveryOperationId);
    await git.preparation.pending(x.f.runner,x.f.incarnation,true);
    const op=(await x.db.pool.query<{request:PublicationPrepareRequest}>('SELECT request FROM delivery_operations WHERE task_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[x.f.task])).rows[0]!;
    for(const page of publicationPages(op.request)){page.result.scan!.workflow_changes=false;page.result.scan_digest=hash(page.result.scan);await git.preparation.finish(x.f.runner,x.f.incarnation,page);}
   }else{
    await git.preparation.pending(x.f.runner,x.f.incarnation,true);
    const result={schema_version:1,operation_id:git.request.operation_id,request_digest:hash(git.request),status:'not_applicable',reason:'no_change'};
    await git.preparation.finish(x.f.runner,x.f.incarnation,{schema_version:1,result,page_index:0,page_count:1,findings:[],page_digest:hash([])});
   }
  }
  const commands=new OwnerDeliveryCommands(x.db,hooks),reads=new OwnerDeliveryReads(x.db);
  const basis=async():Promise<DeliveryAcceptanceBasis>=>{const b=await x.basis();return {control_version:b.control_version,specification_id:b.specification_id,plan_id:b.plan_id};};
  const command=(name:OwnerDeliveryCommand['name'],payload:OwnerDeliveryCommand['payload'],requestId=randomUUID())=>commands.command(x.token,{schema_version:1,task_id:x.f.task,request_id:requestId,name,payload});
  const prepare=async()=>command('prepare_delivery_acceptance',{basis:await basis()});
  const confirm=async(p:Awaited<ReturnType<typeof prepare>>)=>command('confirm_delivery_acceptance',{proposal_id:p.proposal_id!,content_digest:p.content_digest!});
  const accept=async(p:Awaited<ReturnType<typeof prepare>>,c:Awaited<ReturnType<typeof confirm>>,requestId=randomUUID())=>command('accept_delivery',{proposal_id:p.proposal_id!,content_digest:p.content_digest!,confirmation_id:c.confirmation_id!,basis:await basis()},requestId);
  return {...x,commands,reads,deliveryBasis:basis,deliveryCommand:command,prepareDelivery:prepare,confirmDelivery:confirm,acceptDelivery:accept,grantCalls:()=>grantCalls};
 }catch(error){await x.close();throw error;}
}
