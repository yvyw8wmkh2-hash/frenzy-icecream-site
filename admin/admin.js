// Frenzy admin content manager. Talks to /admin/api/* (same Basic-auth login).
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TZ = 'Asia/Karachi';
  let S = { config: null, orders: [], messages: [], statuses: [] }, dirty = false;

  async function api(path, method = 'GET', body) {
    const r = await fetch('/admin/api' + path, { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    const j = await r.json().catch(() => ({ ok: false, error: 'Server error' }));
    if (!r.ok && j.ok !== false) j.ok = false;
    return j;
  }
  function flash(msg, ok = true) { $('#flash').innerHTML = `<div class="toast ${ok ? 'ok' : 'bad'}">${esc(msg)}</div>`; clearTimeout(flash.t); flash.t = setTimeout(() => $('#flash').innerHTML = '', 5000); }
  function setDirty(v) { dirty = v; $$('.savebar').forEach(b => { b.classList.toggle('dirty', v); $('.state', b).textContent = v ? '● Unsaved changes' : 'All changes saved'; }); }
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  const money = n => `${S.config.ordering.currency || 'Rs'} ${Number(n).toLocaleString('en-PK')}`;
  const when = iso => new Date(iso).toLocaleString('en-PK', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });

  // ---------- tabs ----------
  $$('.tabs button').forEach(b => b.addEventListener('click', () => {
    $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    $$('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
  }));

  // ---------- orders ----------
  function renderOrders() {
    const f = $('#o-filter').value;
    const list = S.orders.slice().reverse().filter(o => f === 'all' ? true : f === 'open' ? !['completed', 'cancelled'].includes(o.status || 'new') : (o.status || 'new') === f);
    $('#n-orders').textContent = S.orders.filter(o => (o.status || 'new') === 'new').length || '';
    $('#orders').innerHTML = list.map(o => `<div class="ord" data-s="${esc(o.status || 'new')}">
      <div class="top"><div><strong style="font-size:1.15rem">${esc(o.orderNumber)}</strong> · <small>${esc(when(o.createdAt))}</small></div>
      <div><select data-order="${esc(o.orderNumber)}">${S.statuses.map(s => `<option ${s === (o.status || 'new') ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <button class="btn small danger" data-del-order="${esc(o.orderNumber)}">Delete</button></div></div>
      <p style="margin:.5em 0"><b>${esc(o.name)}</b> · <a href="tel:${esc(o.phone.replace(/[^\d+]/g, ''))}">${esc(o.phone)}</a><br>
      ${o.fulfilment === 'delivery' ? `🛵 Delivery: ${esc(o.address)}${o.area ? ' (' + esc(o.area) + ')' : ''}` : '🏭 Pickup'} · 📅 ${esc(o.date)} ${esc(o.time)}</p>
      <div>${o.items.map(l => `${l.qty} × ${esc(l.name)} <small>(${money(l.lineTotal)})</small>`).join('<br>')}</div>
      <p style="margin:.5em 0">Delivery ${money(o.deliveryFee)} · <b class="neon-lime">Total ${money(o.total)}</b> (cash)</p>
      ${o.notes ? `<p style="margin:0;color:var(--muted)">📝 ${esc(o.notes)}</p>` : ''}</div>`).join('') || '<div class="card">No orders here yet.</div>';
  }
  $('#o-filter').addEventListener('change', renderOrders);
  $('#refresh').addEventListener('click', () => load(true));
  $('#orders').addEventListener('change', async e => {
    const id = e.target.dataset.order; if (!id) return;
    const j = await api('/orders/' + encodeURIComponent(id), 'PATCH', { status: e.target.value });
    if (j.ok) { S.orders.find(o => o.orderNumber === id).status = e.target.value; renderOrders(); flash(`Order ${id} marked ${e.target.value}.`); } else flash(j.error || 'Could not update', false);
  });
  $('#orders').addEventListener('click', async e => {
    const id = e.target.dataset.delOrder; if (!id || !confirm(`Delete order ${id} permanently?`)) return;
    const j = await api('/orders/' + encodeURIComponent(id), 'DELETE');
    if (j.ok) { S.orders = S.orders.filter(o => o.orderNumber !== id); renderOrders(); flash('Order deleted.'); } else flash('Could not delete', false);
  });

  // ---------- messages ----------
  function renderMessages() {
    $('#n-msgs').textContent = S.messages.filter(m => !m.read).length || '';
    $('#messages').innerHTML = S.messages.slice().reverse().map(m => `<div class="ord msg ${m.read ? '' : 'unread'}">
      <div class="top"><div><strong>${esc(m.name)}</strong> ${m.read ? '' : '<span class="badge new">new</span>'} · <small>${esc(when(m.createdAt))}</small></div>
      <div><button class="btn small ghost" data-read="${esc(m.id)}" data-v="${m.read ? 0 : 1}">${m.read ? 'Mark unread' : 'Mark read'}</button>
      <button class="btn small danger" data-del-msg="${esc(m.id)}">Delete</button></div></div>
      <p style="margin:.4em 0">${m.phone ? `📞 <a href="tel:${esc(m.phone.replace(/[^\d+]/g, ''))}">${esc(m.phone)}</a> ` : ''}${m.email ? `✉️ <a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : ''}</p>
      <p style="margin:0;white-space:pre-wrap">${esc(m.message)}</p></div>`).join('') || '<div class="card">No messages yet.</div>';
  }
  $('#messages').addEventListener('click', async e => {
    const r = e.target.dataset.read, d = e.target.dataset.delMsg;
    if (r) { const j = await api('/messages/' + r, 'PATCH', { read: e.target.dataset.v === '1' }); if (j.ok) { S.messages.find(m => m.id === r).read = e.target.dataset.v === '1'; renderMessages(); } }
    if (d && confirm('Delete this message?')) { const j = await api('/messages/' + d, 'DELETE'); if (j.ok) { S.messages = S.messages.filter(m => m.id !== d); renderMessages(); } }
  });

  // ---------- menu editor ----------
  function renderMenu() {
    $('#menu-editor').innerHTML = S.config.menu.map((c, ci) => `<div class="cat" data-ci="${ci}">
      <div class="cat-head"><input value="${esc(c.category)}" data-cat="${ci}" aria-label="Category name">
      <button class="btn small ghost" data-act="cat-up" ${ci === 0 ? 'disabled' : ''}>↑</button><button class="btn small ghost" data-act="cat-down" ${ci === S.config.menu.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn small danger" data-act="del-cat">Delete category</button></div>
      ${c.items.map((it, ii) => `<div class="flav" data-ii="${ii}">
        <div><img src="${esc(it.image || '/images/hero.jpg')}" alt=""><label class="btn small ghost" style="margin-top:8px;width:100%">📷 Change photo<input type="file" accept="image/*" data-photo hidden></label></div>
        <div><div class="f">
          <div class="nm"><label>Flavour name</label><input data-f="name" value="${esc(it.name)}"></div>
          <div><label>Price (Rs)</label><input data-f="price" type="number" min="0" step="10" value="${esc(it.price)}"></div>
          <div><label>Per (unit)</label><input data-f="unit" value="${esc(it.unit)}" placeholder="cup, scoop, 1L tub"></div>
          <div class="full"><label>Description</label><input data-f="description" value="${esc(it.description)}"></div></div>
          <div class="toggles"><label><input type="checkbox" data-f="bestseller" ${it.bestseller ? 'checked' : ''}> ★ Featured</label>
          <label><input type="checkbox" data-f="available" ${it.available ? 'checked' : ''}> Available</label>
          <label><input type="checkbox" data-f="samplePrice" ${it.samplePrice ? 'checked' : ''}> Sample price</label></div>
          <div class="acts"><button class="btn small ghost" data-act="up" ${ii === 0 ? 'disabled' : ''}>↑ Up</button><button class="btn small ghost" data-act="down" ${ii === c.items.length - 1 ? 'disabled' : ''}>↓ Down</button>
          <button class="btn small danger" data-act="del">Remove</button></div></div></div>`).join('')}
      <button class="btn small cyan" data-act="add">+ Add flavour to “${esc(c.category)}”</button></div>`).join('');
  }
  const ed = $('#menu-editor');
  ed.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.cat !== undefined) { S.config.menu[+t.dataset.cat].category = t.value; return setDirty(true); }
    const f = t.dataset.f; if (!f) return;
    const it = S.config.menu[+t.closest('.cat').dataset.ci].items[+t.closest('.flav').dataset.ii];
    it[f] = t.type === 'checkbox' ? t.checked : f === 'price' ? Number(t.value) : t.value; setDirty(true);
  });
  ed.addEventListener('change', async e => {
    if (!e.target.matches('[data-photo]')) return;
    const file = e.target.files[0]; if (!file) return;
    const it = S.config.menu[+e.target.closest('.cat').dataset.ci].items[+e.target.closest('.flav').dataset.ii];
    const url = await uploadImage(file, 900); if (!url) return;
    it.image = url; renderMenu(); await saveConfig('Photo updated for ' + it.name + '.');
  });
  ed.addEventListener('click', e => {
    const a = e.target.dataset.act; if (!a) return;
    const ci = +e.target.closest('.cat').dataset.ci, cat = S.config.menu[ci], fl = e.target.closest('.flav'), ii = fl ? +fl.dataset.ii : -1;
    const mv = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
    if (a === 'add') cat.items.push({ id: 'new-' + Date.now().toString(36), name: 'New flavour', description: '', unit: 'cup', price: 0, available: true, bestseller: false, samplePrice: true, image: '/images/hero.jpg' });
    if (a === 'del') { if (!confirm(`Remove “${cat.items[ii].name}” from the menu?`)) return; cat.items.splice(ii, 1); }
    if (a === 'up') mv(cat.items, ii, -1); if (a === 'down') mv(cat.items, ii, 1);
    if (a === 'cat-up') mv(S.config.menu, ci, -1); if (a === 'cat-down') mv(S.config.menu, ci, 1);
    if (a === 'del-cat') { if (!confirm(`Delete the whole category “${cat.category}” and its ${cat.items.length} flavours?`)) return; S.config.menu.splice(ci, 1); }
    renderMenu(); setDirty(true);
  });
  $('[data-act="add-cat"]').addEventListener('click', () => { S.config.menu.push({ category: 'New category', items: [] }); renderMenu(); setDirty(true); });

  // ---------- business info ----------
  const getK = k => k.split('.').reduce((o, p) => o?.[p], S.config);
  const setK = (k, v) => { const ps = k.split('.'); const last = ps.pop(); ps.reduce((o, p) => o[p] ??= {}, S.config)[last] = v; };
  function renderBiz() {
    $$('[data-k]').forEach(i => i.value = getK(i.dataset.k) ?? '');
    const h = S.config.contact.hours ||= [];
    $('#hours-editor').innerHTML = h.map((r, i) => `<div class="hrow" data-hi="${i}"><input data-h="days" value="${esc(r.days)}" placeholder="Days, e.g. Monday – Friday"><input data-h="time" value="${esc(r.time)}" placeholder="Time, e.g. 12 PM – 11 PM"><button class="btn small danger" data-hdel>✕</button></div>`).join('');
  }
  $('#tab-business').addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.k) { setK(t.dataset.k, t.type === 'number' ? Number(t.value) : t.value); setDirty(true); }
    if (t.dataset.h) { S.config.contact.hours[+t.closest('.hrow').dataset.hi][t.dataset.h] = t.value; setDirty(true); }
  });
  $('#hours-editor').addEventListener('click', e => { if (e.target.dataset.hdel === undefined) return; S.config.contact.hours.splice(+e.target.closest('.hrow').dataset.hi, 1); renderBiz(); setDirty(true); });
  $('#add-hours').addEventListener('click', () => { S.config.contact.hours.push({ days: '', time: '' }); renderBiz(); setDirty(true); });

  // ---------- photos ----------
  function resize(file, max) {
    return new Promise((res, rej) => {
      const img = new Image(); img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src); res(c.toDataURL('image/jpeg', 0.85));
      }; img.onerror = () => rej(new Error('Not an image')); img.src = URL.createObjectURL(file);
    });
  }
  async function uploadImage(file, max) {
    try { flash('Uploading photo…'); const data = await resize(file, max); const j = await api('/upload', 'POST', { data });
      if (!j.ok) { flash(j.error || 'Upload failed', false); return null; } return j.url;
    } catch (e) { flash('That file could not be read as an image.', false); return null; }
  }
  $('#hero-file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return; const url = await uploadImage(f, 1600); if (!url) return;
    S.config.brand.heroImage = url; $('#hero-prev').src = url; await saveConfig('Home photo updated.');
  });

  // ---------- save / load ----------
  async function saveConfig(okMsg = 'Saved! Changes are live on the site.') {
    $$('.save').forEach(b => b.disabled = true);
    const j = await api('/config', 'PUT', S.config);
    $$('.save').forEach(b => b.disabled = false);
    if (j.ok) { S.config = j.config; setDirty(false); renderMenu(); renderBiz(); flash(okMsg); } else flash('Not saved: ' + (j.error || 'error'), false);
  }
  $$('.save').forEach(b => b.addEventListener('click', () => saveConfig()));
  async function load(keepConfig) {
    const j = await api('/state'); if (!j.config) return flash('Could not load data', false);
    S.orders = j.orders; S.messages = j.messages; S.statuses = j.statuses;
    if (!keepConfig || !S.config) { S.config = j.config; renderMenu(); renderBiz(); $('#hero-prev').src = S.config.brand.heroImage || '/images/hero.jpg'; }
    renderOrders(); renderMessages();
  }
  load(); setInterval(() => load(true), 60000);   // refresh orders every minute
})();
