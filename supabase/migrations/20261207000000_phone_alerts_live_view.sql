-- Phone alerts and the runner's live view.
--
-- Alerts: each browser or installed app you turn alerts on in keeps a push subscription (its push service's
-- address and keys). The app sends the notifications that need you there: the runner waiting or stuck, an
-- interview invite, a reply.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- The push service's address for this browser: one row each, whoever subscribes it last.
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  -- What it is ("iPhone", "Chrome on Windows"), to tell them apart in Settings.
  device text not null default '',
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on push_subscriptions (user_id);
alter table push_subscriptions enable row level security;
create policy own_rows on push_subscriptions for all
  using (user_id = auth.uid() and is_member()) with check (user_id = auth.uid() and is_member());
revoke all on push_subscriptions from anon;

-- Live view: while you watch the Applying page, the runner keeps a screenshot of each form it has open at
-- apply-runs/<you>/live/<application>.jpg, written over every few seconds and removed when the form closes.
update storage.buckets set allowed_mime_types = array['text/plain', 'text/html', 'image/png', 'image/jpeg'] where id = 'apply-runs';
create policy apply_runs_own_update on storage.objects for update to authenticated
  using (bucket_id = 'apply-runs' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'apply-runs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy apply_runs_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'apply-runs' and (storage.foldername(name))[1] = auth.uid()::text);
