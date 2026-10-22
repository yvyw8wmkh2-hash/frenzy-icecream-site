// End-to-end smoke test. Starts server.js on a spare port, places an order, sends a contact message,
// edits content in the admin, uploads a photo, restarts the server to check persistence, then removes
// everything it created and restores the original config.
//   File mode:      npm test
//   Postgres mode:  DATABASE_URL=postgres://... npm test
//   Vercel mode:    DATABASE_URL=postgres://... npm run test:vercel   (runs api/index.js in test/vercel-harness.js:
//                   pre-parsed req.body, 4.5 MB body limit, read-only filesystem; requires DATABASE_URL)
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const PASS = 'smoke-test-pass';
const AUTH = 'Basic ' + Buffer.from('admin:' + PASS).toString('base64');
const PG = !!process.env.DATABASE_URL;
const VERCEL = process.argv.includes('--vercel') || process.env.SMOKE_VERCEL === '1';
if (VERCEL && !PG) { console.error('Vercel mode needs DATABASE_URL (the serverless filesystem is read-only).'); process.exit(1); }
const ENTRY = path.join(ROOT, VERCEL ? 'test/vercel-harness.js' : 'server.js');
let fsWrites = [];
const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ADMIN_USER: 'admin', ADMIN_PASSWORD: PASS };
// 1x1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let child;
function start() {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [ENTRY], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = d => { out += d; const m = String(d).match(/fs-writes=(\d+)/); if (m) fsWrites.push(+m[1]); if (out.includes('Ice cream site on')) resolve(out); };
    child.stdout.on('data', onData); child.stderr.on('data', d => { out += d; });
    child.on('exit', c => reject(new Error('server exited ' + c + '\n' + out)));
    setTimeout(() => reject(new Error('server start timeout\n' + out)), 20000).unref();
  });
}
function stop() { return new Promise(r => { if (!child || child.exitCode !== null) return r(); child.removeAllListeners('exit'); child.on('exit', r); child.kill('SIGTERM'); }); }
const j = (method, p, body, headers = {}) => fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers }, body: body && JSON.stringify(body) });
const admin = (method, p, body) => j(method, '/admin/api' + p, body, { Authorization: AUTH });
function karachiDate(d = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }

