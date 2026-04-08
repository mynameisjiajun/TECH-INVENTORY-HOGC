import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/utils/auth";
import {
  DEFAULT_OUTBOX_FLUSH_LIMIT,
  drainSheetWriteOutbox,
  getSheetWriteOutboxPendingCount,
} from "@/lib/services/inventorySheetSync";

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

function getCronSecretFromRequest(request) {
  const headerSecret = request.headers.get("x-cron-secret");
  if (headerSecret) {
    return headerSecret;
  }

  const authorization = request.headers.get("authorization") || "";
  if (authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return "";
}

function hasValidCronSecret(request) {
  if (!CRON_SECRET) {
    return false;
  }

  const secret = getCronSecretFromRequest(request);
  return !!secret && secret === CRON_SECRET;
}

async function authorizeManualDrain(request) {
  if (hasValidCronSecret(request)) {
    return { ok: true, source: "cron" };
  }

  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return { ok: false };
  }

  return { ok: true, source: "admin", user };
}

async function runDrain({ batchSize, maxBatches }) {
  const pendingBefore = await getSheetWriteOutboxPendingCount();
  const drainResult = await drainSheetWriteOutbox({ batchSize, maxBatches });
  const pendingAfter = await getSheetWriteOutboxPendingCount();

  return {
    ok: true,
    batchSize,
    maxBatches,
    pendingBefore,
    pendingAfter,
    ...drainResult,
  };
}

export async function GET(request) {
  if (!CRON_SECRET) {
    console.error("CRON_SECRET is not configured");
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 },
    );
  }

  if (!hasValidCronSecret(request)) {
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

  try {
    const result = await runDrain({ batchSize, maxBatches });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Sheet outbox drain failed:", error);
    return NextResponse.json(
      { error: error.message || "Drain failed" },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  const authorization = await authorizeManualDrain(request);
  if (!authorization.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const batchSize = parseBoundedInt(
    body.batchSize,
    DEFAULT_OUTBOX_FLUSH_LIMIT,
    MAX_BATCH_SIZE,
  );
  const maxBatches = parseBoundedInt(
    body.maxBatches,
    DEFAULT_MAX_BATCHES,
    MAX_BATCHES,
  );

  try {
    const result = await runDrain({ batchSize, maxBatches });
    return NextResponse.json({
      triggeredBy: authorization.source,
      ...result,
    });
  } catch (error) {
    console.error("Sheet outbox drain failed:", error);
    return NextResponse.json(
      { error: error.message || "Drain failed" },
      { status: 500 },
    );
  }
}
