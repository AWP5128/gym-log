// Session types shown on the start screen.
// weights: true means the session offers a Heavy / Volume day type.
export const sessionTypes = [
  { id: "legs", label: "Legs", weights: true },
  { id: "arms", label: "Arms", weights: true },
  { id: "abs", label: "Abs", weights: false },
  { id: "cardio", label: "Cardio", weights: false },
];

// Two kinds of exercise. A machine has a weight stack (lb, 10 lb steps). A free exercise uses
// free weights or body weight (kg, 2.5 kg steps). Units and steps are placeholders until checked
// at the gym; names and stacks are changed on the Machine setup screen.
const machine = (id, name, group, common = true) => ({ id, name, group, common, unit: "lb", step: 10 });
const free = (id, name, group, common = true, extra = {}) => ({ id, name, group, common, unit: "kg", step: 2.5, ...extra });

export const exercises = [
  // Legs
  machine("hip-abduction", "Hip Abduction Machine", "legs"),
  machine("hip-adduction", "Hip Adduction Machine", "legs"),
  machine("calf-press", "Calf Press Machine", "legs"),
  machine("leg-press", "Leg Press Machine", "legs"),
  machine("squat-machine", "Squat Machine", "legs"),
  free("deadlift", "Deadlift (barbell)", "legs"),
  free("pull-up", "Pull-ups (neutral grip)", "legs", true, { min: 0 }),
  machine("quad-extension", "Quad Extension Machine", "legs", false),
  machine("hamstring-curl", "Hamstring Curl Machine", "legs", false),

  // Arms (upper body)
  machine("shoulder-press", "Shoulder Press Machine", "arms"),
  machine("chest-press", "Chest Press Machine", "arms"),
  machine("tricep-dip", "Tricep Dip Machine", "arms"),
  machine("bicep-curl", "Bicep Curl Machine", "arms"),
  machine("tricep-extension", "Tricep Extension Machine", "arms"),
  machine("lat-pulldown", "Lat Pull-down", "arms"),
  machine("upright-row", "Upright Row", "arms"),
  free("farmers-hold", "Farmers Hold (dumbbells)", "arms", false),
  machine("delt-fly", "Delt Fly Machine", "arms", false),
  machine("rear-fly", "Rear Fly Machine", "arms", false),
];

// Exercises for one session type (group). Pass the full list (built-in plus
// any you added) as the third argument.
export function exercisesForGroup(group, includeLessCommon = false, list = exercises) {
  return list.filter(
    (e) => e.group === group && (includeLessCommon || e.common)
  );
}