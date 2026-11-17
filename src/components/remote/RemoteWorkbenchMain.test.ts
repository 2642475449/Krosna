// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@/i18n";
import { useRemoteWorkspaceStore } from "@/store/slices/remoteWorkspace";
import { RemoteWorkbenchMain } from "./RemoteWorkbenchMain";

vi.mock("./RemoteTerminal", () => ({
  RemoteTerminal: ({ hostId, session }: { hostId: string; session: { id: string } }) =>
    createElement("div", { "data-mock-remote-terminal": `${hostId}:${session.id}` }),
  RemoteAuthenticationTerminal: ({ hostId, active }: { hostId: string; active: boolean }) =>
    createElement("div", { "data-mock-auth-terminal": hostId, "data-active": String(active) }),
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useRemoteWorkspaceStore.setState(useRemoteWorkspaceStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useRemoteWorkspaceStore.setState(useRemoteWorkspaceStore.getInitialState(), true);
  vi.unstubAllGlobals();
});

it("renders the authentication terminal and quick reply input when host is authenticating", async () => {
  useRemoteWorkspaceStore.setState({
    visible: true,
    hosts: [{ id: "h-8g", name: "8g", target: "8g", sshConfigFile: "~/.ssh/config" }],
    selectedHostId: "h-8g",
    activeTab: null,
    connections: {
      "h-8g": {
        hostId: "h-8g",
        state: "authenticating",
        authOutput: "root@119.29.73.208's password:",
        authRevision: 1,
      },
    },
  });

  await act(async () => {
    root.render(createElement(RemoteWorkbenchMain, { visible: true }));
  });

  const authTerm = container.querySelector<HTMLElement>('[data-mock-auth-terminal="h-8g"]');
  expect(authTerm).not.toBeNull();
  expect(authTerm?.dataset.active).toBe("true");
  expect(container.querySelector(".app-remote-auth-reply")).not.toBeNull();
});
