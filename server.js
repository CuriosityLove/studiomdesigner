// Studio M Design: static site + one Claude-backed endpoint.
// Run: ANTHROPIC_API_KEY=... node server.js   (PORT defaults to 3000)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Anthropic = require('@anthropic-ai/sdk');
const { buildPrompt } = require('./public/compose-prompt.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const EFFORT = process.env.CLAUDE_EFFORT || 'low';                // low | medium | high
const PER_IP_LIMIT = Number(process.env.PER_IP_LIMIT) || 8;      // compositions per IP per window
const WINDOW_MS = (Number(process.env.WINDOW_MINUTES) || 10) * 60_000;
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT) || 300;      // compositions per day, all visitors
const MAX_BODY = 12 * 1024 * 1024;

// Catalog: the same file the page loads.
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(PUBLIC, 'catalog.js'), 'utf8'), sandbox);
const BY_ID = Object.fromEntries(sandbox.window.SM_CATALOG.map(p => [p.id, p]));

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// ---- rate limiting (in memory; resets on restart) ----
const hits = new Map();
let day = new Date().toDateString(), dayCount = 0;
function allow(ip) {
  const now = Date.now();
  if (new Date().toDateString() !== day) { day = new Date().toDateString(); dayCount = 0; }
  if (dayCount >= DAILY_LIMIT) return false;
  const list = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (list.length >= PER_IP_LIMIT) { hits.set(ip, list); return false; }
  list.push(now); hits.set(ip, list); dayCount++;
  return true;
}
setInterval(() => { const now = Date.now(); for (const [ip, l] of hits) if (!l.some(t => now - t < WINDOW_MS)) hits.delete(ip); }, WINDOW_MS).unref();

// ---- helpers ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const SECURITY = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-frame-options': 'SAMEORIGIN' };
function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY, ...headers });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'content-type': 'application/json', 'cache-control': 'no-store' });
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { code: 'too_large' })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  return null;
}

// ---- /api/compose ----
async function compose(req, res) {
  if (!client) return json(res, 503, { code: 'not_configured' });
  if (!allow(clientIp(req))) return json(res, 429, { code: 'rate_limited' });
  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) { return json(res, e.code === 'too_large' ? 413 : 400, { code: 'bad_request' }); }

  const images = (Array.isArray(body.images) ? body.images : []).slice(0, 5)
    .filter(i => i && /^image\/(jpeg|png|webp|gif)$/.test(i.media_type) && typeof i.data === 'string' && i.data.length < 6_000_000);
  const input = { ...(body.input || {}), moodCount: Math.min(Number(body.input?.moodCount) || 0, images.length - (body.input?.hasPlan ? 1 : 0)), hasPlan: !!body.input?.hasPlan && images.length > 0 };
  const prompt = buildPrompt(input, BY_ID);

  try {
    const message = await client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      output_config: { effort: EFFORT },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{
        role: 'user',
        content: [
          ...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.media_type, data: i.data } })),
          { type: 'text', text: prompt },
        ],
      }],
    }).finalMessage();

    if (message.stop_reason === 'refusal') return json(res, 422, { code: 'refused' });
    const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const data = parseJson(text);
    if (!data || !Array.isArray(data.rooms)) return json(res, 502, { code: 'invalid_json' });
    return json(res, 200, data);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json(res, 429, { code: 'rate_limited' });
    if (err instanceof Anthropic.APIError) { console.error('Claude API error', err.status, err.message); return json(res, 502, { code: 'upstream_error' }); }
    console.error(err); return json(res, 500, { code: 'upstream_error' });
  }
}

