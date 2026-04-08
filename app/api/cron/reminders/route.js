import { runReminderJobs } from "@/lib/services/reminders";
import { getCronSecretFromRequest } from "@/lib/utils/cronAuth";
import { NextResponse } from "next/server";

const CRON_SECRET = process.env.CRON_SECRET?.trim();

/**
 * GET /api/cron/reminders
 * Called by cron-job.org (or any scheduler) once per day.
 * Sends overdue and due-soon reminders via email + Telegram.
 * Protected by CRON_SECRET header.
 */
export async function GET(request) {
  if (!CRON_SECRET) {
    console.error("CRON_SECRET is not configured");
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 },
    );
  }

  const secret = getCronSecretFromRequest(request);
  if (!secret || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runReminderJobs();
  return NextResponse.json(result);
}
