const dns = require('node:dns').promises;
const net = require('node:net');

const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 2;
const TIMEOUT_MS = 6500;

function send(res, code, body, type='text/plain; charset=utf-8') {
  res.statusCode = code;
  res.setHeader('Content-Type', type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.end(body);
}

function blockedIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a,b] = p;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

function blockedIp(ip) {
  if (net.isIP(ip) === 4) return blockedIPv4(ip);
  if (net.isIP(ip) !== 6) return true;
  const x = ip.toLowerCase();
  if (x === '::' || x === '::1') return true;
  if (x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb')) return true;
  if (x.startsWith('::ffff:')) {
    const v4 = x.slice(7);
    if (net.isIP(v4) === 4) return blockedIPv4(v4);
  }
  return false;
}

async function validateRemote(raw) {
  if (!raw || raw.length > 2200) throw new Error('INVALID_IMAGE_URL');
  let u;
  try { u = new URL(raw); } catch { throw new Error('INVALID_IMAGE_URL'); }
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('HTTPS_IMAGE_REQUIRED');
  if (u.port && u.port !== '443') throw new Error('INVALID_IMAGE_PORT');
  const host = u.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('INVALID_IMAGE_HOST');
  if (net.isIP(host)) {
    if (blockedIp(host)) throw new Error('PRIVATE_IMAGE_HOST');
  } else {
    const addresses = await dns.lookup(host, {all:true, verbatim:true});
    if (!addresses.length || addresses.some(x => blockedIp(x.address))) throw new Error('PRIVATE_IMAGE_HOST');
  }
  return u;
}

function detectType(buf) {
  if (buf.length >= 8 && buf.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && (buf.subarray(0,6).toString() === 'GIF87a' || buf.subarray(0,6).toString() === 'GIF89a')) return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0,4).toString() === 'RIFF' && buf.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  if (buf.length >= 12 && buf.subarray(4,8).toString() === 'ftyp') {
    const brand = buf.subarray(8,12).toString();
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'image/x-icon';
  return null;
}

async function readLimited(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new Error('IMAGE_TOO_LARGE');
  if (!response.body) throw new Error('EMPTY_IMAGE');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { try { await reader.cancel(); } catch {} throw new Error('IMAGE_TOO_LARGE'); }
    chunks.push(Buffer.from(value));
  }
  if (!size) throw new Error('EMPTY_IMAGE');
  return Buffer.concat(chunks, size);
}

async function fetchImage(raw) {
  let current = await validateRemote(raw);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let r;
    try {
      r = await fetch(current, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'accept': 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8',
          'user-agent': 'DEAD-PIXELS-PORTAL/3.7.7 token-image-proxy'
        }
      });
    } finally { clearTimeout(timer); }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      if (i === MAX_REDIRECTS) throw new Error('TOO_MANY_REDIRECTS');
      current = await validateRemote(new URL(r.headers.get('location'), current).toString());
      continue;
    }
    if (!r.ok) throw new Error(`UPSTREAM_${r.status}`);
    const buf = await readLimited(r);
    const type = detectType(buf);
    if (!type) throw new Error('UNSUPPORTED_IMAGE_FORMAT'); // SVG/HTML intentionally rejected.
    return {buf, type};
  }
  throw new Error('IMAGE_FETCH_FAILED');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, 'METHOD_NOT_ALLOWED');
  try {
    const raw = String(req.query?.url || '');
    const {buf, type} = await fetchImage(raw);
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
    res.end(buf);
  } catch (e) {
    return send(res, 404, 'IMAGE_UNAVAILABLE');
  }
};
