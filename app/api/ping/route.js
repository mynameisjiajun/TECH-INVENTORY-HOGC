import { getDb } from "@/lib/db/db";
import { NextResponse } from "next/server";

/**
 * Lightweight keep-warm endpoint.
 * Hit this every 5 minutes via cron-job.org (free) to prevent cold starts.
 *
 * Optional: set PING_SECRET in env vars and pass it as ?secret=xxx
 * to prevent random public hits from triggering a full DB init.
 */
export async function GET(request) {
  const secret = process.env.PING_SECRET;
  if (secret) {
    const { searchParams } = new URL(request.url);
    if (searchParams.get("secret") !== secret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const start = Date.now();

  // Touch the DB so the SQLite connection is open and schema is initialized.
  // This is the most expensive part of a cold start — do it here so real
  // user requests don't pay the penalty.
  try {
    const db = getDb();
    const { count } = db
      .prepare("SELECT COUNT(*) as count FROM storage_items")
      .get();
    const ms = Date.now() - start;
    return NextResponse.json({ ok: true, items: count, ms });
  } catch (err) {
    // Don't expose internals — just signal the instance is alive
    return NextResponse.json({ ok: true, ms: Date.now() - start });
  }
}
