import { describe, expect, it, vi } from "vitest";

vi.mock("antd", () => ({ Tooltip: () => null }));
vi.mock("@ant-design/icons", () => ({
  CheckCircleOutlined: () => null,
  CloseCircleOutlined: () => null,
  LoadingOutlined: () => null,
  StopOutlined: () => null,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/store", () => ({ useAppStore: vi.fn() }));
vi.mock("@/store/slices/shortcutSlice", () => ({ useShortcutStore: vi.fn() }));

import { getBottomRunnerRailBadge, getBottomRunnerRailCounts } from "./BottomRunnerStatus";

describe("BottomRunnerStatus rail badge helpers", () => {
  it("counts starting and running tabs as running and error tabs as failed", () => {
    expect(
      getBottomRunnerRailCounts([
        { status: "starting" },
        { status: "running" },
        { status: "error" },
        { status: "success" },
        { status: "stopped" },
      ]),
    ).toEqual({ runningCount: 2, errorCount: 1 });
  });

  it("returns null when there are no running or failed tabs", () => {
    expect(getBottomRunnerRailBadge([{ status: "success" }, { status: "completed" }, { status: "stopped" }])).toBeNull();
  });

  it("returns running badge with count when tasks are starting or running", () => {
    expect(getBottomRunnerRailBadge([{ status: "starting" }, { status: "running" }])).toEqual({
      variant: "running",
      count: 2,
    });
  });

  it("prioritizes error badge with failed count over running badge to avoid double-badge collision", () => {
    expect(getBottomRunnerRailBadge([{ status: "running" }, { status: "error" }, { status: "error" }])).toEqual({
      variant: "error",
      count: 2,
    });
  });
});
