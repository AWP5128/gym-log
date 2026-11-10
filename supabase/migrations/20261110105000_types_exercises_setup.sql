-- Step 28c: what the exercises are, and each person's own setup. Tables equipment_type, exercise_type, exercise,
-- personal_setup, and the links from gym_equipment to the first three.

create table public.equipment_type (
  id    text primary key,
  label text not null
);
create table public.exercise_type (
  id        text primary key,
  label     text not null,
  day_types text[] not null default '{}'       -- {heavy,volume} for Legs and Arms, empty otherwise
);
-- one movement, shared by every gym
create table public.exercise (
  id               text primary key,
  name             text not null,
  exercise_type_id text references public.exercise_type (id),
  also_under       text[] not null default '{}', -- other exercise types it is listed under (pull-ups under legs)
  custom           jsonb,                        -- the definition of an exercise a person added
  updated_at       timestamptz not null default now()
);

-- one row per person, gym, exercise and day type. day_type 'none' is the row that holds notes (or the only row) when
-- no heavy or volume weights are saved; the app's null becomes 'none' when data is loaded (step 28e).
create table public.personal_setup (
  person_id   text not null references public.person (id) on delete cascade,
  gym_id      text not null references public.gym (id) on delete cascade,
  exercise_id text not null references public.exercise (id),
  day_type    text not null default 'none' check (day_type in ('none', 'heavy', 'volume')),
  warmup      jsonb,                             -- { weight, extra, reps }
  working     jsonb,                             -- { weight, extra, reps, sets }
  notes       text,
  updated_at  timestamptz not null default now(),
  primary key (person_id, gym_id, exercise_id, day_type)
);

alter table public.gym_equipment
  add constraint gym_equipment_equipment_type foreign key (equipment_type_id) references public.equipment_type (id),
  add constraint gym_equipment_exercise_type  foreign key (exercise_type_id)  references public.exercise_type (id),
  add constraint gym_equipment_exercise       foreign key (exercise_id)       references public.exercise (id);

create trigger touch before update on public.exercise       for each row execute function app.touch();
create trigger touch before update on public.personal_setup for each row execute function app.touch();

alter table public.equipment_type  enable row level security;
alter table public.exercise_type   enable row level security;
alter table public.exercise        enable row level security;
alter table public.personal_setup  enable row level security;

-- the lists of types: everyone signed in reads; only the laptop (service role) changes them
create policy equipment_type_select on public.equipment_type for select to authenticated using (true);
create policy exercise_type_select  on public.exercise_type  for select to authenticated using (true);

-- exercises: everyone signed in reads; an owner or editor of a gym can add one; changes and removals only by the laptop
create function app.is_any_editor() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.gym_member where person_id = app.my_person_id()
                   and status = 'active' and role in ('owner', 'editor'))
$$;
create policy exercise_select on public.exercise for select to authenticated using (true);
create policy exercise_insert on public.exercise for insert to authenticated with check (app.is_any_editor());

-- personal setup: only yours, and only at a gym you are an active member of
create policy setup_select on public.personal_setup for select to authenticated using (person_id = app.my_person_id());
create policy setup_insert on public.personal_setup for insert to authenticated
  with check (person_id = app.my_person_id() and app.is_gym_member(gym_id));
create policy setup_update on public.personal_setup for update to authenticated
  using (person_id = app.my_person_id()) with check (person_id = app.my_person_id() and app.is_gym_member(gym_id));
create policy setup_delete on public.personal_setup for delete to authenticated using (person_id = app.my_person_id());

revoke all on public.equipment_type, public.exercise_type, public.exercise, public.personal_setup from anon;
grant select on public.equipment_type, public.exercise_type to authenticated;
grant select, insert on public.exercise to authenticated;
grant select, insert, update, delete on public.personal_setup to authenticated;
revoke all on function app.is_any_editor() from public;
grant execute on function app.is_any_editor() to authenticated;
