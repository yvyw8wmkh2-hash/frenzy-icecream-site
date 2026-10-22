// Storage layer for the Frenzy site.
//  - DATABASE_URL set   -> Postgres (e.g. Neon free tier). Survives restarts/redeploys on Render's ephemeral disk.
//  - DATABASE_URL unset -> local JSON files in data/ and uploads in public/images/uploads (original behaviour).
// In Postgres mode nothing is written to the local disk (required on Vercel, whose filesystem is read-only);
// data/config.json is only read, once, to seed an empty database.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const CONFIG_FILE = path.join(DATA, 'config.json');
const ORDERS_FILE = path.join(DATA, 'orders.json');
const MESSAGES_FILE = path.join(DATA, 'messages.json');
const BACKUP_DIR = path.join(DATA, 'backups');
const UPLOAD_DIR = path.join(ROOT, 'public', 'images', 'uploads');
const MAX_BACKUPS = 30;
const UPLOAD_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

let writeChain = Promise.resolve();            // serialise writes within this process
function withLock(fn) { const p = writeChain.then(fn); writeChain = p.catch(() => {}); return p; }
function newUploadName(ext) { return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${ext}`; }
function maxSuffix(numbers, prefix) {
  return numbers.reduce((m, n) => n && n.startsWith(prefix) ? Math.max(m, parseInt(n.slice(prefix.length), 10) || 0) : m, 0);
}

// ======================= file store =======================
function fileStore() {
  const readList = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; } };
  const writeJSON = (file, data) => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, file); };
  const guard = () => { if (SERVERLESS) throw new Error('Cannot save: the serverless filesystem is read-only. Set DATABASE_URL to use Postgres.'); };
  const mutate = (file, fn) => withLock(() => { guard(); const l = readList(file); const r = fn(l); if (r !== false) writeJSON(file, l); return r; });
  return {
    mode: 'file',
    async init() { if (!SERVERLESS) fs.mkdirSync(DATA, { recursive: true }); },
    async ping() { return true; },
    async getConfig() { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); },
    async saveConfig(clean) {
      await withLock(() => {
        guard();
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        fs.copyFileSync(CONFIG_FILE, path.join(BACKUP_DIR, `config-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
        const backups = fs.readdirSync(BACKUP_DIR).sort(); while (backups.length > MAX_BACKUPS) fs.unlinkSync(path.join(BACKUP_DIR, backups.shift()));
        writeJSON(CONFIG_FILE, clean);
      });
    },
    async listOrders() { return readList(ORDERS_FILE); },
    async createOrder(order, prefix) {
      let rec;
      await mutate(ORDERS_FILE, l => {
        rec = { orderNumber: prefix + String(maxSuffix(l.map(o => o.orderNumber), prefix) + 1).padStart(3, '0'), createdAt: new Date().toISOString(), status: 'new', ...order };
        l.push(rec);
      });
      return rec;
    },
    async setOrderStatus(id, status) {
      return mutate(ORDERS_FILE, l => { const o = l.find(x => x.orderNumber === id); if (!o) return false; o.status = status; o.updatedAt = new Date().toISOString(); return true; });
    },
    async deleteOrder(id) {
      return mutate(ORDERS_FILE, l => { const i = l.findIndex(o => o.orderNumber === id); if (i < 0) return false; l.splice(i, 1); return true; });
    },
    async listMessages() { return readList(MESSAGES_FILE); },
    async createMessage(msg) {
      const rec = { read: false, id: 'MSG-' + Date.now().toString(36).toUpperCase(), createdAt: new Date().toISOString(), ...msg };
      await mutate(MESSAGES_FILE, l => { l.push(rec); });
      return rec;
    },
    async setMessageRead(id, read) {
      return mutate(MESSAGES_FILE, l => { const o = l.find(x => x.id === id); if (!o) return false; o.read = !!read; return true; });
    },
    async deleteMessage(id) {
      return mutate(MESSAGES_FILE, l => { const i = l.findIndex(o => o.id === id); if (i < 0) return false; l.splice(i, 1); return true; });
    },
    async saveUpload(buf, ext) {
      guard();
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      const name = newUploadName(ext);
      fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
      return `/images/uploads/${name}`;
    },
    async getUpload() { return null; },          // file mode serves uploads as static files
    async close() {}
  };
}

