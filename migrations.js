// Content migrations for the live menu.
// In production the menu lives in Postgres (seeded ONCE from data/config.json), so new products added to
// data/config.json would never reach an existing database. Each migration below is applied once per database
// (tracked in the `content_migrations` table) and is written to be additive and non-destructive:
//   - it only ADDS items/categories whose id/name is missing,
//   - it only changes an existing field when that field still holds the original seed value
//     (so anything the owner already edited in /admin is left alone),
//   - orders, messages and uploads are never touched.
// Once applied, the owner can freely rename, re-price, re-photo or delete these items in /admin; a deleted
// item is NOT re-added, because the migration id is recorded.
'use strict';

const P = n => `/images/products/${n}.webp`;
const TUBS_CAT = 'Family Tubs (1 L & 5 L)';
const LOLLY_CAT = 'Ice Lollies & Stick Bars';

const NEW_TUBS = [
  { id: 'chocolate-tub', name: 'Chocolate Tub 1 L', description: 'Rich chocolate ice cream loaded with chocolate chips.', unit: '1L tub', price: 900, image: P('tub-1l-chocolate') },
  { id: 'mango-tub', name: 'Mango Tub 1 L', description: 'Made with Pakistani mangoes: sweet, fresh and fruity.', unit: '1L tub', price: 950, image: P('tub-1l-mango') },
  { id: 'kulfi-tub-1l', name: 'Kulfi Tub 1 L', description: 'Creamy desi kulfi with pista, badam and kesar.', unit: '1L tub', price: 1000, image: P('tub-1l-kulfi') },
  { id: 'strawberry-tub-1l', name: 'Strawberry Tub 1 L', description: 'Pink strawberry ice cream topped with fresh strawberries.', unit: '1L tub', price: 900, image: P('tub-1l-strawberry') },
  { id: 'chocolate-tub-5l', name: 'Chocolate Tub 5 L', description: 'Party-size chocolate chip tub for big families and events.', unit: '5L tub', price: 3800, image: P('tub-5l-chocolate') },
  { id: 'mango-tub-5l', name: 'Mango Tub 5 L', description: 'Party-size mango tub: perfect for weddings and dawats.', unit: '5L tub', price: 4000, image: P('tub-5l-mango') },
  { id: 'kulfi-tub-5l', name: 'Kulfi Tub 5 L', description: 'Party-size kulfi tub with pista, badam and kesar.', unit: '5L tub', price: 4200, image: P('tub-5l-kulfi') },
  { id: 'strawberry-tub-5l', name: 'Strawberry Tub 5 L', description: 'Party-size strawberry tub with real strawberry pieces.', unit: '5L tub', price: 3800, image: P('tub-5l-strawberry') }
];
const NEW_LOLLIES = [
  { id: 'mango-lolly', name: 'Mango Ice Lolly', description: 'Frozen mango-orange water ice on a stick. Super refreshing.', unit: 'stick', price: 80, image: P('lolly-mango') },
  { id: 'rooh-afza-lolly', name: 'Rooh Afza Strawberry Lolly', description: 'Rose and strawberry water-ice gola on a stick.', unit: 'stick', price: 100, image: P('lolly-rooh-afza') },
  { id: 'choc-bar', name: 'Chocolate Bar (Choc Bar)', description: 'Vanilla ice cream dipped in a crunchy chocolate shell.', unit: 'stick', price: 150, image: P('chocbar') }
];
// Kulfi on a stick already exists (Malai Kulfi / Pista Badam Kulfi in "Kulfi & Desi Favourites"), so no
// duplicate is added; Pista Badam Kulfi just gets the new kulfi-on-a-stick photo.
// Original seed values: a field is only updated if it still equals this (i.e. never edited in admin).
const SEED = {
  'chocolate-tub': { name: 'Chocolate Tub', description: '1 litre family pack.', price: 1050, image: '/images/chocolate.jpg' },
  'mango-tub': { name: 'Mango Tub', description: '1 litre family pack, seasonal.', price: 1100, image: '/images/mango.jpg' },
  'pista-kulfi': { image: '/images/kulfi.jpg' }
};
const NEW_IMAGE_FOR_SEEDED = { 'pista-kulfi': P('kulfi-stick') };

