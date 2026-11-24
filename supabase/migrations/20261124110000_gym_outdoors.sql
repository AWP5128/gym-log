-- Step 77: a gym row can be marked outdoors (the one shared "Outdoors" place for Garmin golf rounds and walks). The app
-- leaves such a place out of its Gym lists because it has no equipment. Blank for every ordinary gym; nothing existing changes.
alter table public.gym add column outdoors boolean;
