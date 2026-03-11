# Tech Inventory - HOGC

Equipment inventory and loan management system for church tech ministry.

## Features

- Browse inventory across Storage Spare, Deployed, and summary tabs
- Request temporary or permanent equipment loans via a cart system
- Admin panel for loan approvals, user management, and audit logging
- Two-way Google Sheets sync (reads from and writes back to Sheets)
- Permanent loans auto-deploy items to the Deployed tab + Google Sheets
- Real-time notifications for loan status updates and overdue warnings
- PWA support with offline fallback
- Role-based access control (admin / user) with invite code registration

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19
- **Database**: SQLite via better-sqlite3
- **Auth**: JWT with httpOnly cookies
- **Sheets**: Google Sheets API via googleapis
- **Styling**: Custom CSS (dark theme)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env.local` with your credentials:
   ```
   JWT_SECRET=<random-64-char-hex>
   INVITE_CODE=<registration-invite-code>
   GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account-email>
   GOOGLE_PRIVATE_KEY="<service-account-private-key>"
   GOOGLE_SHEETS_ID=<spreadsheet-id>
   ```

3. Seed the database from Google Sheets:
   ```bash
   npm run seed
   ```

4. Start the dev server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) and log in with the seeded admin account.

## Deploy on Vercel

1. Push this repo to GitHub.
2. Import the repo at [vercel.com/new](https://vercel.com/new).
3. Add these **Environment Variables** in the Vercel dashboard:
   - `JWT_SECRET` — a random 64-char hex string
   - `INVITE_CODE` — registration invite code
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` — service account email
   - `GOOGLE_PRIVATE_KEY` — the full PEM private key (include `-----BEGIN...` and `-----END...`)
   - `GOOGLE_SHEETS_ID` — the spreadsheet ID from the Google Sheets URL
   - `ADMIN_USERNAME` — admin login username (default: `admin`)
   - `ADMIN_PASSWORD` — admin login password (default: `admin123`)
   - `ADMIN_DISPLAY_NAME` — admin display name (default: `Admin`)
4. Deploy. The admin account is auto-created on first request.
5. Log in and click **Refresh** on the Inventory page to sync data from Google Sheets.

> **Note:** On Vercel, the SQLite database lives in `/tmp` and is ephemeral. Data persists as long as the serverless function stays warm (~15 min of inactivity). Inventory data is always recoverable via the Refresh button (syncs from Google Sheets). For fully persistent storage, consider migrating to [Turso](https://turso.tech) (hosted SQLite).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run seed` | Seed database from Google Sheets (local dev) |
