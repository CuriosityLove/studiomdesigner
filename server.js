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
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
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
      output_config: { effort: 'medium' },
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
  if (pathname === '/api/compose') {
    if (req.method !== 'POST') return json(res, 405, { code: 'method_not_allowed' });
    return compose(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  serveStatic(req, res, pathname);
}).listen(PORT, () => console.log(`Studio M Design on :${PORT} · Claude ${client ? 'on (' + MODEL + ')' : 'off (no ANTHROPIC_API_KEY)'} · ${Object.keys(BY_ID).length} products`));
