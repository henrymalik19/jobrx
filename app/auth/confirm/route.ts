import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { exchangeAuthCode, verifyEmailToken } from "@/server/auth/session";

/** The emailed links that sign someone in here: an invite (a token) or a password reset (a code). */
const TOKEN_TYPES = new Set<EmailOtpType>(["invite", "recovery", "email"]);

/**
 * Where emailed auth links land: a password reset brings a `code`, an invite a `token_hash` and `type`. Either
 * becomes a session, then continues to `next` (same-site paths only). A used or expired link goes to
 * /login/forgot, where a new one can be sent.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const next = params.get("next") ?? "/app";
  const target = request.nextUrl.clone();
  target.search = "";
  const ok = code
    ? await exchangeAuthCode(code)
    : !!tokenHash && !!type && TOKEN_TYPES.has(type) && (await verifyEmailToken(tokenHash, type));
  if (ok) {
    target.pathname = next.startsWith("/") && !next.startsWith("//") ? next : "/app";
  } else {
    target.pathname = "/login/forgot";
    target.searchParams.set("error", "expired");
  }
  return NextResponse.redirect(target);
}
