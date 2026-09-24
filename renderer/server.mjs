import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { render } from './render.mjs';
const token = process.env.BROWSER_RENDER_TOKEN;
if (!token || token.length < 32 || token.startsWith('replace-with-')) throw Error('Set a private renderer token');
let busy = false;
http.createServer(async (req, res) => {
  const actual = Buffer.from(req.headers.authorization || ''); const expected = Buffer.from('Bearer ' + token);
  res.setHeader('cache-control', 'no-store');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { res.writeHead(401); res.end(); return; }
  if (req.method !== 'POST' || req.url !== '/render') { res.writeHead(404); res.end(); return; }
  if (busy) { res.writeHead(429); res.end(); return; }
  busy = true;
  try {
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) throw Error('Too large'); }
    const html = await render(JSON.parse(body).url);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html);
  } catch { res.writeHead(502); res.end('Product rendering unavailable'); }
  finally { busy = false; }
}).listen(Number(process.env.PORT) || 3001);
