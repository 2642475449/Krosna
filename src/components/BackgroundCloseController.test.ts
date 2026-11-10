import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ state: {
  promptOpen: true, busy: false, remember: true, setRemember: vi.fn(), setPromptOpen: vi.fn(),
  documentPromptOpen: false, documentCloseIntent: "close", unsavedPaths: ["draft.md"],
  exitPreparing: false, closePreparing: false,
} }));
vi.mock("react", async (importOriginal) => ({ ...await importOriginal<typeof import("react")>(),
  useEffect: () => undefined, useCallback: <T>(callback: T) => callback,
}));
vi.mock("antd", () => ({ Modal: () => null, Button: () => null, Checkbox: () => null, Spin: () => null, message: { error: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/api", () => ({ onBackgroundSettingsChanged: vi.fn(), onWorkspaceCloseRequested: vi.fn(),
  onWorkspaceExitPreparationCancelled: vi.fn(), onWorkspaceExitPreparationRequested: vi.fn() }));
vi.mock("@/store/slices/background", () => ({
  useBackgroundStore: () => mocks.state,
  chooseWorkspaceClose: vi.fn(), refreshBackgroundSettings: vi.fn(), requestWorkspaceClose: vi.fn(),
  cancelWorkspaceDocumentClose: vi.fn(), resolveWorkspaceDocumentClose: vi.fn(), prepareWorkspaceExit: vi.fn(), cancelPreparedWorkspaceExit: vi.fn(),
}));
import { BackgroundCloseController } from "./BackgroundCloseController";

interface ModalProps { open: boolean; closable?: boolean; keyboard?: boolean; title?: string; children?: ReactNode }
function modals() {
  const output = BackgroundCloseController();
  return Children.toArray(output.props.children).filter(isValidElement) as ReactElement<ModalProps>[];
}
beforeEach(() => {
  Object.assign(mocks.state, { promptOpen: true, documentPromptOpen: false, exitPreparing: false, closePreparing: false });
});

it("keeps the destination unsaved-files modal mounted while replacing the close-choice modal", () => {
  mocks.state.promptOpen = false;
  mocks.state.documentPromptOpen = true;
  const views = modals();
  expect(views).toHaveLength(3);
  expect(views.map((view) => view.props.open)).toEqual([false, true, false]);
});

it.each(["closePreparing", "exitPreparing"] as const)("blocks workspace interaction during %s", (phase) => {
  mocks.state[phase] = true;
  mocks.state.documentPromptOpen = true;
  const views = modals();
  expect(views.map((view) => view.props.open)).toEqual([false, false, true]);
  expect(views[2].props).toMatchObject({ closable: false, keyboard: false });
});