function allIds(cfg) { const s = new Set(); for (const c of cfg.menu) for (const i of c.items) s.add(i.id); return s; }
function findItem(cfg, id) { for (const c of cfg.menu) { const i = c.items.find(x => x.id === id); if (i) return i; } return null; }
function item(base) { return { available: true, bestseller: false, samplePrice: true, ...base }; }

function addTubsAndLollies(cfg) {
  cfg.menu = Array.isArray(cfg.menu) ? cfg.menu : [];
  const changes = [];
  // 1. Family tubs category: reuse the existing tub category (renamed only if it still has its seed name)
  let tubs = cfg.menu.find(c => c.items.some(i => i.id === 'chocolate-tub' || i.id === 'vanilla-tub')) || cfg.menu.find(c => /tub/i.test(c.category));
  if (!tubs) { tubs = { category: TUBS_CAT, items: [] }; cfg.menu.push(tubs); changes.push('created category ' + TUBS_CAT); }
  else if (tubs.category === 'Family Tubs (1 Litre)') { tubs.category = TUBS_CAT; changes.push('renamed tub category'); }
  // 2. upgrade the two seeded 1 L tubs (only fields the owner never changed)
  for (const [id, seed] of Object.entries(SEED)) {
    const it = findItem(cfg, id); if (!it) continue;
    const target = NEW_TUBS.find(t => t.id === id) || { image: NEW_IMAGE_FOR_SEEDED[id] };
    for (const f of Object.keys(seed)) if (it[f] === seed[f] && target[f] !== undefined) { it[f] = target[f]; changes.push(`${id}.${f}`); }
  }
  // 3. add missing tubs, then order the category: 1 L flavours, 5 L flavours, then anything else (kept in its order)
  const ids = allIds(cfg);
  for (const t of NEW_TUBS) if (!ids.has(t.id)) { tubs.items.push(item(t)); changes.push('added ' + t.id); }
  const rank = id => { const k = NEW_TUBS.findIndex(t => t.id === id); return k < 0 ? 1000 : k; };
  tubs.items = tubs.items.map((x, n) => [x, n]).sort((a, b) => rank(a[0].id) - rank(b[0].id) || a[1] - b[1]).map(a => a[0]);
  // 4. ice lollies & stick bars
  let lol = cfg.menu.find(c => /lolly|lollies|stick bar/i.test(c.category));
  if (!lol) { lol = { category: LOLLY_CAT, items: [] }; changes.push('created category ' + LOLLY_CAT); }
  else cfg.menu.splice(cfg.menu.indexOf(lol), 1);
  for (const t of NEW_LOLLIES) if (!ids.has(t.id)) { lol.items.push(item(t)); changes.push('added ' + t.id); }
  // 5. category order: first category (scoops) → tubs → lollies → the rest
  cfg.menu.splice(cfg.menu.indexOf(tubs), 1);
  const first = cfg.menu.length ? 1 : 0;
  cfg.menu.splice(first, 0, tubs, lol);
  return changes;
}

const MIGRATIONS = [
  { id: '2026-10-22-tubs-and-lollies', up: addTubsAndLollies }
];

// Applies every migration whose id is not in `applied`. Returns { config, ran: [ids], changes: [..] }.
function applyMigrations(config, applied = new Set()) {
  const cfg = JSON.parse(JSON.stringify(config));
  const ran = [], changes = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    changes.push(...m.up(cfg).map(c => `${m.id}: ${c}`));
    ran.push(m.id);
  }
  return { config: cfg, ran, changes };
}

module.exports = { MIGRATIONS, applyMigrations };

if (require.main === module) {          // node migrations.js data/config.json  -> rewrites the file in place
  const fs = require('fs');
  const file = process.argv[2] || require('path').join(__dirname, 'data', 'config.json');
  const { config, changes } = applyMigrations(JSON.parse(fs.readFileSync(file, 'utf8')));
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  console.log(changes.join('\n') || 'no changes');
}
