import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openTab: vi.fn(),
}));

vi.mock("@/store", () => ({
  useAppStore: {
    getState: () => ({ openTab: mocks.openTab }),
  },
}));

import {
  PENDING_SETTINGS_PAGE_KEY,
  SETTINGS_NAVIGATE_EVENT,
  SETTINGS_TAB_ID,
  consumePendingSettingsPage,
  isSettingsPage,
  openSettingsPage,
  readPendingSettingsPage,
} from "./settingsNavigation";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

it("recognizes valid settings page ids and rejects unknown values", () => {
  expect(isSettingsPage("network")).toBe(true);
  expect(isSettingsPage("agents")).toBe(true);
  expect(isSettingsPage("unknown")).toBe(false);
  expect(isSettingsPage(null)).toBe(false);
});

it("reads and consumes pending settings pages without leaking stale state", () => {
  const storage = createStorage();
  storage.setItem(PENDING_SETTINGS_PAGE_KEY, "network");

  expect(readPendingSettingsPage(storage)).toBe("network");
  expect(consumePendingSettingsPage(storage)).toBe("network");
  expect(consumePendingSettingsPage(storage)).toBeNull();
});

it("ignores invalid pending page ids", () => {
  const storage = createStorage();
  storage.setItem(PENDING_SETTINGS_PAGE_KEY, "nonexistent");

  expect(readPendingSettingsPage(storage)).toBeNull();
  expect(consumePendingSettingsPage(storage)).toBeNull();
  expect(storage.getItem(PENDING_SETTINGS_PAGE_KEY)).toBe("nonexistent");
});

it("writes pending page, opens the settings tab, and dispatches navigation event", () => {
  const storage = createStorage();
  const dispatchEvent = vi.fn();
  vi.stubGlobal("window", { sessionStorage: storage, dispatchEvent });
  vi.stubGlobal("CustomEvent", class {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  });

  try {
    openSettingsPage("network");
    expect(storage.getItem(PENDING_SETTINGS_PAGE_KEY)).toBe("network");
    expect(mocks.openTab).toHaveBeenCalledWith(SETTINGS_TAB_ID);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: SETTINGS_NAVIGATE_EVENT, detail: "network" }),
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
