import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProduct, amount } from '../lib/product.mjs';
const link = 'https://store.example/shoe?color=black';
const variant = (color, price, extra = {}) => ({ '@type': 'Product', sku: color, name: 'Fictional Shoe', color,
  image: { '@type': 'ImageObject', contentUrl: '/images/' + color + '.jpg' },
  offers: { '@type': 'Offer', price, priceCurrency: 'USD', url: '/shoe?color=' + color }, ...extra });
const html = data => '<script type="application/ld+json">' + JSON.stringify(data) + '</script>';

test('nested groups match the selected color, not the first cheaper offer', () => {
  const data = parseProduct(html({ '@type': 'ProductGroup', hasVariant: [variant('red', 60), variant('black', 100)] }), link + '&utm_source=fiction');
  assert.equal(data.price, 100); assert.equal(data.variant_id, 'black');
  assert.equal(data.image, 'https://store.example/images/black.jpg');
  assert.equal(data.extraction_status, 'verified');
});
test('unmatched colors and ambiguous offers never supply a price', () => {
  const page = html({ '@type': 'ProductGroup', hasVariant: [variant('red', 60), variant('blue', 80)] });
  assert.equal(parseProduct(page, link).price, null);
  assert.equal(parseProduct(page, link).extraction_status, 'needs_variant');
  assert.equal(parseProduct(page, link, { variant_id: 'blue' }).price, 80);
  assert.equal(parseProduct(html(variant('red', 60)), link).price, null);
});
test('linked graph nodes and type arrays resolve selected offers', () => {
  const p = variant('black', 100); p['@type'] = ['Thing', 'Product']; p.offers = { '@id': '#offer' };
  const data = parseProduct(html({ '@graph': [p, { '@id': '#offer', '@type': 'Offer', price: '100,00', priceCurrency: 'usd', url: link }] }), link);
  assert.equal(data.price, 100); assert.equal(data.currency, 'USD');
});
test('range prices, list prices, and unknown formats are not silently used', () => {
  assert.equal(parseProduct(html({ '@type': 'Product', offers: { '@type': 'AggregateOffer', lowPrice: 50, highPrice: 100, priceCurrency: 'USD' } }), link).price, null);
  assert.equal(amount('1,234.50'), 1234.5); assert.equal(amount('1.234,50'), 1234.5);
  assert.equal(amount('from 50'), null);
  const p = variant('black', undefined); p.offers.priceSpecification = { price: 200, priceCurrency: 'USD', priceType: 'https://schema.org/ListPrice' };
  assert.equal(parseProduct(html(p), link).price, null);
});
test('unavailable variant remains distinguishable from a verified in-stock price', () => {
  const p = variant('black', 100); p.offers.availability = 'https://schema.org/OutOfStock';
  assert.equal(parseProduct(html(p), link).extraction_status, 'out_of_stock');
});
test('embedded commerce variants use explicit currency and minor-unit prices', () => {
  const payload = { product: { title: 'Fictional Shirt', handle: 'shirt', currency: 'USD',
    variants: [{ id: 11, title: 'Black', options: ['Black'], price: 12500, available: true }] } };
  const page = '<script type="application/json">' + JSON.stringify(payload) + '</script>';
  const result = parseProduct(page, 'https://store.example/products/shirt?variant=11');
  assert.equal(result.price,125);assert.equal(result.variant_id,'11');
});
test('a different product recommendation never substitutes for the saved product', () => {
  const p = variant('black', 100);p.offers.url='/unrelated-product';
  assert.equal(parseProduct(html(p),'https://store.example/shoe').price,null);
});
test('multiple offers for one product have independently selectable identities', () => {
  const p = variant('black',100);p.offers=[
    {'@type':'Offer',url:'/shoe?size=s',name:'Small',price:100,priceCurrency:'USD'},
    {'@type':'Offer',url:'/shoe?size=l',name:'Large',price:80,priceCurrency:'USD'}
  ];
  const ambiguous=parseProduct(html(p),'https://store.example/shoe');
  assert.equal(ambiguous.variants.length,2);
  const chosen=parseProduct(html(p),'https://store.example/shoe',{variant_id:ambiguous.variants[1].id});
  assert.equal(chosen.price,80);
});
test('malformed merchant offer URLs do not crash extraction or supply a price', () => {
  const p=variant('black',100);p.offers.url='http://[';
  assert.equal(parseProduct(html(p),'https://store.example/shoe').price,null);
});
