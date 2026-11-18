-- Members: people you invite sign in to their own workspace (Admin stays yours, role 'owner').
--
-- Removing someone's access keeps their data: `removed_at` is set, they're signed out and can't sign back in,
-- and the workers skip them. Restoring clears it.
alter table users add column removed_at timestamptz;

-- A removed member is no longer a member: every "your own rows" policy checks this.
create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from users where id = auth.uid() and removed_at is null);
$$;

-- Each person reads their own row (whether they're the owner, for Admin); nobody changes it but the server.
create policy own_row on users for select using (id = auth.uid());

-- Your Claude spending cap is set by the owner: members read theirs but can't write it.
create policy cap_set_by_owner_insert on user_settings as restrictive for insert
  with check (key <> 'llm_monthly_cap_usd' or is_owner());
create policy cap_set_by_owner_update on user_settings as restrictive for update
  using (key <> 'llm_monthly_cap_usd' or is_owner()) with check (key <> 'llm_monthly_cap_usd' or is_owner());
create policy cap_set_by_owner_delete on user_settings as restrictive for delete
  using (key <> 'llm_monthly_cap_usd' or is_owner());

-- Requests to join from the sign-in page's "Request access". Only the server (service role) reads and writes them.
create table access_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  -- What they're looking for, or how they heard about Jobrx.
  note text,
  status text not null default 'pending' check (status in ('pending', 'invited', 'declined')),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
-- One open request per address: asking again while one waits changes nothing.
create unique index access_requests_one_pending on access_requests (lower(email)) where status = 'pending';
create index access_requests_recent on access_requests (created_at desc);
alter table access_requests enable row level security;
alter table access_requests force row level security;
revoke all on access_requests from anon, authenticated;
