// Before the end-to-end tests: the test user, made afresh in the local Supabase stack.
import { createE2EUser, localAdmin } from "./local";

export default async function globalSetup() {
  await createE2EUser(localAdmin());
}
