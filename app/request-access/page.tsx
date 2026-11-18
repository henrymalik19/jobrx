import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RequestForm } from "./request-form";

export const metadata: Metadata = {
  title: "Request access · Jobrx",
  robots: { index: false, follow: false },
};

/** Asks to join Jobrx: the owner sees the request in Admin > Users and can send an invite. */
export default function RequestAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="relative w-full max-w-sm">
        <CardHeader>
          <CardTitle><Logo /></CardTitle>
          <h1 className="pt-2 text-lg font-semibold">Request access</h1>
          <CardDescription>Jobrx is invite only for now. Tell us who you are and we&apos;ll be in touch.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RequestForm />
          <Link href="/login" className="text-sm text-muted-foreground underline">Already have an account? Sign in</Link>
        </CardContent>
      </Card>
    </main>
  );
}
