import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {canonicalJSON,digest,validate} from '../src/index.ts';
import type {PublicationResultPage,PublicationPrepareRequest} from '../src/index.ts';
const fixture=JSON.parse(readFileSync(new URL('../fixtures/publication.json',import.meta.url),'utf8')) as {request:PublicationPrepareRequest;page:PublicationResultPage;request_digest:string;result_digest:string;canonical_request:string};
it('pins the cross-language publication request and digest',()=>{
 expect(canonicalJSON(fixture.request)).toBe(fixture.canonical_request);expect(digest(canonicalJSON(fixture.request))).toBe(fixture.request_digest);
 expect(()=>validate('PublicationPrepareRequest',fixture.request)).not.toThrow();
 expect(digest(canonicalJSON(fixture.request.source))).toBe(fixture.request.source_digest);
 expect(fixture.request.construction.source_digest).toBe(fixture.request.source_digest);
 expect(digest(canonicalJSON(fixture.request.construction))).toBe(fixture.request.construction_digest);
 expect(fixture.page.result.request_digest).toBe(fixture.request_digest);
 expect(digest(canonicalJSON(fixture.page.result))).toBe(fixture.result_digest);
});
it('bounds publication UTF8 paths, malformed Unicode and whole frame encoding',()=>{
 const finding={finding_id:'a'.repeat(64),kind:'tracked_ignore',rule_id:'tracked_ignore',scope:'final_tree',commit:'b'.repeat(40),path:'𠮷.txt',path_redacted:false,occurrence_ordinal:0,override_eligible:true,message:'Tracked file matches ignore rules.'};
 const page={...fixture.page,findings:[finding]};expect(()=>validate('PublicationResultPage',page)).not.toThrow();
 expect(()=>validate('PublicationResultPage',{...page,findings:[{...finding,path:'界'.repeat(1400)}]})).toThrow();
 expect(()=>validate('PublicationResultPage',{...page,findings:[{...finding,path:'\ud800'}]})).toThrow();
 const large={...page,findings:Array.from({length:64},(_,i)=>({...finding,path:'\t'.repeat(3900),occurrence_ordinal:i}))};expect(()=>validate('PublicationResultPage',large)).not.toThrow();
 const huge={...page,findings:Array.from({length:64},(_,i)=>({...finding,path:'\t'.repeat(4096),occurrence_ordinal:i}))};
 expect(()=>validate('Frame',{schema_version:1,type:'publication_result',incarnation:1,publication_result:huge})).toThrow();
 expect(()=>validate('PublicationResultPage',{...fixture.page,result:{...fixture.page.result,scan:{...fixture.page.result.scan,status:'incomplete'}}})).toThrow();
});
