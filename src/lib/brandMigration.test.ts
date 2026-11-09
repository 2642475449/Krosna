import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../public/migrate-storage.js", import.meta.url), "utf8");

function migrate(entries: Record<string, string>) {
  const values = new Map(Object.entries(entries));
  const localStorage = {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  runInNewContext(source, { localStorage });
  return values;
}

describe("brand storage migration", () => {
  it("preserves sessions, project scoped caches, and themes without changing unrelated storage", () => {
    const sessions = JSON.stringify({ version: 5, state: { projectSessions: { "/project": [{ id: "session" }] } } });
    const result = migrate({
      "termflow-settings": sessions,
      "termflow-startup-theme": '{"themeCategory":"light"}',
      "termflow-auxiliary-dock": '{"state":{"tabs":[{"id":"tab"}]}}',
      "other-tool": "unchanged",
    });
    expect(result.get("krosna-settings")).toBe(sessions);
    expect(result.get("krosna-startup-theme")).toBe('{"themeCategory":"light"}');
    expect(result.get("krosna-auxiliary-dock")).toContain('"tab"');
    expect(result.get("other-tool")).toBe("unchanged");
    expect(result.get("termflow-settings")).toBe(sessions);
  });

  it("never replaces newer settings, including an intentionally empty value", () => {
    const result = migrate({ "termflow-settings": "old", "krosna-settings": "new", "termflow-cache": "old", "krosna-cache": "" });
    expect(result.get("krosna-settings")).toBe("new");
    expect(result.get("krosna-cache")).toBe("");
  });

  it("allows startup when browser storage is unavailable", () => {
    expect(() => runInNewContext(source, { get localStorage() { throw new Error("denied"); } })).not.toThrow();
  });
});
