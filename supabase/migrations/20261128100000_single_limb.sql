-- A person can switch on single limb logging (left and right reps) for an exercise at a gym. Kept on the personal_setup row for that
-- person, gym and exercise (day_type 'none'), like never and use. Nullable (true or blank), so nothing existing changes.
alter table public.personal_setup add column single_limb boolean;
