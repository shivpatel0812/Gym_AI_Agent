import { beforeEach, expect, it, vi } from "vitest";
import apiClient from "./client";
import { updateNutritionPlan } from "./nutritionPlan";

vi.mock("./client", () => ({ default: { patch: vi.fn() } }));
const patch = vi.mocked(apiClient.patch);
beforeEach(() => patch.mockReset());

it("persists rapid whole-list edits in tap order", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  let stored: unknown;
  patch.mockImplementationOnce(async (_url, body) => {
    await gate;
    stored = body;
    return { data: { plan: body } };
  }).mockImplementationOnce(async (_url, body) => {
    stored = body;
    return { data: { plan: body } };
  });
  const first = updateNutritionPlan("ordered", { go_to_items: [{ name: "Yogurt", days: ["mon"] }] });
  const latest = { go_to_items: [{ name: "Yogurt", days: ["mon", "tue"] }] };
  const second = updateNutritionPlan("ordered", latest);
  await vi.waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  finish();
  await Promise.all([first, second]);
  expect(stored).toEqual(latest);
});

it("reports a failed save and still allows the next save", async () => {
  patch.mockRejectedValueOnce(new Error("offline"));
  patch.mockResolvedValueOnce({ data: { plan: { id: "retry" } } });
  const first = updateNutritionPlan("retry", {});
  const failure = expect(first).rejects.toThrow("offline");
  const next = updateNutritionPlan("retry", {});
  await failure;
  await expect(next).resolves.toEqual({ id: "retry" });
});

it("does not block a different plan behind a pending save", async () => {
  let finish!: () => void;
  patch.mockImplementationOnce(() => new Promise((resolve) => {
    finish = () => resolve({ data: { plan: { id: "one" } } });
  }));
  patch.mockResolvedValueOnce({ data: { plan: { id: "two" } } });
  const first = updateNutritionPlan("one", {});
  const second = updateNutritionPlan("two", {});
  await expect(second).resolves.toEqual({ id: "two" });
  finish();
  await first;
});
