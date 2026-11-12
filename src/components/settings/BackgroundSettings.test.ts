import { beforeEach, expect, it, vi } from "vitest";
import type { BackgroundSettings as BackgroundSettingsValue } from "@/lib/api";
import type { WorkspaceCloseBehavior } from "@/store/slices/background";

const mocks = vi.hoisted(() => ({
  state: { settings: { runInBackground: true, askBeforeClose: true } as BackgroundSettingsValue, ready: true, busy: false },
  save: vi.fn(),
  error: vi.fn(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("antd", () => ({ Select: () => null, message: { error: mocks.error } }));
vi.mock("@/store/slices/background", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/store/slices/background")>(),
  useBackgroundStore: () => mocks.state,
  saveWorkspaceCloseBehavior: mocks.save,
}));
import { BackgroundSettings } from "./BackgroundSettings";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { settings: { runInBackground: true, askBeforeClose: true }, ready: true, busy: false };
  mocks.save.mockResolvedValue(undefined);
});

it("replaces two competing switches with one choice reflecting the effective behavior", () => {
  const row = BackgroundSettings();
  const control = row.props.children;
  expect(row.props.label).toBe("background.closeBehavior");
  expect(row.props.description).toBe("background.closeBehaviorDescription.ask");
  expect(control.props.value).toBe("ask");
  expect(control.props.options.map((option: { value: string }) => option.value)).toEqual(["ask", "background", "close"]);
  expect(control.props["aria-label"]).toBe("background.closeBehavior");
});

it.each<WorkspaceCloseBehavior>(["ask", "background", "close"])("saves the selected %s behavior", async (behavior) => {
  BackgroundSettings().props.children.props.onChange(behavior);
  await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledExactlyOnceWith(behavior));
});

it.each([{ ready: false, busy: false }, { ready: true, busy: true }])("disables changes while settings are unavailable or saving: %j", (state) => {
  Object.assign(mocks.state, state);
  const control = BackgroundSettings().props.children;
  expect(control.props.disabled).toBe(true);
  expect(control.props.loading).toBe(true);
});

it("reports a failed save instead of silently changing the close preference", async () => {
  mocks.save.mockRejectedValueOnce(new Error("storage unavailable"));
  BackgroundSettings().props.children.props.onChange("close");
  await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledWith("background.actionFailed"));
});
