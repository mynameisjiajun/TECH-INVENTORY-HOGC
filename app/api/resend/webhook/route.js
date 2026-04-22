import { NextResponse } from "next/server";

/**
 * Resend Webhook — receives delivery events for all outgoing emails.
 *
 * Events received:
 *   email.sent          — Resend accepted the email
 *   email.delivered     — Mail server confirmed delivery
 *   email.delivery_delayed — Temporary delay (greylisting, etc.)
 *   email.bounced       — Hard or soft bounce
 *   email.complained    — Recipient marked as spam
 *   email.opened        — Recipient opened (requires open tracking)
 *   email.clicked       — Recipient clicked a link (requires click tracking)
 *
 * Docs: https://resend.com/docs/dashboard/webhooks/introduction
 */

const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;

export async function POST(request) {
  try {
    if (!RESEND_WEBHOOK_SECRET) {
      console.error("RESEND_WEBHOOK_SECRET is not configured");
      return NextResponse.json(
        { error: "Server misconfiguration" },
        { status: 500 },
      );
    }

    // Verify the webhook came from Resend using their svix signature
    // Install: npm install svix
    const rawBody = await request.text();
    const svixId = request.headers.get("svix-id");
    const svixTimestamp = request.headers.get("svix-timestamp");
    const svixSignature = request.headers.get("svix-signature");

    try {
      const { Webhook } = await import("svix");
      const wh = new Webhook(RESEND_WEBHOOK_SECRET);
      wh.verify(rawBody, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
    } catch (verifyErr) {
      console.error(
        "Resend webhook signature verification failed:",
        verifyErr.message,
      );
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (!event?.type) {
      return NextResponse.json({ error: "Invalid event format" }, { status: 400 });
    }
    const { type, data } = event;

    const to = data?.to?.[0] || data?.email_id || "unknown";
    const subject = data?.subject || "";
    const emailId = data?.email_id || "";

    switch (type) {
      case "email.delivery_delayed":
        console.warn(`[Resend] Delayed — ${emailId} to ${to}. Reason: ${data?.reason || "unknown"}`);
        break;

      case "email.bounced":
        console.error(`[Resend] Bounced — ${emailId} to ${to}. Type: ${data?.bounce?.type}`);
        break;

      case "email.complained":
        console.error(`[Resend] Spam complaint — ${emailId} to ${to}`);
        break;

      default:
        break;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Resend webhook error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
