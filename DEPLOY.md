# Deploying Frenzy for free (Render + Neon)

Render's free web service has an **ephemeral disk**: anything written to local files is lost on every restart, redeploy or spin-down.
So in production all data lives in a free **Neon Postgres** database, reached through `DATABASE_URL`:

| Data | Local (no `DATABASE_URL`) | Production (`DATABASE_URL` set) |
|---|---|---|
| Site content (menu, prices, contact…) | `data/config.json` | table `site_config` (seeded once from `data/config.json`) |
| Config history (last 30) | `data/backups/` | table `config_backups` |
| Orders | `data/orders.json` | table `orders` |
| Contact messages | `data/messages.json` | table `messages` |
| Admin photo uploads | `public/images/uploads/` | table `uploads` (bytea + MIME type), served from `/uploads/<id>` |

Tables are created automatically at startup. The built-in photos in `public/images/` ship with the repo.

## 1. Create the database (Neon, free)
1. Sign up at https://neon.tech and create a project. Pick region **AWS Asia Pacific (Singapore)** to sit close to the Render region.
2. Copy the **connection string**. It looks like
   `postgresql://USER:PASSWORD@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
   TLS is always used for non-local hosts, so the URL works with or without `?sslmode=require`.

## 2. Push this repo to GitHub
```bash
gh auth login                      # once
gh repo create frenzy-icecream --private --source . --push
# or: git remote add origin git@github.com:<you>/frenzy-icecream.git && git push -u origin main
```

## 3. Create the Render service
- **Blueprint (uses `render.yaml`):** Render dashboard → New → Blueprint → pick the repo. Render asks for the `sync: false` values.
- **Or manually:** New → Web Service → the repo, Runtime **Node**, Instance type **Free**, Build `npm install`, Start `npm start`, Health check path `/healthz`.

Environment variables:

| Key | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string (secret) |
| `ADMIN_PASSWORD` | a long random password for `/admin` (secret) |
| `ADMIN_USER` | `admin` (optional, this is the default) |

Do **not** set `PORT` because Render provides it. The server binds `0.0.0.0:$PORT`.

## 4. Check it
- `https://<service>.onrender.com/healthz` returns `{"ok":true,"storage":"postgres"}`. Add `?db=1` to also ping the database.
- Open `/admin` and log in with `admin` / your `ADMIN_PASSWORD`.

## Free-tier notes
- A Render free service sleeps after about 15 minutes without traffic. The next visit wakes it in under a minute.
  Neon free compute also auto-suspends and resumes on the next query (a second or two).
  `/healthz` deliberately does not touch the database, so health checks don't keep Neon awake.
- Neon's free storage is small (0.5 GB at the time of writing). The admin resizes photos before uploading (≤1600 px), so this holds hundreds of photos.
- Back up now and then: download orders from the admin (Orders → download JSON), or run `pg_dump "$DATABASE_URL" > backup.sql`.
- Never commit `.env`. Keep secrets only in the Render dashboard.
