-- Step 28b: who and where. Tables person, gym, gym_member, gym_equipment, with row-level security.
-- Ids are text so the app's own ids ("main", "awp", "leg-press") load unchanged.
-- The tables they point to (equipment_type, exercise_type, exercise) come in step 28c, which adds those links.
-- Sign-in (step 30) will set person.auth_user_id; until then only the service role (the laptop) writes people.

create schema if not exists app;

-- keeps updated_at current: the sync step uses it for "last change wins"
create function app.touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create table public.person (
  id            text primary key,
  name          text not null,
  auth_user_id  uuid unique references auth.users (id) on delete set null,
  defaults      jsonb not null default '{}',
  superset      jsonb,
  updated_at    timestamptz not null default now()
);

create table public.gym (
  id            text primary key,
  name          text not null,
  units         jsonb not null default '{}',
  list_default  text,
  starter_free  boolean,
  starter_abs   boolean,
  pull_ups_moved boolean,
  updated_at    timestamptz not null default now()
);

create table public.gym_member (
  person_id   text not null references public.person (id) on delete cascade,
  gym_id      text not null references public.gym (id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'editor', 'member')),
  status      text not null default 'pending' check (status in ('pending', 'active')),
  off_types   text[] not null default '{}',     -- equipment types this person switches off at this gym
  updated_at  timestamptz not null default now(),
  primary key (person_id, gym_id)
);

create table public.gym_equipment (
  gym_id            text not null references public.gym (id) on delete cascade,
  id                text not null,                 -- the exercise id, or "set:dumbbells" / "set:barbell"
  exercise_id       text,                          -- null for a weight set
  equipment_type_id text not null,
  exercise_type_id  text,
  name              text not null,
  unit              text,
  step              numeric,
  common            boolean,
  min               numeric,
  pins              jsonb,
  stack_spec        jsonb,
  hidden            boolean,
  muscle            text,
  uses              text,                          -- the weight set an exercise uses
  top               numeric,
  updated_at        timestamptz not null default now(),
  primary key (gym_id, id)
);
create index gym_member_gym on public.gym_member (gym_id);

create trigger touch before update on public.person        for each row execute function app.touch();
create trigger touch before update on public.gym           for each row execute function app.touch();
create trigger touch before update on public.gym_member    for each row execute function app.touch();
create trigger touch before update on public.gym_equipment for each row execute function app.touch();

-- ---------- Who is asking ----------
-- These run with their own rights so a rule can look at the member list without that list's own rules getting in the way.
create function app.my_person_id() returns text language sql stable security definer set search_path = '' as $$
  select id from public.person where auth_user_id = auth.uid()
$$;
create function app.is_gym_member(g text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.gym_member where gym_id = g and person_id = app.my_person_id() and status = 'active')
$$;
create function app.can_edit_gym(g text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.gym_member where gym_id = g and person_id = app.my_person_id()
                   and status = 'active' and role in ('owner', 'editor'))
$$;
create function app.is_gym_owner(g text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.gym_member where gym_id = g and person_id = app.my_person_id()
                   and status = 'active' and role = 'owner')
$$;
create function app.gym_has_members(g text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.gym_member where gym_id = g)
$$;
create function app.shares_gym(p text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.gym_member a join public.gym_member b on a.gym_id = b.gym_id
                  where a.person_id = p and a.status = 'active'
                    and b.person_id = app.my_person_id() and b.status = 'active')
$$;

-- ---------- Row-level security ----------
alter table public.person        enable row level security;
alter table public.gym           enable row level security;
alter table public.gym_member    enable row level security;
alter table public.gym_equipment enable row level security;

-- person: you and the people who share an active gym with you; you change only yourself
create policy person_select on public.person for select to authenticated
  using (id = app.my_person_id() or app.shares_gym(id));
create policy person_insert on public.person for insert to authenticated
  with check (auth_user_id = auth.uid() and app.my_person_id() is null);   -- one person per sign-in
create policy person_update on public.person for update to authenticated
  using (id = app.my_person_id()) with check (id = app.my_person_id() and auth_user_id = auth.uid());

-- gym: members see it, owner and editors change it, only the owner deletes it
create policy gym_select on public.gym for select to authenticated using (app.is_gym_member(id));
create policy gym_insert on public.gym for insert to authenticated with check (app.my_person_id() is not null);
create policy gym_update on public.gym for update to authenticated
  using (app.can_edit_gym(id)) with check (app.can_edit_gym(id));
create policy gym_delete on public.gym for delete to authenticated using (app.is_gym_owner(id));

-- gym_member: you ask for access (pending); the owner approves; the first owner row is allowed only on a gym with no members yet
-- (step 30 replaces that with a create-gym function)
create policy member_select on public.gym_member for select to authenticated
  using (person_id = app.my_person_id() or app.is_gym_member(gym_id));
create policy member_insert on public.gym_member for insert to authenticated with check (
  app.is_gym_owner(gym_id)
  or (person_id = app.my_person_id() and role = 'member' and status = 'pending')
  or (person_id = app.my_person_id() and role = 'owner' and status = 'active' and not app.gym_has_members(gym_id))
);
create policy member_update on public.gym_member for update to authenticated
  using (person_id = app.my_person_id() or app.is_gym_owner(gym_id))
  with check (person_id = app.my_person_id() or app.is_gym_owner(gym_id));
create policy member_delete on public.gym_member for delete to authenticated
  using (person_id = app.my_person_id() or app.is_gym_owner(gym_id));

-- someone who is not the owner may change only off_types on their own row, never role or status
create function app.guard_member_update() returns trigger language plpgsql as $$
begin
  if not app.is_gym_owner(new.gym_id)
     and (new.person_id, new.gym_id, new.role, new.status) is distinct from (old.person_id, old.gym_id, old.role, old.status) then
    raise exception 'Only the gym owner can change a role or approve access';
  end if;
  return new;
end $$;
create trigger guard before update on public.gym_member for each row execute function app.guard_member_update();

-- gym_equipment: members read; owner and editors change
create policy equip_select on public.gym_equipment for select to authenticated using (app.is_gym_member(gym_id));
create policy equip_insert on public.gym_equipment for insert to authenticated with check (app.can_edit_gym(gym_id));
create policy equip_update on public.gym_equipment for update to authenticated
  using (app.can_edit_gym(gym_id)) with check (app.can_edit_gym(gym_id));
create policy equip_delete on public.gym_equipment for delete to authenticated using (app.can_edit_gym(gym_id));

-- ---------- Who may touch what ----------
revoke all on public.person, public.gym, public.gym_member, public.gym_equipment from anon;
grant select, insert, update, delete on public.person, public.gym, public.gym_member, public.gym_equipment to authenticated;
grant usage on schema app to authenticated;
revoke all on all functions in schema app from public;
grant execute on all functions in schema app to authenticated;
