import { chromium } from 'playwright';
import { cleanUrl, fetchProductResource } from '../lib/product.mjs';

// Every page request is fulfilled through the same DNS-pinned public-network fetcher.
// Never pass app credentials, browser profiles, or collection data to this service.
export async function render(url, resource = fetchProductResource) {
  cleanUrl(url);
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true,
    args: ['--host-resolver-rules=MAP * ~NOTFOUND'] });
  const deadline = setTimeout(() => browser.close().catch(() => {}), 20_000);
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    await context.routeWebSocket('**/*', socket => socket.close());
    let requests = 0, total = 0;
    await context.route('**/*', async route => {
      const req = route.request();
      if (++requests > 60 || req.method() !== 'GET' || !['document','script','stylesheet','xhr','fetch'].includes(req.resourceType())) return route.abort();
      try {
        const result = await resource(cleanUrl(req.url()));
        total += result.body.length;
        if (total > 8_000_000) return route.abort();
        await route.fulfill({ status: 200, contentType: result.contentType, body: result.body });
      } catch { await route.abort().catch(() => {}); }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForFunction(() => [...document.querySelectorAll('script[type="application/ld+json"]')].some(s => /"(?:price|offers)"/.test(s.textContent)), undefined, { timeout: 4000 }).catch(() => {});
    const html = await page.content();
    if (Buffer.byteLength(html) > 2_000_000) throw Error('Rendered page too large');
    return html;
  } finally { clearTimeout(deadline); await browser.close(); }
}
