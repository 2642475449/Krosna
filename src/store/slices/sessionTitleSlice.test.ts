import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore, createAppStore } from "@/store";
import * as api from "@/lib/api";
import { setSessionTitlePrompt, startSessionTitleGeneration, retrySessionTitle } from "./sessionTitleSlice";

let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().initializeWindowContext({ windowLabel: "project-a", mode: "project", projectPath: "E:/A", projectName: "A" });
  useAppStore.getState().addSession({ id: "a", path: "E:/A", name: "会话", createdAt: 1, active: true, agentId: "claude" });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("does not write a late title into a project this window no longer owns", async () => {
  let resolve!: (title: string) => void;
  vi.spyOn(api, "generateSessionTitle").mockImplementation(() => new Promise<string>((done) => { resolve = done; }));
  setSessionTitlePrompt("a", "检查系统 bug");
  stop = startSessionTitleGeneration();
  await vi.advanceTimersByTimeAsync(1);
  useAppStore.getState().initializeWindowContext({ windowLabel: "project-a", mode: "project", projectPath: "E:/B", projectName: "B" });
  useAppStore.getState().addSession({ id: "b", path: "E:/B", name: "B 会话", createdAt: 2, active: true });
  resolve("系统缺陷排查");
  await vi.advanceTimersByTimeAsync(1);
  const state = useAppStore.getState();
  expect(state.projectSessions["E:/A"][0].generatedTitle).toBeUndefined();
  expect(state.sessions[0].name).toBe("B 会话");
  expect(state.tabsById.b.title).toBe("B 会话");
});

it("protects a manual rename from both completion and explicit retry", async () => {
  let resolve!: (title: string) => void;
  const generate = vi.spyOn(api, "generateSessionTitle").mockImplementation(() => new Promise<string>((done) => { resolve = done; }));
  setSessionTitlePrompt("a", "检查系统 bug");
  stop = startSessionTitleGeneration();
  await vi.advanceTimersByTimeAsync(1);
  useAppStore.getState().updateSession("a", { name: "我的名字", titleSource: "manual" });
  resolve("系统缺陷排查");
  await vi.advanceTimersByTimeAsync(1);
  retrySessionTitle("a");
  await vi.advanceTimersByTimeAsync(1);
  expect(useAppStore.getState().sessions[0].manualTitle).toBe("我的名字");
  expect(useAppStore.getState().tabsById.a.title).toBe("我的名字");
  expect(generate).toHaveBeenCalledOnce();
});

it("round-trips retry state and separate titles through actual Zustand persistence", () => {
  let saved: string | null = null;
  const storage = { getItem: () => saved, setItem: (_: string, value: string) => { saved = value; }, removeItem: () => {} };
  const store = createAppStore(storage);
  store.getState().setCurrentProject({ name: "A", path: "E:/A" });
  store.getState().addSession({ id: "a", path: "E:/A", name: "临时标题", createdAt: 1, active: true,
    titleSource: "auto", temporaryTitle: "临时标题", titleGeneration: {
      prompt: "检查系统 bug", status: "failed", attempts: 2, error: "offline", nextRetryAt: 12345,
    },
  });
  const restored = createAppStore(storage).getState().projectSessions["E:/A"][0];
  expect(restored.temporaryTitle).toBe("临时标题");
  expect(restored.generatedTitle).toBeUndefined();
  expect(restored.titleGeneration).toMatchObject({ status: "failed", error: "offline", attempts: 2, nextRetryAt: 12345 });
});

it("ignores late Codex titles after the window switches project", async () => {
  let resolve!: (titles: Record<string, string>) => void;
  const read = vi.spyOn(api, "readCodexSessionTitles").mockImplementation(() => new Promise((done) => { resolve = done; }));
  const generate = vi.spyOn(api, "generateSessionTitle").mockResolvedValue("不应生成");
  useAppStore.getState().updateSession("a", { agentId: "codex", agentSessionId: "thread-a" });
  setSessionTitlePrompt("a", "修复登录问题");
  stop = startSessionTitleGeneration();
  await vi.advanceTimersByTimeAsync(1);
  useAppStore.getState().initializeWindowContext({ windowLabel: "project-a", mode: "project", projectPath: "E:/B", projectName: "B" });
  resolve({ "thread-a": "Codex 原生：登录流程修复" });
  await vi.advanceTimersByTimeAsync(60_001);
  const state = useAppStore.getState();
  expect(read).toHaveBeenCalledWith(["thread-a"]);
  expect(generate).not.toHaveBeenCalled();
  expect(state.projectSessions["E:/A"][0].nativeTitle).toBeUndefined();
  expect(state.sessions).toEqual([]);
});

