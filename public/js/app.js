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
      <button class="menu-toggle" aria-label="Open menu" aria-expanded="false">☰</button>
      <nav class="nav-links">${links.map(([h, t, k]) => `<a href="${h}" class="${k === page ? 'active' : ''}">${t}</a>`).join('')}
      <a class="btn small" href="/order.html">Order now</a></nav></div>`;
    const t = $('.menu-toggle'), n = $('.nav-links');
    t.addEventListener('click', () => { n.classList.toggle('open'); t.setAttribute('aria-expanded', n.classList.contains('open')); });
    const c = CFG.contact;
    $('#site-footer').innerHTML = `<div class="wrap"><div><strong class="neon-pink" style="font-size:1.3rem">${esc(CFG.brand.name)}</strong><br>${esc(c.address)}</div>
      <div>📞 <a href="${telHref(c.phone)}">${esc(c.phone)}</a><br>✉️ <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>
      <div>💵 ${esc(CFG.ordering.paymentNote)}<br><small>${esc(CFG.brand.imagesNote || '')}</small></div></div>`;
    if (c.whatsapp) document.body.insertAdjacentHTML('beforeend', `<a class="wa-float" href="${waHref(c.whatsapp)}" target="_blank" rel="noopener" aria-label="WhatsApp us">💬</a>`);
    document.title = `${document.title} · ${CFG.brand.name}`;
  }

  function featuredHTML() {
    const f = items().filter(i => i.bestseller);
    if (!f.length) return '';
    return f.map(i => `<article class="feat">
      <div class="ph"><img src="${esc(i.image || '/images/hero.jpg')}" alt="${esc(i.name)} ice cream" loading="lazy"></div>
      <span class="ribbon">★ Fan favourite</span>
      <div class="body"><h3 class="${f.indexOf(i) % 2 ? 'neon-cyan' : 'neon-pink'}">${esc(i.name)}</h3><p>${esc(i.description)}</p>
      <div class="price">${money(i.price)} <span class="unit">/ ${esc(i.unit)}</span>${sampleBadge(i)}</div>
      <div class="actions">${i.available ? `<a class="btn" href="/order.html?add=${encodeURIComponent(i.id)}">Order ${esc(i.name)}</a>` : '<span class="badge off">Sold out today</span>'}</div></div></article>`).join('');
  }
  function itemCard(i) {
    return `<article class="item ${i.available ? '' : 'unavailable'}">
      <div class="ph"><img src="${esc(i.image || '/images/hero.jpg')}" alt="${esc(i.name)}" loading="lazy"></div>
      <div class="body"><h4>${esc(i.name)} ${i.bestseller ? '<span class="badge hot">★</span>' : ''}</h4><p>${esc(i.description)}</p>
      <div class="row"><span><span class="price">${money(i.price)}</span> <span class="unit">/ ${esc(i.unit)}</span>${sampleBadge(i)}</span>
      ${i.available ? `<a class="btn small cyan" href="/order.html?add=${encodeURIComponent(i.id)}">+ Add</a>` : '<span class="badge off">Unavailable</span>'}</div></div></article>`;
  }

  // ---------- pages ----------
  const pages = {
    home() {
      const b = CFG.brand;
      $('#hero').innerHTML = `<img class="bg" src="${esc(b.heroImage || '/images/hero.jpg')}" alt="">
        <div class="content"><h1 class="neon-pink">${esc(b.name)}</h1>
        ${b.urduTagline ? `<div class="urdu">${esc(b.urduTagline)}</div>` : ''}
        <p class="tag">${esc(b.tagline)}</p>
        <div class="cta-row"><a class="btn big" href="/order.html">🍦 Order now</a><a class="btn big ghost" href="/menu.html">See the menu</a></div></div>`;
      $('#intro').textContent = b.intro;
      $('#featured').innerHTML = featuredHTML();
      const o = CFG.ordering;
      $('#delivery-info').textContent = `Delivery fee ${money(o.deliveryFee)}${o.freeDeliveryOver ? `, free over ${money(o.freeDeliveryOver)}` : ''}. ${o.deliveryAreaNote}`;
    },
    menu() {
      $('#featured').innerHTML = featuredHTML();
      $('#menu-list').innerHTML = CFG.menu.map(c => {
        const rest = c.items.filter(i => !i.bestseller);
        return rest.length ? `<h3 class="cat-title">${esc(c.category)}</h3><div class="grid">${rest.map(itemCard).join('')}</div>` : '';
      }).join('');
    },
    order() { orderPage(); },
    contact() { contactPage(); }
  };

  function karachiToday(offsetDays = 0) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offsetDays * 864e5));
  }

  function orderPage() {
    const o = CFG.ordering, max = o.maxQtyPerItem || 50;
    const preset = new URLSearchParams(location.search).get('add');
    const all = items().filter(i => i.available).sort((a, b) => (b.bestseller | 0) - (a.bestseller | 0));
    $('#items').innerHTML = all.map(i => `<div class="oi ${i.bestseller ? 'star' : ''}" data-id="${esc(i.id)}" data-price="${i.price}">
      <img src="${esc(i.image || '/images/hero.jpg')}" alt="">
      <div class="info"><strong>${i.bestseller ? '★ ' : ''}${esc(i.name)}</strong><small>${money(i.price)} / ${esc(i.unit)}${i.samplePrice ? ' · sample price' : ''}</small></div>
      <div class="qty"><button type="button" data-d="-1" aria-label="Less">−</button>
      <input type="number" inputmode="numeric" min="0" max="${max}" value="${i.id === preset ? 1 : 0}" name="qty_${esc(i.id)}" aria-label="Quantity of ${esc(i.name)}">
      <button type="button" data-d="1" aria-label="More">+</button></div></div>`).join('');
    const form = $('#order-form');
    const date = form.elements.date;
    date.min = karachiToday(); date.max = karachiToday(o.maxDaysAhead || 30); date.value = karachiToday();
    form.elements.time.value = '19:00';
    $('#pay-note').textContent = o.paymentNote; $('#area-note').textContent = o.deliveryAreaNote;
    $('#min-note').textContent = o.minimumOrder ? `Minimum order ${money(o.minimumOrder)}.` : '';
    document.body.classList.add('has-bar');

    function calc() {
      let sub = 0, count = 0; const lines = [];
      $$('.oi').forEach(r => {
        const inp = $('input', r); let q = parseInt(inp.value || '0', 10); if (isNaN(q) || q < 0) q = 0; if (q > max) q = max;
        if (q) { sub += q * +r.dataset.price; count += q; lines.push(`${q} × ${$('strong', r).textContent.replace('★ ', '')}`); }
      });
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
