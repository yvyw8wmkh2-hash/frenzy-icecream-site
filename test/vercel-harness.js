// Local stand-in for Vercel's Node runtime, used by `npm run test:vercel`.
// It serves api/index.js through http.createServer the way Vercel would after the vercel.json rewrite:
//  - VERCEL=1 is set, so the app runs in serverless mode;
//  - request bodies over 4.5 MB are rejected with 413 before the function runs;
//  - the body is read up front and exposed as a lazily parsed `req.body` (JSON / urlencoded / text / Buffer),
//    so the handler must not depend on reading the stream itself;
//  - every fs write API throws EROFS, like Vercel's read-only filesystem.
// Static files in public/ are served by the function too (on Vercel the CDN serves them first).
'use strict';
process.env.VERCEL = '1';
const fs = require('fs');
const http = require('http');
const querystring = require('querystring');

const writes = [];
for (const fn of ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync', 'rename', 'renameSync',
  'copyFile', 'copyFileSync', 'unlink', 'unlinkSync', 'rm', 'rmSync', 'createWriteStream']) {
  const orig = fs[fn];
  fs[fn] = function (...args) {
    writes.push(`${fn}(${args[0]})`);
    const e = Object.assign(new Error(`EROFS: read-only file system, ${fn} '${args[0]}'`), { code: 'EROFS' });
    if (typeof args[args.length - 1] === 'function' && !fn.endsWith('Sync')) return process.nextTick(args[args.length - 1], e);
    throw e;
  };
  fs[fn].orig = orig;
}

const fnHandler = require('../api/index.js');
const LIMIT = 4.5 * 1024 * 1024;

const server = http.createServer((req, res) => {
  const chunks = []; let size = 0; let over = false;
  req.on('data', c => { size += c.length; if (size > LIMIT) over = true; else chunks.push(c); });
  req.on('end', () => {
    if (over) { res.writeHead(413, { 'Content-Type': 'text/plain' }); return res.end('Request Entity Too Large (FUNCTION_PAYLOAD_TOO_LARGE)'); }
    const raw = Buffer.concat(chunks);
    let parsed, done = false;
    Object.defineProperty(req, 'body', { configurable: true, get() {
      if (done) return parsed; done = true;
      if (!raw.length) return (parsed = undefined);
      const ct = (req.headers['content-type'] || '').toLowerCase();
      if (ct.includes('application/json')) { try { parsed = JSON.parse(raw.toString()); } catch { done = false; throw new Error('Invalid JSON'); } }
      else if (ct.includes('application/x-www-form-urlencoded')) parsed = { ...querystring.parse(raw.toString()) };
      else if (ct.startsWith('text/')) parsed = raw.toString();
      else parsed = raw;
      return parsed;
    } });
    Promise.resolve(fnHandler(req, res)).catch(e => { console.error(e); res.statusCode = 500; res.end(); });
  });
});

const PORT = parseInt(process.env.PORT || '3000', 10);
server.listen(PORT, process.env.HOST || '127.0.0.1', () => {
  const { store } = require('../server');
  console.log(`Ice cream site on http://127.0.0.1:${PORT}  (storage: ${store.mode}; vercel harness)`);
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  if (writes.length) console.log('[harness] filesystem writes attempted:\n  ' + writes.join('\n  '));
  console.log(`[harness] fs-writes=${writes.length}`);
  const { store } = require('../server');
  server.close(); store.close().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
});
