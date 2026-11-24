-- Step 76: the two fixed lookup lists (equipment types, session types), seeded here. Phones never sync them (they are read only),
-- and the migrations never filled them, so a gym's equipment or a workout part could not be saved online. Golf and Walking are the
-- two outdoor session types for Garmin activities. A test keeps this file equal to the lists in the app. Safe to repeat.

insert into public.equipment_type (id, label) values
  ('stack', 'Stack machine'),
  ('dumbbell', 'Dumbbells'),
  ('barbell', 'Barbell'),
  ('plate', 'Plate-loaded machine'),
  ('bodyweight', 'Body weight'),
  ('cardio', 'Cardio machine')
on conflict (id) do nothing;

insert into public.exercise_type (id, label, day_types) values
  ('legs', 'Legs', '{heavy,volume}'),
  ('arms', 'Arms', '{heavy,volume}'),
  ('abs', 'Abs', '{}'),
  ('cardio', 'Cardio', '{}'),
  ('golf', 'Golf', '{}'),
  ('walking', 'Walking', '{}')
on conflict (id) do nothing;
