// Email the web app sends itself (a link to verify your application email): through Resend in production; on
// the local Supabase stack, into its Mailpit mailbox (http://127.0.0.1:54324) so nothing leaves your computer.
import { createResendSender } from "./resend";
import type { SendEmail } from "./smtp";

/** Who Jobrx's own email comes from (its domain is verified in Resend). */
export const JOBRX_FROM = "Jobrx <no-reply@send.jobrx.ai>";

/** Where the app's email goes out, and from whom; null when nothing is set up to send it. */
export type AppMailer = { send: SendEmail; from: string };

/** A sender into the local stack's Mailpit, through its HTTP API. */
function mailpitSender(base: string, fetchImpl: typeof fetch = fetch): SendEmail {
  return async (email) => {
    const name = /^(.*)<(.+)>$/.exec(email.from);
    const res = await fetchImpl(`${base}/api/v1/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: name ? { Name: name[1].trim(), Email: name[2] } : { Email: email.from },
        To: [{ Email: email.to }],
        Subject: email.subject,
        Text: email.text,
        HTML: email.html,
        Headers: email.headers,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { ID?: string };
    if (!res.ok || !body.ID) throw new Error(`Mailpit ${res.status}`);
    return body.ID;
  };
}

/**
 * The app's mailer: Mailpit whenever Supabase is the local stack (development and tests never send real email,
 * whatever .env.local holds); else Resend with RESEND_API_KEY (from NOTIFY_FROM, else {@link JOBRX_FROM});
 * otherwise none.
 */
export function appMailer(env: { RESEND_API_KEY?: string; NOTIFY_FROM?: string; SUPABASE_URL: string }): AppMailer | null {
  const from = env.NOTIFY_FROM || JOBRX_FROM;
  const local = /^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/.exec(env.SUPABASE_URL);
  if (local) return { send: mailpitSender(`http://${local[1]}:54324`), from };
  if (env.RESEND_API_KEY) return { send: createResendSender(env.RESEND_API_KEY), from };
  return null;
}
