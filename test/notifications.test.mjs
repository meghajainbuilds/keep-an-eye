import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createStore } from '../lib/store.mjs';
import { checkPrices } from '../lib/alerts.mjs';
import { createPriceJobs, createPushRetries } from '../lib/price-jobs.mjs';
import { sendPushAlert } from '../lib/push.mjs';
import { parseProduct } from '../lib/product.mjs';
import { sharedUrl } from '../lib/shared-input.mjs';
import { captureBrowserPreview, shortcutCaptureScript } from '../public/browser-preview.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(),'eye-notifications-'));
  const store = createStore(dir);
  t.after(() => { store.close(); rmSync(dir,{recursive:true,force:true}); });
  return {store,dir};
}
const product = {url:'https://shop.example/dress', title:'Fictional dress',price:100,currency:'USD'};
const observation = price => ({price,currency:'USD',extraction_status:'verified',price_source:'fixture'});
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
async function until(predicate) { for (let i=0;i<200;i++) { if (predicate()) return; await delay(5); } assert.fail('Condition did not settle'); }

test('inbox survives failed push and restart; read state persists; a new discount episode creates a new alert',async t => {
  const {store,dir} = fixture(t); const item=store.add(product);
  await checkPrices(store,{inspect:async()=>observation(80),notify:async()=>{throw Error('offline');}});
  assert.equal(store.get(item.id).extraction_status,'verified');
  assert.equal(store.unreadCount(),1);
  await checkPrices(store,{inspect:async()=>observation(75)});
  assert.equal(store.notifications().length,1);
  const reopened=createStore(dir); assert.equal(reopened.unreadCount(),1);
  reopened.markRead([reopened.notifications()[0].id]); reopened.close();
  assert.equal(store.unreadCount(),0);
  await checkPrices(store,{inspect:async()=>observation(100)});
  await checkPrices(store,{inspect:async()=>observation(79)});
  assert.equal(store.notifications().length,2); assert.equal(store.unreadCount(),1);
});

test('phone retry skips accepted endpoints and payload carries stable event ID and unread badge',async t => {
  const {store}=fixture(t); const item=store.add(product);
  const event=store.recordNotification(item.id,item,80);
  for (const suffix of ['one','two']) store.saveSubscription({endpoint:'https://web.push.apple.com/'+suffix,keys:{p256dh:'key',auth:'auth'}});
  const calls=[];let fail=true;
  const send=async(subscription,payload)=>{calls.push(subscription.endpoint);const data=JSON.parse(payload);assert.equal(data.notificationId,event.id);assert.equal(data.unreadCount,1);if(fail && subscription.endpoint.endsWith('two'))throw Error('offline');};
  const args={item,price:80,notificationId:event.id,send};
  await assert.rejects(sendPushAlert(store,args));fail=false;
  await sendPushAlert(store,args);
  assert.equal(calls.filter(x=>x.endsWith('one')).length,1);
  assert.equal(calls.filter(x=>x.endsWith('two')).length,2);
});

test('paused watches never deliver queued phone alerts',async t=>{
  const {store}=fixture(t);const item=store.add(product);store.recordNotification(item.id,item,80);
  store.update(item.id,{watch_enabled:0});let sent=0;
  const retries=createPushRetries(store,async()=>sent++);t.after(()=>retries.stop());await retries.run();
  assert.equal(sent,0);assert.equal(store.unreadCount(),1);assert.equal(store.pendingNotifications().length,0);
});

test('background job joins concurrent starts and resumes unfinished cursor after restart',async t=>{
  const {store}=fixture(t);store.add(product);store.add({...product,url:'https://shop.example/coat'});
  let release; const gate=new Promise(resolve=>release=resolve);let calls=0;
  const check=async()=>{calls++;await gate;return {checked:1,alerted:0,unavailable:0,errors:[]};};
  const first=createPriceJobs(store,{check});const id=first.start().id;
  assert.equal(first.start().id,id);await until(()=>calls===1);first.stop();release();await until(()=>first.status().cursor===1);
  const second=createPriceJobs(store,{check});t.after(()=>second.stop());await until(()=>second.status().state==='completed');
  assert.equal(second.status().id,id);assert.equal(second.status().checked,2);assert.equal(calls,2);
});

