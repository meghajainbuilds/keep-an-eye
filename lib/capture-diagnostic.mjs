// Record structure only: never credentials, full URLs, paths, or query values.
export function captureDiagnostic(input) {
  const type = input === null ? 'null' : Array.isArray(input) ? 'array' : typeof input;
  const result = { type };
  if (typeof input !== 'string') return result;
  const value = input.trim();
  const scheme = /^([a-z][a-z0-9+.-]{0,31}):/i.exec(value)?.[1]?.toLowerCase();
  result.scheme = scheme || 'missing';
  try {
    const url = new URL(value);
    result.hasCredentials = Boolean(url.username || url.password);
    result.hasPort = Boolean(url.port);
    result.wrappers = ['url', 'q', 'link', 'target', 'u'].filter(key => url.searchParams.has(key));
    result.embeddedWebUrl = result.wrappers.some(key => /^https?:\/\//i.test(url.searchParams.get(key)));
  } catch { result.parsed = false; }
  return result;
}
