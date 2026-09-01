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

export async function sendEmail({ to, subject, react }) {
  const resend = new Resend(process.env.RESEND_API_KEY || "");

  try {
    const data = await resend.emails.send({
      from: "Finance App <onboarding@resend.dev>",
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