"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { signInMember, signOutCurrentUser } from "@/server/auth/session";

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** Login form state; `error` is shown under the form. */
export type LoginState = { error?: string };

/** Login form action: signs in a member and goes to their workspace. */
export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter your email and password." };

  const result = await signInMember(parsed.data.email, parsed.data.password);
  if (!result.ok) return { error: result.error };
  redirect("/app");
}

/** Signs out and returns to the login page. */
export async function signOut() {
  await signOutCurrentUser();
  redirect("/login");
}
