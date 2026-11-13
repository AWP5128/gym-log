-- Step 31: least privilege. A hosted Supabase project grants EVERY privilege on every new table in schema public to anon and
-- authenticated (select, insert, update, delete, truncate, references, trigger). Row-level security already stops reading and
-- writing rows without a policy, but TRUNCATE and the others are not what the app needs, and the earlier migrations only took
-- the rights away from anon. This takes everything back and grants exactly what the app uses, and makes tables and functions
-- created later start with NO rights for the browser roles (each new migration must grant what it needs, as they already do).
-- The laptop's service role and the dashboard are not affected.

revoke all on all tables in schema public from anon, authenticated;

grant select, insert, update, delete on public.person, public.gym, public.gym_member, public.gym_equipment, public.personal_setup,
  public.workout, public.workout_type, public.workout_exercise, public.logged_set to authenticated;
grant select on public.equipment_type, public.exercise_type, public.deleted_row to authenticated;     -- lists and delete notes: read only
grant select, insert on public.exercise to authenticated;                                              -- owners and editors add exercises (policy)
-- invite: no rights at all, on purpose (only the service role and the dashboard)

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
