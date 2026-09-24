export async function renderProduct(url) {
  const endpoint = new URL('/render', process.env.BROWSER_RENDER_URL);
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw Error('Invalid renderer configuration');
  const response = await fetch(endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25_000),
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.BROWSER_RENDER_TOKEN },
    body: JSON.stringify({ url })
  });
  if (!response.ok) throw Error('Renderer unavailable');
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length; if (size > 2_000_000) throw Error('Rendered page too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
