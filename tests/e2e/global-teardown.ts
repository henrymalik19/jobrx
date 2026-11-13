// After the end-to-end tests: the test user and all it owns are removed, leaving the local stack as it was.
import { localAdmin, removeE2EUser } from "./local";

export default async function globalTeardown() {
  await removeE2EUser(localAdmin());
}
