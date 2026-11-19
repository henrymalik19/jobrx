import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { VerifyResult } from "@/server/modules/profile/application-email";

export const metadata: Metadata = {
  title: "Verify email · Jobrx",
  robots: { index: false, follow: false },
};

const SAYS: Record<VerifyResult, { heading: string; body: string }> = {
  verified: { heading: "Email verified", body: "Jobrx will use it on your applications from now on." },
  expired: { heading: "That link has expired", body: "Send a new one from your profile." },
  changed: { heading: "Your application email changed", body: "That link was for an address that isn't on your profile anymore. Send a link for the new one from your profile." },
  invalid: { heading: "That link doesn't work", body: "It may be incomplete. Send a new one from your profile." },
};

async function Result({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const { result } = await searchParams;
  const says = SAYS[(result as VerifyResult) in SAYS ? (result as VerifyResult) : "invalid"];
  return (
    <>
      <h1 className="pt-2 text-lg font-semibold">{says.heading}</h1>
      <CardDescription role="status">{says.body}</CardDescription>
    </>
  );
}

/** After opening the link that verifies an application email: what happened, and the way to the profile. */
export default function VerifyEmailDonePage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle><Logo /></CardTitle>
          <Suspense>
            <Result searchParams={searchParams} />
          </Suspense>
        </CardHeader>
        <CardContent>
          <Link href="/app/profile" className="text-sm underline">Open your profile</Link>
        </CardContent>
      </Card>
    </main>
  );
}
