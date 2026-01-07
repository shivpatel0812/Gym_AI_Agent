export interface DefaultExercise {
  name: string;
  category: string;
  equipment: string;
  id: string;
}

const defaultExercises: DefaultExercise[] = [
  { name: "Dumbbell Bench Press", category: "CHEST", equipment: "Dumbbell", id: "default-chest-db-bench-press" },
  { name: "Incline Dumbbell Press", category: "CHEST", equipment: "Dumbbell", id: "default-chest-db-incline-press" },
  { name: "Decline Dumbbell Press", category: "CHEST", equipment: "Dumbbell", id: "default-chest-db-decline-press" },
  { name: "Dumbbell Flyes", category: "CHEST", equipment: "Dumbbell", id: "default-chest-db-flyes" },
  { name: "Incline Dumbbell Flyes", category: "CHEST", equipment: "Dumbbell", id: "default-chest-db-incline-flyes" },
  { name: "Dumbbell Pullover", category: "CHEST", equipment: "Dumbbell", id: "default-chest-db-pullover" },
  { name: "Barbell Bench Press", category: "CHEST", equipment: "Barbell", id: "default-chest-bb-bench-press" },
  { name: "Incline Barbell Bench", category: "CHEST", equipment: "Barbell", id: "default-chest-bb-incline-bench" },
  { name: "Decline Barbell Bench", category: "CHEST", equipment: "Barbell", id: "default-chest-bb-decline-bench" },
  { name: "Close-Grip Bench Press", category: "CHEST", equipment: "Barbell", id: "default-chest-bb-close-grip" },
  { name: "Cable Chest Fly (Mid)", category: "CHEST", equipment: "Cable", id: "default-chest-cable-fly-mid" },
  { name: "Cable Chest Fly (High to Low)", category: "CHEST", equipment: "Cable", id: "default-chest-cable-fly-high-low" },
  { name: "Cable Chest Fly (Low to High)", category: "CHEST", equipment: "Cable", id: "default-chest-cable-fly-low-high" },
  { name: "Single-Arm Cable Press", category: "CHEST", equipment: "Cable", id: "default-chest-cable-single-arm" },
  { name: "Chest Press Machine", category: "CHEST", equipment: "Machine", id: "default-chest-machine-press" },
  { name: "Pec Deck", category: "CHEST", equipment: "Machine", id: "default-chest-machine-pec-deck" },
  { name: "Hammer Strength Chest Press", category: "CHEST", equipment: "Machine", id: "default-chest-machine-hammer" },
  { name: "Push-Ups", category: "CHEST", equipment: "Bodyweight", id: "default-chest-bw-pushups" },
  { name: "Decline Push-Ups", category: "CHEST", equipment: "Bodyweight", id: "default-chest-bw-decline-pushups" },
  { name: "Chest Dips", category: "CHEST", equipment: "Bodyweight", id: "default-chest-bw-dips" },
  
  { name: "Dumbbell Shoulder Press", category: "SHOULDERS", equipment: "Dumbbell", id: "default-shoulders-db-press" },
  { name: "Arnold Press", category: "SHOULDERS", equipment: "Dumbbell", id: "default-shoulders-db-arnold" },
  { name: "Dumbbell Lateral Raises", category: "SHOULDERS", equipment: "Dumbbell", id: "default-shoulders-db-lateral" },
  { name: "Dumbbell Front Raises", category: "SHOULDERS", equipment: "Dumbbell", id: "default-shoulders-db-front" },
  { name: "Dumbbell Rear Delt Flyes", category: "SHOULDERS", equipment: "Dumbbell", id: "default-shoulders-db-rear-delt" },
  { name: "Dumbbell Upright Row", category: "SHOULDERS", equipment: "Dumbbell", id: "default-shoulders-db-upright-row" },
  { name: "Barbell Overhead Press", category: "SHOULDERS", equipment: "Barbell", id: "default-shoulders-bb-press" },
  { name: "Push Press", category: "SHOULDERS", equipment: "Barbell", id: "default-shoulders-bb-push-press" },
  { name: "Barbell Upright Row", category: "SHOULDERS", equipment: "Barbell", id: "default-shoulders-bb-upright-row" },
  { name: "Cable Lateral Raises", category: "SHOULDERS", equipment: "Cable", id: "default-shoulders-cable-lateral" },
  { name: "Cable Front Raises", category: "SHOULDERS", equipment: "Cable", id: "default-shoulders-cable-front" },
  { name: "Cable Rear Delt Flyes", category: "SHOULDERS", equipment: "Cable", id: "default-shoulders-cable-rear-delt" },
  { name: "Face Pulls", category: "SHOULDERS", equipment: "Cable", id: "default-shoulders-cable-face-pulls" },
  { name: "Shoulder Press Machine", category: "SHOULDERS", equipment: "Machine", id: "default-shoulders-machine-press" },
  { name: "Lateral Raise Machine", category: "SHOULDERS", equipment: "Machine", id: "default-shoulders-machine-lateral" },
  { name: "Reverse Pec Deck", category: "SHOULDERS", equipment: "Machine", id: "default-shoulders-machine-reverse-pec" },
  
  { name: "Dumbbell Curls", category: "BICEPS", equipment: "Dumbbell", id: "default-biceps-db-curls" },
  { name: "Alternating Dumbbell Curls", category: "BICEPS", equipment: "Dumbbell", id: "default-biceps-db-alternating" },
  { name: "Hammer Curls", category: "BICEPS", equipment: "Dumbbell", id: "default-biceps-db-hammer" },
  { name: "Incline Dumbbell Curls", category: "BICEPS", equipment: "Dumbbell", id: "default-biceps-db-incline" },
  { name: "Concentration Curls", category: "BICEPS", equipment: "Dumbbell", id: "default-biceps-db-concentration" },
  { name: "Barbell Curls", category: "BICEPS", equipment: "Barbell", id: "default-biceps-bb-curls" },
  { name: "EZ-Bar Curls", category: "BICEPS", equipment: "Barbell", id: "default-biceps-bb-ez-bar" },
  { name: "Preacher Curls (EZ or Barbell)", category: "BICEPS", equipment: "Barbell", id: "default-biceps-bb-preacher" },
  { name: "Cable Curls", category: "BICEPS", equipment: "Cable", id: "default-biceps-cable-curls" },
  { name: "Rope Hammer Curls", category: "BICEPS", equipment: "Cable", id: "default-biceps-cable-rope-hammer" },
  { name: "Single-Arm Cable Curls", category: "BICEPS", equipment: "Cable", id: "default-biceps-cable-single-arm" },
  { name: "Bicep Curl Machine", category: "BICEPS", equipment: "Machine", id: "default-biceps-machine-curls" },
  
  { name: "Overhead Dumbbell Extensions", category: "TRICEPS", equipment: "Dumbbell", id: "default-triceps-db-overhead" },
  { name: "Dumbbell Skull Crushers", category: "TRICEPS", equipment: "Dumbbell", id: "default-triceps-db-skull" },
  { name: "Dumbbell Kickbacks", category: "TRICEPS", equipment: "Dumbbell", id: "default-triceps-db-kickbacks" },
  { name: "Barbell Skull Crushers", category: "TRICEPS", equipment: "Barbell", id: "default-triceps-bb-skull" },
  { name: "Close-Grip Bench Press", category: "TRICEPS", equipment: "Barbell", id: "default-triceps-bb-close-grip" },
  { name: "Tricep Pushdowns", category: "TRICEPS", equipment: "Cable", id: "default-triceps-cable-pushdowns" },
  { name: "Rope Pushdowns", category: "TRICEPS", equipment: "Cable", id: "default-triceps-cable-rope" },
  { name: "Overhead Cable Extensions", category: "TRICEPS", equipment: "Cable", id: "default-triceps-cable-overhead" },
  { name: "Single-Arm Cable Pushdowns", category: "TRICEPS", equipment: "Cable", id: "default-triceps-cable-single-arm" },
  { name: "Tricep Extension Machine", category: "TRICEPS", equipment: "Machine", id: "default-triceps-machine-extension" },
  { name: "Assisted Dip Machine", category: "TRICEPS", equipment: "Machine", id: "default-triceps-machine-assisted-dip" },
  { name: "Bench Dips", category: "TRICEPS", equipment: "Bodyweight", id: "default-triceps-bw-bench-dips" },
  { name: "Parallel Bar Dips", category: "TRICEPS", equipment: "Bodyweight", id: "default-triceps-bw-parallel-dips" },
  
  { name: "Dumbbell Rows", category: "BACK", equipment: "Dumbbell", id: "default-back-db-rows" },
  { name: "Single-Arm Dumbbell Rows", category: "BACK", equipment: "Dumbbell", id: "default-back-db-single-arm-rows" },
  { name: "Dumbbell Deadlifts", category: "BACK", equipment: "Dumbbell", id: "default-back-db-deadlifts" },
  { name: "Dumbbell Shrugs", category: "BACK", equipment: "Dumbbell", id: "default-back-db-shrugs" },
  { name: "Deadlifts", category: "BACK", equipment: "Barbell", id: "default-back-bb-deadlifts" },
  { name: "Bent-Over Barbell Rows", category: "BACK", equipment: "Barbell", id: "default-back-bb-bent-over-rows" },
  { name: "Pendlay Rows", category: "BACK", equipment: "Barbell", id: "default-back-bb-pendlay-rows" },
  { name: "Barbell Shrugs", category: "BACK", equipment: "Barbell", id: "default-back-bb-shrugs" },
  { name: "Lat Pulldowns", category: "BACK", equipment: "Cable", id: "default-back-cable-lat-pulldown" },
  { name: "Seated Cable Rows", category: "BACK", equipment: "Cable", id: "default-back-cable-seated-rows" },
  { name: "Straight-Arm Pulldowns", category: "BACK", equipment: "Cable", id: "default-back-cable-straight-arm" },
  { name: "Single-Arm Cable Rows", category: "BACK", equipment: "Cable", id: "default-back-cable-single-arm-rows" },
  { name: "Assisted Pull-Up Machine", category: "BACK", equipment: "Machine", id: "default-back-machine-assisted-pullup" },
  { name: "Row Machine", category: "BACK", equipment: "Machine", id: "default-back-machine-row" },
  { name: "Hammer Strength Row", category: "BACK", equipment: "Machine", id: "default-back-machine-hammer-row" },
  { name: "Pull-Ups", category: "BACK", equipment: "Bodyweight", id: "default-back-bw-pullups" },
  { name: "Chin-Ups", category: "BACK", equipment: "Bodyweight", id: "default-back-bw-chinups" },
  { name: "Inverted Rows", category: "BACK", equipment: "Bodyweight", id: "default-back-bw-inverted-rows" },
  
  { name: "Goblet Squats", category: "LEGS", equipment: "Dumbbell", id: "default-legs-db-goblet-squats" },
  { name: "Dumbbell Lunges", category: "LEGS", equipment: "Dumbbell", id: "default-legs-db-lunges" },
  { name: "Dumbbell Step-Ups", category: "LEGS", equipment: "Dumbbell", id: "default-legs-db-step-ups" },
  { name: "Dumbbell Romanian Deadlifts", category: "LEGS", equipment: "Dumbbell", id: "default-legs-db-romanian-deadlift" },
  { name: "Back Squats", category: "LEGS", equipment: "Barbell", id: "default-legs-bb-back-squats" },
  { name: "Front Squats", category: "LEGS", equipment: "Barbell", id: "default-legs-bb-front-squats" },
  { name: "Romanian Deadlifts", category: "LEGS", equipment: "Barbell", id: "default-legs-bb-romanian-deadlift" },
  { name: "Conventional Deadlifts", category: "LEGS", equipment: "Barbell", id: "default-legs-bb-conventional-deadlift" },
  { name: "Good Mornings", category: "LEGS", equipment: "Barbell", id: "default-legs-bb-good-mornings" },
  { name: "Cable Squats", category: "LEGS", equipment: "Cable", id: "default-legs-cable-squats" },
  { name: "Cable Pull-Throughs", category: "LEGS", equipment: "Cable", id: "default-legs-cable-pull-throughs" },
  { name: "Cable Lunges", category: "LEGS", equipment: "Cable", id: "default-legs-cable-lunges" },
  { name: "Leg Press", category: "LEGS", equipment: "Machine", id: "default-legs-machine-leg-press" },
  { name: "Hack Squat", category: "LEGS", equipment: "Machine", id: "default-legs-machine-hack-squat" },
  { name: "Leg Extension", category: "LEGS", equipment: "Machine", id: "default-legs-machine-leg-extension" },
  { name: "Seated Leg Curl", category: "LEGS", equipment: "Machine", id: "default-legs-machine-seated-leg-curl" },
  { name: "Lying Leg Curl", category: "LEGS", equipment: "Machine", id: "default-legs-machine-lying-leg-curl" },
  
  { name: "Dumbbell Hip Thrusts", category: "GLUTES", equipment: "Dumbbell", id: "default-glutes-db-hip-thrusts" },
  { name: "Dumbbell Bulgarian Split Squats", category: "GLUTES", equipment: "Dumbbell", id: "default-glutes-db-bulgarian-squats" },
  { name: "Barbell Hip Thrusts", category: "GLUTES", equipment: "Barbell", id: "default-glutes-bb-hip-thrusts" },
  { name: "Barbell Glute Bridges", category: "GLUTES", equipment: "Barbell", id: "default-glutes-bb-glute-bridges" },
  { name: "Sumo Deadlifts", category: "GLUTES", equipment: "Barbell", id: "default-glutes-bb-sumo-deadlifts" },
  { name: "Cable Kickbacks", category: "GLUTES", equipment: "Cable", id: "default-glutes-cable-kickbacks" },
  { name: "Cable Pull-Throughs", category: "GLUTES", equipment: "Cable", id: "default-glutes-cable-pull-throughs" },
  { name: "Hip Abduction Machine", category: "GLUTES", equipment: "Machine", id: "default-glutes-machine-hip-abduction" },
  { name: "Glute Kickback Machine", category: "GLUTES", equipment: "Machine", id: "default-glutes-machine-kickback" },
  
  { name: "Dumbbell Standing Calf Raises", category: "CALVES", equipment: "Dumbbell", id: "default-calves-db-standing" },
  { name: "Dumbbell Seated Calf Raises", category: "CALVES", equipment: "Dumbbell", id: "default-calves-db-seated" },
  { name: "Barbell Standing Calf Raises", category: "CALVES", equipment: "Barbell", id: "default-calves-bb-standing" },
  { name: "Seated Calf Raise Machine", category: "CALVES", equipment: "Machine", id: "default-calves-machine-seated" },
  { name: "Standing Calf Raise Machine", category: "CALVES", equipment: "Machine", id: "default-calves-machine-standing" },
  { name: "Leg Press Calf Raises", category: "CALVES", equipment: "Machine", id: "default-calves-machine-leg-press" },
  
  { name: "Planks", category: "CORE / ABS", equipment: "Bodyweight", id: "default-core-bw-planks" },
  { name: "Side Planks", category: "CORE / ABS", equipment: "Bodyweight", id: "default-core-bw-side-planks" },
  { name: "Crunches", category: "CORE / ABS", equipment: "Bodyweight", id: "default-core-bw-crunches" },
  { name: "Leg Raises", category: "CORE / ABS", equipment: "Bodyweight", id: "default-core-bw-leg-raises" },
  { name: "Hanging Knee Raises", category: "CORE / ABS", equipment: "Bodyweight", id: "default-core-bw-hanging-knee" },
  { name: "Cable Crunches", category: "CORE / ABS", equipment: "Cable", id: "default-core-cable-crunches" },
  { name: "Woodchoppers", category: "CORE / ABS", equipment: "Cable", id: "default-core-cable-woodchoppers" },
  { name: "Pallof Press", category: "CORE / ABS", equipment: "Cable", id: "default-core-cable-pallof" },
  { name: "Weighted Sit-Ups", category: "CORE / ABS", equipment: "Weighted", id: "default-core-weighted-sit-ups" },
  { name: "Ab Rollouts", category: "CORE / ABS", equipment: "Weighted", id: "default-core-weighted-ab-rollouts" },
];

export const categories = ["CHEST", "SHOULDERS", "BICEPS", "TRICEPS", "BACK", "LEGS", "GLUTES", "CALVES", "CORE / ABS"];

export const categoryToMuscleGroup: Record<string, string> = {
  "CHEST": "Chest",
  "SHOULDERS": "Shoulders",
  "BICEPS": "Biceps",
  "TRICEPS": "Triceps",
  "BACK": "Back",
  "LEGS": "Legs",
  "GLUTES": "Glutes",
  "CALVES": "Calves",
  "CORE / ABS": "Core",
};

export function getExercisesByCategory(category: string): DefaultExercise[] {
  return defaultExercises.filter(ex => ex.category === category);
}

export function getExercisesByCategoryAndEquipment(category: string, equipment: string): DefaultExercise[] {
  return defaultExercises.filter(ex => ex.category === category && ex.equipment === equipment);
}

export function getAllDefaultExercises(): DefaultExercise[] {
  return defaultExercises;
}

export default defaultExercises;

