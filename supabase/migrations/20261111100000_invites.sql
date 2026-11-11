-- Step 30a: invite-only sign-in. Nobody can become a person, create a gym or join one unless the owner invited their email.
-- The invite table is filled from the laptop only (service role, or the SQL editor); the app can never read or write it.
-- Your email address is NEVER put in this file or in the repo: add it with one SQL command on the laptop (see step 30 notes).

create table public.invite (
  email       text primary key check (email = lower(email) and email like '%@%'),   -- stored in lower case
  person_id   text not null,                    -- the person this email becomes (an existing id, or a new one)
  name        text not null,
  created_at  timestamptz not null default now(),
  claimed_by  uuid references auth.users (id) on delete set null,
  claimed_at  timestamptz
);
alter table public.invite enable row level security;      -- no policies: nobody but the service role can touch it
revoke all on public.invite from anon, authenticated;

-- The signed-in user asks to be linked to their invited person. Works only for an email Supabase has confirmed.
-- Safe to call again: a user who is already linked just gets their person id back.
create function app.claim_invite() returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); mail text; inv public.invite; pid text;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  pid := app.my_person_id();
  if pid is not null then return pid; end if;
  select lower(email) into mail from auth.users where id = uid and email_confirmed_at is not null;
  if mail is null then raise exception 'Email not confirmed'; end if;
  select * into inv from public.invite where email = mail and claimed_by is null for update;
  if not found then raise exception 'No invitation for this email'; end if;
  if exists (select 1 from public.person where id = inv.person_id and auth_user_id is not null) then
    raise exception 'That person is already linked to another sign-in';
  end if;
  insert into public.person (id, name, auth_user_id) values (inv.person_id, inv.name, uid)
    on conflict (id) do update set auth_user_id = excluded.auth_user_id;     -- links an existing person, keeping their data
  update public.invite set claimed_by = uid, claimed_at = now() where email = mail;
  return inv.person_id;
end $$;

-- Replaces the first-owner stopgap: a linked person creates a gym and becomes its owner in one step.
-- Calling it again for a gym you already own does nothing; a gym id that belongs to someone else is refused.
create function app.create_gym(g text, n text) returns void language plpgsql security definer set search_path = '' as $$
declare pid text := app.my_person_id();
begin
  if pid is null then raise exception 'Not linked to a person'; end if;
  if exists (select 1 from public.gym where id = g) then
    if app.is_gym_owner(g) then return; end if;
    raise exception 'That gym id is taken';
  end if;
  insert into public.gym (id, name) values (g, n);
  insert into public.gym_member (person_id, gym_id, role, status) values (pid, g, 'owner', 'active');
end $$;

-- Close the open doors from step 28b
drop policy person_insert on public.person;       -- people now come only from claim_invite
drop policy gym_insert on public.gym;             -- gyms now come only from create_gym
drop policy member_insert on public.gym_member;
create policy member_insert on public.gym_member for insert to authenticated
  with check (app.is_gym_owner(gym_id));          -- only a gym's owner adds people to it

revoke all on function app.claim_invite(), app.create_gym(text, text) from public;
grant execute on function app.claim_invite(), app.create_gym(text, text) to authenticated;