it("round-trips native Codex names and AI fallback deadlines through Zustand persistence", () => {
  let saved: string | null = null;
  const storage = { getItem: () => saved, setItem: (_: string, value: string) => { saved = value; }, removeItem: () => {} };
  const store = createAppStore(storage);
  store.getState().setCurrentProject({ name: "A", path: "E:/A" });
  store.getState().addSession({ id: "a", path: "E:/A", name: "原生名称", createdAt: 1, active: true,
    agentId: "codex", agentSessionId: "thread-a", nativeTitle: { sessionId: "thread-a", title: "原生名称" },
    temporaryTitle: "临时名称", titleGeneration: {
      prompt: "检查系统 bug", status: "pending", attempts: 0, notBefore: 12345,
    },
  });
  const restored = createAppStore(storage).getState().projectSessions["E:/A"][0];
  expect(restored.nativeTitle).toEqual({ sessionId: "thread-a", title: "原生名称" });
  expect(restored.name).toBe("原生名称");
  expect(restored.titleGeneration?.notBefore).toBe(12345);
});

it("does not execute another project's restored jobs or any jobs from a launcher", async () => {
  const generate = vi.spyOn(api, "generateSessionTitle").mockResolvedValue("不应生成");
  const read = vi.spyOn(api, "readCodexSessionTitles").mockResolvedValue({});
  useAppStore.setState((state) => ({ projectSessions: { ...state.projectSessions, "E:/B": [{
    id: "foreign", path: "E:/B", name: "旧标题", createdAt: 1, active: false, agentId: "claude",
    titleGeneration: { prompt: "其他项目的任务", status: "pending", attempts: 0 },
  }] } }));
  stop = startSessionTitleGeneration();
  await vi.advanceTimersByTimeAsync(100);
  expect(generate).not.toHaveBeenCalled();
  stop();
  useAppStore.getState().initializeWindowContext({ windowLabel: "main", mode: "launcher", projectPath: null, projectName: null });
  stop = startSessionTitleGeneration();
  await vi.advanceTimersByTimeAsync(100);
  expect(generate).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

it("starts restored work only after project ownership is ready", async () => {
  const generate = vi.spyOn(api, "generateSessionTitle").mockResolvedValue("修复登录状态");
  setSessionTitlePrompt("a", "修复登录状态");
  useAppStore.setState({ windowContextReady: false });
  stop = startSessionTitleGeneration();
  await vi.advanceTimersByTimeAsync(100);
  expect(generate).not.toHaveBeenCalled();
  useAppStore.setState({ windowContextReady: true });
  await vi.advanceTimersByTimeAsync(100);
  expect(generate).toHaveBeenCalledOnce();
  expect(useAppStore.getState().sessions[0].generatedTitle).toBe("修复登录状态");
});

it("recovers a generating job when ownership becomes ready", async () => {
  const generate = vi.spyOn(api, "generateSessionTitle").mockResolvedValue("恢复标题任务");
  useAppStore.getState().updateSession("a", { titleGeneration: {
    prompt: "恢复标题任务", status: "generating", attempts: 1, requestId: "old-process",
  } });
  useAppStore.setState({ windowContextReady: false });
  stop = startSessionTitleGeneration();
  await vi.advanceTimersByTimeAsync(10);
  expect(generate).not.toHaveBeenCalled();
  useAppStore.setState({ windowContextReady: true });
  await vi.advanceTimersByTimeAsync(10);
  expect(generate).toHaveBeenCalledOnce();
  expect(useAppStore.getState().sessions[0].generatedTitle).toBe("恢复标题任务");
});

it("restarts unfinished owned work after switching away and back", async () => {
  let resolve!: (title: string) => void;
  const generate = vi.spyOn(api, "generateSessionTitle")
    .mockImplementationOnce(() => new Promise<string>((done) => { resolve = done; }))
    .mockResolvedValue("完成恢复任务");
  setSessionTitlePrompt("a", "完成恢复任务");
  stop = startSessionTitleGeneration();
  await vi.advanceTimersByTimeAsync(10);
  useAppStore.getState().initializeWindowContext({ windowLabel: "project-a", mode: "project", projectPath: "E:/B", projectName: "B" });
  resolve("离开期间完成");
  await vi.advanceTimersByTimeAsync(10);
  expect(useAppStore.getState().projectSessions["E:/A"][0].generatedTitle).toBeUndefined();
  useAppStore.getState().initializeWindowContext({ windowLabel: "project-a", mode: "project", projectPath: "E:/A", projectName: "A" });
  await vi.advanceTimersByTimeAsync(10);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(useAppStore.getState().sessions[0].generatedTitle).toBe("完成恢复任务");
});

it("does not wake title schedulers for unrelated runtime updates", async () => {
  stop = startSessionTitleGeneration();
  await vi.advanceTimersByTimeAsync(10);
  expect(vi.getTimerCount()).toBe(0);
  for (let index = 0; index < 100; index++) useAppStore.getState().setGitChangeCount(index);
  expect(vi.getTimerCount()).toBe(0);
});
