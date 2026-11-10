-- Step 29b: the server remembers deletions, so a phone that was away learns that a row is gone (an undone set, a removed
-- gym member). One row per deleted key. The key has the same form the app's sync engine builds: table|["pk","values"].
-- Deleting and re-adding the same row clears the memory of the delete. Written only by the triggers below.
-- Convention: ids of workout parts and exercises start with the person's id and a colon ("awp:main:2026-11-02:legs"),
-- and person ids contain no colon. That is how a delete is tied to its person when the workout row is already gone.

create table public.deleted_row (
  key        text primary key,
  table_name text not null,
  person_id  text,            -- whose private row it was
  gym_id     text,            -- the gym, for shared rows
  deleted_at timestamptz not null default now()
);
create index deleted_row_at on public.deleted_row (deleted_at);

create function app.sync_key(tbl text, rec jsonb, cols text[]) returns text language sql immutable as $$
  select tbl || '|[' || (select string_agg(to_json(rec ->> c)::text, ',' order by ord) from unnest(cols) with ordinality as u(c, ord)) || ']'
$$;

create function app.record_delete() returns trigger language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(old);
begin
  insert into public.deleted_row (key, table_name, person_id, gym_id, deleted_at) values (
    app.sync_key(tg_table_name, r, tg_argv), tg_table_name,
    case when tg_table_name in ('workout_type', 'workout_exercise') then split_part(r ->> 'id', ':', 1)
         when tg_table_name = 'person' then r ->> 'id'
         else r ->> 'person_id' end,
    case when tg_table_name = 'gym' then r ->> 'id' else r ->> 'gym_id' end,
    now())
  on conflict (key) do update set deleted_at = now(), person_id = excluded.person_id, gym_id = excluded.gym_id;
  return old;
end $$;

create function app.clear_delete() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.deleted_row where key = app.sync_key(tg_table_name, to_jsonb(new), tg_argv);
  return new;
end $$;

create trigger record_delete after delete on public.person           for each row execute function app.record_delete('id');
create trigger record_delete after delete on public.gym              for each row execute function app.record_delete('id');
create trigger record_delete after delete on public.gym_member       for each row execute function app.record_delete('person_id', 'gym_id');
create trigger record_delete after delete on public.gym_equipment    for each row execute function app.record_delete('gym_id', 'id');
create trigger record_delete after delete on public.personal_setup   for each row execute function app.record_delete('person_id', 'gym_id', 'exercise_id', 'day_type');
create trigger record_delete after delete on public.workout          for each row execute function app.record_delete('id');
create trigger record_delete after delete on public.workout_type     for each row execute function app.record_delete('id');
create trigger record_delete after delete on public.workout_exercise for each row execute function app.record_delete('id');
create trigger record_delete after delete on public.logged_set       for each row execute function app.record_delete('id');

create trigger clear_delete after insert on public.person           for each row execute function app.clear_delete('id');
create trigger clear_delete after insert on public.gym              for each row execute function app.clear_delete('id');
create trigger clear_delete after insert on public.gym_member       for each row execute function app.clear_delete('person_id', 'gym_id');
create trigger clear_delete after insert on public.gym_equipment    for each row execute function app.clear_delete('gym_id', 'id');
create trigger clear_delete after insert on public.personal_setup   for each row execute function app.clear_delete('person_id', 'gym_id', 'exercise_id', 'day_type');
create trigger clear_delete after insert on public.workout          for each row execute function app.clear_delete('id');
create trigger clear_delete after insert on public.workout_type     for each row execute function app.clear_delete('id');
create trigger clear_delete after insert on public.workout_exercise for each row execute function app.clear_delete('id');
create trigger clear_delete after insert on public.logged_set       for each row execute function app.clear_delete('id');

-- who learns of a delete: the person it belonged to, and members of the gym for shared rows
alter table public.deleted_row enable row level security;
create policy deleted_select on public.deleted_row for select to authenticated using (
  person_id = app.my_person_id()
  or (table_name in ('gym', 'gym_member', 'gym_equipment') and gym_id is not null and app.is_gym_member(gym_id))
);
revoke all on public.deleted_row from anon, authenticated;
grant select on public.deleted_row to authenticated;
