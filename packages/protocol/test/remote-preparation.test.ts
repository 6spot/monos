import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {canonicalJSON,digest,validate} from '../src/index.ts';
import type {PublicationPushRequest,PublicationResult,PublicationPrepareRequest} from '../src/index.ts';

const fixture=JSON.parse(readFileSync(new URL('../fixtures/remote-preparation.json',import.meta.url),'utf8')) as {
 push:PublicationPushRequest; mapped:PublicationResult; mapping_request:PublicationPrepareRequest;
 frame:Record<string,unknown>; canonical_request:string; request_digest:string;
 cases:{schema:string;valid:boolean;name:string;value:unknown}[];
};
describe('shared remote preparation boundary',()=>{
 for(const c of fixture.cases)it(c.name,()=>{
  const checked=()=>validate(c.schema,c.value);
  if(c.valid)expect(checked).not.toThrow();else expect(checked).toThrow();
 });
 it('keeps every paired digest exact throughout valid nested fixtures',()=>{
  const pairs=[['source','source_digest'],['effective_basis','effective_basis_digest'],['construction','construction_digest'],['configuration','configuration_digest'],['permission_proof','permission_proof_digest'],['published','published_digest'],['published_proof','published_proof_digest'],['candidate','candidate_manifest_digest'],['scan','scan_digest'],['mapping','mapping_digest'],['observation','observation_digest']];
  const visit=(value:unknown,path:string)=>{
   if(Array.isArray(value)){value.forEach((item,index)=>visit(item,`${path}[${index}]`));return;}
   if(!value||typeof value!=='object')return;
   const record=value as Record<string,unknown>;
   for(const [key,field]of pairs)if(record[key!]!==undefined&&record[field!]!==undefined)expect(record[field!],`${path}.${field}`).toBe(digest(canonicalJSON(record[key!])));
   if(record.preparation&&record.prepared){const prepared=record.prepared as Record<string,unknown>;expect(prepared.request_digest,`${path}.prepared.request_digest`).toBe(digest(canonicalJSON(record.preparation)));expect(record.preparation_result_digest).toBe(digest(canonicalJSON(prepared)));}
   for(const [key,item]of Object.entries(record))visit(item,`${path}.${key}`);
  };
  for(const c of fixture.cases.filter(c=>c.valid))visit(c.value,c.name);
 });
 it('pins immutable request and reused manifest while binding a new scan',()=>{
  expect(canonicalJSON(fixture.push)).toBe(fixture.canonical_request);
  expect(digest(canonicalJSON(fixture.push))).toBe(fixture.request_digest);
  expect(digest(canonicalJSON(fixture.push.preparation.source))).toBe(fixture.push.preparation.source_digest);
  expect(fixture.push.prepared.request_digest).toBe(digest(canonicalJSON(fixture.push.preparation)));
  expect(fixture.push.preparation_result_digest).toBe(digest(canonicalJSON(fixture.push.prepared)));
  expect(fixture.mapped.request_digest).toBe(digest(canonicalJSON(fixture.mapping_request)));
  expect(fixture.mapping_request.published_digest).toBe(digest(canonicalJSON(fixture.mapping_request.published)));
  expect(fixture.mapped.mapping_digest).toBe(digest(canonicalJSON(fixture.mapped.mapping)));
  expect(fixture.mapped.candidate).toEqual(fixture.push.prepared.candidate);
  expect(fixture.mapped.mapping?.source_digest).toBe(fixture.mapping_request.source_digest);
  expect(fixture.mapped.mapping?.reused_head).toBe(fixture.push.prepared.candidate?.head);
  expect(fixture.mapped.scan?.scan_id).toBe(fixture.mapping_request.scan_run_id);
  expect(fixture.mapped.scan?.scan_id).not.toBe(fixture.push.prepared.scan?.scan_id);
  expect(fixture.mapped.scan?.coverage.commits).toBe(0);
  expect(fixture.push.prepared.scan?.workflow_changes).toBe(true);
  expect(fixture.mapped.scan?.workflow_changes).toBe(false);
  expect(digest(canonicalJSON({...fixture.mapped.scan,workflow_changes:true}))).not.toBe(fixture.mapped.scan_digest);
 });
 it('enforces nested UTF8 paths and total encoded provider payload bytes',()=>{
  const push=structuredClone(fixture.push);
  push.preparation.construction.parents[0]!.outcome!.path='界'.repeat(1400);
  expect(()=>validate('PublicationPushRequest',push)).toThrow();
  const provider=structuredClone(fixture.cases.find(c=>c.name==='create exact PR')!.value) as Record<string,unknown>;
  const content={title:'Review',body:'\u0001'.repeat(65536)};
  expect(()=>validate('RemotePreparationContent',content)).not.toThrow();
  provider.content=content;
  provider.override_receipts=Array.from({length:64},()=>({receipt_id:'safe-receipt',confirmation_id:'safe-confirmation',selection_digest:'a'.repeat(64),selection:{candidate_id:'safe-candidate',candidate_manifest_digest:'b'.repeat(64),effective_basis_digest:'c'.repeat(64),scan_digest:'d'.repeat(64),finding_ids:Array.from({length:64},(_,i)=>i.toString(16).padStart(64,'0'))}}));
  expect(()=>validate('RemotePreparationProviderRequest',provider)).toThrow('encoded wire byte limit');
 });
 it('keeps ephemeral access and permission responses within 16 KiB',()=>{
  const value=fixture.cases.find(c=>c.schema==='PublicationAccessResult'&&c.valid)!.value as Record<string,unknown>;
  expect(()=>validate('PublicationAccessResult',{...value,authentication:{kind:'github_installation',token:'x'.repeat(16384),expires_at:'2026-10-04T13:00:00.000Z'}})).toThrow();
 });
});
