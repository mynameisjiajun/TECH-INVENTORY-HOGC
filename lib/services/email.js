import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;
const FROM_EMAIL =
  process.env.EMAIL_FROM || "Tech Inventory <noreply@resend.dev>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Escape user-supplied values before inserting into HTML
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function itemList(items) {
  return items.map((i) => `<li>${esc(i.item)} × ${esc(i.quantity)}</li>`).join("");
}

// Shared email wrapper — one place to update the design
function layout(accentColor, headline, body) {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1f2937;">
      <div style="background:#1e1b4b;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
        <h1 style="color:#818cf8;margin:0;font-size:22px;">Tech Inventory</h1>
      </div>
      <div style="background:#f9fafb;padding:28px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;">
        <p style="color:${accentColor};font-weight:700;font-size:18px;margin-top:0;">${headline}</p>
        ${body}
      </div>
    </div>`;
}

function btn(href, label) {
  return `<a href="${esc(href)}" style="display:inline-block;background:#6366f1;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px;">${label}</a>`;
}

function itemsBox(items) {
  return `
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0;">
      <p style="font-weight:600;margin:0 0 8px 0;">Items:</p>
      <ul style="margin:0;padding-left:20px;">${itemList(items)}</ul>
    </div>`;
}

async function send(to, subject, html) {
  if (!resend || !to) return;
  try {
    const { error } = await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
    if (error) console.error("Resend error:", error);
  } catch (err) {
    console.error("Failed to send email:", err.message);
  }
}

async function sendBatch(messages) {
  if (!resend || !messages.length) return;
  try {
    const { error } = await resend.batch.send(
      messages.map((m) => ({ from: FROM_EMAIL, ...m }))
    );
    if (error) console.error("Resend batch error:", error);
  } catch (err) {
    console.error("Failed to send batch email:", err.message);
  }
}

// ── Public API ───────────────────────────────────────────────────

export async function sendOverdueEmail({ to, displayName, loanId, items, endDate }) {
  await send(
    to,
    `🚨 Overdue Loan #${loanId} — Please Return Items`,
    layout("#ef4444", "🚨 Your loan is overdue!", `
      <p>Hi <strong>${esc(displayName)}</strong>,</p>
      <p>Loan <strong>#${loanId}</strong> was due on <strong>${esc(endDate)}</strong> and has not yet been returned.</p>
      ${itemsBox(items)}
      <p>Please return the items as soon as possible or contact an admin.</p>
      ${btn(`${APP_URL}/loans`, "View My Loans")}
    `)
  );
}

export async function sendDueSoonEmail({ to, displayName, loanId, items, endDate }) {
  await send(
    to,
    `⏰ Loan #${loanId} is due tomorrow`,
    layout("#f59e0b", "⏰ Return reminder", `
      <p>Hi <strong>${esc(displayName)}</strong>,</p>
      <p>Loan <strong>#${loanId}</strong> is due tomorrow on <strong>${esc(endDate)}</strong>.</p>
      ${itemsBox(items)}
      <p>Please prepare to return these items. Contact an admin if you need an extension.</p>
      ${btn(`${APP_URL}/loans`, "View My Loans")}
    `)
  );
}

export async function sendPasswordResetEmail({ to, displayName, resetUrl }) {
  await send(
    to,
    "🔑 Password Reset — Tech Inventory",
    layout("#6366f1", "🔑 Password Reset Request", `
      <p>Hi <strong>${esc(displayName)}</strong>,</p>
      <p>We received a request to reset your password. Click the button below to set a new password:</p>
      ${btn(resetUrl, "Reset Password")}
      <p style="font-size:13px;color:#6b7280;">This link expires in 1 hour. If you didn&rsquo;t request this, you can safely ignore this email.</p>
    `)
  );
}

export async function sendLoanStatusEmail({ to, displayName, loanId, status, adminNotes, items }) {
  if (status !== "approved" && status !== "rejected") return;
  const isApproved = status === "approved";
  await send(
    to,
    `${isApproved ? "✅ Loan Approved" : "❌ Loan Rejected"} — Request #${loanId}`,
    layout(
      isApproved ? "#22c55e" : "#ef4444",
      isApproved ? "✅ Your loan request has been approved!" : "❌ Your loan request was rejected.",
      `
        <p>Hi <strong>${esc(displayName)}</strong>, loan request <strong>#${loanId}</strong> has been <strong>${esc(status)}</strong>.</p>
        ${itemsBox(items)}
        ${adminNotes ? `<p><strong>Admin notes:</strong> ${esc(adminNotes)}</p>` : ""}
        ${btn(`${APP_URL}/loans`, "View My Loans")}
      `
    )
  );
}

export async function sendWelcomeEmail({ to, displayName, username }) {
  await send(
    to,
    "👋 Welcome to Tech Inventory!",
    layout("#10b981", "🎉 Welcome to the team!", `
      <p>Hi <strong>${esc(displayName)}</strong>,</p>
      <p>Your account has been successfully created. You can now log in using your username: <strong>${esc(username)}</strong>.</p>
      <p>You can now request loans and manage your inventory directly from the app.</p>
      ${btn(`${APP_URL}/login`, "Log In Now")}
    `)
  );
}

export async function sendNewLoanUserEmail({ to, displayName, loanId, loanType, purpose, items }) {
  await send(
    to,
    `📝 Loan Request Received — #${loanId}`,
    layout("#6366f1", "📝 Request Received", `
      <p>Hi <strong>${esc(displayName)}</strong>,</p>
      <p>We've received your request for a <strong>${esc(loanType)}</strong> loan (<strong>#${loanId}</strong>).</p>
      <p><strong>Purpose:</strong> ${esc(purpose)}</p>
      ${itemsBox(items)}
      <p>The admins will review your request shortly.</p>
      ${btn(`${APP_URL}/loans`, "View My Loans")}
    `)
  );
}

/**
 * Notify all admins of a new loan — single batch API call instead of one per admin.
 * @param {Array<{email: string, display_name: string}>} admins
 */
export async function sendNewLoanAdminEmails({ admins, userName, loanId, loanType, purpose, items }) {
  const messages = admins
    .filter((a) => a.email)
    .map((admin) => ({
      to: admin.email,
      subject: `🔔 New Loan Request from ${esc(userName)} — #${loanId}`,
      html: layout("#f59e0b", "🔔 Pending Approval", `
        <p>Hi <strong>${esc(admin.display_name)}</strong>,</p>
        <p><strong>${esc(userName)}</strong> has submitted a new <strong>${esc(loanType)}</strong> loan request (<strong>#${loanId}</strong>).</p>
        <p><strong>Purpose:</strong> ${esc(purpose)}</p>
        ${itemsBox(items)}
        ${btn(`${APP_URL}/admin`, "Review Request")}
      `),
    }));
  await sendBatch(messages);
}
