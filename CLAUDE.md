# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start Next.js dev server (Next 16 uses turbopack by default — no `--turbopack` flag is passed) |
| `npm run build` | Production build (`output: "standalone"`) |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint (Next.js core-web-vitals config, flat-config `eslint.config.mjs`) |
| `npm run telegram:commands` | Push bot command list to Telegram |
| `npm run telegram:webhook:setup` / `:check` | Configure / inspect Telegram webhook |

There is no longer a `seed` script — inventory seeding happens automatically on cold start via `lib/db/db.js::autoSyncFromSheets` (see Architecture below). The README still mentions `npm run seed`; it's stale.

### Running a single test

Tests are a small, mixed set — there is no global runner. Invoke directly:

- Node's built-in runner (`*.test.mjs`):
  `node --test lib/services/inventorySheetSyncCore.test.mjs`
- Vitest-style (`lib/utils/auth.test.js`) imports from `vitest`, but **vitest is not in `package.json`** — if touching this file, either add vitest or migrate it to `node:test` to match the rest.

## Architecture

### Hybrid two-database split (important!)

The system deliberately splits storage between SQLite and Supabase. Do not "consolidate" them without understanding why:

- **SQLite (`better-sqlite3`, via `lib/db/db.js`)** — **inventory only**: `storage_items` and `deployed_items`. On Vercel the DB lives in `/tmp` and is ephemeral; locally it persists at `data/inventory.db` (override with `DATABASE_DIR`). The schema is created on first `getDb()` call. `next.config.mjs` lists `better-sqlite3` in `serverExternalPackages` — needed so its native binding isn't bundled; don't remove it.
- **Supabase (Postgres, via `lib/db/supabase.js`)** — everything persistent: users, loan requests, laptop loans, templates, notifications, audit log, app settings, guest borrow requests, telegram chat IDs, sheet-write outbox.
- **Google Sheets is the source of truth for inventory.** `Storage Spare` and `DEPLOYED` tabs are read on cold start; stock (column G) is written back when loans change.

Cold-start flow in `lib/db/db.js`:
1. `getDb()` opens SQLite and creates schema.
2. If `storage_items` is empty, `_needsSync` is set.
3. `waitForSync()` / `startSyncIfNeeded()` triggers `autoSyncFromSheets()` — reads both sheets, upserts into SQLite, then **replays approved loan deductions from Supabase** so `current` stock is always `quantity_spare − sum(approved loan quantities)`. This self-healing replay is why the Sheets write-back failing mid-flight doesn't leave stock wrong forever.

Any API route that reads inventory must `await waitForSync()` before querying SQLite.

### Sheet write-back with durable retries

Writes back to Google Sheets go through `lib/services/inventorySheetSync.js`. If the Sheets call fails, rows are queued in the Supabase `sheet_write_outbox` table and flushed by `app/api/cron/sheet-write-outbox` on the next cron tick. Don't write directly to Sheets from route handlers — always go through this module.

### Google Apps Script webhook

Edits made directly in the Google Sheet flow back via a Google Apps Script → `POST /api/items/webhook`, so the source-of-truth direction is bidirectional. The webhook updates SQLite and may reallocate loans.

### Next.js App Router layout

- `app/(auth)/` — unauthenticated pages: `login`, `register`, `reset-password`, `guest-request`.
- `app/(main)/` — authenticated pages: `home`, `dashboard`, `inventory`, `loans`, `admin`, `profile`, `guest-return`.
- `app/api/` — route handlers. Two separate loan systems live side-by-side: `/api/loans/*` (tech inventory) and `/api/laptop-loans/*` (laptop fleet with tiers at `/api/laptops/tiers`). They do not share schemas — check which one you're working in.
- `middleware.js` at the repo root guards `/admin`, `/profile`, etc., redirects authed users away from `/login`/`/register`, and redirects `/inventory` → `/home` (the inventory UI lives inside `/home`). The exported function is still named `proxy` for historical reasons — that name is cosmetic. Update its `matcher` when adding new protected routes.
- Path alias: `@/*` → repo root (see `jsconfig.json`).
- Shared client state lives in `lib/context/` — `AuthContext`, `CartContext`, `ToastContext`. Use these providers rather than threading props or creating parallel ones.

### Auth

- JWT signed with `JWT_SECRET`, stored in an httpOnly cookie (`COOKIE_NAME` in `lib/utils/jwt.js`).
- `getCurrentUser()` in `lib/utils/auth.js` re-fetches role/display_name/ministry/profile_emoji from Supabase, but the lookup is cached per warm instance for 30s via `lib/utils/cache.js`. Mutations that change these fields **must** call `invalidateAll()` (or a more targeted `invalidate("auth:user:<id>")`) afterwards, otherwise stale role/ministry data lingers for up to 30s.
- Password reset tokens are signed with `JWT_SECRET + last 10 chars of the user's password hash`, so they self-invalidate once the password changes.
- Guest flow lets unauthenticated users submit `/api/guest/requests` — separate code path, separate table (`guest_borrow_requests`).

### Integrations

- **Google Sheets** — `lib/services/sheets.js` (singleton googleapis client).
- **Email** — Resend, via `lib/services/email.js`.
- **Telegram** — `lib/services/telegram.js`; webhook handler at `app/api/telegram/webhook`.
- **Cron** — `vercel.json` schedules `/api/cron/maintenance` daily at 01:00 UTC. Other cron endpoints (`reminders`, `sheet-write-outbox`) are triggered manually or by outside callers; protect them with `lib/utils/cronAuth.js`.

### Tech loan auto-approval

