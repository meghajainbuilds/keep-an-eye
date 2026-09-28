import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../lib/store.mjs';
import { createEnrichmentQueue } from '../lib/enrichment.mjs';
import { checkPrices } from '../lib/alerts.mjs';
const waitFor = async fn => { for(let i=0;i<100;i++) { if(fn())return; await new Promise(r=>setTimeout(r,10)); } assert.fail('Worker did not finish'); };
const product = { title: 'Fictional Jacket', image: 'https://images.example/jacket.jpg', price: 100, currency: 'USD', variant_id: 'black', variant_label: 'Black', extraction_status: 'verified' };

test('pending saves survive restart, retry, enrich and preserve private edits', async () => {
  const dir=mkdtempSync(join(tmpdir(),'keep-queue-')); let store=createStore(dir);
  const item=store.add({url:'https://store.example/jacket',title:'store.example',note:'Synthetic note'});
  store.close();store=createStore(dir);let calls=0;
  const queue=createEnrichmentQueue(store,{delays:[1],inspect:async()=>{if(++calls===1)throw Error('blocked');return product;}});
  try {
    await waitFor(()=>store.get(item.id).extraction_status==='verified');
    const saved=store.get(item.id); assert.equal(calls,2); assert.equal(saved.price,100);
    assert.equal(saved.title,product.title); assert.equal(saved.note,'Synthetic note'); assert.equal(saved.variant_id,null); assert.equal(saved.watch_scope,'product');
  }finally{queue.stop();store.close();rmSync(dir,{recursive:true,force:true});}
});
test('variant mismatch, currency change and outage never trigger or overwrite verified price',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'keep-variant-'));const store=createStore(dir);
  const item=store.add({url:'https://store.example/jacket',...product});let sent=0;
  try{
    for(const patch of [{variant_id:'red',price:50},{currency:'EUR',price:50},{extraction_status:'out_of_stock',price:50}]){
      await checkPrices(store,{inspect:async()=>({...product,...patch}),notify:async()=>sent++});
      assert.equal(store.get(item.id).price,100);assert.equal(sent,0);
    }
    await checkPrices(store,{inspect:async()=>({...product,price:80}),notify:async()=>sent++});
    assert.equal(sent,1);assert.equal(store.get(item.id).price,80);
    await checkPrices(store,{inspect:async()=>{throw Error('offline');},notify:async()=>sent++});
    assert.equal(store.get(item.id).price,80);assert.equal(store.get(item.id).extraction_status,'unavailable');
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('refreshed category evidence persists and daily checks preserve AI and manual classifications', async()=>{
  const dir=mkdtempSync(join(tmpdir(),'keep-preview-'));const store=createStore(dir);
  try {
    const item=store.add({url:'https://store.example/coat',title:'store.example'});
    const inspect=async()=>({...product,title:'Fictional Rain Coat',merchant_category:'Kids > Rainwear'});
    await checkPrices(store,{inspect});
    assert.equal(store.get(item.id).category,'Kids'); assert.equal(store.get(item.id).subcategory,'Clothing');
    assert.equal(store.get(item.id).merchant_category,'Kids > Rainwear');
    for(const category_source of ['ai','manual']) {
      store.update(item.id,{category:'Other',subcategory:'Other',category_source,title:'My custom title',note:'My note'});
      await checkPrices(store,{inspect});
      assert.equal(store.get(item.id).category,'Other'); assert.equal(store.get(item.id).category_source,category_source);
      assert.equal(store.get(item.id).title,'My custom title'); assert.equal(store.get(item.id).note,'My note');
    }
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('a common price becoming a range preserves last observation and cannot trigger a false drop',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'keep-common-'));const store=createStore(dir);let sent=0;
  try {
    const item=store.add({url:'https://store.example/pullover',title:'Fictional Pullover',price:100,currency:'USD'});
    await checkPrices(store,{inspect:async()=>({price:null,currency:null,extraction_status:'needs_variant',variants:[]}),notify:async()=>sent++});
    assert.equal(store.get(item.id).price,100); assert.equal(store.get(item.id).baseline_price,100); assert.equal(sent,0);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
