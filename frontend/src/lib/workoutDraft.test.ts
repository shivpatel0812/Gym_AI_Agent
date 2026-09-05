import { describe, expect, it } from "vitest";
import { workoutDraftStore, type DraftStorage } from "./workoutDraft";

function storage(): DraftStorage {
  const rows = new Map<string, string>();
  return {
    getItem: async key => rows.get(key) ?? null,
    setItem: async (key, value) => { rows.set(key, value); },
    removeItem: async key => { rows.delete(key); },
  };
}

describe("workout recovery", () => {
  it("restores a new session's retry ID, incomplete input and logged sets", async () => {
    const disk = storage();
    const draft = { sessionId: "retry-id", inputs: { weight: "12." }, sets: [{ reps: 7, weight: 25 }] };
    await workoutDraftStore(disk, "alice").save(draft);
    expect(await workoutDraftStore(disk, "alice").read()).toEqual(draft);
    expect(await workoutDraftStore(disk, "bob").read()).toBeNull();
  });

  it("does not let a slow write resurrect a successfully closed workout", async () => {
    const disk = storage();
    const write = disk.setItem;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    disk.setItem = async (key, value) => { await gate; await write(key, value); };
    const drafts = workoutDraftStore(disk, "alice");
    const saving = drafts.save({ reps: 7 });
    const clearing = drafts.clear();
    release();
    await Promise.all([saving, clearing]);
    expect(await drafts.read()).toBeNull();
  });

  it("can retry after storage fails without losing subsequent changes", async () => {
    const disk = storage();
    const write = disk.setItem;
    let failed = false;
    disk.setItem = async (key, value) => {
      if (!failed) { failed = true; throw new Error("storage unavailable"); }
      await write(key, value);
    };
    const drafts = workoutDraftStore(disk, "alice");
    await expect(drafts.save({ reps: 6 })).rejects.toThrow();
    await drafts.save({ reps: 8 });
    expect(await drafts.read()).toEqual({ reps: 8 });
  });
});
