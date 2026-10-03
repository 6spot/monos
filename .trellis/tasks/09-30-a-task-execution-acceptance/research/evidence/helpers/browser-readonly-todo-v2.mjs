import {createRequire} from 'node:module';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import readline from 'node:readline';
const require=createRequire('/Users/me/IdeaProjects/monos/apps/web/package.json');
const {chromium}=require('@playwright/test');
const root='/tmp/monos-execution-native-todo-continuity-v2', base='https://127.0.0.1:19444';
fs.mkdirSync(root,{recursive:true,mode:0o700});
const ssh=['-S','/tmp/monos-execution-acceptance-ssh-v2','root@100.120.14.84'];
const cert=execFileSync('ssh',[...ssh,'cat /root/monos-boundary-probe-src/infra/compose/private/server.crt']);
const pub=execFileSync('openssl',['x509','-pubkey','-noout'],{input:cert});
const der=execFileSync('openssl',['pkey','-pubin','-outform','der'],{input:pub});
const spki=crypto.createHash('sha256').update(der).digest('base64');
const browser=await chromium.launch({headless:true,args:[`--ignore-certificate-errors-spki-list=${spki}`]});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();page.setDefaultTimeout(20000);
let counter=0, sessionId;const pending=new Set(), observerErrors=[];
function observationError(stage,path,error){const value={stage,path,error:error instanceof Error?error.message:String(error)};observerErrors.push(value);process.stdout.write(JSON.stringify({observer_error:value})+'\n');}
function authenticatedSession(value){if(!value?.authenticated||typeof value.session_id!=='string'||!(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.session_id)))throw Error('No valid authenticated Owner session');return value.session_id;}
function save(name,obj){fs.writeFileSync(`${root}/${name}.json`,JSON.stringify(obj,null,2)+'\n',{flag:'wx',mode:0o600});}
await page.route('**/v1/owner/**',async route=>{
 const r=route.request(),url=new URL(r.url());
 try{
  if(r.method()!=='GET'&&!(r.method()==='POST'&&url.pathname==='/v1/owner/login'))throw Error('Read-only continuity browser blocks Owner mutations');
  await route.continue();
 }catch(error){observationError('request',url.pathname,error);await route.abort().catch(()=>{});}
});
page.on('response',r=>{
 const u=new URL(r.url());if(!u.pathname.startsWith('/v1/owner/'))return;
 const job=(async()=>{
  if(/\/(login|session)$/.test(u.pathname)){
   if(r.ok()){const value=await r.json();sessionId=value.authenticated?authenticatedSession(value):undefined;}else sessionId=undefined;
   return;
  }
  const body=await r.json(),req=r.request();let id;
  if(req.method()==='POST')id=req.postDataJSON()?.request_id;
  save(id?`response-${id}-${++counter}`:`read-${++counter}`,{at:new Date().toISOString(),path:u.pathname+u.search,status:r.status(),body});
 })().catch(error=>observationError('response',u.pathname,error));
 pending.add(job);void job.then(()=>pending.delete(job));
});
async function drain(){while(pending.size)await Promise.allSettled([...pending]);return observerErrors.splice(0);}
async function actualSession(){const response=await read('/v1/owner/session');if(response.status!==200)throw Error('Owner session read failed');sessionId=authenticatedSession(response.body);return sessionId;}
async function read(path){if(typeof path!=='string'||!path.startsWith('/v1/owner/'))throw Error('Explicit Owner read path required');return await page.evaluate(async path=>{const r=await fetch(path);return {status:r.status,body:await r.json()};},path);}
async function shot(name){
 await page.getByRole('complementary',{name:'Created Task',exact:true}).getByRole('link',{name:'View Task →',exact:true}).waitFor({state:'visible'});
 if(!/^[a-z0-9][a-z0-9-]*$/.test(name))throw Error('Invalid screenshot evidence name');
 for(const size of ['desktop','mobile'])for(const suffix of ['.png','-viewport.png','.json'])if(fs.existsSync(`${root}/${name}-${size}${suffix}`))throw Error('Screenshot evidence already exists');
 await page.waitForFunction(()=>[...document.querySelectorAll('.boot-screen, .loading-state')].every(node=>!node.getClientRects().length));
 for(const text of ['Loading Task…','Loading Task preview…','Loading Discussion…','Loading Todos…','Loading tasks…'])await page.getByText(text,{exact:true}).waitFor({state:'hidden'});
 for(const [size,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
 await page.setViewportSize(viewport);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`${root}/${name}-${size}.png`,fullPage:true});
 await page.screenshot({path:`${root}/${name}-${size}-viewport.png`});
 save(`${name}-${size}`,{route:page.url(),viewport,body:await page.locator('body').innerText(),horizontalOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
 }await page.setViewportSize({width:1440,height:1000});}
const actions={
 async login(){await page.goto(base+'/#projects');await page.getByLabel('Password',{exact:true}).fill(execFileSync('ssh',[...ssh,'cat /etc/monos-probe/owner-password'],{encoding:'utf8'}).trim());await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Projects',exact:true}).waitFor();await actualSession();return {route:page.url(),session:sessionId,certificate_sha256:crypto.createHash('sha256').update(cert).digest('hex'),spki};},
 async waitText(c){await page.getByText(c.text,{exact:true}).waitFor({state:'visible',timeout:c.timeout??20000});return {visible:c.text};},
 async read(c){return read(c.path);},
 async inspect(){return {route:page.url(),body:await page.locator('body').innerText()};},
 async goto(c){await page.goto(base+c.hash);return {route:page.url()};},
 async shot(c){await shot(c.name);return {captured:c.name};},
 async close(){await page.unrouteAll({behavior:'wait'});await browser.close();return {closed:true};}
};
process.stdout.write(JSON.stringify({ready:true})+'\n');
try{
 for await(const line of readline.createInterface({input:process.stdin,crlfDelay:Infinity})){
  let c;try{
   c=JSON.parse(line);if(!actions[c.action])throw Error('unknown action');
   const result=await actions[c.action](c),errors=await drain();
   process.stdout.write(JSON.stringify({action:c.action,result,...(errors.length?{error:'Evidence observation failed',observer_errors:errors}:{})})+'\n');
   if(c.action==='close')break;
  }catch(e){const errors=await drain();process.stdout.write(JSON.stringify({action:c?.action,error:e.message,...(errors.length?{observer_errors:errors}:{})})+'\n');}
 }
}finally{
 if(browser.isConnected()){await page.unrouteAll({behavior:'wait'});await browser.close();}
 const errors=await drain();if(errors.length)process.stdout.write(JSON.stringify({shutdown_observer_errors:errors})+'\n');
}
