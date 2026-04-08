import { NextResponse } from "next/server";
import {
  DEFAULT_OUTBOX_FLUSH_LIMIT,
  drainSheetWriteOutbox,
  getSheetWriteOutboxPendingCount,
} from "@/lib/services/inventorySheetSync";
import { runReminderJobs } from "@/lib/services/reminders";
import { getCronSecretFromRequest } from "@/lib/utils/cronAuth";

const CRON_SECRET = process.env.CRON_SECRET?.trim();
const DEFAULT_MAX_BATCHES = 10;
const MAX_BATCH_SIZE = 500;
const MAX_BATCHES = 50;

function parseBoundedInt(value, fallback, max) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, max);
}

async function runMaintenance({ batchSize, maxBatches }) {
  const result = {
    ok: true,
    sheetWriteOutbox: null,
    reminders: null,
  };

  try {
    const pendingBefore = await getSheetWriteOutboxPendingCount();
    const drainResult = await drainSheetWriteOutbox({ batchSize, maxBatches });
    const pendingAfter = await getSheetWriteOutboxPendingCount();
    result.sheetWriteOutbox = {
      batchSize,
      maxBatches,
      pendingBefore,
      pendingAfter,
      ...drainResult,
    };
  } catch (error) {
    result.ok = false;
    result.sheetWriteOutbox = {
      error: error.message || "Sheet outbox drain failed",
    };
  }

  try {
    result.reminders = await runReminderJobs();
  } catch (error) {
    result.ok = false;
    result.reminders = {
      error: error.message || "Reminder job failed",
    };
  }

  return result;
}

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

  const { searchParams } = new URL(request.url);
  const batchSize = parseBoundedInt(
    searchParams.get("batchSize"),
    DEFAULT_OUTBOX_FLUSH_LIMIT,
    MAX_BATCH_SIZE,
  );
  const maxBatches = parseBoundedInt(
    searchParams.get("maxBatches"),
    DEFAULT_MAX_BATCHES,
    MAX_BATCHES,
  );

  const result = await runMaintenance({ batchSize, maxBatches });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
