import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/server/auth/require-owner";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = {
  title: "New password · Jobrx",
  robots: { index: false, follow: false },
};

/** Whose password this sets; signed-out visitors are sent to /login. */
async function ForUser() {
  const owner = await requireOwner();
  return <>For {owner.email}.</>;
}

/** Sets a new password; reached from a reset link, which signs you in. */
export default function ResetPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>New password</CardTitle>
          <CardDescription>
            <Suspense>
              <ForUser />
            </Suspense>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResetForm />
        </CardContent>
      </Card>
    </main>
  );
}
