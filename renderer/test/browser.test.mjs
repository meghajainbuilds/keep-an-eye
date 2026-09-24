import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProduct, fetchProductResource } from '../../lib/product.mjs';

test('isolated renderer reads JS product data and rejects a private-network subrequest', { skip: process.env.RUN_RENDERER_TESTS !== '1' }, async () => {
  const { render } = await import('../render.mjs'); let blocked = false;
  const page = `<html><head></head><body><script>
    fetch('http://127.0.0.1/private').catch(()=>{});
    const node=document.createElement('script'); node.type='application/ld+json';
    node.textContent=JSON.stringify({'@type':'Product',name:'Fictional Rendered Item',sku:'sample',offers:{'@type':'Offer',price:100,priceCurrency:'USD'}});
    document.head.append(node);
    </script></body></html>`;
  const html = await render('https://store.example/product', async url => {
    if (url === 'https://store.example/product') return { body: Buffer.from(page), contentType:'text/html' };
    try { return await fetchProductResource(url); } catch(e) { blocked = true;throw e; }
  });
  assert.equal(parseProduct(html,'https://store.example/product').price,100);
  assert.equal(blocked,true);
});
