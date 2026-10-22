/* Frenzy theme switcher.
   Order of precedence: ?theme=<name> in the URL  >  theme picked earlier in this browser tab  >  site default.
   Site default = SITE_THEME env var on the server (injected as <html data-default-theme>), else DEFAULT below.
   "neon" = the original black/pink/cyan look (style.css only, no extra theme file). */
(function () {
  var DEFAULT = 'noir-gold';
  var THEMES = { 'noir-gold': '#0b0a09', 'chocolate-cream': '#1e1310', 'ivory-parlour': '#f8f3ea', 'mango-sunset': '#120c13', neon: '#07070b' };
  var d = document.documentElement, t;
  try {
    var q = new URLSearchParams(location.search).get('theme');
    if (q && THEMES[q]) sessionStorage.setItem('frenzy-theme', q);
    t = q || sessionStorage.getItem('frenzy-theme');
  } catch (e) {}
  if (!t || !THEMES[t]) t = d.getAttribute('data-default-theme') || DEFAULT;
  if (!THEMES[t]) t = 'neon';
  d.setAttribute('data-theme', t);
  var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', THEMES[t]);
  if (t !== 'neon') document.write('<link rel="stylesheet" href="/css/themes/base.css"><link rel="stylesheet" href="/css/themes/' + t + '.css">');
})();
