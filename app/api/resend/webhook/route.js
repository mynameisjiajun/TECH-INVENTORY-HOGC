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

    const event = JSON.parse(rawBody);
    const { type, data } = event;

    const to = data?.to?.[0] || data?.email_id || "unknown";
    const subject = data?.subject || "";
    const emailId = data?.email_id || "";

    switch (type) {
      case "email.sent":
        console.log(`[Resend] ✅ Sent — ${emailId} to ${to}`);
        break;

      case "email.delivered":
        console.log(`[Resend] 📬 Delivered — ${emailId} to ${to}`);
        break;

      case "email.delivery_delayed":
        console.warn(
          `[Resend] ⏳ Delayed — ${emailId} to ${to}. Reason: ${data?.reason || "unknown"}`,
        );
        break;

      case "email.bounced":
        console.error(
          `[Resend] ❌ Bounced — ${emailId} to ${to}. Type: ${data?.bounce?.type}, Sub: ${data?.bounce?.subtype}`,
        );
        // TODO: optionally mark the user's email as invalid in Supabase
        // await supabase.from('users').update({ email_invalid: true }).eq('email', to);
        break;

      case "email.complained":
        console.error(`[Resend] 🚫 Spam complaint — ${emailId} to ${to}`);
        break;

      case "email.opened":
        console.log(`[Resend] 👁 Opened — ${emailId} by ${to}`);
        break;

      case "email.clicked":
        console.log(
          `[Resend] 🖱 Clicked — ${emailId} by ${to}, link: ${data?.click?.link}`,
        );
        break;

      default:
        console.log(`[Resend] Unknown event: ${type}`, data);
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
