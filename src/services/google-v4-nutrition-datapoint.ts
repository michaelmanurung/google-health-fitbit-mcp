import { createHash } from "node:crypto";
import type { MealType, NutrientMap } from "./nutrition-normalize.js";

export const NUTRITION_DATA_TYPE = "nutrition-log";

export interface NutritionFoodInput {
  food_name: string;
  amount_g: number;
  nutrients: Required<Pick<NutrientMap, "calories_kcal" | "protein_g" | "carbohydrates_g" | "fat_g">> & NutrientMap;
}

export interface NutritionMealInput {
  items: NutritionFoodInput[];
  meal_type?: MealType;
  eaten_at: string;
}

const OPTIONAL_NUTRIENTS: Array<[keyof NutrientMap, string, number]> = [
  ["protein_g", "PROTEIN", 1],
  ["fiber_g", "DIETARY_FIBER", 1],
  ["sugar_g", "SUGAR", 1],
  ["saturated_fat_g", "SATURATED_FAT", 1],
  ["sodium_mg", "SODIUM", 0.001]
];

export function buildNutritionDataPointBody(item: NutritionFoodInput, meal: Pick<NutritionMealInput, "meal_type" | "eaten_at">): Record<string, unknown> {
  const start = new Date(meal.eaten_at);
  if (!Number.isFinite(start.getTime())) throw new Error("Invalid eaten_at timestamp.");
  const end = new Date(start.getTime() + 1000);
  const offset = offsetSeconds(meal.eaten_at);
  const nutrients = OPTIONAL_NUTRIENTS.flatMap(([key, nutrient, factor]) => {
    const value = item.nutrients[key];
    return value === undefined ? [] : [{ nutrient, quantity: { grams: round(value * factor) } }];
  });
  const nutritionLog: Record<string, unknown> = {
    interval: {
      startTime: start.toISOString(),
      startUtcOffset: `${offset}s`,
      endTime: end.toISOString(),
      endUtcOffset: `${offset}s`
    },
    foodDisplayName: `${item.food_name} (${item.amount_g} g)`,
    energy: { kcal: item.nutrients.calories_kcal },
    totalCarbohydrate: { grams: item.nutrients.carbohydrates_g },
    totalFat: { grams: item.nutrients.fat_g },
    nutrients
  };
  if (meal.meal_type && meal.meal_type !== "other") nutritionLog.mealType = meal.meal_type.toUpperCase();
  return { nutritionLog };
}

export function nutritionPreviewFingerprint(meal: NutritionMealInput): string {
  return createHash("sha256").update(JSON.stringify(meal)).digest("hex");
}

function offsetSeconds(timestamp: string): number {
  if (timestamp.endsWith("Z")) return 0;
  const match = timestamp.match(/([+-])(\d{2}):(\d{2})$/);
  if (!match) throw new Error("eaten_at must include a timezone offset.");
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 3600 + Number(match[3]) * 60);
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}
