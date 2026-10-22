// Shared front-end code for all public pages. Data comes from /api/config (data/config.json).
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const telHref = p => 'tel:' + String(p || '').replace(/[^\d+]/g, '');
  const waHref = p => 'https://wa.me/' + String(p || '').replace(/\D/g, '').replace(/^0/, '92');
  const page = document.body.dataset.page;
  let CFG;
  const money = n => `${CFG.ordering.currency || 'Rs'} ${Number(n).toLocaleString('en-PK')}`;
  const items = () => CFG.menu.flatMap(c => c.items.map(i => ({ ...i, category: c.category })));
  const sampleBadge = i => i.samplePrice ? ' <span class="badge sample" title="Placeholder price – edit in admin">sample price</span>' : '';

  function header() {
    const links = [['/', 'Home', 'home'], ['/menu.html', 'Menu', 'menu'], ['/contact.html', 'Contact', 'contact']];
    $('#site-header').innerHTML = `<div class="wrap nav">
      <a class="logo" href="/">${esc(CFG.brand.name)}<small>ICE CREAM · LAHORE</small></a>
      <a class="btn small hdr-order" href="/order.html">Order</a>
      <button class="menu-toggle" aria-label="Open menu" aria-expanded="false">☰</button>
      <nav class="nav-links">${links.map(([h, t, k]) => `<a href="${h}" class="${k === page ? 'active' : ''}">${t}</a>`).join('')}
      <a class="btn small" href="/order.html">Order now</a></nav></div>`;
    const t = $('.menu-toggle'), n = $('.nav-links');
    t.addEventListener('click', () => { n.classList.toggle('open'); t.setAttribute('aria-expanded', n.classList.contains('open')); });
    const c = CFG.contact;
    $('#site-footer').innerHTML = `<div class="wrap"><div><strong class="neon-pink foot-brand" style="font-size:1.3rem">${esc(CFG.brand.name)}</strong><br>${esc(c.address)}</div>
      <div><span class="ico">📞</span> <a href="${telHref(c.phone)}">${esc(c.phone)}</a><br><span class="ico">✉️</span> <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>
      <div><span class="ico">💵</span> ${esc(CFG.ordering.paymentNote)}<br><small>${esc(CFG.brand.imagesNote || '')}</small></div></div>`;
    if (c.whatsapp) document.body.insertAdjacentHTML('beforeend', `<a class="wa-float" href="${waHref(c.whatsapp)}" target="_blank" rel="noopener" aria-label="WhatsApp us">💬</a>`);
    document.title = `${document.title} · ${CFG.brand.name}`;
  }

  // ---------- cart (kept in localStorage so "+ Add" on any page carries over to the order page) ----------
  const CART_KEY = 'frenzy-cart-v1';
  const cart = {
    get() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch { return {}; } },
    set(c) { try { localStorage.setItem(CART_KEY, JSON.stringify(c)); } catch {} },
    qty(id) { return this.get()[id] || 0; },
    change(id, d) {
      const c = this.get(), max = CFG.ordering.maxQtyPerItem || 50;
      const q = Math.min(max, Math.max(0, (c[id] || 0) + d)); if (q) c[id] = q; else delete c[id]; this.set(c); return q;
    },
    clear() { try { localStorage.removeItem(CART_KEY); } catch {} }
  };
  // srcset for the optimised product photos (/images/products/x.webp also exists as x-400.webp)
  function imgTag(i, cls = '') {
    const src = i.image || '/images/hero.jpg';
    const m = src.match(/^\/images\/products\/([\w-]+)\.webp$/);
    const set = m ? ` srcset="/images/products/${m[1]}-400.webp 400w, ${esc(src)} 720w" sizes="(max-width:720px) 46vw, (max-width:1000px) 31vw, 260px"` : '';
    return `<img class="${cls}" src="${esc(src)}"${set} alt="${esc(i.name)}" loading="lazy" decoding="async" width="400" height="400">`;
  }
  function addControl(i) {
    if (!i.available) return '<span class="badge off">Sold out</span>';
    const q = cart.qty(i.id);
    return q ? `<div class="stepper" role="group" aria-label="Quantity of ${esc(i.name)}"><button type="button" data-step="-1" aria-label="One less">−</button><span class="q">${q}</span><button type="button" data-step="1" aria-label="One more">+</button></div>`
      : `<button type="button" class="btn add-btn" data-step="1">+ Add</button>`;
  }
  function productCard(i) {
    return `<article class="pc ${i.available ? '' : 'unavailable'}" data-id="${esc(i.id)}">
      <div class="ph">${imgTag(i)}<span class="size">${esc(i.unit)}</span>${i.bestseller ? '<span class="fav" title="Fan favourite">★</span>' : ''}</div>
      <div class="pb"><h3>${esc(i.name)}</h3>${i.description ? `<p class="desc">${esc(i.description)}</p>` : ''}
      <div class="price-row"><span class="price">${money(i.price)}</span><span class="per">/ ${esc(i.unit)}</span></div>
      <div class="add" data-add="${esc(i.id)}">${addControl(i)}</div></div></article>`;
  }
  const slug = s => 'cat-' + String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // All products grouped by category, with a sticky tab bar to jump between categories.
  function renderProducts(root) {
    const favs = items().filter(i => i.bestseller);
    const cats = [...(favs.length ? [{ category: '★ Fan favourites', id: 'cat-favourites', items: favs }] : []),
      // fan favourites get their own section, so they are not repeated in their category
      ...CFG.menu.map(c => ({ ...c, id: slug(c.category), items: favs.length ? c.items.filter(i => !i.bestseller) : c.items })).filter(c => c.items.length)];
    const short = c => c.category.replace(/\s*\(.*\)\s*$/, '') || c.category;
    root.innerHTML = `<nav class="cat-tabs" aria-label="Menu categories"><div class="tabs-inner">${cats.map((c, n) => `<a href="#${c.id}" class="${n ? '' : 'active'}">${esc(short(c))}</a>`).join('')}</div></nav>
      ${cats.map(c => `<section class="cat-sec" id="${c.id}"><div class="cat-head"><h2>${esc(c.category)}</h2><span class="count">${c.items.length} item${c.items.length === 1 ? '' : 's'}</span></div>
      <div class="pgrid">${c.items.map(productCard).join('')}</div></section>`).join('')}`;
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-step]'); if (!b) return;
      const id = b.closest('[data-add]').dataset.add; cart.change(id, +b.dataset.step); refreshCart();
    });
    // highlight the tab of the section being viewed
    const tabs = $$('.cat-tabs a', root), secs = cats.map(c => document.getElementById(c.id)), bar = $('.cat-tabs', root);
    let ticking = false;
    const onScroll = () => {
      ticking = false;
      const off = bar.getBoundingClientRect().bottom + 24;
      let k = 0; secs.forEach((s, n) => { if (s.getBoundingClientRect().top <= off) k = n; });
      tabs.forEach((t, n) => t.classList.toggle('active', n === k));
      const t = tabs[k], inner = t.parentElement;
      if (t.offsetLeft < inner.scrollLeft || t.offsetLeft + t.offsetWidth > inner.scrollLeft + inner.clientWidth) inner.scrollTo({ left: t.offsetLeft - 16, behavior: 'smooth' });
    };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
    refreshCart();
  }
  function refreshCart() {
    const c = cart.get(), all = Object.fromEntries(items().map(i => [i.id, i]));
    $$('[data-add]').forEach(el => { const it = all[el.dataset.add]; if (it) el.innerHTML = addControl(it); });
    let count = 0, sum = 0;
    for (const [id, q] of Object.entries(c)) { const it = all[id]; if (it && it.available) { count += q; sum += q * it.price; } }
    let bar = $('#cart-bar');
    if (!bar) { document.body.insertAdjacentHTML('beforeend', '<div class="cart-bar hidden" id="cart-bar"></div>'); bar = $('#cart-bar'); }
    bar.innerHTML = `<div><strong>${money(sum)}</strong><small>${count} item${count === 1 ? '' : 's'} in your order</small></div><a class="btn" href="/order.html">Checkout →</a>`;
    bar.classList.toggle('hidden', !count); document.body.classList.toggle('has-cart', !!count);
  }

  // ---------- pages ----------
  const pages = {
    home() {
      const b = CFG.brand, o = CFG.ordering;
      $('#hero').innerHTML = `<img class="bg" src="${esc(b.heroImage || '/images/hero-tubs.webp')}" alt="" fetchpriority="high">
        <div class="content"><h1 class="neon-pink">${esc(b.name)}</h1>
        ${b.urduTagline ? `<div class="urdu">${esc(b.urduTagline)}</div>` : ''}
        <p class="tag">${esc(b.tagline)}</p>
        <div class="cta-row"><a class="btn" href="#products"><span class="ico">🍦</span> Order now</a><a class="btn ghost" href="/menu.html">Full menu</a></div>
        <ul class="pills"><li><span class="ico">🛵</span> Delivery in Lahore</li><li><span class="ico">💵</span> Cash on delivery</li><li><span class="ico">🏭</span> Made in Lahore</li></ul></div>`;
      $('#intro').textContent = b.intro;
      $('#delivery-info').textContent = `Delivery fee ${money(o.deliveryFee)}${o.freeDeliveryOver ? `, free over ${money(o.freeDeliveryOver)}` : ''}. ${o.deliveryAreaNote}`;
      renderProducts($('#products'));
      sampleNote();
    },
    menu() { renderProducts($('#products')); sampleNote(); },
    order() { orderPage(); },
    contact() { contactPage(); }
  };
  function sampleNote() {
    const el = $('#sample-note'); if (!el) return;
    el.classList.toggle('hidden', !items().some(i => i.samplePrice));
  }

  function karachiToday(offsetDays = 0) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offsetDays * 864e5));
  }

  function orderPage() {
    const o = CFG.ordering, max = o.maxQtyPerItem || 50;
    const preset = new URLSearchParams(location.search).get('add');
    const all = Object.fromEntries(items().filter(i => i.available).map(i => [i.id, i]));
    if (preset && all[preset] && !cart.qty(preset)) cart.change(preset, 1);
    const saved = cart.get();
    const row = i => `<div class="oi ${i.bestseller ? 'star' : ''} ${saved[i.id] ? '' : 'zero'}" data-id="${esc(i.id)}" data-price="${i.price}">
      ${imgTag(i)}
      <div class="info"><strong>${i.bestseller ? '★ ' : ''}${esc(i.name)}</strong><small>${money(i.price)} / ${esc(i.unit)}${i.samplePrice ? ' · sample price' : ''}</small></div>
      <div class="qty"><button type="button" data-d="-1" aria-label="Less">−</button>
      <input type="number" inputmode="numeric" min="0" max="${max}" value="${Math.min(max, saved[i.id] || 0)}" name="qty_${esc(i.id)}" aria-label="Quantity of ${esc(i.name)}">
      <button type="button" data-d="1" aria-label="More">+</button></div></div>`;
    $('#items').innerHTML = CFG.menu.map(c => { const av = c.items.filter(i => i.available); return av.length ? `<h3 class="oi-cat">${esc(c.category)}</h3>${av.map(row).join('')}` : ''; }).join('');
    if (Object.keys(saved).some(id => all[id])) {        // came from "+ Add": show the picked items first, the rest on demand
      $('#items').classList.add('collapsed');
      $('#items').insertAdjacentHTML('afterend', '<button type="button" class="btn ghost small" id="show-all" style="margin-top:12px;width:100%">+ Add more items</button>');
      $('#show-all').addEventListener('click', e => { $('#items').classList.remove('collapsed'); e.target.remove(); });
    }
    const form = $('#order-form');
    const date = form.elements.date;
    date.min = karachiToday(); date.max = karachiToday(o.maxDaysAhead || 30); date.value = karachiToday();
    form.elements.time.value = '19:00';
    $('#pay-note').textContent = o.paymentNote; $('#area-note').textContent = o.deliveryAreaNote;
    $('#min-note').textContent = o.minimumOrder ? `Minimum order ${money(o.minimumOrder)}.` : '';
    document.body.classList.add('has-bar');

    function calc() {
      let sub = 0, count = 0; const lines = [], cq = {};
      $$('.oi').forEach(r => {
        const inp = $('input', r); let q = parseInt(inp.value || '0', 10); if (isNaN(q) || q < 0) q = 0; if (q > max) q = max;
        if (q) { sub += q * +r.dataset.price; count += q; lines.push(`${q} × ${$('strong', r).textContent.replace('★ ', '')}`); }
        cq[r.dataset.id] = q;
      });
      const kept = cart.get(); for (const [id, q] of Object.entries(cq)) { if (q) kept[id] = q; else delete kept[id]; } cart.set(kept);
      const delivery = form.elements.fulfilment.value === 'delivery';
      const fee = delivery && sub > 0 ? (o.freeDeliveryOver && sub >= o.freeDeliveryOver ? 0 : o.deliveryFee || 0) : 0;
      $('#t-lines').innerHTML = lines.length ? lines.map(esc).join('<br>') : '<span style="color:var(--muted)">No items yet – tap + to add.</span>';
      $('#t-sub').textContent = money(sub); $('#t-fee').textContent = delivery ? money(fee) : 'Pickup – free';
      $('#t-total').textContent = money(sub + fee); $('#bar-total').textContent = money(sub + fee);
      $('#bar-count').textContent = `${count} item${count === 1 ? '' : 's'}`;
      $('#address-block').classList.toggle('hidden', !delivery);
      form.elements.address.required = delivery;
    }
    $('#items').addEventListener('click', e => {
      const b = e.target.closest('button[data-d]'); if (!b) return;
      const inp = $('input', b.parentElement); inp.value = Math.min(max, Math.max(0, (parseInt(inp.value, 10) || 0) + +b.dataset.d)); calc();
    });
    form.addEventListener('input', calc); form.addEventListener('change', calc); calc();
    if (preset) setTimeout(() => $(`.oi[data-id="${CSS.escape(preset)}"]`)?.scrollIntoView({ block: 'center' }), 50);

    form.addEventListener('submit', async e => {
      e.preventDefault();
      $$('.err', form).forEach(x => x.textContent = ''); $('#form-msg').innerHTML = '';
      const fd = new FormData(form); const body = { items: [] };
      for (const [k, v] of fd) { if (k.startsWith('qty_')) { if (+v > 0) body.items.push({ id: k.slice(4), qty: +v }); } else body[k] = v; }
      const btn = $('#submit-btn'); btn.disabled = true; btn.textContent = 'Placing order…';
      try {
        const r = await fetch('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json();
        if (!j.ok) {
          for (const [k, msg] of Object.entries(j.errors || {})) { const el = $(`#err-${k}`); if (el) el.textContent = msg; }
          $('#form-msg').innerHTML = `<div class="toast bad">Please check: ${Object.values(j.errors || {}).map(esc).join(' ')}</div>`;
          $('#form-msg').scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else showConfirmation(j.order);
      } catch { $('#form-msg').innerHTML = '<div class="toast bad">Network error – please try again or call us.</div>'; }
      btn.disabled = false; btn.textContent = 'Place order (cash on delivery)';
    });
  }
  function showConfirmation(x) {
    cart.clear();
    document.body.classList.remove('has-bar');
    $('#order-area').innerHTML = `<section class="card glow" style="max-width:720px;margin:0 auto">
      <h1 class="neon-pink">Shukriya! Order placed 🎉</h1>
      <p class="order-no">Order number: <strong>${esc(x.orderNumber)}</strong></p>
      <p>Please keep this number. ${x.fulfilment === 'delivery' ? `We'll deliver to <b>${esc(x.address)}</b>` : 'Pick up from our factory'} on <b>${esc(x.date)}</b> around <b>${esc(x.time)}</b>.</p>
      <table class="summary"><tbody>${x.items.map(l => `<tr><td>${l.qty} × ${esc(l.name)}</td><td>${money(l.lineTotal)}</td></tr>`).join('')}
      <tr><td>Subtotal</td><td>${money(x.subtotal)}</td></tr><tr><td>Delivery</td><td>${money(x.deliveryFee)}</td></tr>
      <tr class="total"><td>Total – pay cash on ${x.fulfilment === 'delivery' ? 'delivery' : 'pickup'}</td><td>${money(x.total)}</td></tr></tbody></table>
      <p>We'll call you on ${esc(x.phone)} to confirm. Questions? <a href="${telHref(CFG.contact.phone)}">${esc(CFG.contact.phone)}</a></p>
      <div class="cta-row"><a class="btn" href="/">Back to home</a><a class="btn ghost" href="/order.html">New order</a></div></section>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function contactPage() {
    const c = CFG.contact;
    $('#contact-info').innerHTML = `<li><span class="ic">📍</span><span>${esc(c.address)}</span></li>
      <li><span class="ic">📞</span><a href="${telHref(c.phone)}">${esc(c.phone)}</a></li>
      ${c.whatsapp ? `<li><span class="ic">💬</span><a href="${waHref(c.whatsapp)}" target="_blank" rel="noopener">WhatsApp ${esc(c.whatsapp)}</a></li>` : ''}
      <li><span class="ic">✉️</span><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>`;
    $('#hours').innerHTML = (c.hours || []).map(h => `<li><span>${esc(h.days)}</span><strong>${esc(h.time)}</strong></li>`).join('');
    if (c.mapUrl) $('#map').innerHTML = `<a class="btn ghost" href="${esc(c.mapUrl)}" target="_blank" rel="noopener">Open in Google Maps</a>`;
    const form = $('#contact-form');
    form.addEventListener('submit', async e => {
      e.preventDefault(); $$('.err', form).forEach(x => x.textContent = '');
      const body = Object.fromEntries(new FormData(form));
      const btn = $('button[type=submit]', form); btn.disabled = true;
      try {
        const r = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json();
        if (j.ok) { form.reset(); $('#contact-msg').innerHTML = '<div class="toast ok">Thanks! Your message was sent. We\'ll get back to you soon.</div>'; }
        else { for (const [k, m] of Object.entries(j.errors || {})) { const el = $(`#cerr-${k}`); if (el) el.textContent = m; } $('#contact-msg').innerHTML = '<div class="toast bad">Please fix the highlighted fields.</div>'; }
      } catch { $('#contact-msg').innerHTML = '<div class="toast bad">Network error – please try again.</div>'; }
      btn.disabled = false;
    });
  }

  fetch('/api/config', { cache: 'no-store' }).then(r => r.json()).then(cfg => {
    CFG = cfg; header(); (pages[page] || (() => {}))();
  }).catch(() => { document.body.insertAdjacentHTML('afterbegin', '<div class="toast bad">Could not load site data.</div>'); });
})();
