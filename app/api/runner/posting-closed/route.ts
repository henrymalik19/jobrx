// The apply runner reports here a LinkedIn posting it found no longer accepting applications (it has already
// expired your application). The job is marked closed, which the runner can't do itself.
import { z } from "zod";
import { ValidationError } from "@/server/core/errors";
import { createServiceClient } from "@/server/db/service-client";
import { markPostingClosed } from "@/server/modules/apply/posting-closed";
import { serverEnv } from "@/shared/env";
import { runnerUser } from "../auth";

const body = z.object({ applicationId: z.string().uuid() });

/** Marks the job of the signed-in user's application closed; answers whether it was marked now. */
export async function POST(request: Request): Promise<Response> {
  const user = await runnerUser(request);
  if (user instanceof Response) return user;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  try {
    const closed = await markPostingClosed(user.db, createServiceClient(serverEnv()), user.userId, parsed.data.applicationId);
    return Response.json({ closed });
  } catch (err) {
    if (err instanceof ValidationError) return Response.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
