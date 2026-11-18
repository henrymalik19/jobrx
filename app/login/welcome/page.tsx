import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/server/auth/require-owner";
import { ResetForm } from "../reset/reset-form";

export const metadata: Metadata = {
  title: "Welcome · Jobrx",
  robots: { index: false, follow: false },
};

/** Whose account this is; signed-out visitors are sent to /login. */
async function ForUser() {
  const user = await requireOwner();
  return <>You&apos;re joining as {user.email}. Choose a password to finish setting up your account.</>;
}

/** Where an invite link lands (it signs the new member in): they choose a password, then go to the app. */
export default function WelcomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle><Logo /></CardTitle>
          <h1 className="pt-2 text-lg font-semibold">Welcome to Jobrx</h1>
          <CardDescription>
            <Suspense>
              <ForUser />
            </Suspense>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResetForm submitLabel="Set password and continue" />
        </CardContent>
      </Card>
    </main>
  );
}