test('a hung merchant cannot block later products or mutate a price after its deadline',async t=>{
  const {store}=fixture(t);const item=store.add(product);let finish;
  const result=await checkPrices(store,{timeoutMs:10,inspect:()=>new Promise(resolve=>finish=resolve)});
  assert.equal(result.errors.length,1);finish(observation(1));await delay(0);
  assert.equal(store.get(item.id).price,100);assert.equal(store.unreadCount(),0);
});

test('matching merchant list price triggers 20% sale; member offers and unrelated variant list prices do not',async t=>{
  const {store}=fixture(t);const item=store.add({...product,price:null});
  const html=offer=>'<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Fictional dress',url:product.url,offers:offer})+'</script>';
  const offer={'@type':'Offer',price:80,priceCurrency:'USD',priceSpecification:[{'@type':'UnitPriceSpecification',price:100,priceCurrency:'USD',priceType:'https://schema.org/StrikethroughPrice'}]};
  const parsed=parseProduct(html(offer),product.url,{scope:'product'});
  assert.equal(parsed.regular_price,100);assert.equal(parsed.price,80);
  await checkPrices(store,{inspect:async()=>parsed});assert.equal(store.unreadCount(),1);assert.equal(store.get(item.id).baseline_price,80);
  assert.equal(parseProduct(html({...offer,eligibleCustomerType:'Member'}),product.url,{scope:'product'}).price,null);
  assert.equal(parseProduct(html({...offer,priceSpecification:[{price:100,priceCurrency:'EUR',priceType:'https://schema.org/StrikethroughPrice'}]}),product.url,{scope:'product'}).regular_price,null);
});

test('shared prose accepts one unique URL, rejects ambiguity and unsafe schemes, preserves variant query',()=>{
  assert.equal(sharedUrl('Look at this https://shop.example/p?size=S&color=red now'),'https://shop.example/p?size=S&color=red');
  assert.equal(sharedUrl('https://shop.example/p https://shop.example/p'),'https://shop.example/p');
  assert.throws(()=>sharedUrl('https://shop.example/a https://shop.example/b'),/Choose one/);
  assert.throws(()=>sharedUrl('javascript:alert(1)'));
});

test('browser capture reads generic Product structured preview without importing its price',()=>{
  const doc={title:'Fallback',querySelectorAll:selector=>selector==='meta'?[]:[{textContent:JSON.stringify({'@type':'Product',url:product.url,name:'Fictional dress',description:'Woven cotton',image:{url:'/dress.jpg'},offers:{price:80,priceCurrency:'USD'}})}]};
  const captured=captureBrowserPreview(doc,product.url);
  let completed; runInNewContext(shortcutCaptureScript,{document:doc,location:{href:product.url},URL,completion:value=>completed=JSON.parse(value)});
  assert.deepEqual(completed,captured);
  assert.equal(captured.title,'Fictional dress');assert.equal(captured.image,'https://shop.example/dress.jpg');assert.equal(captured.price,undefined);
});

test('service worker shows notification and badge, then refreshes open app',async()=>{
  const listeners={};let badge,shown,refreshed=false,pending;
  const self={location:{origin:'https://app.example'},addEventListener:(name,fn)=>listeners[name]=fn,
    registration:{showNotification:async(title,options)=>shown={title,options}},navigator:{setAppBadge:async n=>badge=n}};
  const clients={matchAll:async()=>[{postMessage:()=>refreshed=true}]};
  runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{self,clients,URL});
  listeners.push({data:{json:()=>({title:'Sale',url:'/?item=fixture',notificationId:'event',unreadCount:2})},waitUntil:p=>pending=p});await pending;
  assert.equal(badge,2);assert.equal(shown.options.tag,'event');assert.equal(refreshed,true);
});
