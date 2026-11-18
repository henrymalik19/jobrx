import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminContext } from "@/server/auth/require-owner";
import { listUsers } from "@/server/modules/admin/admin.service";
import { listAccessRequests, listAccounts, type MemberStatus } from "@/server/modules/members/members.service";
import { ago } from "@/shared/format";
import { TableSkeleton } from "../../_components/skeletons";
import { cardsOnPhone } from "@/app/(signed-in)/_components/data-table";
import { declineAction, removeAction, restoreAction } from "./actions";
import { InviteButton, InviteForm } from "./forms";

const n = (counts: Record<string, number>, ...statuses: string[]) => statuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0);

const STATUS_BADGE: Record<MemberStatus, { label: string; variant: "outline" | "secondary" } | null> = {
  active: null,
  invited: { label: "invited", variant: "outline" },
  removed: { label: "removed", variant: "secondary" },
};

/** People who asked to join, with Invite and Decline. Nothing when nobody is waiting. */
async function Requests() {
  const { admin } = await adminContext();
  const requests = await listAccessRequests(admin);
  if (requests.length === 0) return null;
  const now = new Date();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Requests to join</CardTitle>
        <CardDescription>From Request access on the sign-in page. Invite sends them a link to set up an account; declining doesn&apos;t tell them.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table className={cardsOnPhone.table}>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Looking for</TableHead>
              <TableHead className="text-right">Asked</TableHead>
              <TableHead className="text-right"><span className="sr-only">Answer</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((r) => (
              <TableRow key={r.id}>
                <TableCell className={cardsOnPhone.first}>
                  <span className="font-medium">{r.name}</span>
                  <span className="block text-xs text-muted-foreground">{r.email}</span>
                </TableCell>
                <TableCell data-label="Looking for" className="max-w-sm text-sm whitespace-normal text-muted-foreground">{r.note ?? "—"}</TableCell>
                <TableCell data-label="Asked" className="text-right text-muted-foreground">{ago(r.createdAt, now)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-start justify-end gap-2">
                    <InviteButton email={r.email} />
                    <form action={declineAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <Button type="submit" size="sm" variant="ghost">Decline</Button>
                    </form>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

async function Users() {
  const { admin } = await adminContext();
  const [users, accounts] = await Promise.all([listUsers(admin), listAccounts(admin)]);
  const now = new Date();
  return (
    <Card>
      <CardContent>
        <Table className={cardsOnPhone.table}>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead className="text-right">To approve</TableHead>
              <TableHead className="text-right">Applying</TableHead>
              <TableHead className="text-right">Sent</TableHead>
              <TableHead className="text-right">Interviews</TableHead>
              <TableHead className="text-right">Last activity</TableHead>
              <TableHead className="text-right"><span className="sr-only">Access</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const account = accounts.get(u.id);
              const status = account?.status ?? "active";
              const badge = STATUS_BADGE[status];
              const email = account?.email ?? u.email;
              return (
                <TableRow key={u.id} className={status === "removed" ? "opacity-60" : undefined}>
                  <TableCell className={cardsOnPhone.first}>
                    <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">{u.name === "Someone" && email ? email : u.name}</Link>
                    {u.role === "owner" && <Badge variant="outline" className="ml-2">you</Badge>}
                    {badge && <Badge variant={badge.variant} className="ml-2">{badge.label}</Badge>}
                    {email && <span className="block text-xs text-muted-foreground">{email}</span>}
                  </TableCell>
                  <TableCell data-label="To approve" className="text-right tabular-nums">{n(u.counts, "queued", "needs_input", "manual")}</TableCell>
                  <TableCell data-label="Applying" className="text-right tabular-nums">{n(u.counts, "approved")}</TableCell>
                  <TableCell data-label="Sent" className="text-right tabular-nums">{n(u.counts, "submitted", "confirmed", "responded")}</TableCell>
                  <TableCell data-label="Interviews" className="text-right tabular-nums">{n(u.counts, "interviewing", "offer")}</TableCell>
                  <TableCell data-label="Last activity" className="text-right text-muted-foreground">
                    {u.lastActivityAt ? ago(u.lastActivityAt, now) : status === "invited" && account?.invitedAt ? `invited ${ago(account.invitedAt, now)}` : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {u.role !== "owner" && (
                      <div className="flex items-start justify-end gap-2">
                        {status === "invited" && email && <InviteButton email={email} label="Resend invite" variant="outline" />}
                        {status === "removed" ? (
                          <form action={restoreAction}>
                            <input type="hidden" name="id" value={u.id} />
                            <Button type="submit" size="sm" variant="outline">Restore access</Button>
                          </form>
                        ) : (
                          <form action={removeAction}>
                            <input type="hidden" name="id" value={u.id} />
                            <Button type="submit" size="sm" variant="ghost" className="text-destructive">Remove access</Button>
                          </form>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** Users: everyone using the app and where their applications stand; invites, requests to join and access. Admin only. */
export default function UsersPage() {
  return (
    <main className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">Everyone using the app. Open one to see their profile and applications (read only).</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Invite someone</CardTitle>
          <CardDescription>
            They get an email to set a password, then start in their own workspace following your boards, with $5 a month of Claude.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InviteForm />
        </CardContent>
      </Card>
      <Suspense fallback={null}>
        <Requests />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={4} />}>
        <Users />
      </Suspense>
    </main>
  );
}
