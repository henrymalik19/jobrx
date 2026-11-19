// The look every Jobrx email shares: the brand above a white card on a light grey page, one optional button,
// a footnote under a rule, and a small footer. It matches supabase/templates/recovery.html and invite.html (the
// Supabase Auth emails, which are pasted into the dashboard and can't import this).
//
// Built from tables with spacing on <td>s, not <table>s: many mail clients (Roundcube, Outlook) ignore padding
// on tables, and most ignore <style> blocks, so every style is inline.

/** Escapes text for HTML (an element's text or an attribute in double quotes). */
export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The palette, as in the Supabase templates. */
export const EMAIL_COLORS = {
  page: "#f4f4f7",
  card: "#ffffff",
  border: "#e4e4e7",
  rule: "#f0f0f2",
  text: "#18181b",
  body: "#3f3f46",
  muted: "#71717a",
  faint: "#a1a1aa",
  brand: "#6366f1",
} as const;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** One email's content. `body` and `footnote` are HTML (escape what you put in them). */
export type EmailContent = {
  /** The document title (some clients show it). */
  title: string;
  /** The line inboxes show after the subject. */
  preview: string;
  heading: string;
  /** The card's content under the heading, as HTML. */
  body: string;
  /** A button under the body. */
  button?: { label: string; href: string };
  /** Small print under a rule at the bottom of the card, as HTML. */
  footnote?: string;
};

/** A paragraph of body text (escaped). */
export function paragraph(text: string, opts: { last?: boolean } = {}): string {
  return `<p style="font-size:15px;line-height:24px;margin:0 0 ${opts.last ? 0 : 16}px;color:${EMAIL_COLORS.body}">${escapeHtml(text)}</p>`;
}

/** A link in body text (escaped). */
export function link(label: string, href: string, color: string = EMAIL_COLORS.brand): string {
  return `<a href="${escapeHtml(href)}" style="color:${color};text-decoration:underline">${escapeHtml(label)}</a>`;
}

function button(b: { label: string; href: string }): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px">
                  <tr>
                    <td style="background:${EMAIL_COLORS.brand};border-radius:8px">
                      <a href="${escapeHtml(b.href)}" style="display:inline-block;padding:13px 24px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px">${escapeHtml(b.label)}</a>
                    </td>
                  </tr>
                </table>`;
}

/** The whole email as an HTML document. */
export function renderEmail(content: EmailContent): string {
  const c = EMAIL_COLORS;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${escapeHtml(content.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:${c.page};font-family:${FONT};color:${c.text}">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(content.preview)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${c.page}">
      <tr>
        <td align="center" style="padding:40px 16px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
            <tr>
              <td style="padding:0 4px 20px">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="36" height="36" style="width:36px;height:36px;background:${c.brand};border-radius:9px;color:#ffffff;font-weight:700;font-size:14px;text-align:center;vertical-align:middle">Rx</td>
                    <td style="padding-left:10px;font-weight:600;font-size:17px;color:${c.text}">Jobrx</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background:${c.card};border:1px solid ${c.border};border-radius:12px;padding:36px 32px">
                <h1 style="font-size:22px;line-height:30px;margin:0 0 12px;color:${c.text}">${escapeHtml(content.heading)}</h1>
                ${content.body}
                ${content.button ? button(content.button) : ""}
                ${content.footnote ? `<p style="font-size:13px;line-height:20px;margin:28px 0 0;padding-top:20px;border-top:1px solid ${c.rule};color:${c.muted}">${content.footnote}</p>` : ""}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px 4px 0;font-size:12px;line-height:18px;color:${c.faint}">
                Jobrx · <a href="https://jobrx.ai" style="color:${c.faint};text-decoration:none">jobrx.ai</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}
