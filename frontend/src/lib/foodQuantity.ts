import { FoodItem } from "../components/nutrition/types";

/**
 * Macros on a logged FoodItem are always the PRODUCT (per-unit x quantity) so
 * every total in the app keeps summing `calories` without knowing quantity
 * exists. These helpers are the only place that product is formed.
 */

export function foodQuantity(food: Pick<FoodItem, "quantity">): number {
  const q = Math.round(Number(food.quantity) || 1);
  return q > 0 ? q : 1;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Build a logged row from a PER-UNIT food and a count. Always scales from the
 * per-unit base rather than from the current row, so repeated bumps cannot
 * accumulate rounding drift.
 */
export function scaleFoodItem(base: FoodItem, quantity: number): FoodItem {
  const qty = Math.max(1, Math.round(quantity) || 1);
  const unit = base.unit_amount || base.amount;
  return {
    ...base,
    calories: Math.round((Number(base.calories) || 0) * qty),
    protein: round1((Number(base.protein) || 0) * qty),
    carbs: round1((Number(base.carbs) || 0) * qty),
    fats: round1((Number(base.fats) || 0) * qty),
    fiber: round1((Number(base.fiber) || 0) * qty),
    quantity: qty,
    unit_amount: unit,
    amount: qty > 1 ? (unit ? `${qty} × ${unit}` : `×${qty}`) : unit,
  };
}
