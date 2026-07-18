export interface FoodDbItem {
  name: string;
  serving: string; // human-readable serving label
  grams: number; // grams in one serving
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}

const foodDatabase: FoodDbItem[] = [
  // Proteins
  { name: "Grilled Chicken Breast", serving: "180g", grams: 180, calories: 297, protein: 56, carbs: 0, fats: 6 },
  { name: "Chicken Thigh (skinless)", serving: "150g", grams: 150, calories: 265, protein: 36, carbs: 0, fats: 13 },
  { name: "Ground Beef (90/10)", serving: "150g cooked", grams: 150, calories: 264, protein: 39, carbs: 0, fats: 11 },
  { name: "Ground Turkey (93/7)", serving: "150g cooked", grams: 150, calories: 249, protein: 33, carbs: 0, fats: 12 },
  { name: "Salmon (baked)", serving: "1 fillet (170g)", grams: 170, calories: 350, protein: 34, carbs: 0, fats: 22 },
  { name: "Tuna (canned in water)", serving: "1 can (142g)", grams: 142, calories: 120, protein: 27, carbs: 0, fats: 1 },
  { name: "Shrimp (cooked)", serving: "150g", grams: 150, calories: 149, protein: 29, carbs: 1, fats: 2 },
  { name: "Tilapia (baked)", serving: "1 fillet (120g)", grams: 120, calories: 154, protein: 31, carbs: 0, fats: 3 },
  { name: "Eggs (whole)", serving: "2 large (100g)", grams: 100, calories: 143, protein: 13, carbs: 1, fats: 10 },
  { name: "Egg Whites", serving: "1 cup (243g)", grams: 243, calories: 126, protein: 26, carbs: 2, fats: 0 },
  { name: "Tofu (firm)", serving: "150g", grams: 150, calories: 108, protein: 12, carbs: 3, fats: 6 },
  { name: "Steak (sirloin)", serving: "170g cooked", grams: 170, calories: 344, protein: 52, carbs: 0, fats: 14 },
  { name: "Pork Tenderloin", serving: "150g cooked", grams: 150, calories: 216, protein: 39, carbs: 0, fats: 6 },
  { name: "Whey Protein Scoop", serving: "1 scoop (32g)", grams: 32, calories: 120, protein: 24, carbs: 3, fats: 1.5 },
  { name: "Deli Turkey Breast", serving: "85g", grams: 85, calories: 90, protein: 18, carbs: 2, fats: 1 },

  // Dairy
  { name: "Greek Yogurt (2%)", serving: "200g", grams: 200, calories: 190, protein: 20, carbs: 8, fats: 5 },
  { name: "Greek Yogurt (0%)", serving: "200g", grams: 200, calories: 118, protein: 20, carbs: 7, fats: 0.5 },
  { name: "Cottage Cheese (2%)", serving: "1 cup (226g)", grams: 226, calories: 183, protein: 24, carbs: 9, fats: 5 },
  { name: "Whole Milk", serving: "1 cup (244ml)", grams: 244, calories: 149, protein: 8, carbs: 12, fats: 8 },
  { name: "Skim Milk", serving: "1 cup (245ml)", grams: 245, calories: 83, protein: 8, carbs: 12, fats: 0 },
  { name: "Cheddar Cheese", serving: "30g", grams: 30, calories: 121, protein: 7, carbs: 1, fats: 10 },
  { name: "Mozzarella (part-skim)", serving: "30g", grams: 30, calories: 86, protein: 7, carbs: 1, fats: 6 },

  // Carbs / Grains
  { name: "White Rice (cooked)", serving: "150g cooked", grams: 150, calories: 195, protein: 4, carbs: 42, fats: 0 },
  { name: "Brown Rice (cooked)", serving: "150g cooked", grams: 150, calories: 165, protein: 3, carbs: 34, fats: 1 },
  { name: "Oats (dry)", serving: "50g dry", grams: 50, calories: 190, protein: 7, carbs: 34, fats: 3.5 },
  { name: "Granola", serving: "40g", grams: 40, calories: 180, protein: 4, carbs: 28, fats: 6 },
  { name: "Quinoa (cooked)", serving: "150g cooked", grams: 150, calories: 180, protein: 7, carbs: 32, fats: 3 },
  { name: "Sweet Potato (baked)", serving: "1 medium (150g)", grams: 150, calories: 135, protein: 3, carbs: 31, fats: 0 },
  { name: "White Potato (baked)", serving: "1 medium (173g)", grams: 173, calories: 161, protein: 4, carbs: 37, fats: 0 },
  { name: "Whole Wheat Bread", serving: "2 slices (56g)", grams: 56, calories: 138, protein: 7, carbs: 24, fats: 2 },
  { name: "White Bread", serving: "2 slices (50g)", grams: 50, calories: 133, protein: 4, carbs: 25, fats: 2 },
  { name: "Bagel (plain)", serving: "1 bagel (105g)", grams: 105, calories: 289, protein: 11, carbs: 56, fats: 2 },
  { name: "Pasta (cooked)", serving: "150g cooked", grams: 150, calories: 236, protein: 9, carbs: 46, fats: 1 },
  { name: "Tortilla (flour)", serving: "1 large (72g)", grams: 72, calories: 218, protein: 6, carbs: 36, fats: 5 },
  { name: "Cereal (Cheerios)", serving: "1 cup (28g)", grams: 28, calories: 100, protein: 3, carbs: 20, fats: 2 },
  { name: "Rice Cakes", serving: "2 cakes (18g)", grams: 18, calories: 70, protein: 1, carbs: 15, fats: 0.5 },

  // Fruits
  { name: "Banana", serving: "1 medium (118g)", grams: 118, calories: 105, protein: 1, carbs: 27, fats: 0 },
  { name: "Apple", serving: "1 medium (182g)", grams: 182, calories: 95, protein: 0.5, carbs: 25, fats: 0 },
  { name: "Blueberries", serving: "100g", grams: 100, calories: 57, protein: 1, carbs: 14, fats: 0 },
  { name: "Strawberries", serving: "1 cup (152g)", grams: 152, calories: 49, protein: 1, carbs: 12, fats: 0.5 },
  { name: "Orange", serving: "1 medium (131g)", grams: 131, calories: 62, protein: 1, carbs: 15, fats: 0 },
  { name: "Grapes", serving: "1 cup (151g)", grams: 151, calories: 104, protein: 1, carbs: 27, fats: 0 },
  { name: "Watermelon", serving: "1 cup (152g)", grams: 152, calories: 46, protein: 1, carbs: 12, fats: 0 },
  { name: "Pineapple", serving: "1 cup (165g)", grams: 165, calories: 82, protein: 1, carbs: 22, fats: 0 },
  { name: "Mango", serving: "1 cup (165g)", grams: 165, calories: 99, protein: 1, carbs: 25, fats: 0.5 },

  // Fats / Nuts
  { name: "Avocado", serving: "1/2 medium (100g)", grams: 100, calories: 160, protein: 2, carbs: 9, fats: 15 },
  { name: "Peanut Butter", serving: "2 tbsp (32g)", grams: 32, calories: 188, protein: 8, carbs: 6, fats: 16 },
  { name: "Almond Butter", serving: "2 tbsp (32g)", grams: 32, calories: 196, protein: 7, carbs: 6, fats: 18 },
  { name: "Almonds", serving: "28g (23 nuts)", grams: 28, calories: 164, protein: 6, carbs: 6, fats: 14 },
  { name: "Walnuts", serving: "28g", grams: 28, calories: 185, protein: 4, carbs: 4, fats: 18 },
  { name: "Cashews", serving: "28g", grams: 28, calories: 157, protein: 5, carbs: 9, fats: 12 },
  { name: "Olive Oil & Lemon", serving: "1 tbsp", grams: 14, calories: 119, protein: 0, carbs: 0, fats: 14 },
  { name: "Olive Oil", serving: "1 tbsp (14g)", grams: 14, calories: 119, protein: 0, carbs: 0, fats: 14 },
  { name: "Butter", serving: "1 tbsp (14g)", grams: 14, calories: 102, protein: 0, carbs: 0, fats: 12 },
  { name: "Chia Seeds", serving: "2 tbsp (24g)", grams: 24, calories: 116, protein: 4, carbs: 10, fats: 7 },

  // Veggies
  { name: "Broccoli (steamed)", serving: "1 cup (156g)", grams: 156, calories: 55, protein: 4, carbs: 11, fats: 0.5 },
  { name: "Mixed Greens", serving: "80g", grams: 80, calories: 20, protein: 2, carbs: 3, fats: 0 },
  { name: "Spinach (raw)", serving: "100g", grams: 100, calories: 23, protein: 3, carbs: 4, fats: 0 },
  { name: "Green Beans", serving: "1 cup (125g)", grams: 125, calories: 44, protein: 2, carbs: 10, fats: 0 },
  { name: "Asparagus", serving: "1 cup (134g)", grams: 134, calories: 27, protein: 3, carbs: 5, fats: 0 },
  { name: "Bell Pepper", serving: "1 medium (119g)", grams: 119, calories: 31, protein: 1, carbs: 7, fats: 0 },
  { name: "Carrots", serving: "1 cup (128g)", grams: 128, calories: 52, protein: 1, carbs: 12, fats: 0 },
  { name: "Cucumber", serving: "1 cup (104g)", grams: 104, calories: 16, protein: 1, carbs: 4, fats: 0 },

  // Drinks / Misc
  { name: "Black Coffee", serving: "240ml", grams: 240, calories: 5, protein: 0, carbs: 0, fats: 0 },
  { name: "Orange Juice", serving: "1 cup (248ml)", grams: 248, calories: 112, protein: 2, carbs: 26, fats: 0 },
  { name: "Protein Bar", serving: "1 bar (60g)", grams: 60, calories: 220, protein: 20, carbs: 23, fats: 7 },
  { name: "Dark Chocolate (70%)", serving: "30g", grams: 30, calories: 170, protein: 2, carbs: 13, fats: 12 },
  { name: "Hummus", serving: "2 tbsp (30g)", grams: 30, calories: 70, protein: 2, carbs: 4, fats: 5 },
  { name: "Honey", serving: "1 tbsp (21g)", grams: 21, calories: 64, protein: 0, carbs: 17, fats: 0 },
];

export default foodDatabase;
