-- Step 28d: the training log. Tables workout, workout_type, workout_exercise, logged_set.
-- A workout is private to the person who did it. Ids start with the person ("awp:main:2026-11-02") so two people's
-- rows never collide. Totals, bests and times per machine are calculated, never stored.

create table public.workout (
  id        text primary key,                      -- person:gym:date
  person_id text not null references public.person (id) on delete cascade,
  gym_id    text not null references public.gym (id) on delete cascade,
  date      date not null,
  start     timestamptz,
  "end"     timestamptz,
  updated_at timestamptz not null default now(),
  unique (person_id, gym_id, date)                 -- one per person, gym and day
);
create index workout_person_date on public.workout (person_id, date);

-- the part of a workout done as one kind of session (Arms heavy, then Abs, then Cardio), each with its own start and end
create table public.workout_type (
  id               text primary key,
  workout_id       text not null references public.workout (id) on delete cascade,
  exercise_type_id text not null references public.exercise_type (id),
  day_type         text check (day_type in ('heavy', 'volume')),
  start            timestamptz,
  "end"            timestamptz,
  updated_at       timestamptz not null default now(),
  unique (workout_id, exercise_type_id)
);

-- one exercise within a part; the cardio fields stay empty until there is data
create table public.workout_exercise (
  id              text primary key,
  workout_type_id text not null references public.workout_type (id) on delete cascade,
  exercise_id     text not null references public.exercise (id),
  distance        numeric,
  avg_heart_rate  numeric,
  zone_minutes    jsonb,
  watts           numeric,
  level           numeric,
  updated_at      timestamptz not null default now(),
  unique (workout_type_id, exercise_id)
);

-- person_id is kept on every set so the access rule is one simple check, and because a typed-in best from before the
-- app (manual = true, no workout, no time) belongs to a person but to no workout
create table public.logged_set (
  id                  text primary key,
  seq                 integer,                     -- place in the old flat list, keeps the order
  person_id           text not null references public.person (id) on delete cascade,
  workout_exercise_id text references public.workout_exercise (id) on delete cascade,
  exercise_id         text not null references public.exercise (id),
  gym_id              text not null references public.gym (id) on delete cascade,
  time                timestamptz,
  weight              numeric,
  reps                numeric,
  minutes             numeric,
  unit                text check (unit in ('kg', 'lb')),
  mode                text check (mode in ('heavy', 'volume')),
  manual              boolean not null default false,
  updated_at          timestamptz not null default now(),
  check (manual or (workout_exercise_id is not null and time is not null))
);
create index logged_set_exercise on public.logged_set (person_id, exercise_id);
create index logged_set_workout  on public.logged_set (workout_exercise_id);

create trigger touch before update on public.workout          for each row execute function app.touch();
create trigger touch before update on public.workout_type     for each row execute function app.touch();
create trigger touch before update on public.workout_exercise for each row execute function app.touch();
create trigger touch before update on public.logged_set       for each row execute function app.touch();

-- ---------- Who may see and change what ----------
create function app.owns_workout(w text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workout where id = w and person_id = app.my_person_id())
$$;
create function app.owns_workout_type(w text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workout_type t join public.workout x on x.id = t.workout_id
                  where t.id = w and x.person_id = app.my_person_id())
$$;
create function app.owns_workout_exercise(w text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workout_exercise e
                  join public.workout_type t on t.id = e.workout_type_id join public.workout x on x.id = t.workout_id
                  where e.id = w and x.person_id = app.my_person_id())
$$;

alter table public.workout          enable row level security;
alter table public.workout_type     enable row level security;
alter table public.workout_exercise enable row level security;
alter table public.logged_set       enable row level security;

-- you log at a gym you are an active member of; everything is yours alone
create policy workout_select on public.workout for select to authenticated using (person_id = app.my_person_id());
create policy workout_insert on public.workout for insert to authenticated
  with check (person_id = app.my_person_id() and app.is_gym_member(gym_id));
create policy workout_update on public.workout for update to authenticated
  using (person_id = app.my_person_id()) with check (person_id = app.my_person_id() and app.is_gym_member(gym_id));
create policy workout_delete on public.workout for delete to authenticated using (person_id = app.my_person_id());

create policy wtype_select on public.workout_type for select to authenticated using (app.owns_workout(workout_id));
create policy wtype_insert on public.workout_type for insert to authenticated with check (app.owns_workout(workout_id));
create policy wtype_update on public.workout_type for update to authenticated
  using (app.owns_workout(workout_id)) with check (app.owns_workout(workout_id));
create policy wtype_delete on public.workout_type for delete to authenticated using (app.owns_workout(workout_id));

create policy wex_select on public.workout_exercise for select to authenticated using (app.owns_workout_type(workout_type_id));
create policy wex_insert on public.workout_exercise for insert to authenticated with check (app.owns_workout_type(workout_type_id));
create policy wex_update on public.workout_exercise for update to authenticated
  using (app.owns_workout_type(workout_type_id)) with check (app.owns_workout_type(workout_type_id));
create policy wex_delete on public.workout_exercise for delete to authenticated using (app.owns_workout_type(workout_type_id));

create policy set_select on public.logged_set for select to authenticated using (person_id = app.my_person_id());
create policy set_insert on public.logged_set for insert to authenticated with check (
  person_id = app.my_person_id() and app.is_gym_member(gym_id)
  and (workout_exercise_id is null or app.owns_workout_exercise(workout_exercise_id)));
create policy set_update on public.logged_set for update to authenticated
  using (person_id = app.my_person_id())
  with check (person_id = app.my_person_id() and app.is_gym_member(gym_id)
              and (workout_exercise_id is null or app.owns_workout_exercise(workout_exercise_id)));
create policy set_delete on public.logged_set for delete to authenticated using (person_id = app.my_person_id());

revoke all on public.workout, public.workout_type, public.workout_exercise, public.logged_set from anon;
grant select, insert, update, delete on public.workout, public.workout_type, public.workout_exercise, public.logged_set to authenticated;
revoke all on function app.owns_workout(text), app.owns_workout_type(text), app.owns_workout_exercise(text) from public;
grant execute on function app.owns_workout(text), app.owns_workout_type(text), app.owns_workout_exercise(text) to authenticated;
