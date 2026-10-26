// Units and step sizes are placeholders until checked at the gym.
export const exercises = [
  // Legs day
  { id: "hip-abduction", name: "Hip Abduction Machine", group: "legs", common: true, unit: "lb", step: 10 },
  { id: "hip-adduction", name: "Hip Adduction Machine", group: "legs", common: true, unit: "lb", step: 10 },
  { id: "calf-press", name: "Calf Press Machine", group: "legs", common: true, unit: "lb", step: 10 },
    { id: "leg-press", name: "Leg Press Machine", group: "legs", common: true, unit: "lb", step: 10, defaultWeight: 130 },
  { id: "squat-machine", name: "Squat Machine", group: "legs", common: true, unit: "lb", step: 10 },
  { id: "deadlift", name: "Deadlift (barbell)", group: "legs", common: true, unit: "kg", step: 2.5 },
  { id: "pull-up", name: "Pull-ups (neutral grip)", group: "legs", common: true, unit: "kg", step: 2.5, min: 0 },
  { id: "quad-extension", name: "Quad Extension Machine", group: "legs", common: false, unit: "lb", step: 10 },
  { id: "hamstring-curl", name: "Hamstring Curl Machine", group: "legs", common: false, unit: "lb", step: 10 },

  // Upper day
  { id: "shoulder-press", name: "Shoulder Press Machine", group: "upper", common: true, unit: "lb", step: 10 },
  { id: "chest-press", name: "Chest Press Machine", group: "upper", common: true, unit: "lb", step: 10 },
  { id: "tricep-dip", name: "Tricep Dip Machine", group: "upper", common: true, unit: "lb", step: 10 },
  { id: "bicep-curl", name: "Bicep Curl Machine", group: "upper", common: true, unit: "lb", step: 10 },
  { id: "tricep-extension", name: "Tricep Extension Machine", group: "upper", common: true, unit: "lb", step: 10 },
  { id: "lat-pulldown", name: "Lat Pull-down", group: "upper", common: true, unit: "lb", step: 10 },
  { id: "upright-row", name: "Upright Row", group: "upper", common: true, unit: "lb", step: 10 },
  { id: "farmers-hold", name: "Farmers Hold (dumbbells)", group: "upper", common: false, unit: "kg", step: 2.5 },
  { id: "delt-fly", name: "Delt Fly Machine", group: "upper", common: false, unit: "lb", step: 10 },
  { id: "rear-fly", name: "Rear Fly Machine", group: "upper", common: false, unit: "lb", step: 10 },
];

// day: "legs", "upper" or "combined" (combined shows both lists)
export function exercisesForDay(day, includeLessCommon = false) {
  const groups = day === "combined" ? ["legs", "upper"] : [day];
  return exercises.filter(
    (e) => groups.includes(e.group) && (includeLessCommon || e.common)
  );
}