// ======================= Postgres store =======================
function pgOptions(url) {
  // Neon needs TLS. We strip sslmode/channel_binding from the URL and set ssl ourselves so the
  // behaviour is identical whether or not the copied Neon URL carries ?sslmode=require.
  const u = new URL(url);
  const sslmode = (u.searchParams.get('sslmode') || '').toLowerCase();
  u.searchParams.delete('sslmode'); u.searchParams.delete('channel_binding');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) || u.hostname.startsWith('/');
  const off = sslmode === 'disable' || process.env.PGSSL === 'disable' || (local && sslmode !== 'require');
  return { connectionString: u.toString(), ssl: off ? false : { rejectUnauthorized: false },
    // small pool: on Vercel every warm function instance keeps its own pool (Neon's pooler absorbs the rest)
    max: parseInt(process.env.PG_POOL_MAX || '3', 10), idleTimeoutMillis: SERVERLESS ? 10000 : 30000,
    connectionTimeoutMillis: 15000, allowExitOnIdle: SERVERLESS };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS site_config (id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1), data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS config_backups (id BIGSERIAL PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS orders (order_number TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL);
CREATE INDEX IF NOT EXISTS messages_created_idx ON messages (created_at);
CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, mime TEXT NOT NULL, size INT NOT NULL, data BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
`;
const ORDER_LOCK_KEY = 72310001;               // pg_advisory_xact_lock key for order numbering
const INIT_LOCK_KEY = 72310002;                // serialises schema creation when several cold instances start at once
const CONFIG_TTL_MS = 30000;

// One Pool per process, kept on globalThis so warm serverless invocations (and any re-require) reuse it.
function sharedPool(url, Pool) {
  const g = globalThis.__frenzyPgPools || (globalThis.__frenzyPgPools = new Map());
  if (!g.has(url)) {
    const pool = new Pool(pgOptions(url));
    pool.on('error', e => console.error('[db] idle client error:', e.message));
    g.set(url, pool);
  }
  return g.get(url);
}
// A frozen/resumed serverless instance can hand out a socket the server already closed. Such errors
// happen before the statement runs, so retrying once on a fresh connection is safe.
const STALE_RE = /Connection terminated|ECONNRESET|EPIPE|Client has encountered a connection error|Connection ended/i;

function pgStore(url, pgModule) {
  const { Pool } = pgModule || require('pg');
  const pool = sharedPool(url, Pool);
  let cache = null, cacheAt = 0;
  const query = async (text, params) => {
    try { return await pool.query(text, params); }
    catch (e) { if (!STALE_RE.test(e.message)) throw e; return pool.query(text, params); }
  };
  const connect = async () => {               // a client whose connection is verified with BEGIN
    for (let i = 0; ; i++) {
      const c = await pool.connect();
      try { await c.query('BEGIN'); return c; }
      catch (e) { c.release(e); if (i || !STALE_RE.test(e.message)) throw e; }
    }
  };
  const tx = async fn => {
    const c = await connect();
    try { const r = await fn(c); await c.query('COMMIT'); return r; }
    catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
    finally { c.release(); }
  };
  return {
    mode: 'postgres',
    pool,
    async init() {                             // idempotent: safe to run on every cold start
      await tx(async c => {
        await c.query('SELECT pg_advisory_xact_lock($1)', [INIT_LOCK_KEY]);
        await c.query(SCHEMA);
        const { rows } = await c.query('SELECT 1 FROM site_config WHERE id = 1');
        if (!rows.length) {
          const seed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
          await c.query('INSERT INTO site_config (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [seed]);
          console.log('[db] seeded site_config from data/config.json');
        }
      });
    },
    async ping() { await query('SELECT 1'); return true; },
    async getConfig({ fresh = false } = {}) {
      if (!fresh && cache && Date.now() - cacheAt < CONFIG_TTL_MS) return cache;
      const { rows } = await query('SELECT data FROM site_config WHERE id = 1');
      if (!rows.length) throw new Error('site_config row missing');
      cache = rows[0].data; cacheAt = Date.now();
      return cache;
    },
    async saveConfig(clean) {
      await tx(async c => {
        await c.query('INSERT INTO config_backups (data) SELECT data FROM site_config WHERE id = 1');
        await c.query('DELETE FROM config_backups WHERE id NOT IN (SELECT id FROM config_backups ORDER BY id DESC LIMIT $1)', [MAX_BACKUPS]);
        await c.query('INSERT INTO site_config (id, data, updated_at) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()', [clean]);
      });
      cache = clean; cacheAt = Date.now();
    },
    async listOrders() { return (await query('SELECT data FROM orders ORDER BY created_at, order_number')).rows.map(r => r.data); },
    async createOrder(order, prefix) {
      return tx(async c => {
        await c.query('SELECT pg_advisory_xact_lock($1)', [ORDER_LOCK_KEY]);
        const { rows } = await c.query("SELECT order_number FROM orders WHERE order_number LIKE $1 || '%'", [prefix]);
        const now = new Date();
        const rec = { orderNumber: prefix + String(maxSuffix(rows.map(r => r.order_number), prefix) + 1).padStart(3, '0'), createdAt: now.toISOString(), status: 'new', ...order };
        await c.query('INSERT INTO orders (order_number, created_at, data) VALUES ($1, $2, $3)', [rec.orderNumber, now, rec]);
        return rec;
      });
    },
    async setOrderStatus(id, status) {
      const r = await query("UPDATE orders SET data = data || jsonb_build_object('status', $2::text, 'updatedAt', $3::text) WHERE order_number = $1", [id, status, new Date().toISOString()]);
      return r.rowCount > 0;
    },
    async deleteOrder(id) { return (await query('DELETE FROM orders WHERE order_number = $1', [id])).rowCount > 0; },
    async listMessages() { return (await query('SELECT data FROM messages ORDER BY created_at, id')).rows.map(r => r.data); },
    async createMessage(msg) {
      const now = new Date();
      const rec = { read: false, id: 'MSG-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase(), createdAt: now.toISOString(), ...msg };
      await query('INSERT INTO messages (id, created_at, data) VALUES ($1, $2, $3)', [rec.id, now, rec]);
      return rec;
    },
    async setMessageRead(id, read) {
      const r = await query("UPDATE messages SET data = data || jsonb_build_object('read', $2::boolean) WHERE id = $1", [id, !!read]);
      return r.rowCount > 0;
    },
    async deleteMessage(id) { return (await query('DELETE FROM messages WHERE id = $1', [id])).rowCount > 0; },
    async saveUpload(buf, ext) {
      const id = newUploadName(ext);
      await query('INSERT INTO uploads (id, mime, size, data) VALUES ($1, $2, $3, $4)', [id, UPLOAD_MIME[ext], buf.length, buf]);
      return `/uploads/${id}`;
    },
    async getUpload(id) {
      const { rows } = await query('SELECT mime, data FROM uploads WHERE id = $1', [id]);
      return rows[0] || null;
    },
    async close() { globalThis.__frenzyPgPools?.delete(url); await pool.end(); }
  };
}

function createStore(env = process.env, pgModule) {
  return env.DATABASE_URL ? pgStore(env.DATABASE_URL, pgModule) : fileStore();
}
module.exports = { createStore, pgOptions, SCHEMA };
