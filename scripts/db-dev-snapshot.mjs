#!/usr/bin/env node
/**
 * scripts/db-dev-snapshot.mjs
 *
 * Copies a snapshot of production Supabase data into the configured dev Supabase
 * project. Refuses to run unless the destination is explicitly tagged as dev.
 *
 * Usage:
 *   PROD_SUPABASE_URL=https://<prod>.supabase.co \
 *   PROD_SUPABASE_SERVICE_ROLE_KEY=<prod-service-key> \
 *   npm run db:dev:snapshot
 *
 * The destination credentials come from .env.local (which must already contain
 * dev creds + SUPABASE_ENVIRONMENT=dev). The source credentials are passed at
 * the shell so they are never persisted to a file.
 *
 * For a full schema-and-data clone use `supabase db dump` + `psql` instead;
 * see CLAUDE.md → "Dev environment isolation".
 */
import { createClient } from "@supabase/supabase-js";

// Order respects foreign keys (parents before children).
const TABLES_IN_ORDER = [
  "app_settings",
  "users",
  "templates",
  "laptops",
  "laptop_tiers",
  "loan_requests",
  "laptop_loans",
  "notifications",
  "telegram_chat_ids",
  "audit_log",
  "guest_borrow_requests",
  "sheet_write_outbox",
];

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const srcUrl = process.env.PROD_SUPABASE_URL;
const srcKey = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY;
const dstUrl = process.env.SUPABASE_URL;
const dstKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dstEnv = process.env.SUPABASE_ENVIRONMENT;

if (!srcUrl || !srcKey) {
  fail(
    "Source missing. Set PROD_SUPABASE_URL and PROD_SUPABASE_SERVICE_ROLE_KEY when invoking the script.",
  );
}
if (!dstUrl || !dstKey) {
  fail(
    "Destination missing. Run with `npm run db:dev:snapshot` so .env.local is loaded, " +
      "or pass --env-file=.env.local to node.",
  );
}
if (dstEnv !== "dev") {
  fail(
    `Destination SUPABASE_ENVIRONMENT must be "dev"; got ${
      dstEnv ? `"${dstEnv}"` : "(unset)"
    }. ` +
      "Refusing to write — that would defeat the dev/prod isolation. See CLAUDE.md.",
  );
}
if (srcUrl === dstUrl) {
  fail("Source and destination Supabase URLs are identical — refusing to copy onto itself.");
}

const src = createClient(srcUrl, srcKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const dst = createClient(dstUrl, dstKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log(`Source:      ${srcUrl}`);
console.log(`Destination: ${dstUrl}`);
console.log(`Tables:      ${TABLES_IN_ORDER.join(", ")}`);
console.log("");

async function fetchAll(client, table) {
  const PAGE = 1000;
  const out = [];
  let from = 0;
  while (true) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function wipe(client, table) {
  // Supabase JS requires a filter on delete; use a tautology against id, fall
  // back to created_at for tables without an integer id.
  let { error } = await client.from(table).delete().not("id", "is", null);
  if (error && /column .* does not exist/i.test(error.message)) {
    ({ error } = await client.from(table).delete().not("created_at", "is", null));
  }
  if (error) throw error;
}

async function insertAll(client, table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await client.from(table).insert(chunk);
    if (error) throw error;
  }
}

let totalCopied = 0;
let skipped = 0;

for (const table of TABLES_IN_ORDER) {
  process.stdout.write(`→ ${table.padEnd(24)} `);
  try {
    const rows = await fetchAll(src, table);
    await wipe(dst, table);
    await insertAll(dst, table, rows);
    console.log(`copied ${rows.length} row(s)`);
    totalCopied += rows.length;
  } catch (err) {
    skipped += 1;
    console.log(`SKIP (${err.message ?? err})`);
  }
}

console.log("");
console.log(`✓ Snapshot complete. ${totalCopied} row(s) copied, ${skipped} table(s) skipped.`);
console.log("");
console.log(
  "If your dev project uses serial id sequences, update them so new rows don't collide.",
);
console.log("Run this in the Supabase SQL editor of the DEV project:");
console.log(
  "  SELECT setval(pg_get_serial_sequence(table_name, 'id'), COALESCE(MAX(id), 1))",
);
console.log("  FROM (");
console.log("    SELECT 'users' AS table_name UNION ALL SELECT 'loan_requests'");
console.log("    UNION ALL SELECT 'laptop_loans' UNION ALL SELECT 'laptops'");
console.log("    UNION ALL SELECT 'notifications' UNION ALL SELECT 'audit_log'");
console.log("    UNION ALL SELECT 'guest_borrow_requests'");
console.log("  ) t,");
console.log("  LATERAL (SELECT MAX(id) AS id FROM users) m;  -- adjust per table");
