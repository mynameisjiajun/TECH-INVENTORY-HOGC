import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.EMAIL_FROM || 'Tech Inventory <noreply@resend.dev>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export async function sendOverdueEmail({ to, displayName, loanId, items, endDate }) {
  if (!resend || !to) return;
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `🚨 Overdue Loan #${loanId} — Please Return Items`,
      html: `
        <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
          <div style="background: #1e1b4b; padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: #818cf8; margin: 0; font-size: 22px;">Tech Inventory</h1>
          </div>
          <div style="background: #f9fafb; padding: 28px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb;">
            <p style="color: #ef4444; font-weight: 700; font-size: 18px; margin-top: 0;">🚨 Your loan is overdue!</p>
            <p>Hi <strong>${displayName}</strong>,</p>
            <p>Loan <strong>#${loanId}</strong> was due on <strong>${endDate}</strong> and has not yet been returned.</p>
            <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 16px 0;">
              <p style="font-weight: 600; margin: 0 0 8px 0;">Items borrowed:</p>
              <ul style="margin: 0; padding-left: 20px;">
                ${items.map(i => `<li>${i.item} × ${i.quantity}</li>`).join('')}
              </ul>
            </div>
            <p>Please return the items as soon as possible or contact an admin.</p>
            <a href="${APP_URL}/loans" style="display: inline-block; background: #6366f1; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 8px;">View My Loans</a>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error('Failed to send overdue email:', err.message);
  }
}

export async function sendDueSoonEmail({ to, displayName, loanId, items, endDate }) {
  if (!resend || !to) return;
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `⏰ Loan #${loanId} is due tomorrow`,
      html: `
        <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
          <div style="background: #1e1b4b; padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: #818cf8; margin: 0; font-size: 22px;">Tech Inventory</h1>
          </div>
          <div style="background: #f9fafb; padding: 28px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb;">
            <p style="color: #f59e0b; font-weight: 700; font-size: 18px; margin-top: 0;">⏰ Return reminder</p>
            <p>Hi <strong>${displayName}</strong>,</p>
            <p>Loan <strong>#${loanId}</strong> is due tomorrow on <strong>${endDate}</strong>.</p>
            <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 16px 0;">
              <p style="font-weight: 600; margin: 0 0 8px 0;">Items to return:</p>
              <ul style="margin: 0; padding-left: 20px;">
                ${items.map(i => `<li>${i.item} × ${i.quantity}</li>`).join('')}
              </ul>
            </div>
            <p>Please prepare to return these items. Contact an admin if you need an extension.</p>
            <a href="${APP_URL}/loans" style="display: inline-block; background: #6366f1; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 8px;">View My Loans</a>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error('Failed to send due-soon email:', err.message);
  }
}

export async function sendLoanStatusEmail({ to, displayName, loanId, status, adminNotes, items }) {
  if (!resend || !to) return;
  const isApproved = status === 'approved';
  const isRejected = status === 'rejected';
  if (!isApproved && !isRejected) return;

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${isApproved ? '✅ Loan Approved' : '❌ Loan Rejected'} — Request #${loanId}`,
      html: `
        <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
          <div style="background: #1e1b4b; padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: #818cf8; margin: 0; font-size: 22px;">Tech Inventory</h1>
          </div>
          <div style="background: #f9fafb; padding: 28px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb;">
            <p style="color: ${isApproved ? '#22c55e' : '#ef4444'}; font-weight: 700; font-size: 18px; margin-top: 0;">
              ${isApproved ? '✅ Your loan request has been approved!' : '❌ Your loan request was rejected.'}
            </p>
            <p>Hi <strong>${displayName}</strong>, loan request <strong>#${loanId}</strong> has been <strong>${status}</strong>.</p>
            <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 16px 0;">
              <p style="font-weight: 600; margin: 0 0 8px 0;">Items:</p>
              <ul style="margin: 0; padding-left: 20px;">
                ${items.map(i => `<li>${i.item} × ${i.quantity}</li>`).join('')}
              </ul>
            </div>
            ${adminNotes ? `<p><strong>Admin notes:</strong> ${adminNotes}</p>` : ''}
            <a href="${APP_URL}/loans" style="display: inline-block; background: #6366f1; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 8px;">View My Loans</a>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error('Failed to send status email:', err.message);
  }
}
