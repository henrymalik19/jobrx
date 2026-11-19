-- The application email: the address on your profile (profiles.email), which goes on every application, can
-- differ from the one you sign in with. It's used only once verified: it's the address you sign in with, or you
-- opened a link Jobrx emailed to it. Changing it makes it unverified again.

alter table profiles add column email_verified_at timestamptz;

-- Addresses already on a profile were in use before verification existed: they stay usable.
update profiles set email_verified_at = now() where email is not null;

-- Whether an address is the one someone signs in with (a member can ask only about themselves).
create or replace function is_sign_in_email(p_user uuid, p_email text) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from auth.users u
    where u.id = p_user and lower(u.email) = lower(p_email) and (auth.uid() is null or auth.uid() = p_user)
  );
$$;
revoke execute on function is_sign_in_email(uuid, text) from public, anon;

-- Keeps email_verified_at honest: only the server (service role, or a migration) sets it; a new or changed email
-- is unverified, unless it's the address the person signs in with.
create or replace function profiles_email_verification() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  -- current_user is who's writing: 'authenticated' for a signed-in person, 'service_role' for the server.
  if tg_op = 'UPDATE' and new.email_verified_at is distinct from old.email_verified_at
     and current_user in ('authenticated', 'anon') then
    new.email_verified_at := old.email_verified_at;
  elsif tg_op = 'INSERT' and current_user in ('authenticated', 'anon') then
    new.email_verified_at := null;
  end if;

  if new.email is null then
    new.email_verified_at := null;
  elsif tg_op = 'INSERT' or lower(new.email) is distinct from lower(old.email) then
    new.email_verified_at := case
      when is_sign_in_email(new.user_id, new.email) then now()
      when current_user in ('authenticated', 'anon') then null
      else new.email_verified_at
    end;
  end if;
  return new;
end;
$$;

create trigger profiles_email_verification before insert or update on profiles
  for each row execute function profiles_email_verification();

-- Links Jobrx emailed to verify an application email. Only the server (service role) reads and writes them;
-- the link carries a random token, of which only the SHA-256 is kept.
create table email_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_verifications_by_user on email_verifications (user_id, created_at desc);
alter table email_verifications enable row level security;
alter table email_verifications force row level security;
revoke all on email_verifications from anon, authenticated;
