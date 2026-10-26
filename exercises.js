// Session types shown on the start screen.
// weights: true means the session offers a Heavy / Volume day type.
export const sessionTypes = [
  { id: "legs", label: "Legs", weights: true },
  { id: "arms", label: "Arms", weights: true },
  { id: "abs", label: "Abs", weights: true },
  { id: "cardio", label: "Cardio", weights: false },
];

// Units and step sizes are placeholders until checked at the gym.
// You can change names and steps on the Settings screen.
export const exercises = [
  // Legs
  { id: "hip-abduction", name: "Hip Abduction Machine", group: "legs", common: true, unit: "lb", step: 10 },
  { id: "hip-adduction", name: "Hip Adduction Machine", group: "legs", common: true, unit: "lb", step: 10 },
  { id: "calf-press", name: "Calf Press Machine", group: "legs", common: true, unit: "lb", step: 10 },
  { id: "leg-press", name: "Leg Press Machine", group: "legs", common: true, unit: "lb", step: 10 },
  { id: "squat-machine", name: "Squat Machine", group: "legs", common: true, unit: "lb", step: 10 },
  { id: "deadlift", name: "Deadlift (barbell)", group: "legs", common: true, unit: "kg", step: 2.5 },
  { id: "pull-up", name: "Pull-ups (neutral grip)", group: "legs", common: true, unit: "kg", step: 2.5, min: 0 },
  { id: "quad-extension", name: "Quad Extension Machine", group: "legs", common: false, unit: "lb", step: 10 },
  { id: "hamstring-curl", name: "Hamstring Curl Machine", group: "legs", common: false, unit: "lb", step: 10 },

  // Arms (upper body)
  { id: "shoulder-press", name: "Shoulder Press Machine", group: "arms", common: true, unit: "lb", step: 10 },
  { id: "chest-press", name: "Chest Press Machine", group: "arms", common: true, unit: "lb", step: 10 },
  { id: "tricep-dip", name: "Tricep Dip Machine", group: "arms", common: true, unit: "lb", step: 10 },
  { id: "bicep-curl", name: "Bicep Curl Machine", group: "arms", common: true, unit: "lb", step: 10 },
  { id: "tricep-extension", name: "Tricep Extension Machine", group: "arms", common: true, unit: "lb", step: 10 },
  { id: "lat-pulldown", name: "Lat Pull-down", group: "arms", common: true, unit: "lb", step: 10 },
  { id: "upright-row", name: "Upright Row", group: "arms", common: true, unit: "lb", step: 10 },
  { id: "farmers-hold", name: "Farmers Hold (dumbbells)", group: "arms", common: false, unit: "kg", step: 2.5 },
  { id: "delt-fly", name: "Delt Fly Machine", group: "arms", common: false, unit: "lb", step: 10 },
  { id: "rear-fly", name: "Rear Fly Machine", group: "arms", common: false, unit: "lb", step: 10 },
];

// Exercises for one session type (group). Pass the full list (built-in plus
// any you added on the Settings screen) as the third argument.
export function exercisesForGroup(group, includeLessCommon = false, list = exercises) {
  return list.filter(
    (e) => e.group === group && (includeLessCommon || e.common)
  );
}