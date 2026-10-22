# Frenzy visual themes

Five looks share the same markup/JS: `neon` (the original, style.css only) plus four premium themes:

| # | name | file | fonts |
|---|------|------|-------|
| 1 | Noir & Gold | `public/css/themes/noir-gold.css` | Cormorant Garamond + Inter |
| 2 | Chocolate & Cream | `public/css/themes/chocolate-cream.css` | DM Serif Display + DM Sans |
| 3 | Ivory Parlour | `public/css/themes/ivory-parlour.css` | Playfair Display + Jost |
| 4 | Mango Sunset | `public/css/themes/mango-sunset.css` | Fraunces + Manrope |

Shared premium structure lives in `public/css/themes/base.css`; fonts are self-hosted woff2 (Latin subset, OFL) in `public/fonts/`.

## Preview
`/?theme=noir-gold` (or chocolate-cream, ivory-parlour, mango-sunset, neon). The choice sticks for that browser tab; `?theme=neon` goes back.

## Make one the default
* Without a code change: set env var `SITE_THEME=ivory-parlour` (etc.) on the host and restart; server.js injects it into every page.
* Or in code: change `var DEFAULT = 'noir-gold';` (current default) at the top of `public/js/theme.js`.

## Screenshots
Screenshot tooling (puppeteer) is kept out of this repo; see the frenzy-themes workspace.