// ---- live product lookup ----
// Pieces pasted by visitors that aren't in the bundled catalog are read from Studio M's own
// product pages. Only that site and its image CDN are ever fetched, by model number.
const SITE = 'https://studiomedition.com';
const CDN = 'https://studiom-prod.sfo3.cdn.digitaloceanspaces.com';
const UA = 'Mozilla/5.0 (compatible; StudioMDesign/1.0; +https://design.studiomlighting.com)';
const MODEL_RE = /^[A-Za-z0-9_~-]{3,40}$/;
const productCache = new Map();
const lookupHits = new Map();
function allowLookup(ip) {
  const now = Date.now(), list = (lookupHits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (list.length >= 60) { lookupHits.set(ip, list); return false; }
  list.push(now); lookupHits.set(ip, list); return true;
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unescapeHtml = t => t.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e.toLowerCase()] ?? m));
function typeOf(name) {
  const n = name.toLowerCase();
  if (/outdoor|lantern|post|pier|path|bollard|deck|landscape|garden/.test(n)) return 'outdoor';
  if (n.includes('floor lamp')) return 'floor-lamp';
  if (n.includes('lamp')) return 'table-lamp';
  if (/vanity|bath/.test(n)) return 'vanity';
  if (/sconce|wall|picture/.test(n)) return 'sconce';
  if (/chandelier|chandlelier|tier/.test(n)) return 'chandelier';
  if (/linear|island/.test(n)) return 'linear';
  if (/flush|semi|surface mount/.test(n)) return 'flush';
  if (/pendant|cluster/.test(n)) return 'pendant';
  return 'pendant';
}
function parseProduct(html, model) {
  const main = (html.match(/<main[\s\S]*?<\/main>/) || [html])[0]
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '\n');
  const L = main.split('\n').map(l => unescapeHtml(l).trim()).filter(Boolean).slice(0, 220);
  const ti = L.indexOf('Technical Info');
  if (L.length < 10 || ti < 0) return null;
  const after = (arr, k) => { const i = arr.indexOf(k); return i >= 0 ? arr[i + 1] || '' : ''; };
  const attr = k => { const i = L.slice(0, 30).indexOf(k); return i >= 0 && L[i + 1] === ':' ? L[i + 2] : ''; };
  const rest = L.slice(ti), dims = after(L, 'Dimensions');
  const d = Object.fromEntries([...dims.matchAll(/([LWH])([\d.]+)"/g)].map(m => [m[1], Number(m[2])]));
  const desc = L.slice(0, ti).reduce((a, b) => b.length > a.length ? b : a, '');
  return {
    id: after(L, 'Model') || model, name: L[0], coll: L[1], designer: after(L, 'By'), type: typeOf(L[0]),
    finish: attr('Finish'), material: attr('Shade') || attr('Glass') || attr('Material') || attr('Crystal') || attr('Fabric'),
    dims, w: d.W || d.L || null, h: d.H || null, desc: desc.length > 60 ? desc.slice(0, 700) : '',
    light: after(rest, 'Light Type'), lumens: after(rest, 'Delivered Lumens'), cct: after(rest, 'Color Temperature'),
    bulbs: after(rest, 'Number of Bulbs'), rating: after(rest, 'UL Standard'), ada: after(rest, 'ADA Compliant') === 'Yes',
    url: `${SITE}/products/${encodeURIComponent(model)}/${String(L[1]).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  };
}
async function lookupProduct(req, res, url) {
  const model = url.searchParams.get('model') || '';
  if (!MODEL_RE.test(model)) return json(res, 400, { code: 'bad_model' });
  if (BY_ID[model]) return json(res, 200, BY_ID[model]);
  if (productCache.has(model)) return json(res, 200, productCache.get(model));
  if (!allowLookup(clientIp(req))) return json(res, 429, { code: 'rate_limited' });
  try {
    const r = await fetch(`${SITE}/products/${encodeURIComponent(model)}/p`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return json(res, 404, { code: 'not_found' });
    const p = parseProduct(await r.text(), model);
    if (!p || !p.name) return json(res, 404, { code: 'not_found' });
    p.id = model;
    if (productCache.size > 2000) productCache.clear();
    productCache.set(model, p);
    return json(res, 200, p);
  } catch (e) {
    console.error('product lookup failed', model, e.message);
    return json(res, 502, { code: 'lookup_failed' });
  }
}
async function productImage(req, res, model) {
  if (!MODEL_RE.test(model)) return send(res, 400, 'Bad model');
  try {
    const r = await fetch(`${CDN}/product_variants/${model}/primary_image/product_variant_${model}_primary_image_small.webp`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return send(res, 404, 'Not found');
    const buf = Buffer.from(await r.arrayBuffer());
    send(res, 200, buf, { 'content-type': r.headers.get('content-type') || 'image/webp', 'cache-control': 'public, max-age=604800' });
  } catch { send(res, 502, 'Image unavailable'); }
}

// ---- static files ----
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', { 'content-type': 'text/plain' });
    const ext = path.extname(file).toLowerCase();
    const cache = ext === '.html' ? 'no-cache' : (rel.startsWith('/img/') ? 'public, max-age=604800' : 'public, max-age=3600');
    res.writeHead(200, { ...SECURITY, 'content-type': TYPES[ext] || 'application/octet-stream', 'content-length': st.size, 'cache-control': cache });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/healthz') return send(res, 200, 'ok', { 'content-type': 'text/plain' });
  if (pathname === '/api/status' && req.method === 'GET') return json(res, 200, { ai: !!client, images: !!client });
  if (pathname === '/api/product' && req.method === 'GET') return lookupProduct(req, res, new URL(req.url, 'http://localhost'));
  if (pathname.startsWith('/api/product-image/') && req.method === 'GET') return productImage(req, res, decodeURIComponent(pathname.slice(19)));
  if (pathname === '/api/compose') {
    if (req.method !== 'POST') return json(res, 405, { code: 'method_not_allowed' });
    return compose(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  serveStatic(req, res, pathname);
}).listen(PORT, () => console.log(`Studio M Design on :${PORT} · Claude ${client ? 'on (' + MODEL + ', effort ' + EFFORT + ')' : 'off (no ANTHROPIC_API_KEY)'} · ${Object.keys(BY_ID).length} products`));
