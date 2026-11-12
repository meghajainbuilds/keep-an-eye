import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createStore } from '../lib/store.mjs';

test('notification inbox is session-only; read changes require same origin; scheduler acknowledges durable job',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'eye-inbox-api-'));
 Object.assign(process.env,{NODE_ENV:'test',DATA_DIR:dir,APP_PASSWORD:randomBytes(24).toString('hex'),SESSION_SECRET:randomBytes(32).toString('hex'),CRON_SECRET:randomBytes(32).toString('hex')});
 const store=createStore(dir);
 const item=store.add({url:'https://shop.example/fixture',title:'Fictional coat',price:100,currency:'USD',extraction_status:'verified',watch_enabled:false});
 const event=store.recordNotification(item.id,item,80);
 const {server}=await import('../server.mjs');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const call=(path,method='GET',headers={},body)=>fetch(base+path,{method,headers:{'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
 try {
  assert.equal((await call('/api/notifications')).status,401);
  assert.equal((await call('/api/check-prices','POST')).status,401);
  const login=await call('/api/login','POST',{}, {password:process.env.APP_PASSWORD});const auth={cookie:login.headers.get('set-cookie').split(';')[0]};
  const inbox=await (await call('/api/notifications','GET',auth)).json();assert.equal(inbox.unreadCount,1);assert.equal(inbox.notifications[0].id,event.id);assert.equal(inbox.notifications[0].payload,undefined);
  assert.equal((await call('/api/notifications/read','POST',{...auth,origin:'https://evil.example'},{ids:[event.id]})).status,403);
  assert.equal((await call('/api/notifications/read','POST',auth,{ids:'all'})).status,400);
  assert.equal((await (await call('/api/notifications/read','POST',auth,{ids:[event.id]})).json()).unreadCount,0);
  const token=await (await call('/api/shortcut-token','POST',auth,{})).json();const captureAuth={authorization:'Bearer '+token.token};
  assert.equal((await call('/api/notifications','GET',captureAuth)).status,401);
  const shared={version:1,url:'http://127.0.0.1/synthetic-product',title:'Shared fixture',description:'Preview only',image:'javascript:alert(1)',price:1,watch_enabled:false};
  const captured=await call('/api/capture','POST',captureAuth,{capture:JSON.stringify(shared)});
  assert.equal(captured.status,201);const saved=store.byUrl(shared.url);
  assert.equal(saved.title,'Shared fixture');assert.equal(saved.price,null);assert.equal(saved.watch_enabled,1);assert.equal(saved.image,null);
  assert.equal((await call('/api/capture','POST',captureAuth,{capture:'{broken'})).status,400);
  assert.equal((await call('/api/capture','POST',captureAuth,{url:'https://other.example/p',capture:JSON.stringify(shared)})).status,400);
  assert.equal((await call('/api/capture','POST',captureAuth,{text:'https://one.example/p https://two.example/p'})).status,400);
  store.remove(saved.id);
  const cron={authorization:'Bearer '+process.env.CRON_SECRET};const started=await call('/api/check-prices','POST',cron);
  assert.equal(started.status,202);const job=await started.json();assert.equal(job.total,0);assert.ok(job.id);assert.equal(job.ids,undefined);
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal((await (await call('/api/check-prices','GET',cron)).json()).state,'completed');
 }finally{await new Promise(resolve=>server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});
