// Ice cream factory website – zero-dependency Node.js server (Node 18+).
// Run: npm start   (env: PORT, HOST, ADMIN_PASSWORD, DATABASE_URL – see README/DEPLOY.md)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createStore } = require('./store');

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me-icecream';
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const store = createStore();
const TZ = 'Asia/Karachi';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };

function karachiDate(d = new Date()) {          // YYYY-MM-DD in Karachi
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function allItems(cfg) { const m = {}; for (const c of cfg.menu) for (const it of c.items) m[it.id] = it; return m; }

// ---------- request helpers ----------
function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
}
function sendJSON(res, status, obj) { send(res, status, JSON.stringify(obj), MIME['.json'], { 'Cache-Control': 'no-store' }); }
function readBody(req, limit = 100 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function parseBody(req) {
  const raw = await readBody(req);
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('application/json')) return JSON.parse(raw || '{}');
  const p = new URLSearchParams(raw); const o = {};
  for (const [k, v] of p) { if (k in o) o[k] = [].concat(o[k], v); else o[k] = v; }
  return o;
}
function wantsJSON(req) { return (req.headers.accept || '').includes('application/json') || (req.headers['content-type'] || '').includes('application/json'); }
function str(v, max) { return (Array.isArray(v) ? v[0] : (v ?? '')).toString().trim().slice(0, max); }
function normPhone(p) { return p.replace(/[\s\-()]/g, ''); }
const PHONE_RE = /^(\+92|0092|0)?3\d{9}$|^(\+92|0092|0)?(42)\d{7,8}$/; // PK mobile, or Lahore landline (042)

// ---------- order logic ----------
function validateOrder(input, cfg) {
  const errors = {};
  const o = cfg.ordering;
  const name = str(input.name, 80);
  const phone = str(input.phone, 25);
  const fulfilment = str(input.fulfilment, 10).toLowerCase();
  const address = str(input.address, 300);
  const area = str(input.area, 80);
  const date = str(input.date, 10);
  const time = str(input.time, 5);
  const notes = str(input.notes, 500);

  if (name.length < 2) errors.name = 'Please enter your name.';
  if (!PHONE_RE.test(normPhone(phone))) errors.phone = 'Enter a valid Pakistani phone number, e.g. 0300 0000000 or +92 300 0000000.';
  if (!['delivery', 'pickup'].includes(fulfilment)) errors.fulfilment = 'Choose delivery or pickup.';
  if (fulfilment === 'delivery' && address.length < 8) errors.address = 'Please enter a full delivery address in Lahore.';

  const today = karachiDate();
  const maxD = karachiDate(new Date(Date.now() + (o.maxDaysAhead || 30) * 86400000));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = 'Choose a preferred date.';
  else if (date < today) errors.date = 'Date cannot be in the past.';
  else if (date > maxD) errors.date = `Orders can be placed up to ${o.maxDaysAhead || 30} days ahead.`;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors.time = 'Choose a preferred time.';

  // items: accept {items:[{id,qty}]} (JSON) or qty_<id>=N (form)
  const menu = allItems(cfg);
  let raw = [];
  if (Array.isArray(input.items)) raw = input.items;
  else for (const k of Object.keys(input)) if (k.startsWith('qty_')) raw.push({ id: k.slice(4), qty: input[k] });
  const lines = []; const maxQ = o.maxQtyPerItem || 50;
  for (const r of raw) {
    const qty = parseInt(str(r.qty, 4) || '0', 10);
    if (!qty) continue;
    const it = menu[str(r.id, 60)];
    if (!it) { errors.items = 'An item in your order is not on the menu.'; continue; }
    if (!it.available) { errors.items = `${it.name} is currently unavailable.`; continue; }
    if (!(qty >= 1 && qty <= maxQ)) { errors.items = `Quantity must be between 1 and ${maxQ}.`; continue; }
    lines.push({ id: it.id, name: it.name, unit: it.unit, unitPrice: it.price, qty, lineTotal: it.price * qty });
  }
  if (!lines.length && !errors.items) errors.items = 'Please add at least one item.';

  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  if (lines.length && subtotal < (o.minimumOrder || 0)) errors.items = `Minimum order is ${o.currency} ${o.minimumOrder}.`;
  let deliveryFee = 0;
  if (fulfilment === 'delivery') deliveryFee = (o.freeDeliveryOver && subtotal >= o.freeDeliveryOver) ? 0 : (o.deliveryFee || 0);
  const total = subtotal + deliveryFee;

  return { errors, order: { name, phone, fulfilment, address: fulfilment === 'delivery' ? address : '', area: fulfilment === 'delivery' ? area : '',
    date, time, notes, items: lines, subtotal, deliveryFee, total, currency: o.currency || 'Rs', payment: 'Cash on delivery' } };
}

