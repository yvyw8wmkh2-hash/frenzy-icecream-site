# Frenzy: ice cream website (Lahore)

A small, working website: **Home, Menu, Order (cash on delivery), Contact** and a password-protected **Admin / content manager**.
Plain HTML/CSS/JS front-end + a small Node.js server (`server.js`, Node 20+; 22 on Render). No build step. The only dependency is `pg`, used when `DATABASE_URL` is set.

**Deploying for free on Render + Neon: see [DEPLOY.md](DEPLOY.md).**

## Run / restart
```bash
cd /workspace/icecream-site
npm install         # once (installs pg)
./start.sh          # (re)starts the server in the background with nohup → http://localhost:8080 (bound to 0.0.0.0)
tail -f logs/server.log
./tunnel.sh         # optional: temporary public https URL via Cloudflare quick tunnel (needs outbound port 7844)
```
Settings come from environment variables or the `.env` file (see `.env.example`): `PORT` (8080), `HOST` (0.0.0.0), `ADMIN_USER` (admin), `ADMIN_PASSWORD`, `DATABASE_URL` (optional).
Health check: `GET /healthz` (add `?db=1` to also ping the database). Tests: `npm test` (file mode) or `DATABASE_URL=... npm test` (Postgres mode); the test cleans up after itself.

## Storage modes
- **`DATABASE_URL` unset (local):** files. Config in `data/config.json`, orders in `data/orders.json`, messages in `data/messages.json`, uploads in `public/images/uploads/`.
- **`DATABASE_URL` set (production):** Postgres. Tables `site_config`, `config_backups`, `orders`, `messages` and `uploads` are created automatically at startup. On first boot the config is seeded from `data/config.json`. Uploaded photos are stored in the database (bytea + MIME type) and served from `/uploads/<id>`. After the first boot, edit content in `/admin`; changes to `data/config.json` no longer apply.

## Admin / content manager: `/admin`
- Log in with user **admin** and the password from `ADMIN_PASSWORD`.
  - On this box a random password is stored in **`.env`** (`ADMIN_PASSWORD=…`, file mode 600).
  - If neither `.env` nor the env var is set, the built-in default is **`change-me-icecream`**. Change it before going live.
- Tabs:
  - **Orders**: every order with customer, phone (tap to call), address, items and total. Set the status (new → confirmed → out-for-delivery → completed / cancelled), delete orders, download all as JSON.
  - **Messages**: contact-form messages. Mark them read or unread, or delete them.
  - **Flavours & prices**: add, edit or remove flavours and categories: name, description, price (Rs), unit, ★ Featured (the big "Fan favourite" card), Available, Sample price badge. Reorder with ↑/↓, use **Change photo** to upload a picture (it is resized automatically), then press **Save changes**.
  - **Business info**: name, tagline, Urdu tagline, intro, phone, WhatsApp, email, address, Google Maps link, opening hours, delivery fee, free-delivery threshold, minimum order and payment note.
  - **Home photo**: upload or replace the big hero picture.
- Changes are saved (to `data/config.json`, or to Postgres in production) and show up on the site straight away (no restart; in Postgres mode within 30 s at most). The previous 30 versions are kept (`data/backups/` or the `config_backups` table).

## Editing data by hand (optional)
Everything public lives in **`data/config.json`** (brand, contact, hours, ordering rules, menu). Edit it, save it, and refresh the page.
Item fields: `id` (unique, used in orders), `name`, `description`, `unit`, `price`, `available`, `bestseller`, `samplePrice`, `image`.

**Placeholders to replace:** address, phone/WhatsApp `+92 300 0000000`, email `orders@example.com`, opening hours and all prices
(currently **sample prices**; Chocolate Rs 300 and Mango Rs 320 are featured). Every photo is AI-generated; swap them for real photos in the admin.

## Data files (file mode)
- `data/orders.json`: orders (order number format `FRZ-YYYYMMDD-NNN`, Karachi date)
- `data/messages.json`: contact messages
- `public/images/` holds the photos; admin uploads go to `public/images/uploads/`
Back up the `data/` folder and `public/images/uploads/` regularly.

## How ordering works
The customer picks quantities (from the menu data), chooses delivery (Lahore address) or pickup, a date and time, and adds notes.
The server re-validates everything (Pakistani phone number, date not in the past, items exist and are available, quantity limits, minimum order),
**recalculates the total server-side** (delivery fee and free-delivery threshold), saves the order and returns an order number.
Payment is **cash on delivery or pickup only**. There is no online payment.

## Permanent hosting
This box and the temporary tunnel URL are not permanent. To go live:
- **Free option (ready to use): Render free web service + Neon free Postgres.** Follow [DEPLOY.md](DEPLOY.md).
- Or a small VPS (`npm start` behind HTTPS) with `data/` on a persistent disk.
- Static-only hosts like **Netlify** or GitHub Pages can serve the pages, but orders and the admin need a backend (or a form service).
- Buy a domain (e.g. `frenzy.pk` via PKNIC or any registrar) and point it at the host. Set a strong `ADMIN_PASSWORD`.
- Optional extras: order notifications by email or WhatsApp, and a real Google Maps embed.

## Files
```
server.js            Node server (static files, order/contact API, admin API, /healthz, /uploads/:id)
store.js             storage layer: JSON files (local) or Postgres (when DATABASE_URL is set)
render.yaml          Render Blueprint (free web service)
test/smoke.js        end-to-end test (npm test)
start.sh / tunnel.sh restart server / start a public tunnel
data/config.json     ← all editable content (or use /admin)
public/              index.html, menu.html, order.html, contact.html, css/, js/app.js, images/
admin/               admin UI (served only after login)
screenshots/         PNG screenshots
```
