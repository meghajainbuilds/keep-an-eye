import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseProduct, inspectProduct } from '../lib/product.mjs';
import { guessCategory } from '../lib/categories.mjs';
const fixture = name => readFileSync(new URL(`./fixtures/extraction/${name}.html`, import.meta.url), 'utf8');
const parse = (name, path, options) => parseProduct(fixture(name), `https://store.example${path}`, options);

test('common offer price keeps preview without binding a random size', () => {
  const p = parse('uniform-offers', '/products/pullover');
  assert.equal(p.price, 98); assert.equal(p.currency, 'USD'); assert.equal(p.variant_id, null);
  assert.equal(p.price_source, 'JSON-LD uniform offers'); assert.equal(p.image, 'https://store.example/pullover.jpg');
  assert.equal(p.variants.length, 2);
  assert.equal(parse('uniform-offers', '/products/pullover?variant=2').variant_id, 'large');
  assert.equal(parse('uniform-offers', '/products/pullover?variant=missing').price, null);
  assert.equal(parse('uniform-offers', '/products/pullover', { variant_id: 'missing' }).price, null);
});
test('metadata aliases and safe image URLs work without schema offers', () => {
  const p = parse('meta-alias', '/tote?utm_source=sample&srsltid=sample');
  assert.equal(p.price, 175); assert.equal(p.currency, 'USD'); assert.equal(p.image, 'https://images.example/tote.jpg');
  assert.equal(parse('meta-alias', '/tote?variant=2').price, null);
  assert.equal(parse('meta-alias', '/tote', { variant_id: 'old' }).price, null);
});
test('explicit merchant product ID corroborates an abbreviated offer URL', () => {
  const p = parse('offer-alias', '/p/fictional-dress-123456');
  assert.equal(p.price, 56); assert.equal(p.image, 'https://images.example/dress.jpg');
  assert.equal(p.title, 'Fictional Denim Dress');
  assert.equal(parse('offer-alias', '/p/fictional-dress-123456?size=large').price, null);
  const unrelated = fixture('offer-alias').replace('https://store.example/p/fictional-dress"', 'https://store.example/p/other-dress"');
  assert.equal(parseProduct(unrelated, 'https://store.example/p/fictional-dress-123456').price, null);
});
test('canonical collection URLs retain selectors and malformed images fall back', () => {
  const p = parse('malformed-image', '/collections/new/products/shirt');
  assert.equal(p.price, 120); assert.equal(p.currency, 'EUR'); assert.equal(p.image, 'https://images.example/shirt.jpg');
  assert.equal(parse('malformed-image', '/collections/new/products/shirt?variant=2').price, 120);
  assert.equal(parse('malformed-image', '/collections/new/products/shirt?variant=missing').price, null);
});
test('different color prices require a choice; a selected color may have a common size price', () => {
  const p = parse('color-prices', '/sweater');
  assert.equal(p.price, null); assert.equal(p.extraction_status, 'needs_variant'); assert.ok(p.image);
  assert.equal(p.title, 'Fictional Cashmere Sweater');
  const black = parse('color-prices', '/sweater?color=black');
  assert.equal(black.price, 50); assert.equal(black.variant_id, null); assert.match(black.image, /black/);
  assert.equal(parse('color-prices', '/sweater', {variant_id: 'brown-s'}).price, 55);
});
test('missing currency, unknown price, different currencies and sold-out offers never create a valid common price', () => {
  const html = fixture('uniform-offers');
  for (const changed of [html.replace('"priceCurrency":"USD"', '"priceCurrency":""'), html.replace('"price":98', '"price":"from 98"'), html.replace('"priceCurrency":"USD"', '"priceCurrency":"EUR"')]) {
    assert.equal(parseProduct(changed, 'https://store.example/products/pullover').price, null);
  }
  const sold = parseProduct(html.replaceAll('InStock', 'OutOfStock'), 'https://store.example/products/pullover');
  assert.equal(sold.extraction_status, 'out_of_stock');
});
test('child age evidence from variants is available even before choosing a size', () => {
  const p = parse('kids-group', '/coat');
  assert.deepEqual(guessCategory(p), {category:'Kids', subcategory:'Clothing'});
});
test('ambiguous static prices do not short circuit rendering and rendering merges metadata', async () => {
  const resource = async url => ({url, body:Buffer.from(fixture('uniform-offers').replaceAll('98', '99').replace('"price":99', '"price":98').replace(/"image":\[.*?\],/, ''))});
  let calls = 0;
  const render = async () => { calls++; return '<meta property="og:image" content="https://images.example/rendered.jpg">'; };
  const p = await inspectProduct('https://store.example/products/pullover', { resource, render });
  assert.equal(calls,1); assert.equal(p.extraction_status,'needs_variant'); assert.equal(p.image,'https://images.example/rendered.jpg');
});
test('rendered product fields replace a JavaScript shell; outage never fabricates details', async () => {
  const resource = async url => ({url, body:Buffer.from(fixture('javascript-shell'))});
  const p = await inspectProduct('https://store.example/tote', {resource, render:async()=>fixture('meta-alias')});
  assert.equal(p.title,'Fictional Weekday Tote'); assert.equal(p.price,175); assert.ok(p.image);
  const unavailable = await inspectProduct('https://store.example/tote', {resource, render:async()=>{throw Error('blocked');}});
  assert.equal(unavailable.price,null); assert.equal(unavailable.image,null); assert.equal(unavailable.extraction_status,'unavailable');
});
test('invalid image objects and out-of-range HTML entities do not create fake URLs or crash', () => {
  const html = '<script type="application/ld+json">{"@type":"Product","name":"Sample &#999999999;","image":[null,{}]}</script><meta property="twitter:image" content="/valid.jpg">';
  assert.equal(parseProduct(html,'https://store.example/item').image,'https://store.example/valid.jpg');
});

test('whole-product From prices remain distinct from exact-variant prices',()=>{
  const p=parse('color-prices','/sweater',{scope:'product'});
  assert.equal(p.price,50); assert.equal(p.price_kind,'from'); assert.equal(p.variant_id,null);
  assert.equal(p.title,'Fictional Cashmere Sweater');
  const exact=parse('color-prices','/sweater',{variant_id:'brown-s'});
  assert.equal(exact.price,55); assert.equal(exact.variant_id,'brown-s');
});
