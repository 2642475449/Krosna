import { create } from "zustand";
import { gitListBranches } from "@/lib/api";
import type { GitBranchListItem } from "@/types";

export const GIT_BRANCH_CACHE_TTL_MS = 5_000;
export const EMPTY_GIT_BRANCHES = {
  branches: [] as GitBranchListItem[],
  loading: false,
  error: null as string | null,
  updatedAt: null as number | null,
};
interface BranchStore {
  entries: Record<string, typeof EMPTY_GIT_BRANCHES>;
  /** Force starts a new generation, e.g. after a mutation or an explicit retry. */
  refresh: (path: string, options?: { force?: boolean }) => Promise<void>;
}
export const useGitBranchesStore = create<BranchStore>((set, get) => {
  const inFlight = new Map<string, Promise<void>>();
  return {
    entries: {},
    refresh: (path, { force = false } = {}) => {
      if (!force) {
        const pending = inFlight.get(path);
        if (pending) return pending;
        const entry = get().entries[path];
        if (
          entry?.updatedAt != null &&
          !entry.error &&
          Date.now() - entry.updatedAt < GIT_BRANCH_CACHE_TTL_MS
        ) {
          return Promise.resolve();
        }
      }

      // Install the request before notifying subscribers, so reentrant refreshes
      // share it too. A forced read supersedes any pre-mutation response.
      const request = Promise.resolve().then(async () => {
        try {
          const branches = await gitListBranches(path);
          if (inFlight.get(path) !== request) return;
          set((s) => ({
            entries: {
              ...s.entries,
              [path]: { branches, loading: false, error: null, updatedAt: Date.now() },
            },
          }));
        } catch (error) {
          if (inFlight.get(path) !== request) return;
          set((s) => ({
            entries: {
              ...s.entries,
              [path]: {
                ...(s.entries[path] ?? EMPTY_GIT_BRANCHES),
                loading: false,
                error: String(error),
              },
            },
          }));
        } finally {
          if (inFlight.get(path) === request) inFlight.delete(path);
        }
      });
      inFlight.set(path, request);
      set((s) => ({
        entries: {
          ...s.entries,
          [path]: {
            ...(s.entries[path] ?? EMPTY_GIT_BRANCHES),
            loading: true,
            error: null,
          },
        },
      }));
      return request;
    },
  };
});
