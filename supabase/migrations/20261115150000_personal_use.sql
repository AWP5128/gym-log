-- A person can mark an exercise Normal or Rare at a gym (Rare: under "Show less common"), the same row that holds the
-- never mark. Only a choice that differs from the exercise's own default is stored. Nullable, so nothing existing changes.
alter table public.personal_setup add column use text check (use in ('normal', 'rare'));