function orderPrefix() { return `FRZ-${karachiDate().replace(/-/g, '')}-`; }   // store appends 001, 002, ...

// ---------- page templates ----------
function shell(cfg, title, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(cfg.brand.name)}</title><link rel="stylesheet" href="/css/style.css"></head>
<body><header class="site-header"><div class="wrap nav"><a class="logo" href="/">🍦 <span>${esc(cfg.brand.name)}</span></a>
<nav><a href="/">Home</a><a href="/menu.html">Menu</a><a href="/order.html">Order</a><a href="/contact.html">Contact</a></nav></div></header>
<main class="wrap">${inner}</main></body></html>`;
}
function confirmationHTML(cfg, order) {
  const rows = order.items.map(l => `<tr><td>${esc(l.name)}</td><td>${l.qty} × ${esc(order.currency)} ${l.unitPrice}</td><td>${esc(order.currency)} ${l.lineTotal}</td></tr>`).join('');
  return shell(cfg, 'Order confirmed', `<section class="card confirm"><h1>Shukriya! Your order is placed 🎉</h1>
<p class="order-no">Order number: <strong>${esc(order.orderNumber)}</strong></p>
<p>${order.fulfilment === 'delivery' ? `Delivery to: ${esc(order.address)}` : 'Pickup from the factory'} · ${esc(order.date)} at ${esc(order.time)}</p>
<table class="summary"><tbody>${rows}<tr><td colspan="2">Subtotal</td><td>${esc(order.currency)} ${order.subtotal}</td></tr>
<tr><td colspan="2">Delivery fee</td><td>${esc(order.currency)} ${order.deliveryFee}</td></tr>
<tr class="total"><td colspan="2">Total (cash on delivery)</td><td>${esc(order.currency)} ${order.total}</td></tr></tbody></table>
<p>We'll call you on ${esc(order.phone)} to confirm. Questions? Call ${esc(cfg.contact.phone)}.</p><p><a class="btn" href="/">Back to home</a></p></section>`);
}
function errorPage(cfg, errors) {
  return shell(cfg, 'Please fix your order', `<section class="card"><h1>Please fix the following</h1><ul>${Object.values(errors).map(e => `<li>${esc(e)}</li>`).join('')}</ul>
<p><a class="btn" href="javascript:history.back()">Go back</a></p></section>`);
}

