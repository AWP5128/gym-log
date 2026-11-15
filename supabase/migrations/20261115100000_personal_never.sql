-- A person can mark an exercise "never used" at a gym: it is hidden from all their lists there. Kept on the
-- personal_setup row for that person, gym and exercise (day_type 'none'). Nullable, so nothing existing changes.
alter table public.personal_setup add column never boolean;
