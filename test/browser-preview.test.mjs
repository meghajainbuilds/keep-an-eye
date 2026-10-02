import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { randomBytes } from 'node:crypto';
import { browserPreviewPatch } from '../lib/browser-preview.mjs';
import { captureBrowserPreview, previewBookmark } from '../public/browser-preview.js';
import { inspectProduct } from '../lib/product.mjs';
import { createStore } from '../lib/store.mjs';
import { checkPrices } from '../lib/alerts.mjs';

const input = { version:1, url:'https://boutique.example/p/wide-leg-pants?color=black', title:'Fictional Draped Trousers', description:'Relaxed trousers in woven fabric.', image:'https://images.example/trousers.jpg', confirm_match:true };
const publicDns = t => t.mock.method(dns.promises,'lookup',async()=>[{address:'93.184.215.14',family:4}]);

test('browser helper captures standard metadata on unrelated stores and bookmark executes without network or account data', () => {
  for (const [file,url] of [['browser-social.html','https://boutique.example/p/pants'],['browser-twitter.html','https://market.example/catalog/lamp']]) {
    const html=readFileSync(new URL('./fixtures/extraction/'+file,import.meta.url),'utf8');
    const metas=[...html.matchAll(/<meta\s+(property|name)="([^"]+)"\s+content="([^"]*)"/g)].map(m=>({getAttribute:key=>key===m[1]?m[2]:key==='content'?m[3]:null}));
    const doc={title:'Fallback page',querySelectorAll:selector=>{assert.equal(selector,'meta');return metas;}};
    const result=captureBrowserPreview(doc,url);
    assert.ok(result.title.startsWith('Fictional'));
    assert.ok(result.image.startsWith('https://'));
    assert.equal(result.url,url);assert.equal(result.price,undefined);
    let copied;
    runInNewContext(decodeURIComponent(previewBookmark.slice('javascript:'.length)),{document:doc,location:{href:url},URL,window:{prompt:(_message,value)=>{copied=JSON.parse(value);}}});
    assert.deepEqual(copied,result);
  }
});

test('preview import preserves user choices, prices and original links through failures and restart',async t=>{
  publicDns(t);const directory=mkdtempSync(join(tmpdir(),'preview-store-'));let store=createStore(directory);
  try {
    const item=store.add({url:'https://share.example/abc',title:'share.example',price:140,currency:'USD',note:'Keep my note',watch_enabled:false,extraction_status:'verified'});
    const watch=store.addWatch(item.id,{id:'black-small',label:'Black small',url:'https://boutique.example/p/pants?size=s'});
    const patch=await browserPreviewPatch(item,{...input,price:1,baseline_price:1,watch_enabled:true,variant_id:'different'});
    store.update(item.id,patch);
    assert.equal(store.get(item.id).title,input.title);assert.equal(store.get(item.id).subcategory,'Bottoms');
    const before=store.get(item.id);
    let notified=0;
    await checkPrices(store,{itemId:item.id,inspect:async()=>({title:'Access Denied',image:'https://images.example/logo.jpg',description:'Blocked',merchant_url:'https://share.example/abc',price:null,extraction_status:'unavailable'}),notify:async()=>notified++});
    assert.equal(notified,0);
    const after=store.get(item.id);
    for(const key of ['url','merchant_url','title','image','description','price','currency','baseline_price','watch_enabled','note','preview_captured_at']) assert.equal(after[key],before[key],key);
    assert.equal(store.getWatch(watch.id).variant_id,'black-small');
    store.close();store=createStore(directory);assert.equal(store.get(item.id).merchant_url,input.url);assert.equal(store.get(item.id).image,input.image);
    store.update(item.id,{title:'My chosen name',category:'Other',subcategory:'Other',category_source:'manual'});
    const custom=await browserPreviewPatch(store.get(item.id),input);
    assert.equal(custom.title,undefined);assert.equal(custom.category,undefined);assert.equal(custom.price,undefined);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('browser import rejects unconfirmed, unsafe, local and oversized URLs',async t=>{
  publicDns(t);const item={url:'https://share.example/x',title:'share.example',category_source:'rules'};
  for(const delta of [{confirm_match:false},{version:2},{title:''},{url:'https://user:pass@shop.example/p'},{url:'http://shop.example/p'},{image:'javascript:alert(1)'},{image:'https://127.0.0.1/p'},{image:'https://[::1]/p'},{url:'https://localhost/p'},{image:'https://cdn.example/'+ 'x'.repeat(2050)}]) await assert.rejects(browserPreviewPatch(item,{...input,...delta}));
  t.mock.method(dns.promises,'lookup',async()=>[{address:'10.0.0.1',family:4}]);
  await assert.rejects(browserPreviewPatch(item,input),/public HTTPS/);
});

test('shared links retain final merchant identity when the merchant denies fetching, across domains',async t=>{
  publicDns(t);
  t.mock.method(https,'get',(url,_options,callback)=>{
    const req=new EventEmitter();req.destroy=e=>req.emit('error',e);
    queueMicrotask(()=>{const res=new EventEmitter();res.resume=()=>{};
      res.statusCode=url.hostname==='share.example'?302:403;
      res.headers=res.statusCode===302?{location:'https://'+(url.pathname==='/a'?'boutique.example':'market.example')+'/p/pants'}:{};
      callback(res);
    });return req;
  });
  for(const [path,host] of [['a','boutique.example'],['b','market.example']]) {
    const result=await inspectProduct('https://share.example/'+path,{scope:'product'});
    assert.equal(result.merchant_url,'https://'+host+'/p/pants');assert.equal(result.title,host);assert.equal(result.price,null);assert.equal(result.image,null);
  }
});

test('browser preview API requires session, same origin and explicit match; cannot change alert state',async t=>{
  publicDns(t);const directory=mkdtempSync(join(tmpdir(),'preview-api-'));
  Object.assign(process.env,{NODE_ENV:'test',DATA_DIR:directory,APP_PASSWORD:randomBytes(24).toString('hex'),SESSION_SECRET:randomBytes(32).toString('hex'),CRON_SECRET:randomBytes(32).toString('hex')});
  const store=createStore(directory);
  const item=store.add({url:'https://share.example/saved',title:'share.example',extraction_status:'unavailable',watch_enabled:false});
  const {server}=await import('../server.mjs');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;let cookie='';
  const call=(path,payload,extra={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',cookie,...extra},body:JSON.stringify(payload)});
  const path='/api/items/'+item.id+'/browser-preview';
  try {
    assert.equal((await call(path,input)).status,401);
    const login=await call('/api/login',{password:process.env.APP_PASSWORD});cookie=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await call(path,input,{origin:'https://unrelated.example'})).status,403);
    assert.equal((await call(path,{...input,confirm_match:false})).status,400);
    assert.equal((await call('/api/items/missing/browser-preview',input)).status,404);
    assert.equal((await call(path,{...input,price:1,currency:'USD',baseline_price:1,watch_enabled:true})).status,200);
    const saved=store.get(item.id);assert.equal(saved.merchant_url,input.url);assert.equal(saved.title,input.title);assert.equal(saved.price,null);assert.equal(saved.baseline_price,null);assert.equal(saved.watch_enabled,0);assert.equal(saved.extraction_status,'unavailable');
    assert.equal((await fetch(base+'/browser-preview.js')).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));store.close();rmSync(directory,{recursive:true,force:true});}
});