`lib/services/techLoanAutoApproval.js` can auto-approve loans matching certain criteria when the `auto_approve_tech_loans` app setting is on. Auto-approved loans get `admin_notes = AUTO_APPROVE_ADMIN_NOTE` (from `lib/constants.js`) — grep for that constant when tracing auto-approval behavior.

### PWA

`app/layout.js` registers `/sw.js` in production and aggressively *unregisters* it in dev (plus clears any `tech-inventory*` caches) to avoid stale-SW issues during development. If weird caching shows up in dev, that's the first place to look.

### Dev environment isolation

The dev environment is **hard-isolated** from production: dev work must never read or write the production Supabase. The contract is enforced at Supabase client init in `lib/db/supabase.js` via a `SUPABASE_ENVIRONMENT` handshake:

- Production deploy (Vercel): `NODE_ENV=production` requires `SUPABASE_ENVIRONMENT=production`.
- Local dev: `NODE_ENV=development` requires `SUPABASE_ENVIRONMENT=dev`.

If the values disagree, `lib/db/supabase.js` throws at module load and *every* route that touches Supabase 500s — by design. There is no "soft warn" mode.

#### One-time dev setup

1. **Provision a dev Supabase.** Either a separate cloud project (Supabase free tier) or a local instance via `supabase start` from the [Supabase CLI](https://supabase.com/docs/guides/cli).
2. **Apply schema.** Run all `supabase/migrations/*.sql` against the dev DB in timestamp order. The simplest path is `supabase db push` if you've linked the dev project, or paste each migration into the SQL editor.
3. **Point `.env.local` at the dev DB.** Replace `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` with the dev project's values. Add `SUPABASE_ENVIRONMENT=dev`.
4. *(Optional, for troubleshooting with realistic data)* **Snapshot prod data into dev:**
   ```bash
   PROD_SUPABASE_URL=https://<prod>.supabase.co \
   PROD_SUPABASE_SERVICE_ROLE_KEY=<prod-service-key> \
     npm run db:dev:snapshot
   ```
   `scripts/db-dev-snapshot.mjs` copies a fixed list of tables (users, app_settings, loans, notifications, etc.) from prod to dev. It refuses to run unless the destination has `SUPABASE_ENVIRONMENT=dev` and the source URL differs from the destination. Source creds are passed at the shell so they aren't persisted to disk. For a full schema-and-data clone use `supabase db dump` from prod and `psql` into dev.

After step 5, restart `npm run dev` — Supabase will initialize successfully and reads/writes go to the dev DB only.

### Dev login bypass

Once the dev environment is isolated and `SUPABASE_ENVIRONMENT=dev` is set, add `NEXT_PUBLIC_DEV_BYPASS=1` to `.env.local` to surface the floating `DevSwitcher` widget (`components/DevSwitcher.js`, mounted in `app/layout.js`). Pick any user in the dev Supabase and impersonate them in one click; the widget posts to `/api/dev/login`, which mints a real JWT via the same `createToken` + `getTokenCookieOptions` helpers used by `/api/auth`, so every server handler behaves identically to a real login (including the 30s `getCurrentUser` cache, which is invalidated for the switched user).

A canonical seed set lives in `lib/devSeedUsers.js` (`dev-admin`, `dev-tech`, `dev-user`, `dev-vp`, `dev-projection`) and is idempotently inserted on the first dev API hit, so a freshly migrated dev DB still has something to log in as. They share the password `devpass123`, so they work through the real `/login` form too.

Safety layers (in order):
1. `/api/dev/*` returns 404 when `NODE_ENV === "production"`.
2. The same routes return 503 when `SUPABASE_ENVIRONMENT !== "dev"` — no Supabase calls happen.
3. `lib/devSeedUsers.js` throws at import time unless both gates pass.
4. `lib/db/supabase.js` refuses to instantiate the client at all when `SUPABASE_ENVIRONMENT` doesn't match `NODE_ENV`.
5. `app/layout.js` doesn't mount `DevSwitcher` in production builds.

### Security headers / CSP

`next.config.mjs` applies strict security headers to *all* routes: CSP, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and `Strict-Transport-Security` (HSTS with `preload`). `poweredByHeader` is also disabled. The CSP allows `'unsafe-inline'`/`'unsafe-eval'` for scripts and Google Fonts for styles — anything else (new third-party scripts, fonts, image hosts, websocket origins beyond `wss:`) needs the CSP updated here, otherwise the browser silently blocks it. Recent commit `6f0aa09` fixed a CSP regression — verify in DevTools when adding external assets.

## Environment variables

Required (checked at runtime, see `.env.local.example` pattern in README):
- `JWT_SECRET`, `INVITE_CODE`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEETS_ID`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ENVIRONMENT` — must be `production` in Vercel, `dev` in `.env.local`. Mismatch causes `lib/db/supabase.js` to throw at startup. See "Dev environment isolation".
- Optional: `ADMIN_USERNAME`/`ADMIN_PASSWORD`/`ADMIN_DISPLAY_NAME` (admin auto-created on first request), Resend + Telegram creds, `DATABASE_DIR` for self-hosted SQLite location, `NEXT_PUBLIC_DEV_BYPASS=1` to surface the dev login switcher (only effective in dev).

## Supabase migrations

Schema lives in `supabase/migrations/*.sql` (timestamp-prefixed). Apply in order via the Supabase CLI / dashboard. The foundational migration (`20260407_robust_schema_foundation.sql`) contains data-validation guards that abort if existing rows violate the tightened constraints — fix the data before re-running, don't weaken the guard.
