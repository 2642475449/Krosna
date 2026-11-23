import { beforeEach, expect, it } from "vitest";
import {
  DEFAULT_GIT_COMMIT_GENERATION_CONFIG,
  normalizeGitCommitGenerationConfig,
  resolveEffectiveCommitAgentId,
  useGitCommitGenerationStore,
} from "./gitCommitGenerationSlice";

beforeEach(() => {
  useGitCommitGenerationStore.setState({
    config: { ...DEFAULT_GIT_COMMIT_GENERATION_CONFIG },
    pendingConfig: false,
    draftsByProject: {},
    draftRevisionsByProject: {},
    activeGenerationTokenByProject: {},
  });
});

it("normalizes unknown or partial commit generation config safely", () => {
  expect(normalizeGitCommitGenerationConfig(null)).toEqual({
    agentId: null,
    model: null,
    reasoningEffort: null,
  });
  expect(
    normalizeGitCommitGenerationConfig({
      agentId: "invalid-agent",
      model: "  gemini-3.8-flash ",
      reasoningEffort: "   ",
    }),
  ).toEqual({
    agentId: null,
    model: "gemini-3.8-flash",
    reasoningEffort: null,
  });
  expect(
    normalizeGitCommitGenerationConfig({
      agentId: "antigravity",
      model: "gemini-3.8-flash",
      reasoningEffort: "low",
    }),
  ).toEqual({
    agentId: "antigravity",
    model: "gemini-3.8-flash",
    reasoningEffort: "low",
  });
});

it("inherits global default agent when dedicated agentId is null", () => {
  expect(
    resolveEffectiveCommitAgentId(
      { agentId: null, model: null, reasoningEffort: null },
      "antigravity",
    ),
  ).toBe("antigravity");
  expect(
    resolveEffectiveCommitAgentId(
      { agentId: "codex", model: null, reasoningEffort: null },
      "antigravity",
    ),
  ).toBe("codex");
});

it("resets model and reasoningEffort when switching dedicated agent", () => {
  const store = useGitCommitGenerationStore.getState();
  store.setConfig({
    agentId: "antigravity",
    model: "gemini-3.8-flash",
    reasoningEffort: "low",
  });
  expect(useGitCommitGenerationStore.getState().config).toEqual({
    agentId: "antigravity",
    model: "gemini-3.8-flash",
    reasoningEffort: "low",
  });

  useGitCommitGenerationStore.getState().setConfig({ agentId: "claude" });
  expect(useGitCommitGenerationStore.getState().config).toEqual({
    agentId: "claude",
    model: null,
    reasoningEffort: null,
  });
});

it("prevents duplicate generation requests for the same project while isolating other projects", () => {
  const store = useGitCommitGenerationStore.getState();
  const ticketA = store.startGeneration("/repo-a");
  expect(ticketA).not.toBeNull();
  // 同一项目重复触发被阻止
  expect(useGitCommitGenerationStore.getState().startGeneration("/repo-a")).toBeNull();
  // 切换到另一项目可以独立发起请求
  const ticketB = useGitCommitGenerationStore.getState().startGeneration("/repo-b");
  expect(ticketB).not.toBeNull();

  // repo-a 的结果只写入 repo-a，不会污染 repo-b
  const outcomeA = useGitCommitGenerationStore
    .getState()
    .finishGeneration(ticketA!, "feat(a): update repo a");
  expect(outcomeA).toBe("applied");
  expect(useGitCommitGenerationStore.getState().draftsByProject["/repo-a"]).toBe(
    "feat(a): update repo a",
  );
  expect(useGitCommitGenerationStore.getState().draftsByProject["/repo-b"]).toBeUndefined();
});

it("preserves user edits made while commit message generation is in flight", () => {
  const store = useGitCommitGenerationStore.getState();
  store.setDraft("/repo-a", "initial draft");
  const ticket = useGitCommitGenerationStore.getState().startGeneration("/repo-a");
  expect(ticket).not.toBeNull();

  // 生成期间用户修改了草稿
  useGitCommitGenerationStore.getState().setDraft("/repo-a", "manual user edit");

  const outcome = useGitCommitGenerationStore
    .getState()
    .finishGeneration(ticket!, "feat: generated message");
  expect(outcome).toBe("preserved-user-edit");
  expect(useGitCommitGenerationStore.getState().draftsByProject["/repo-a"]).toBe(
    "manual user edit",
  );
  expect(
    useGitCommitGenerationStore.getState().activeGenerationTokenByProject["/repo-a"],
  ).toBeUndefined();
});

it("keeps existing draft intact when generation fails", () => {
  const store = useGitCommitGenerationStore.getState();
  store.setDraft("/repo-a", "existing draft");
  const ticket = useGitCommitGenerationStore.getState().startGeneration("/repo-a");
  expect(ticket).not.toBeNull();

  useGitCommitGenerationStore.getState().failGeneration(ticket!);
  expect(useGitCommitGenerationStore.getState().draftsByProject["/repo-a"]).toBe(
    "existing draft",
  );
  expect(
    useGitCommitGenerationStore.getState().activeGenerationTokenByProject["/repo-a"],
  ).toBeUndefined();
});