(async () => {
  const created = { order: null, message: null, upload: null, orders: [] };
  let original = null; let backupsBefore = [];
  const backupDir = path.join(ROOT, 'data', 'backups');
  if (!PG && fs.existsSync(backupDir)) backupsBefore = fs.readdirSync(backupDir);
  const steps = [];
  const ok = s => { steps.push(s); console.log('  ✓ ' + s); };
  try {
    const banner = await start();
    assert(banner.includes(`storage: ${PG ? 'postgres' : 'file'}`), 'unexpected storage mode: ' + banner);
    ok(`server started (${PG ? 'postgres' : 'file'} mode${VERCEL ? ', Vercel function harness' : ''})`);

    let r = await fetch(BASE + '/healthz'); assert.equal(r.status, 200); ok('/healthz 200 ' + JSON.stringify(await r.json()));
    r = await fetch(BASE + '/healthz?db=1'); assert.equal(r.status, 200); ok('/healthz?db=1 200');
    for (const p of ['/', '/menu.html', '/order.html', '/contact.html', '/css/style.css', '/images/hero.jpg']) { r = await fetch(BASE + p); assert.equal(r.status, 200, p); }
    for (const p of ['/menu', '/order', '/contact']) { r = await fetch(BASE + p); assert.equal(r.status, 200, p); }
    r = await fetch(BASE + '/no-such-page'); assert.equal(r.status, 404);
    ok('static pages and images 200, clean URLs 200, unknown page 404');
    r = await fetch(BASE + '/admin/'); assert.equal(r.status, 401); ok('admin requires auth (401)');
    r = await fetch(BASE + '/admin/', { headers: { Authorization: 'Basic ' + Buffer.from('admin:wrong').toString('base64') } }); assert.equal(r.status, 401);
    r = await fetch(BASE + '/admin/', { headers: { Authorization: AUTH } }); assert.equal(r.status, 200); assert.match(await r.text(), /<html/i);
    r = await fetch(BASE + '/admin/admin.js', { headers: { Authorization: AUTH } }); assert.equal(r.status, 200);
    ok('admin login works (wrong password 401, admin UI files 200)');

    const cfg = await (await fetch(BASE + '/api/config')).json();
    const item = cfg.menu.flatMap(c => c.items).find(i => i.available);
    const order = { name: 'Smoke Test', phone: '0300 1234567', fulfilment: 'delivery', address: '12 Test Street, Gulberg, Lahore', area: 'Gulberg',
      date: karachiDate(new Date(Date.now() + 86400000)), time: '15:00', notes: 'automated test – ignore', items: [{ id: item.id, qty: 3 }] };
    r = await j('POST', '/api/order', order); let b = await r.json();
    assert.equal(r.status, 201, JSON.stringify(b)); created.order = b.order.orderNumber;
    assert.match(created.order, /^FRZ-\d{8}-\d{3}$/);
    ok(`order placed ${created.order} total ${b.order.currency} ${b.order.total}`);
    created.orders.push(created.order);
    r = await j('POST', '/api/order', { ...order, phone: '123' }); assert.equal(r.status, 422); ok('invalid order rejected (422)');
    // classic HTML form post (application/x-www-form-urlencoded) to /order
    const form = new URLSearchParams({ name: 'Smoke Form', phone: '03001234567', fulfilment: 'pickup', date: order.date, time: '16:00', notes: 'automated test – ignore', ['qty_' + item.id]: '2' });
    r = await fetch(BASE + '/order', { method: 'POST', body: form });
    let html = await r.text(); assert.equal(r.status, 201, html.slice(0, 300));
    const fm = html.match(/FRZ-\d{8}-\d{3}/); assert(fm, 'no order number in confirmation page'); created.orders.push(fm[0]);
    ok('HTML form order placed ' + fm[0]);
    r = await fetch(BASE + '/contact', { method: 'POST', body: new URLSearchParams({ name: 'Smoke Form', email: 'smoke@example.com', message: 'automated form message' }) });
    html = await r.text(); assert.equal(r.status, 201); assert.match(html, /Thanks, Smoke Form/);
    created.formMessage = true; ok('HTML form contact message saved');

    r = await j('POST', '/api/contact', { name: 'Smoke Test', phone: '03001234567', message: 'automated test message' }); b = await r.json();
    assert.equal(r.status, 201); created.message = b.id; ok('contact message saved ' + created.message);

    r = await admin('GET', '/state'); let st = await r.json(); assert.equal(r.status, 200);
    original = st.config;
    assert(st.orders.some(o => o.orderNumber === created.order), 'order missing in admin');
    assert(st.messages.some(m => m.id === created.message), 'message missing in admin');
    ok(`admin state lists order + message (storage=${st.storage})`);

    r = await admin('PATCH', '/orders/' + created.order, { status: 'confirmed' }); assert.equal(r.status, 200);
    r = await admin('PATCH', '/messages/' + created.message, { read: true }); assert.equal(r.status, 200);
    ok('order status + message read updated');

    r = await admin('POST', '/upload', { data: 'data:image/png;base64,' + PNG }); b = await r.json();
    assert.equal(r.status, 201, JSON.stringify(b)); created.upload = b.url;
    r = await fetch(BASE + created.upload); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await r.arrayBuffer()).toString('base64'), PNG);
    ok('photo uploaded and served: ' + created.upload);
    r = await admin('POST', '/upload', { data: Buffer.from('not an image').toString('base64') }); assert.equal(r.status, 400); ok('non-image upload rejected');
    const big = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(3.2 * 1024 * 1024)]).toString('base64');   // ~4.3 MB body, under Vercel's 4.5 MB
    r = await admin('POST', '/upload', { data: big }); b = await r.json(); assert.equal(r.status, 413); assert.match(b.error, /too large/i);
    ok('oversized photo rejected with friendly 413: ' + b.error);

    const edited = JSON.parse(JSON.stringify(original));
    edited.brand.tagline = 'SMOKE TEST TAGLINE';
    edited.menu[0].items[0].image = created.upload;
    r = await admin('PUT', '/config', edited); b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b));
    let pub = await (await fetch(BASE + '/api/config')).json();
    assert.equal(pub.brand.tagline, 'SMOKE TEST TAGLINE'); assert.equal(pub.menu[0].items[0].image, created.upload);
    ok('admin content edit saved (tagline + item photo)');

    await stop(); await start();
    pub = await (await fetch(BASE + '/api/config')).json(); assert.equal(pub.brand.tagline, 'SMOKE TEST TAGLINE');
    st = await (await admin('GET', '/state')).json();
    const o = st.orders.find(x => x.orderNumber === created.order); assert(o && o.status === 'confirmed', 'order not persisted');
    assert(st.messages.find(m => m.id === created.message)?.read === true, 'message not persisted');
    r = await fetch(BASE + created.upload); assert.equal(r.status, 200);
    ok('everything persisted across a server restart');
  } catch (e) {
    console.error('  ✗ FAILED:', e.message); process.exitCode = 1;
  } finally {
    // ---- cleanup ----
    try {
      if (child && child.exitCode === null) {
        if (original) { const r = await admin('PUT', '/config', original); if (r.status !== 200) throw new Error('config restore failed'); }
        for (const id of created.orders) await admin('DELETE', '/orders/' + id);
        let st = await (await admin('GET', '/state')).json();
        for (const m of st.messages) if (m.id === created.message || (created.formMessage && m.name === 'Smoke Form')) await admin('DELETE', '/messages/' + m.id);
        st = await (await admin('GET', '/state')).json();
        assert(!st.orders.some(o => created.orders.includes(o.orderNumber)) && !st.messages.some(m => m.id === created.message || m.name === 'Smoke Form'));
        if (original) assert.deepStrictEqual(st.config, original);
      }
      await stop();
      if (VERCEL) { assert(fsWrites.length && fsWrites.every(n => n === 0), 'filesystem writes attempted in serverless mode: ' + fsWrites); console.log('  ✓ no filesystem writes in serverless mode'); }
      if (PG) {
        const { Pool } = require('pg'); const { pgOptions } = require('../store');
        const pool = new Pool(pgOptions(process.env.DATABASE_URL));
        if (created.upload) await pool.query('DELETE FROM uploads WHERE id = $1', [created.upload.split('/').pop()]);
        await pool.query("DELETE FROM config_backups WHERE created_at > now() - interval '10 minutes'");
        await pool.end();
      } else {
        if (created.upload) fs.rmSync(path.join(ROOT, 'public', created.upload), { force: true });
        if (fs.existsSync(backupDir)) {
          for (const f of fs.readdirSync(backupDir)) if (!backupsBefore.includes(f)) fs.unlinkSync(path.join(backupDir, f));
          if (!fs.readdirSync(backupDir).length) fs.rmdirSync(backupDir);
        }
      }
      console.log('  ✓ test data cleaned up');
    } catch (e) { console.error('  ✗ cleanup problem:', e.message); process.exitCode = 1; }
    console.log(process.exitCode ? 'SMOKE TEST FAILED' : `SMOKE TEST PASSED (${steps.length} checks)`);
  }
})();
