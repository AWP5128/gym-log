-- Step 85: single-leg sets. reps stays the total for the set; for a single-leg set reps_left and reps_right hold the reps done on
-- each leg (both filled, or both blank for an ordinary set). Blank for every existing row; nothing existing changes.
alter table public.logged_set
  add column reps_left  numeric check (reps_left >= 0),
  add column reps_right numeric check (reps_right >= 0),
  add constraint logged_set_both_legs check ((reps_left is null) = (reps_right is null));