// ---------- admin ----------
function checkAuth(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const [u, ...rest] = Buffer.from(h.slice(6), 'base64').toString().split(':');
  const p = rest.join(':');
  const a = Buffer.from(u + ':' + p), b = Buffer.from(ADMIN_USER + ':' + ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// ---------- admin API (content manager) ----------
const ADMIN_DIR = path.join(ROOT, 'admin');
const ORDER_STATUSES = ['new', 'confirmed', 'out-for-delivery', 'completed', 'cancelled'];

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'item'; }
function cleanConfig(input, old) {
  // Rebuild config from known fields only, with type checks. Throws on bad input.
  const t = (v, max, req) => { const x = String(v ?? '').trim().slice(0, max); if (req && !x) throw new Error(req + ' is required'); return x; };
  const num = (v, name, min = 0, max = 1e7) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be a number between ${min} and ${max}`); return Math.round(n); };
  const img = v => { const x = t(v, 300); if (x && !/^\/images\/[\w\-./]+\.(jpe?g|png|webp)$/i.test(x) && !/^\/uploads\/[\w-]+\.(jpe?g|png|webp)$/i.test(x) || x.includes('..')) throw new Error('Invalid image path'); return x; };
  const b = input.brand || {}, c = input.contact || {}, o = input.ordering || {};
  const seen = new Set();
  const menu = (Array.isArray(input.menu) ? input.menu : []).slice(0, 30).map(cat => ({
    category: t(cat.category, 80, 'Category name'),
    items: (Array.isArray(cat.items) ? cat.items : []).slice(0, 100).map(it => {
      let id = slug(it.id || it.name); while (seen.has(id)) id += '-2'; seen.add(id);
      return { id, name: t(it.name, 80, 'Flavour name'), description: t(it.description, 300), unit: t(it.unit, 30) || 'cup',
        price: num(it.price, `Price of "${it.name}"`, 0, 1000000), available: !!it.available, bestseller: !!it.bestseller, samplePrice: !!it.samplePrice, image: img(it.image) };
    })
  }));
  return {
    _README: old._README,
    brand: { name: t(b.name, 60, 'Business name'), tagline: t(b.tagline, 200), urduTagline: t(b.urduTagline, 120), intro: t(b.intro, 1000),
      heroImage: img(b.heroImage) || '/images/hero.jpg', imagesNote: t(b.imagesNote, 200) },
    contact: { address: t(c.address, 300), phone: t(c.phone, 30), whatsapp: t(c.whatsapp, 30), email: t(c.email, 120), mapUrl: /^https?:\/\//.test(c.mapUrl || '') ? t(c.mapUrl, 500) : '',
      hours: (Array.isArray(c.hours) ? c.hours : []).slice(0, 14).map(h => ({ days: t(h.days, 60), time: t(h.time, 80) })).filter(h => h.days || h.time) },
    ordering: { currency: t(o.currency, 8) || 'Rs', deliveryFee: num(o.deliveryFee ?? 0, 'Delivery fee'), freeDeliveryOver: num(o.freeDeliveryOver ?? 0, 'Free delivery threshold'),
      minimumOrder: num(o.minimumOrder ?? 0, 'Minimum order'), maxQtyPerItem: num(o.maxQtyPerItem ?? 50, 'Max quantity', 1, 1000), maxDaysAhead: num(o.maxDaysAhead ?? 30, 'Days ahead', 0, 365),
      paymentNote: t(o.paymentNote, 200) || 'Cash on delivery only.', deliveryAreaNote: t(o.deliveryAreaNote, 300) },
    menu
  };
}
function sniffImage(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}
async function adminApi(req, res, sub, cfg) {
  const m = req.method;
  if (m !== 'GET' && !(req.headers['content-type'] || '').includes('application/json')) return sendJSON(res, 415, { ok: false, error: 'JSON required' }); // CSRF guard
  const body = async (limit) => { const raw = await readBody(req, limit); return JSON.parse(raw || '{}'); };
  try {
    if (sub === '/state' && m === 'GET') return sendJSON(res, 200, { config: cfg, orders: await store.listOrders(), messages: await store.listMessages(), statuses: ORDER_STATUSES, storage: store.mode });
    if (sub === '/config' && m === 'PUT') {
      const input = await body(1024 * 1024);
      const clean = cleanConfig(input, cfg);
      await store.saveConfig(clean);
      console.log('[admin] config saved');
      return sendJSON(res, 200, { ok: true, config: clean });
    }
    if (sub === '/upload' && m === 'POST') {
      const { data } = await body(12 * 1024 * 1024);
      const b64 = String(data || '').replace(/^data:[^,]*,/, '');
      const buf = Buffer.from(b64, 'base64');
      const ext = sniffImage(buf);
      if (!ext) return sendJSON(res, 400, { ok: false, error: 'Only JPG, PNG or WebP images are allowed.' });
      if (buf.length > 8 * 1024 * 1024) return sendJSON(res, 400, { ok: false, error: 'Image too large (max 8 MB).' });
      const url = await store.saveUpload(buf, ext);
      console.log('[admin] uploaded', url);
      return sendJSON(res, 201, { ok: true, url });
    }
    let mm;
    if ((mm = sub.match(/^\/orders\/([\w-]+)$/))) {
      const id = mm[1];
      if (m === 'PATCH') {
        const { status } = await body();
        if (!ORDER_STATUSES.includes(status)) return sendJSON(res, 400, { ok: false, error: 'Bad status' });
        const ok = await store.setOrderStatus(id, status);
        return sendJSON(res, ok ? 200 : 404, { ok });
      }
      if (m === 'DELETE') {
        const n = await store.deleteOrder(id);
        return sendJSON(res, n ? 200 : 404, { ok: !!n });
      }
    }
    if ((mm = sub.match(/^\/messages\/([\w-]+)$/))) {
      const id = mm[1];
      if (m === 'PATCH') {
        const { read } = await body();
        const ok = await store.setMessageRead(id, read);
        return sendJSON(res, ok ? 200 : 404, { ok });
      }
      if (m === 'DELETE') {
        const n = await store.deleteMessage(id);
        return sendJSON(res, n ? 200 : 404, { ok: !!n });
      }
    }
    return sendJSON(res, 404, { ok: false, error: 'Unknown admin endpoint' });
  } catch (e) {
    return sendJSON(res, 400, { ok: false, error: e.message || 'Bad request' });
  }
}

// ---------- router ----------
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  // health checks: no DB round-trip by default (keeps Neon free compute asleep); /healthz?db=1 also pings the DB
  if (p === '/healthz') {
    if (url.searchParams.get('db') !== '1') return sendJSON(res, 200, { ok: true, storage: store.mode });
    try { await store.ping(); return sendJSON(res, 200, { ok: true, storage: store.mode, db: 'up' }); }
    catch (e) { return sendJSON(res, 503, { ok: false, storage: store.mode, db: 'down', error: e.message }); }
  }
  let mm;
  if ((req.method === 'GET' || req.method === 'HEAD') && (mm = p.match(/^\/uploads\/([\w-]+\.(?:jpe?g|png|webp))$/i))) {
    const up = await store.getUpload(mm[1]);
    if (!up) return send(res, 404, 'Not found', 'text/plain');
    return send(res, 200, req.method === 'HEAD' ? '' : up.data, up.mime, { 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Length': up.data.length });
  }
  let cfg;
  try { cfg = await store.getConfig(); } catch (e) { console.error('[config]', e.message); return send(res, 500, 'Site configuration could not be loaded.', 'text/plain'); }

  if (p === '/api/config' && req.method === 'GET') {
    const { _README, ...pub } = cfg; return sendJSON(res, 200, pub);
  }
  if (p === '/api/health') return sendJSON(res, 200, { ok: true });

  if ((p === '/api/order' || p === '/order') && req.method === 'POST') {
    let input; try { input = await parseBody(req); } catch { return sendJSON(res, 400, { ok: false, errors: { form: 'Invalid request.' } }); }
    if (str(input.website, 100)) return sendJSON(res, 400, { ok: false, errors: { form: 'Rejected.' } }); // honeypot
    const { errors, order } = validateOrder(input, cfg);
    if (Object.keys(errors).length) return wantsJSON(req) ? sendJSON(res, 422, { ok: false, errors }) : send(res, 422, errorPage(cfg, errors));
    const saved = await store.createOrder(order, orderPrefix());
    console.log(`[order] ${saved.orderNumber} ${saved.name} ${saved.currency} ${saved.total}`);
    return wantsJSON(req) ? sendJSON(res, 201, { ok: true, order: saved }) : send(res, 201, confirmationHTML(cfg, saved));
  }

  if ((p === '/api/contact' || p === '/contact') && req.method === 'POST') {
    let input; try { input = await parseBody(req); } catch { return sendJSON(res, 400, { ok: false, errors: { form: 'Invalid request.' } }); }
    if (str(input.website, 100)) return sendJSON(res, 400, { ok: false, errors: { form: 'Rejected.' } });
    const msg = { name: str(input.name, 80), phone: str(input.phone, 25), email: str(input.email, 120), message: str(input.message, 2000) };
    const errors = {};
    if (msg.name.length < 2) errors.name = 'Please enter your name.';
    if (!msg.phone && !msg.email) errors.phone = 'Give us a phone number or email so we can reply.';
    if (msg.phone && !PHONE_RE.test(normPhone(msg.phone))) errors.phone = 'Enter a valid Pakistani phone number.';
    if (msg.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(msg.email)) errors.email = 'Enter a valid email.';
    if (msg.message.length < 5) errors.message = 'Please write a short message.';
    if (Object.keys(errors).length) return wantsJSON(req) ? sendJSON(res, 422, { ok: false, errors }) : send(res, 422, errorPage(cfg, errors));
    const saved = await store.createMessage(msg);
    return wantsJSON(req) ? sendJSON(res, 201, { ok: true, id: saved.id })
      : send(res, 201, shell(cfg, 'Message sent', `<section class="card confirm"><h1>Thanks, ${esc(saved.name)}!</h1><p>We received your message and will get back to you soon.</p><p><a class="btn" href="/">Home</a></p></section>`));
  }

  if (p === '/admin' || p.startsWith('/admin/')) {
    if (!checkAuth(req)) return send(res, 401, 'Authentication required', 'text/plain', { 'WWW-Authenticate': 'Basic realm="Frenzy admin", charset="UTF-8"' });
    if (p === '/admin') return send(res, 302, '', 'text/plain', { Location: '/admin/' });
    if (p.startsWith('/admin/api/')) return adminApi(req, res, p.slice(10), cfg);
    if (p === '/admin/orders.json') return sendJSON(res, 200, await store.listOrders());
    // admin static files (admin/ folder, never public)
    const f = p === '/admin/' ? 'index.html' : p.slice(7);
    const full = path.normalize(path.join(ADMIN_DIR, f));
    if (!full.startsWith(ADMIN_DIR + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    return fs.readFile(full, (err, buf) => err ? send(res, 404, 'Not found', 'text/plain')
      : send(res, 200, buf, MIME[path.extname(full)] || 'application/octet-stream', { 'Cache-Control': 'no-store' }));
  }

  // static files
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
  let file = p === '/' ? '/index.html' : p;
  if (['/menu', '/order', '/contact'].includes(file)) file += '.html';
  const full = path.normalize(path.join(PUBLIC, file));
  if (!full.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(full, (err, buf) => {
    if (err) return send(res, 404, shell(cfg, 'Not found', '<section class="card"><h1>Oops, this scoop melted 🫠</h1><p>Page not found. <a href="/">Go home</a></p></section>'));
    send(res, 200, req.method === 'HEAD' ? '' : buf, MIME[path.extname(full)] || 'application/octet-stream', { 'Cache-Control': 'no-cache' });
  });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => { console.error(e); if (!res.headersSent) send(res, 500, 'Server error', 'text/plain'); });
});
async function initStore(tries = 5) {         // retry: a sleeping Neon compute can take a few seconds to wake
  for (let i = 1; ; i++) {
    try { return await store.init(); }
    catch (e) { if (i >= tries) throw e; console.error(`[startup] storage init failed (${e.message}), retry ${i}/${tries - 1} in 3s`); await new Promise(r => setTimeout(r, 3000)); }
  }
}
initStore(store.mode === 'postgres' ? 5 : 1).then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`Ice cream site on http://${HOST}:${PORT}  (storage: ${store.mode}; admin: /admin, user "${ADMIN_USER}")`);
    if (!process.env.ADMIN_PASSWORD) console.log('WARNING: using default admin password – set ADMIN_PASSWORD.');
  });
}).catch(e => { console.error('[startup] storage init failed:', e.message); process.exit(1); });
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  console.log(`[shutdown] ${sig}`);
  server.close(() => store.close().finally(() => process.exit(0)));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 8000).unref();
});
