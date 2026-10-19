import "server-only";

/**
 * Server-side email delivery.
 *
 * Deliberately NOT a "use server" action. Every export of such a module is a
 * callable endpoint, and this function takes an arbitrary recipient and
 * subject - as an action it was an open relay on our own Resend account and
 * sending domain. Its only callers are server-side (notify.js and the Inngest
 * jobs), so it belongs in a server-only module.
 */

import { Resend } from "resend";

/**
 * Sender address, from RESEND_FROM.
 *
 * The fallback is Resend's shared test sender, which only delivers to the
 * address that owns the Resend account - every budget alert, monthly report
 * and notification to anyone else is rejected. Once a domain is verified in
 * Resend, set RESEND_FROM (e.g. "WealthWise <alerts@yourdomain.com>") and no
 * code needs to change.
 */
const FROM = process.env.RESEND_FROM?.trim() || "Finance App <onboarding@resend.dev>";

export async function sendEmail({ to, subject, react }) {
  const resend = new Resend(process.env.RESEND_API_KEY || "");

  try {
    const data = await resend.emails.send({
      from: FROM,
      to,
      subject,
      react,
    });

    return { success: true, data };
  } catch (error) {
    console.error("Failed to send email:", error);
    return { success: false, error };
  }
}