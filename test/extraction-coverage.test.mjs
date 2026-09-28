import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseProduct, inspectProduct} from '../lib/product.mjs';
import dns from 'node:dns';
import https from 'node:https';
import {EventEmitter} from 'node:events';
const fixture = name => readFileSync(new URL('./fixtures/'+name+'.html',import.meta.url),'utf8');
const tee='https://store.example/products/tee';
test('tracking parameters do not obscure exact color/size and product price is explicitly from',()=>{
 const h=fixture('commerce-options');
 const exact=parseProduct(h,tee+'?variant=101&shem=aimgspc&utm_source=example');
 assert.equal(exact.price,100);assert.equal(exact.variant_id,'TEE-101');
 assert.deepEqual(exact.variants[0].attributes,{Color:'Black',Size:'S'});
 assert.equal(exact.image,'https://images.example/Black.jpg');
 const whole=parseProduct(h,tee,{scope:'product'});
 assert.equal(whole.price,60);assert.equal(whole.price_kind,'from');assert.equal(whole.variant_id,null);
 assert.equal(parseProduct(h,tee,{variant_id:'TEE-104'}).extraction_status,'out_of_stock');
 assert.equal(parseProduct(h,tee,{variant_id:'missing'}).price,null);
});
test('named width/size options and page identity exclude unrelated embedded products',()=>{
 const d=parseProduct(fixture('commerce-width'),'https://store.example/products/loafer-brown',{scope:'product'});
 assert.equal(d.price,250);assert.equal(d.variants.length,2);assert.ok(d.image);
 assert.deepEqual(d.variants[0].attributes,{Size:'38',Width:'Medium'});
});
test('same-origin commerce endpoint supplies missing option labels without credentials',async t=>{
 t.mock.method(dns.promises,'lookup',async()=>[{address:'93.184.215.14',family:4}]);
 const requests=[];
 t.mock.method(https,'get',(url,options,callback)=>{
  requests.push(url.href);if(url.hostname==='images.example'){assert.equal(options.method,'HEAD');assert.equal(options.headers.authorization,undefined);}const req=new EventEmitter();req.destroy=e=>req.emit('error',e);
  queueMicrotask(()=>{
   const res=new EventEmitter();res.resume=()=>{};res.statusCode=200;res.headers={'content-type':url.hostname==='images.example'?'image/jpeg':url.pathname.endsWith('.js')?'application/json':'text/html'};callback(res);
   const content=url.pathname.endsWith('.js')?JSON.stringify({title:'Fictional Wool Jacket',handle:'jacket',options:[{name:'Size'},{name:'Color'}],variants:[{id:201,sku:'JACKET-201',options:['4','Ochre'],price:20000,available:true}]}):fixture('commerce-endpoint');
   res.emit('data',Buffer.from(content));res.emit('end');
  });return req;
 });
 const d=await inspectProduct('https://store.example/products/jacket',{scope:'product'});
 assert.equal(d.price,200);assert.equal(d.variants.length,1);
 assert.deepEqual(d.variants[0].attributes,{Size:'4',Color:'Ochre'});
 assert.deepEqual(requests,['https://store.example/products/jacket','https://store.example/products/jacket.js','https://images.example/tee.jpg']);
});
test('Google ProductGroup references, size objects and sale price specifications',()=>{
 const group={'@type':'ProductGroup','@id':'#group',url:tee,name:'Fictional Tee',hasVariant:[{'@id':'#black'},{'@id':'#red'}]};
 const variant=(id,color,size,price)=>({'@id':id,'@type':'Product',sku:id,color,size:{'@type':'SizeSpecification',name:size},isVariantOf:{'@id':'#group'},offers:{'@type':'Offer',url:tee+'/'+color,priceSpecification:{'@type':'UnitPriceSpecification',price,priceCurrency:'USD'}}});
 const page='<script type="application/ld+json">'+JSON.stringify({'@graph':[group,variant('#black','Black','S',100),variant('#red','Red','M',70)]})+'</script>';
 const d=parseProduct(page,tee,{scope:'product'});assert.equal(d.price,70);
 const exact=parseProduct(page,tee,{variant_id:'#black'});assert.equal(exact.price,100);assert.equal(exact.variants[0].attributes.Size,'S');
});
test('currency conflicts, recommendation-only pages, and conflicting merchant sources fail closed',()=>{
 const h=fixture('commerce-options');
 assert.equal(parseProduct(h.replace('"priceCurrency": "USD"','"priceCurrency": "EUR"'),tee,{variant_id:'TEE-101'}).price,null);
 assert.equal(parseProduct(h,'https://store.example/unrelated',{scope:'product'}).price,null);
 const mixed=h.replaceAll('"priceCurrency": "USD"','"priceCurrency": "EUR"');
 assert.equal(parseProduct(mixed,tee,{scope:'product'}).price,null);
});
