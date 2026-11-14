-- Cardio machines: a gym remembers it has had the starter cardio machines added (like starter_abs), and a cardio
-- machine can switch off watts (null or true = records watts). Both are nullable, so nothing existing changes.
alter table public.gym add column starter_cardio boolean;
alter table public.gym_equipment add column watts boolean;
