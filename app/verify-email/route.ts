import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/server/db/service-client";
import { verifyApplicationEmail } from "@/server/modules/profile/application-email";
import { recheckOpenQuestions } from "@/server/modules/prepare/prepare.service";
import { serverEnv } from "@/shared/env";

/**
 * Where the link to verify an application email lands. The token alone proves the mailbox, so it works signed
 * out (on a phone, say); the result page says what happened.
 */
export async function GET(request: NextRequest) {
  const admin = createServiceClient(serverEnv());
  const { result, userId } = await verifyApplicationEmail(admin, request.nextUrl.searchParams.get("token") ?? "");
  // Waiting applications that asked for the email get it now (no Claude).
  if (result === "verified" && userId) await recheckOpenQuestions({ db: admin, userId }).catch(() => undefined);
  const target = request.nextUrl.clone();
  target.pathname = "/verify-email/done";
  target.search = `?result=${result}`;
  return NextResponse.redirect(target);
}
