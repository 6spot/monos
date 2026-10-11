import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DeliveryBatch, OwnerDeliveryStatus } from '../../../packages/protocol/generated/types.ts';
const base = 'http://127.0.0.1:18556';
const run = new Date().toISOString().replaceAll(/[^0-9]/g,'');
interface Scenario { task: string; second: string; schema: string }
interface Observed { batch: {id:string;content_digest:string;input_cutoff:string;status:string}[]; input:{sequence:string;accepted_delivery_operation_id:string}[];receipts:{request_id:string;envelope:{name:string};response:{operation_id?:string}}[];provider_calls:number }
async function control<T>(page: Page, path: string, data: object = {}): Promise<T> {
  const response = await page.request.post(path, { data, headers: { Origin: base } });
  expect(response.ok()).toBe(true); return response.json();
}
async function read<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async path => {
    const session = await fetch('/v1/owner/session').then(value => value.json());
    const response = await fetch(path, { headers: { 'X-Monos-Session': session.session_id } });
    if (!response.ok) throw new Error(`Protected read failed ${response.status}`);
    return response.json();
  }, path);
}
async function scenario(page: Page, mode: 'repository_free'|'modified'|'no_change'|'multi_deferred') {
  const value = await control<Scenario>(page, '/__test__/owner-delivery-scenario', { mode });
  await page.goto(`/#task?task_id=${value.task}&section=overview`);
  await expect(page.getByRole('heading',{name:'Acceptance and delivery',exact:true})).toBeVisible();
  return value;
}
const section = (page: Page) => page.getByRole('region',{name:'Owner delivery',exact:true});
async function prepare(page: Page) {
  await page.getByRole('button',{name:'Prepare exact review',exact:true}).click();
  await expect(section(page)).toContainText('Exact prepared review');
  await page.getByRole('button',{name:'Review exact result',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Completed outputs and evidence');
}
async function confirm(page: Page) {
  await page.getByRole('button',{name:'Confirm exact result',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Exact Owner confirmation recorded.');
}
async function capture(page: Page, info: TestInfo, name: string, state: string, dialog = false) {
  const root = resolve('../..'), dir = resolve(root,`docs/research/evidence/multi-repository-ui-v1/owner-delivery-${run}`);
  await mkdir(dir,{recursive:true});
  const sourcePaths = [...execFileSync('rg',['--files','apps/web/src','packages/protocol/src','packages/protocol/schemas','packages/protocol/generated'],{cwd:root,encoding:'utf8'}).trim().split('\n'),'apps/web/test/owner-delivery.e2e.ts','apps/web/test/owner-delivery-server.ts','apps/web/owner-delivery.playwright.config.ts'].sort();
  const source = await Promise.all(sourcePaths.map(async path=>({path,sha256:createHash('sha256').update(await readFile(resolve(root,path))).digest('hex')})));
  const assets = await readdir(resolve(root,'apps/web/dist/assets'));
  const bundle = await Promise.all(assets.sort().map(async path=>({path,sha256:createHash('sha256').update(await readFile(resolve(root,'apps/web/dist/assets',path))).digest('hex')})));
  const metadata = { head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty_candidate:true,source,bundle,route:page.url(),state,test:info.title,evidence:'Current built SPA; real isolated PostgreSQL, protected Owner routes through createApp injection, actual prepare/confirm/accept/Retry/Cancel and conversation receipts. Git/process and provider progress are explicitly synthetic. No native Runtime or live provider claim.',views:[] as unknown[] };
  for(const viewport of [{width:1440,height:1000,label:'desktop'},{width:390,height:844,label:'mobile'}]){
    await page.setViewportSize(viewport);await page.evaluate(()=>document.fonts.ready);
    if(!dialog)await page.getByRole('article',{name:'Accepted delivery batch',exact:true}).scrollIntoViewIfNeeded();
    if(dialog && viewport.label==='mobile'){
      const action=page.getByRole('button',{name:'Accept delivery',exact:true});
      await action.scrollIntoViewIfNeeded();await expect(action).toBeInViewport();
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} page overflow`).toBe(true);
    const body=await page.locator('body').innerText();expect(body).not.toContain('ephemeral-owner-delivery-test-grant');
    const image=await page.screenshot(),file=`${name}-${viewport.label}.png`;
    await writeFile(resolve(dir,file),image,{flag:'wx'});await info.attach(file,{body:image,contentType:'image/png'});
    metadata.views.push({viewport,file,sha256:createHash('sha256').update(image).digest('hex'),body});
  }
  await writeFile(resolve(dir,`${name}.json`),JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});
  await page.setViewportSize({width:1440,height:1000});
  console.log(`Owner delivery screenshots: ${dir}/${name}`);
}

test('exact modified confirmation admits one frozen batch; later input, lost Retry receipt and Cancel retain its identity',async({page},info)=>{
  const f=await scenario(page,'modified');
  const before=await control<Observed>(page,'/__test__/owner-delivery-observe');expect(before.batch).toHaveLength(0);
  await prepare(page);
  const prepared=await control<Observed>(page,'/__test__/owner-delivery-observe');expect(prepared.receipts.map(value=>value.envelope.name)).toEqual(['prepare_delivery_acceptance']);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(page.getByRole('button',{name:'Review exact result',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Review exact result',exact:true}).click();
  expect((await control<Observed>(page,'/__test__/owner-delivery-observe')).receipts).toHaveLength(1);
  await confirm(page);await capture(page,info,'exact-confirmation','Actual prepared complete modified proposal and actual exact Owner confirmation; no acceptance yet',true);
  await page.getByRole('button',{name:'Accept delivery',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(section(page)).toContainText('The accepted result is frozen.');
  const accepted=await control<Observed>(page,'/__test__/owner-delivery-observe');expect(accepted.batch).toHaveLength(1);
  const original=accepted.batch[0]!;expect(accepted.receipts.filter(value=>value.envelope.name==='accept_delivery')).toHaveLength(1);
  await expect(page.getByRole('button',{name:'Cancel task',exact:true})).toHaveCount(0);
  await page.goto(`/#task?task_id=${f.task}&section=conversation`);
  await page.getByLabel('Message to Planner', {exact:true}).fill('Explain this frozen result while delivery waits');await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(page.getByText('Message saved. Planner processing is separate.',{exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'Task conversation',exact:true})).toContainText('Explain this frozen result while delivery waits');
  await expect(page.getByRole('region',{name:'Task conversation',exact:true})).toContainText('cannot change or pause the accepted delivery');
  const later=await control<Observed>(page,'/__test__/owner-delivery-observe');expect(later.input.at(-1)?.accepted_delivery_operation_id).toBe(original.id);expect(later.batch[0]?.content_digest).toBe(original.content_digest);expect(later.batch[0]?.input_cutoff).toBe(original.input_cutoff);
  await control(page,'/__test__/owner-delivery-progress',{status:'failed'});
  await page.goto(`/#task?task_id=${f.task}&section=overview`);
  await expect(page.getByRole('button',{name:'Retry accepted delivery',exact:true})).toBeEnabled();
  await expect(section(page)).toContainText('Required checks · Unknown');
  await capture(page,info,'frozen-failed','Actual accepted batch plus immutable later input; explicitly synthetic failed progress and unknown readiness');
  let lost=false;
  await page.route('**/v1/owner/tasks/delivery/commands',async route=>{
    const body=route.request().postDataJSON();if(body.name==='retry_delivery'&&!lost){lost=true;await route.fetch();await route.abort('failed');return;}await route.continue();
  });
  await page.getByRole('button',{name:'Retry accepted delivery',exact:true}).click();
  await expect(page.getByRole('button',{name:'Check request result',exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole('button',{name:'Check request result',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Check request result',exact:true}).click();await expect(page.getByRole('button',{name:'Check request result',exact:true})).toHaveCount(0);
  const recovered=await control<Observed>(page,'/__test__/owner-delivery-observe');expect(recovered.receipts.filter(value=>value.envelope.name==='retry_delivery')).toHaveLength(1);expect(recovered.batch[0]?.id).toBe(original.id);expect(recovered.batch[0]?.content_digest).toBe(original.content_digest);expect(recovered.batch[0]?.input_cutoff).toBe(original.input_cutoff);
  await page.unroute('**/v1/owner/tasks/delivery/commands');
  await page.getByRole('button',{name:'Cancel accepted delivery',exact:true}).click();await page.getByRole('button',{name:'Cancel this batch and Task',exact:true}).click();
  await expect(section(page)).toContainText('New delivery effects are revoked.');
  expect((await control<Observed>(page,'/__test__/owner-delivery-observe')).batch[0]?.status).toBe('cancelled');
});

test('repository-free acceptance completes locally and preserves immutable accepted evidence',async({page},info)=>{
  const f=await scenario(page,'repository_free');await prepare(page);await confirm(page);
  await page.getByRole('button',{name:'Accept result',exact:true}).click();
  await expect(section(page)).toContainText('This accepted delivery is complete.');
  await expect(section(page)).toContainText('No modified repository items.');
  await expect(page.getByRole('button',{name:'Cancel accepted delivery',exact:true})).toHaveCount(0);
  const status=await read<OwnerDeliveryStatus>(page,`/v1/owner/tasks/${f.task}/delivery`),b=status.batches[0]!;
  const detail=await read<DeliveryBatch>(page,`/v1/owner/tasks/${f.task}/delivery/batches/${b.operation_id}`);
  expect(detail.manifest.repositories).toEqual([]);expect(detail.items).toEqual([]);expect(detail.batch.status).toBe('completed');
  expect((await control<Observed>(page,'/__test__/owner-delivery-observe')).provider_calls).toBe(0);
  await capture(page,info,'local-completed','Actual repository-free Owner acceptance and atomic local Task completion, zero provider calls');
});

test('deferred multi-repository acceptance retains partial success and retries only the remainder', async ({ page }, info) => {
  const f = await scenario(page, 'multi_deferred');
  expect((await control<Observed>(page, '/__test__/owner-delivery-observe')).provider_calls).toBe(0);
  await prepare(page);
  await expect(page.getByRole('dialog')).toContainText('1 completed output · 2 modified repositories.');
  await expect(page.getByRole('dialog')).toContainText('github.com/example/multi-0');
  await expect(page.getByRole('dialog')).toContainText('github.com/example/multi-1');
  await confirm(page);
  await page.getByRole('button', { name: 'Accept delivery', exact: true }).click();
  await expect(section(page)).toContainText('0 of 2 repository items finalized.');
  await control(page, '/__test__/owner-delivery-multi-progress', { action: 'partial' });
  await expect(section(page)).toContainText('1 of 2 repository items finalized.');
  await expect(page.getByRole('article', { name: 'Accepted delivery batch', exact: true })).toContainText('Finalized · github.com/example/multi-0');
  await expect(page.getByRole('article', { name: 'Accepted delivery batch', exact: true })).toContainText('Failed · github.com/example/multi-1');
  await expect(page.getByRole('button', { name: 'Retry accepted delivery', exact: true })).toBeEnabled();
  const status = await read<OwnerDeliveryStatus>(page, `/v1/owner/tasks/${f.task}/delivery`);
  const id = status.batches[0]!.operation_id;
  const partial = await read<DeliveryBatch>(page, `/v1/owner/tasks/${f.task}/delivery/batches/${id}`);
  const delivered = partial.items.find(item => item.status === 'finalized')!;
  expect(partial.manifest.repositories).toHaveLength(2);
  expect(partial.batch.status).toBe('failed');
  await capture(page, info, 'multi-repository-partial', 'Actual exact acceptance, preparation and delivery worker; synthetic second provider rejects after first verified merge. First finalization remains durable.');
  await page.getByRole('button', { name: 'Retry accepted delivery', exact: true }).click();
  await expect(section(page)).not.toContainText('Accepted delivery · Failed');
  await control(page, '/__test__/owner-delivery-multi-progress', { action: 'resume' });
  await expect(section(page)).toContainText('2 of 2 repository items finalized.');
  await expect(section(page)).toContainText('This accepted delivery is complete.');
  const completed = await read<DeliveryBatch>(page, `/v1/owner/tasks/${f.task}/delivery/batches/${id}`);
  expect(completed.items.find(item => item.item_id === delivered.item_id)).toEqual(delivered);
  expect(completed.manifest).toEqual(partial.manifest);
  await capture(page, info, 'multi-repository-completed', 'Actual remaining-item Retry completes the frozen two-repository batch; first finalization is unchanged. Remote provider responses are synthetic.');
});

test('held delivery reads cannot restore another Task or a signed-out session',async({page})=>{
  const f=await scenario(page,'repository_free');await prepare(page);await confirm(page);await page.getByRole('button',{name:'Accept result',exact:true}).click();await expect(section(page)).toContainText('This accepted delivery is complete.');
  let release:()=>void=()=>{},entered:()=>void=()=>{},heldOnce=false;
  const held=new Promise<void>(resolve=>{entered=resolve;});
  await page.route(`**/v1/owner/tasks/${f.task}/delivery`,async route=>{
    if(heldOnce){await route.continue();return;}heldOnce=true;
    const response=await route.fetch();await new Promise<void>(resolve=>{release=resolve;entered();});try{await route.fulfill({response});}catch{/* Task navigation may abort the retained request. */}
  });
  await held;await page.goto(`/#task?task_id=${f.second}&section=overview`);release();
  await expect(page.getByText('Independent test-only Task for source fencing',{exact:true})).toBeVisible();
  await expect(section(page)).not.toContainText('This accepted delivery is complete.');await page.unroute(`**/v1/owner/tasks/${f.task}/delivery`);
  await page.goto(`/#task?task_id=${f.task}&section=overview`);await expect(section(page)).toContainText('This accepted delivery is complete.');
  let releaseLogout:()=>void=()=>{},enteredLogout:()=>void=()=>{},logoutHeldOnce=false;
  const heldLogout=new Promise<void>(resolve=>{enteredLogout=resolve;});
  await page.route(`**/v1/owner/tasks/${f.task}/delivery`,async route=>{
    if(logoutHeldOnce){await route.continue();return;}logoutHeldOnce=true;
    const response=await route.fetch();await new Promise<void>(resolve=>{releaseLogout=resolve;enteredLogout();});try{await route.fulfill({response});}catch{/* Logout may abort the retained request. */}
  });
  await heldLogout;await page.getByRole('button',{name:'Sign out',exact:true}).click();releaseLogout();
  await expect(page.getByRole('region',{name:'Owner delivery',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('monos:task-ui:')))).toEqual([]);
  await page.unroute(`**/v1/owner/tasks/${f.task}/delivery`);
});
