export interface DraftStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Serialize writes and removal so an older write cannot resurrect a draft. */
export function workoutDraftStore<T>(storage: DraftStorage, userId: string) {
  const key = `workout-draft:v1:${userId}`;
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = <R>(task: () => Promise<R>): Promise<R> => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };
  return {
    read: () => enqueue(async (): Promise<T | null> => {
      const raw = await storage.getItem(key);
      return raw ? JSON.parse(raw) as T : null;
    }),
    save: (draft: T) => {
      const serialized = JSON.stringify(draft);
      return enqueue(() => storage.setItem(key, serialized));
    },
    clear: () => enqueue(() => storage.removeItem(key)),
  };
}

/** Reused for every retry of a new session, including after restoring a draft. */
export function newWorkoutId() {
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
