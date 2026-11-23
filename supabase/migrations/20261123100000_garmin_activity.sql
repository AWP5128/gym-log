-- Step 74a: the Garmin watch sessions. One row per Garmin activity (strength, elliptical, bike, golf, walk), private to the
-- person who wore the watch. It holds the heart-rate data (average, maximum, seconds in each zone) and the watch's own times
-- and distance. The gym app stays master for times, distance and watts; the Garmin is master for heart rate.
-- The three links tie a session to the person's own workout so zones can be added up per workout, week or month:
-- workout_id is the level reports use; workout_type_id (legs, arms, abs, cardio) and workout_exercise_id are set only when
-- the match is clear. Ids start with the person ("awp:garmin:123456"), like the other private rows.
-- Additive: no existing table or column changes.

create table public.garmin_activity (
  id                  text primary key,                 -- person:garmin:activity id
  person_id           text not null references public.person (id) on delete cascade,
  garmin_id           text not null,
  activity_type       text not null,                    -- strength_training, elliptical, indoor_cycling, golf, walking ...
  name                text,
  start               timestamptz not null,
  "end"               timestamptz,
  duration_s          numeric,
  distance_m          numeric,
  avg_hr              numeric,
  max_hr              numeric,
  calories            numeric,
  zone1_s             numeric,
  zone2_s             numeric,
  zone3_s             numeric,
  zone4_s             numeric,
  zone5_s             numeric,
  workout_id          text references public.workout (id) on delete set null,
  workout_type_id     text references public.workout_type (id) on delete set null,
  workout_exercise_id text references public.workout_exercise (id) on delete set null,
  updated_at          timestamptz not null default now(),
  unique (person_id, garmin_id)
);
create index garmin_activity_person_start on public.garmin_activity (person_id, start);
create index garmin_activity_workout on public.garmin_activity (workout_id);

create trigger touch before update on public.garmin_activity for each row execute function app.touch();

alter table public.garmin_activity enable row level security;
create policy garmin_select on public.garmin_activity for select to authenticated using (person_id = app.my_person_id());
create policy garmin_insert on public.garmin_activity for insert to authenticated with check (
  person_id = app.my_person_id()
  and (workout_id is null or app.owns_workout(workout_id))
  and (workout_type_id is null or app.owns_workout_type(workout_type_id))
  and (workout_exercise_id is null or app.owns_workout_exercise(workout_exercise_id)));
create policy garmin_update on public.garmin_activity for update to authenticated
  using (person_id = app.my_person_id())
  with check (person_id = app.my_person_id()
    and (workout_id is null or app.owns_workout(workout_id))
    and (workout_type_id is null or app.owns_workout_type(workout_type_id))
    and (workout_exercise_id is null or app.owns_workout_exercise(workout_exercise_id)));
create policy garmin_delete on public.garmin_activity for delete to authenticated using (person_id = app.my_person_id());

revoke all on public.garmin_activity from anon;
grant select, insert, update, delete on public.garmin_activity to authenticated;

-- deletes are remembered for sync like the other private rows (person_id is a column here, so the trigger already finds it)
create trigger record_delete after delete on public.garmin_activity for each row execute function app.record_delete('id');
create trigger clear_delete  after insert on public.garmin_activity for each row execute function app.clear_delete('id');
