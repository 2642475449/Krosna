import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isAiAgentId } from "@/lib/agents";
import type { AiAgentId, GitCommitGenerationConfig } from "@/types";

export const DEFAULT_GIT_COMMIT_GENERATION_CONFIG: Readonly<GitCommitGenerationConfig> = {
  agentId: null,
  model: null,
  reasoningEffort: null,
};

function normalizeOptionalString(value: unknown, maxLength = 120): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeGitCommitGenerationConfig(
  value: unknown,
): GitCommitGenerationConfig {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_GIT_COMMIT_GENERATION_CONFIG };
  }
  const record = value as Record<string, unknown>;
  return {
    agentId: isAiAgentId(record.agentId) ? record.agentId : null,
    model: normalizeOptionalString(record.model),
    reasoningEffort: normalizeOptionalString(record.reasoningEffort, 64),
  };
}

export function resolveEffectiveCommitAgentId(
  config: GitCommitGenerationConfig,
  defaultAgentId: AiAgentId | null,
): AiAgentId | null {
  return config.agentId ?? defaultAgentId;
}

export interface CommitGenerationTicket {
  projectPath: string;
  token: number;
  startRevision: number;
}

export type FinishGenerationOutcome = "applied" | "preserved-user-edit" | "stale";

interface GitCommitGenerationState {
  config: GitCommitGenerationConfig;
  pendingConfig: boolean;
  /** 按项目路径隔离的提交草稿，避免切换项目时互相覆盖。 */
  draftsByProject: Record<string, string>;
  /** 每次用户手动修改草稿递增，用于在异步生成完成时判断是否应保留用户编辑。 */
  draftRevisionsByProject: Record<string, number>;
  /** 按项目路径记录进行中的生成令牌，防止重复触发并隔离跨项目请求。 */
  activeGenerationTokenByProject: Record<string, number>;
  setConfig: (patch: Partial<GitCommitGenerationConfig>) => void;
  setPersistedConfig: (value: unknown) => void;
  setDraft: (projectPath: string, value: string) => void;
  clearDraft: (projectPath: string) => void;
  startGeneration: (projectPath: string) => CommitGenerationTicket | null;
  finishGeneration: (
    ticket: CommitGenerationTicket,
    generatedMessage: string,
  ) => FinishGenerationOutcome;
  failGeneration: (ticket: CommitGenerationTicket) => void;
}

let nextGenerationToken = 0;

function configsEqual(a: GitCommitGenerationConfig, b: GitCommitGenerationConfig): boolean {
  return (
    a.agentId === b.agentId &&
    a.model === b.model &&
    a.reasoningEffort === b.reasoningEffort
  );
}

// 独立设置与运行时分片，避免继续扩展主 store；仅持久化用户生成配置。
export const useGitCommitGenerationStore = create<GitCommitGenerationState>()(
  persist(
    (set, get) => ({
      config: { ...DEFAULT_GIT_COMMIT_GENERATION_CONFIG },
      pendingConfig: false,
      draftsByProject: {},
      draftRevisionsByProject: {},
      activeGenerationTokenByProject: {},

      setConfig: (patch) => {
        const current = get().config;
        const agentChanged = "agentId" in patch && patch.agentId !== current.agentId;
        const merged = normalizeGitCommitGenerationConfig({
          ...current,
          ...patch,
          // 切换智能体时清空旧智能体专属的模型和推理强度覆盖，避免携带无效选项。
          ...(agentChanged && !("model" in patch) ? { model: null } : {}),
          ...(agentChanged && !("reasoningEffort" in patch) ? { reasoningEffort: null } : {}),
        });
        set({ config: merged, pendingConfig: true });
      },

      setPersistedConfig: (value) => {
        const normalized = normalizeGitCommitGenerationConfig(value);
        const current = get();
        const matches = configsEqual(normalized, current.config);
        // 未落库的本地修改不能被其他窗口的旧广播覆盖。
        if (current.pendingConfig && !matches) return;
        set({ config: matches ? current.config : normalized, pendingConfig: false });
      },

      setDraft: (projectPath, value) => {
        if (!projectPath) return;
        set((state) => ({
          draftsByProject: { ...state.draftsByProject, [projectPath]: value },
          draftRevisionsByProject: {
            ...state.draftRevisionsByProject,
            [projectPath]: (state.draftRevisionsByProject[projectPath] ?? 0) + 1,
          },
        }));
      },

      clearDraft: (projectPath) => {
        if (!projectPath) return;
        set((state) => ({
          draftsByProject: { ...state.draftsByProject, [projectPath]: "" },
          draftRevisionsByProject: {
            ...state.draftRevisionsByProject,
            [projectPath]: (state.draftRevisionsByProject[projectPath] ?? 0) + 1,
          },
        }));
      },

      startGeneration: (projectPath) => {
        if (!projectPath) return null;
        const current = get();
        if (current.activeGenerationTokenByProject[projectPath]) {
          return null;
        }
        const token = ++nextGenerationToken;
        const startRevision = current.draftRevisionsByProject[projectPath] ?? 0;
        set((state) => ({
          activeGenerationTokenByProject: {
            ...state.activeGenerationTokenByProject,
            [projectPath]: token,
          },
        }));
        return { projectPath, token, startRevision };
      },

      finishGeneration: (ticket, generatedMessage) => {
        const state = get();
        if (state.activeGenerationTokenByProject[ticket.projectPath] !== ticket.token) {
          return "stale";
        }
        const nextActive = { ...state.activeGenerationTokenByProject };
        delete nextActive[ticket.projectPath];

        const currentRevision = state.draftRevisionsByProject[ticket.projectPath] ?? 0;
        if (currentRevision !== ticket.startRevision) {
          set({ activeGenerationTokenByProject: nextActive });
          return "preserved-user-edit";
        }

        const trimmed = generatedMessage.trim();
        if (!trimmed) {
          set({ activeGenerationTokenByProject: nextActive });
          return "stale";
        }

        set({
          activeGenerationTokenByProject: nextActive,
          draftsByProject: {
            ...state.draftsByProject,
            [ticket.projectPath]: trimmed,
          },
        });
        return "applied";
      },

      failGeneration: (ticket) => {
        const state = get();
        if (state.activeGenerationTokenByProject[ticket.projectPath] !== ticket.token) {
          return;
        }
        const nextActive = { ...state.activeGenerationTokenByProject };
        delete nextActive[ticket.projectPath];
        // 生成失败时只清理运行状态，保留已有草稿。
        set({ activeGenerationTokenByProject: nextActive });
      },
    }),
    {
      name: "krosna-git-commit-generation",
      partialize: (state) => ({ config: state.config }),
      merge: (saved, current) => ({
        ...current,
        config: normalizeGitCommitGenerationConfig(
          (saved as { config?: unknown } | undefined)?.config,
        ),
      }),
    },
  ),
);
