import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createStore} from '../lib/store.mjs';
import {checkPrices} from '../lib/alerts.mjs';
import {parseProduct} from '../lib/product.mjs';
const html=readFileSync(new URL('./fixtures/commerce-options.html',import.meta.url),'utf8');
const url='https://store.example/products/tee';
function page(black=100,red=60) {return html.replaceAll('"price": 100,','"price": '+black+',').replaceAll('"price": 10000,','"price": '+black*100+',').replaceAll('"price": 60,','"price": '+red+',').replaceAll('"price": 6000,','"price": '+red*100+',');}
test('whole-product and exact variant watches have independent baselines, thresholds, pause and deduplication',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'scopes-'));const store=createStore(dir);
 try {
  let current=page();const data=parseProduct(current,url,{scope:'product'});
  const item=store.add({url,...data});const black=data.variants.find(v=>v.id==='TEE-101');
  const watch=store.addWatch(item.id,black,{discount_percent:20});
  assert.equal(store.addWatch(item.id,black).id,watch.id);
  const notifications=[];const opts={inspect:async(link,options)=>parseProduct(current,link,options),notify:async event=>notifications.push(event)};
  await checkPrices(store,opts);
  assert.equal(store.get(item.id).baseline_price,60);assert.equal(store.getWatch(watch.id).baseline_price,100);
  current=page(100,45);await checkPrices(store,opts);
  assert.equal(notifications.length,1);assert.equal(notifications[0].item.watch_scope,'product');assert.equal(store.getWatch(watch.id).price,100);
  store.update(item.id,{watch_enabled:0});current=page(80,45);
  await Promise.all([checkPrices(store,opts),checkPrices(store,opts)]);
  assert.equal(notifications.length,2);assert.equal(notifications[1].item.variant_id,'TEE-101');assert.equal(notifications[1].item.id,item.id);
  store.updateWatch(watch.id,{watch_enabled:0});current=page(50,20);await checkPrices(store,opts);assert.equal(notifications.length,2);
  store.remove(item.id);assert.equal(store.getWatch(watch.id),undefined);
 } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
test('variant availability, mismatches, currency changes and removal during a check cannot cause a wrong alert',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'exact-'));const store=createStore(dir);
 try {
  const data=parseProduct(html,url,{scope:'product'});const item=store.add({url,...data,watch_enabled:false});
  const variant=data.variants[0];const watch=store.addWatch(item.id,variant);let sent=0;
  const base=parseProduct(html,url,{variant_id:variant.id});const notify=async()=>sent++;
  await checkPrices(store,{inspect:async()=>base,notify});
  for(const delta of [{variant_id:'another',price:10},{currency:'EUR',price:10},{extraction_status:'out_of_stock',price:10}]) {
   await checkPrices(store,{inspect:async()=>({...base,...delta}),notify});assert.equal(sent,0);assert.equal(store.getWatch(watch.id).price,100);
  }
  await checkPrices(store,{inspect:async()=>{store.removeWatch(watch.id);return {...base,price:50};},notify});assert.equal(sent,0);
 } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
test('legacy selection migrates once without losing its baseline, custom target, or paused state',()=>{
 const dir=mkdtempSync(join(tmpdir(),'scope-migration-'));let store=createStore(dir);
 const item=store.add({url,title:'Fictional tee',price:100,currency:'USD',variant_id:'TEE-101',variant_label:'Black · S',watch_enabled:false,target_price:70});
 store.close();const db=new DatabaseSync(join(dir,'products.sqlite'));db.exec('ALTER TABLE items DROP COLUMN watch_scope');db.close();store=createStore(dir);
 try {
  const migrated=store.get(item.id);assert.equal(migrated.variant_id,null);assert.equal(migrated.baseline_price,null);assert.equal(migrated.watch_enabled,0);
  assert.equal(migrated.variant_watches.length,1);const watch=migrated.variant_watches[0];assert.equal(watch.baseline_price,100);assert.equal(watch.target_price,70);assert.equal(watch.watch_enabled,0);
  store.close();store=createStore(dir);assert.equal(store.get(item.id).variant_watches.length,1);
 } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
