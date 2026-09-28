import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';import {createStore} from '../lib/store.mjs';
test('authenticated variant API validates selection, isolates ownership and edits thresholds independently',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'watch-api-'));
 Object.assign(process.env,{NODE_ENV:'test',DATA_DIR:directory,APP_PASSWORD:randomBytes(24).toString('hex'),SESSION_SECRET:randomBytes(32).toString('hex'),CRON_SECRET:randomBytes(32).toString('hex')});
 const store=createStore(directory);const item=store.add({url:'http://127.0.0.1/product',title:'Fictional product',price:100,currency:'USD',variants:[{id:'black-s',label:'Black · S',url:null,attributes:{Color:'Black',Size:'S'}}]});
 const {server}=await import('../server.mjs');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 let cookie='';const call=(path,method,payload)=>fetch(base+path,{method,headers:{'content-type':'application/json',cookie},body:JSON.stringify(payload)});
 try {
  assert.equal((await call('/api/items/'+item.id+'/variant','POST',{variant_id:'black-s'})).status,401);
  const login=await call('/api/login','POST',{password:process.env.APP_PASSWORD});cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/items/'+item.id+'/variant','POST',{variant_id:'invented'})).status,400);
  const added=await call('/api/items/'+item.id+'/variant','POST',{variant_id:'black-s',discount_percent:25});assert.equal(added.status,202);const {watch}=await added.json();
  assert.equal(store.get(item.id).variant_id,null);assert.equal(store.get(item.id).baseline_price,100);assert.equal(watch.discount_percent,25);
  const path='/api/items/'+item.id+'/watches/'+watch.id;
  assert.equal((await call('/api/items/wrong/watches/'+watch.id,'PATCH',{discount_percent:40})).status,404);
  assert.equal((await call(path,'PATCH',{discount_percent:true})).status,400);
  assert.equal((await call(path,'PATCH',{discount_percent:30,watch_enabled:false})).status,200);
  assert.equal(store.getWatch(watch.id).discount_percent,30);assert.equal(store.getWatch(watch.id).watch_enabled,0);assert.equal(store.get(item.id).discount_percent,20);
  store.updateWatch(watch.id,{last_notified_at:'2026-01-01T00:00:00Z'});
  await call(path,'PATCH',{discount_percent:30,target_price:null});assert.equal(store.getWatch(watch.id).last_notified_at,'2026-01-01T00:00:00Z');
  assert.equal((await call(path,'DELETE',{})).status,200);assert.equal(store.watches(item.id).length,0);
 } finally {await new Promise(resolve=>server.close(resolve));store.close();rmSync(directory,{recursive:true,force:true});}
});
