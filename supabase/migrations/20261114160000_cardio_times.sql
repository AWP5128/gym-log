-- A cardio entry keeps its start and end time (end = start + the duration). Both nullable, so nothing existing changes.
alter table public.workout_exercise add column start timestamptz;
alter table public.workout_exercise add column "end" timestamptz;
