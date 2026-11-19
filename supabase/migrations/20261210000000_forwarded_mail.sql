-- Forwarded mail: each person gets a private address on Jobrx's receiving domain (u-<random>@in.jobrx.ai) and
-- forwards their application email to it. Resend receives the mail and calls the app (/api/inbound/resend),
-- which keeps it here for email tracking and the apply runner's security codes. Nobody signs in to anyone's
-- mailbox, and nothing is moved or sent from it.

-- Each person's forwarding address (the part before the @). Made by the server the first time it's shown.
create table inbound_addresses (
  user_id uuid primary key references users (id) on delete cascade,
  local_part text not null unique check (local_part ~ '^u-[a-z0-9]{8,32}$'),
  created_at timestamptz not null default now()
);
alter table inbound_addresses enable row level security;
alter table inbound_addresses force row level security;
-- Each person reads their own; only the server writes.
create policy own_address on inbound_addresses for select using (user_id = auth.uid() and is_member());
revoke insert, update, delete on inbound_addresses from anon, authenticated;
revoke all on inbound_addresses from anon;

-- Mail forwarded to someone's address, as tracking reads it. Kept 30 days (tracking keeps what it needs in
-- emails); only the server writes.
create table inbound_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  -- Resend's id for the received email: a webhook delivered twice is kept once.
  provider_id text not null,
  message_id text not null,
  received_at timestamptz not null,
  from_address text not null default '',
  from_name text not null default '',
  subject text not null default '',
  text text not null default '',
  headers jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create unique index inbound_emails_once on inbound_emails (user_id, provider_id);
create index inbound_emails_by_user on inbound_emails (user_id, received_at desc);
alter table inbound_emails enable row level security;
alter table inbound_emails force row level security;
-- Each person reads their own (the apply runner, signed in as them, reads security codes); only the server writes.
create policy own_mail on inbound_emails for select using (user_id = auth.uid() and is_member());
revoke insert, update, delete on inbound_emails from anon, authenticated;
revoke all on inbound_emails from anon;
