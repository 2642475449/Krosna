import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FolderOpenOutlined,
  ReloadOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { Alert, Button, Empty, Modal, Segmented, Tag, message } from "antd";
import { useTranslation } from "react-i18next";
import {
  getClaudeMdDetail,
  openInAssociatedApplication,
  openInFileManager,
  saveClaudeMd,
} from "@/lib/api";
import { getAgentDisplayName } from "@/lib/agents";
import { mergeSavedInstructionDraft } from "@/lib/instructionDraft";
import { AgentIcon } from "@/components/AgentIcon";
import MonacoTextEditor from "@/components/editors/MonacoTextEditor";
import MarkdownPreview from "@/components/markdown/MarkdownPreview";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { useAppStore } from "@/store";
import {
  loadAgentInstructionFile,
  saveAgentInstructionFile,
  useAgentInstructionsStore,
} from "@/store/slices/agentInstructions";
import type { AiAgentId, ClaudeMdDetail, ClaudeMdScope } from "@/types";

type InstructionStandard = "agents" | "claude";

type TargetDescriptor = {
  id: string;
  scope: "workspace" | "local" | "user";
  label: string;
  fileName: string;
  relativePath?: string;
  absolutePath?: string;
  note: string;
};

const COMPATIBLE_AGENTS: AiAgentId[] = [
  "codex",
  "antigravity",
  "opencode",
  "qoder",
  "pi",
];

function projectFile(projectPath: string | null, filePath: string) {
  if (!projectPath) return filePath;
  const normalizedRoot = projectPath.replace(/[\\/]+$/, "");
  const normalizedFile = filePath.replace(/^[\\/]+/, "");
  const separator = projectPath.includes("\\") ? "\\" : "/";
  return `${normalizedRoot}${separator}${normalizedFile}`;
}

function fileName(filePath: string) {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

export function ClaudeMdPage() {
  const { t } = useTranslation();
  const currentProject = useAppStore((s) => s.currentProject);
  const projectPath = currentProject?.path ?? null;

  // 顶级规范标准：多智能体通用规范 (AGENTS.md) vs Claude Code 专属规范 (CLAUDE.md)
  const [standard, setStandard] = useState<InstructionStandard>("agents");

  // AGENTS.md 规范下的目标选择（项目、本地覆盖、兼容入口）
  const [agentsTargetId, setAgentsTargetId] = useState<string>("agents-workspace");

  // Claude 专属规范下的作用域选择 (user, workspace, local)
  const [claudeScope, setClaudeScope] = useState<ClaudeMdScope>(projectPath ? "workspace" : "user");

  // Claude 数据状态
  const [claudeDocs, setClaudeDocs] = useState<Record<ClaudeMdScope, {
    detail: ClaudeMdDetail | null;
    draft: string;
    loading: boolean;
    saving: boolean;
    loaded: boolean;
  }>>({
    user: { detail: null, draft: "", loading: false, saving: false, loaded: false },
    workspace: { detail: null, draft: "", loading: false, saving: false, loaded: false },
    local: { detail: null, draft: "", loading: false, saving: false, loaded: false },
  });

  const genericDocs = useAgentInstructionsStore((state) => state.documents);
  const setGenericDraft = useAgentInstructionsStore((state) => state.setDraft);

  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");

  // 动态构建 AGENTS.md 规范下的所有真实可选层级目标
  const agentsTargets = useMemo<TargetDescriptor[]>(() => [
    {
      id: "agents-workspace",
      scope: "workspace",
      label: t("settings.claudeMd.targets.agentsWorkspace.label", { defaultValue: "项目通用规范" }),
      fileName: "AGENTS.md",
      relativePath: "AGENTS.md",
      absolutePath: projectFile(projectPath, "AGENTS.md"),
      note: t("settings.claudeMd.targets.agentsWorkspace.note", {
        defaultValue: "项目根目录的开源通用 AI 协作规范，随 Git 提交，所有兼容智能体均会读取",
      }),
    },
    {
      id: "agents-local",
      scope: "local",
      label: t("settings.claudeMd.targets.agentsLocal.label", { defaultValue: "本地私有覆盖" }),
      fileName: "AGENTS.local.md",
      relativePath: "AGENTS.local.md",
      absolutePath: projectFile(projectPath, "AGENTS.local.md"),
      note: t("settings.claudeMd.targets.agentsLocal.note", {
        defaultValue: "当前机器专属私有覆盖（建议加入 .gitignore），不污染远程共享仓库",
      }),
    },
    {
      id: "gemini-compat",
      scope: "local",
      label: t("settings.claudeMd.targets.geminiCompat.label", { defaultValue: "Antigravity 兼容" }),
      fileName: "GEMINI.md",
      relativePath: "GEMINI.md",
      absolutePath: projectFile(projectPath, "GEMINI.md"),
      note: t("settings.claudeMd.targets.geminiCompat.note", {
        defaultValue: "Antigravity CLI 原生兼容的传统规则文件；建议新项目统一使用 AGENTS.md",
      }),
    },
  ], [projectPath, t]);

  const currentAgentsTarget = useMemo(() => {
    return agentsTargets.find((target) => target.id === agentsTargetId) ?? agentsTargets[0];
  }, [agentsTargets, agentsTargetId]);

  // 当前激活的数据视图
  const isClaude = standard === "claude";

  // 当前活跃的文件路径与草稿内容
  const activeFilePath = useMemo(() => {
    if (isClaude) {
      return claudeDocs[claudeScope].detail?.filePath ?? (claudeScope === "user" ? "~/.claude/CLAUDE.md" : "CLAUDE.md");
    }
    return currentAgentsTarget.absolutePath ?? currentAgentsTarget.fileName;
  }, [isClaude, claudeDocs, claudeScope, currentAgentsTarget]);

  const activeDraft = useMemo(() => {
    if (isClaude) {
      return claudeDocs[claudeScope].draft;
    }
    const docKey = currentAgentsTarget.absolutePath ?? "";
    return genericDocs[docKey]?.draft ?? "";
  }, [isClaude, claudeDocs, claudeScope, currentAgentsTarget, genericDocs]);

  const activeExists = useMemo(() => {
    if (isClaude) {
      return claudeDocs[claudeScope].detail?.exists ?? false;
    }
    const docKey = currentAgentsTarget.absolutePath ?? "";
    return genericDocs[docKey]?.exists ?? false;
  }, [isClaude, claudeDocs, claudeScope, currentAgentsTarget, genericDocs]);

  const activeDirty = useMemo(() => {
    if (isClaude) {
      const state = claudeDocs[claudeScope];
      return state.loaded && state.draft !== (state.detail?.content ?? "");
    }
    const docKey = currentAgentsTarget.absolutePath ?? "";
    const state = genericDocs[docKey];
    return Boolean(state?.loaded && state.draft !== state.content);
  }, [isClaude, claudeDocs, claudeScope, currentAgentsTarget, genericDocs]);

  const activeLoading = useMemo(() => {
    if (isClaude) {
      return claudeDocs[claudeScope].loading;
    }
    const docKey = currentAgentsTarget.absolutePath ?? "";
    return Boolean(genericDocs[docKey]?.loading);
  }, [isClaude, claudeDocs, claudeScope, currentAgentsTarget, genericDocs]);

  const activeSaving = useMemo(() => {
    if (isClaude) {
      return claudeDocs[claudeScope].saving;
    }
    const docKey = currentAgentsTarget.absolutePath ?? "";
    return Boolean(genericDocs[docKey]?.saving);
  }, [isClaude, claudeDocs, claudeScope, currentAgentsTarget, genericDocs]);

  const activeGenericDoc = genericDocs[currentAgentsTarget.absolutePath ?? ""];
  const activeError = isClaude ? null : activeGenericDoc?.error;
  const activeLoaded = isClaude ? claudeDocs[claudeScope].loaded : Boolean(activeGenericDoc?.loaded && !activeError);

  const canSave = useMemo(() => {
    if (isClaude) {
      return claudeDocs[claudeScope].loaded && activeDirty && !activeSaving && !activeLoading;
    }
    return Boolean(projectPath && activeLoaded && activeDirty && !activeSaving && !activeLoading);
  }, [isClaude, claudeDocs, claudeScope, activeLoaded, activeDirty, activeSaving, activeLoading, projectPath]);

  // 读取 Claude 配置
  const loadClaudeScope = useCallback(async (scope: ClaudeMdScope, force = false) => {
    if ((scope === "workspace" || scope === "local") && !projectPath) return;

    const existing = claudeDocs[scope];
    if (!force && (existing.loading || existing.loaded)) return;

    setClaudeDocs((prev) => ({
      ...prev,
      [scope]: { ...prev[scope], loading: true },
    }));

    try {
      const detail = await getClaudeMdDetail(scope, projectPath);
      setClaudeDocs((prev) => ({
        ...prev,
        [scope]: {
          detail,
          draft: detail.content,
          loading: false,
          saving: false,
          loaded: true,
        },
      }));
    } catch (error) {
      console.error("Failed to load CLAUDE.md:", error);
      message.error(t("settings.claudeMd.loadFailed"));
      setClaudeDocs((prev) => ({
        ...prev,
        [scope]: { ...prev[scope], loading: false },
      }));
    }
  }, [claudeDocs, projectPath, t]);

  // 读取通用文件（AGENTS.md / AGENTS.local.md / GEMINI.md）
  const loadGenericFile = useCallback(async (target: TargetDescriptor, force = false) => {
    if (!projectPath || !target.absolutePath) return;
    await loadAgentInstructionFile(projectPath, target.absolutePath, force);
  }, [projectPath]);

  // 依赖监听与初始化
  useEffect(() => {
    if (isClaude) {
      void loadClaudeScope(claudeScope);
    } else {
      void loadGenericFile(currentAgentsTarget);
    }
  }, [isClaude, claudeScope, currentAgentsTarget, loadClaudeScope, loadGenericFile]);

  // 编辑器修改草稿
  function handleDraftChange(value: string) {
    if (isClaude) {
      setClaudeDocs((prev) => ({
        ...prev,
        [claudeScope]: { ...prev[claudeScope], draft: value },
      }));
    } else {
      if (currentAgentsTarget.absolutePath) setGenericDraft(currentAgentsTarget.absolutePath, value);
    }
  }

  // 保存当前内容
  async function handleSave() {
    if (!canSave) return;
    if (isClaude) {
      setClaudeDocs((prev) => ({
        ...prev,
        [claudeScope]: { ...prev[claudeScope], saving: true },
      }));
      try {
        const submittedDraft = activeDraft;
        const detail = await saveClaudeMd(claudeScope, submittedDraft, projectPath);
        setClaudeDocs((prev) => ({
          ...prev,
          [claudeScope]: {
            detail,
            draft: mergeSavedInstructionDraft(prev[claudeScope].draft, submittedDraft, detail.content),
            loading: false,
            saving: false,
            loaded: true,
          },
        }));
        message.success(t("settings.claudeMd.saveSuccess"));
      } catch (error) {
        console.error("Failed to save CLAUDE.md:", error);
        message.error(t("settings.claudeMd.saveFailed"));
        setClaudeDocs((prev) => ({
          ...prev,
          [claudeScope]: { ...prev[claudeScope], saving: false },
        }));
      }
      return;
    }

    if (!projectPath || !currentAgentsTarget.absolutePath) return;

    try {
      if (await saveAgentInstructionFile(projectPath, currentAgentsTarget.absolutePath)) {
        message.success(t("settings.claudeMd.saveSuccess"));
      }
    } catch (error) {
      console.error("Failed to save instruction file:", error);
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "";
      message.error(detail || t("settings.claudeMd.saveFailed"));
    }
  }

  // 刷新重载
  function handleRefresh() {
    if (activeDirty) {
      Modal.confirm({
        title: t("settings.claudeMd.confirmRefreshTitle"),
        content: t("settings.claudeMd.confirmRefreshDesc"),
        okText: t("common.refresh"),
        cancelText: t("common.cancel"),
        onOk: async () => {
          if (isClaude) await loadClaudeScope(claudeScope, true);
          else await loadGenericFile(currentAgentsTarget, true);
        },
      });
      return;
    }
    if (isClaude) void loadClaudeScope(claudeScope, true);
    else void loadGenericFile(currentAgentsTarget, true);
  }

  // 打开所在目录
  async function handleOpenLocation() {
    try {
      if (isClaude) {
        const detail = claudeDocs[claudeScope].detail;
        if (detail) {
          await openInFileManager(detail.exists ? detail.filePath : detail.directoryPath);
          return;
        }
      }
      if (projectPath) {
        await openInFileManager(activeExists ? activeFilePath : projectPath);
      }
    } catch (error) {
      console.error("Failed to open location:", error);
      message.error(t("settings.claudeMd.openFailed"));
    }
  }

  return (
    <>
      <SettingsPageHeader
        title={t("settings.claudeMd.title")}
        description={t("settings.claudeMd.headerDesc")}
        actions={
          <>
            <Button
              icon={<ReloadOutlined spin={activeLoading} />}
              onClick={handleRefresh}
              disabled={activeLoading}
            >
              {t("common.refresh")}
            </Button>
            <Button
              icon={<FolderOpenOutlined />}
              onClick={handleOpenLocation}
              disabled={!isClaude && !projectPath}
            >
              {t("settings.claudeMd.openLocation")}
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={() => void handleSave()}
              loading={activeSaving}
              disabled={!canSave}
            >
              {t("settings.claudeMd.save")}
            </Button>
          </>
        }
      >
        {/* 第 1 行：真规范标准切换（AGENTS.md 开源通用标准 vs CLAUDE.md 专属标准） */}
        <div
          className="app-settings-choices"
          role="group"
          aria-label={t("settings.claudeMd.standardLabel")}
        >
          <button
            type="button"
            aria-pressed={standard === "agents"}
            onClick={() => setStandard("agents")}
          >
            <span className="font-medium">{t("settings.claudeMd.agentsMdStandard")}</span>
          </button>
          <button
            type="button"
            aria-pressed={standard === "claude"}
            onClick={() => setStandard("claude")}
          >
            <AgentIcon agentId="claude" size={14} />
            <span className="font-medium">{t("settings.claudeMd.claudeMdStandard")}</span>
          </button>
        </div>

        {/* 第 2 行：真实物理层级与作用域切换 */}
        <div className="app-settings-scope-tabs" role="group">
          {standard === "agents" ? (
            agentsTargets.map((target) => {
              const disabled = target.scope !== "user" && !projectPath;
              return (
                <button
                  key={target.id}
                  type="button"
                  aria-pressed={agentsTargetId === target.id}
                  disabled={disabled}
                  title={target.note}
                  onClick={() => setAgentsTargetId(target.id)}
                >
                  {`${target.label} · ${target.fileName}`}
                </button>
              );
            })
          ) : (
            [
              { label: t("settings.claudeMd.scope.user"), value: "user" as const, disabled: false },
              { label: t("settings.claudeMd.scope.workspace"), value: "workspace" as const, disabled: !projectPath },
              { label: t("settings.claudeMd.scope.local"), value: "local" as const, disabled: !projectPath },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={claudeScope === option.value}
                disabled={option.disabled}
                onClick={() => setClaudeScope(option.value)}
              >
                {option.label}
              </button>
            ))
          )}
        </div>
      </SettingsPageHeader>

      {/* 规范职责说明与生效智能体状态条 */}
      <div className="mb-4 rounded-lg border border-[var(--cs-border-card)] bg-[var(--cs-bg-card)] p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[var(--cs-text-tertiary)] font-medium">
              {standard === "agents" ? t("settings.claudeMd.compatibleAgents") : t("settings.claudeMd.exclusiveAgent")}：
            </span>
            {standard === "agents" ? (
              COMPATIBLE_AGENTS.map((agentId) => (
                <span
                  key={agentId}
                  className="inline-flex items-center gap-1.5 rounded-sm bg-[var(--cs-bg-hover)] px-2 py-0.5 text-[var(--cs-text-primary)]"
                >
                  <AgentIcon agentId={agentId} size={13} />
                  <span>{getAgentDisplayName(agentId)}</span>
                </span>
              ))
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-sm bg-[var(--cs-bg-hover)] px-2 py-0.5 text-[var(--cs-text-primary)]">
                <AgentIcon agentId="claude" size={13} />
                <span>{getAgentDisplayName("claude")}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Tag color={activeError ? "error" : activeExists ? "green" : "default"} className="m-0!">
              {activeError ? t("settings.claudeMd.loadFailed")
                : activeLoading || !activeLoaded ? t("settings.loading")
                : activeExists ? t("settings.claudeMd.fileExists") : t("settings.claudeMd.fileMissing")}
            </Tag>
            <span
              className="max-w-[420px] truncate font-mono text-[var(--cs-text-tertiary)]"
              title={activeFilePath}
            >
              {activeFilePath}
            </span>
            {activeDirty && (
              <span className="font-medium text-[var(--cs-primary)]">
                {t("settings.claudeMd.unsaved")}
              </span>
            )}
          </div>
        </div>

        <p className="mb-0 text-[var(--cs-text-secondary)] leading-relaxed">
          {standard === "agents"
            ? `${t("settings.claudeMd.agentsMdDesc")} ${t("settings.claudeMd.sharedFileNotice")}`
            : t("settings.claudeMd.claudeMdDesc")}
        </p>
      </div>

      {/* 未打开项目提示 */}
      {!projectPath && (standard === "agents" || claudeScope !== "user") ? (
        <Empty
          description={t("settings.claudeMd.openProjectFirst")}
          style={{ padding: "48px 0" }}
        />
      ) : activeLoading || (!isClaude && !activeLoaded && !activeError) ? (
        <div className="flex justify-center py-24">
          <ReloadOutlined spin style={{ fontSize: 20, color: "var(--cs-primary)" }} />
        </div>
      ) : activeError ? (
        <Alert type="error" showIcon title={t("settings.claudeMd.loadFailed")} description={activeError} />
      ) : (
        <div className="app-settings-editor">
          {/* 编辑器顶部工具栏 */}
          <div
            className="flex items-center justify-between gap-3 px-4 py-2.5 flex-wrap"
            style={{ borderBottom: "1px solid var(--cs-border-card)" }}
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium" style={{ color: "var(--cs-text-primary)" }}>
                {fileName(activeFilePath)}
              </span>
              <span className="text-xs text-[var(--cs-text-tertiary)]">
                {activeDirty ? t("settings.claudeMd.unsaved") : t("statusBar.file.saved")}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* 编辑与 Markdown 预览切换 */}
              <Segmented<"edit" | "preview">
                size="small"
                value={viewMode}
                onChange={(value) => setViewMode(value)}
                options={[
                  { value: "edit", label: t("fileTabs.markdownModeEdit") },
                  { value: "preview", label: t("fileTabs.markdownModePreview") },
                ]}
              />
            </div>
          </div>

          {/* Monaco 编辑/预览主体 */}
          <div
            className="min-h-0 flex"
            style={{ height: "clamp(460px, calc(100vh - 430px), 720px)" }}
          >
            {viewMode === "preview" ? (
              <div className="app-markdown-preview-shell h-full w-full overflow-auto p-5">
                <MarkdownPreview
                  content={activeDraft}
                  emptyText={t("fileTabs.markdownPreviewEmpty")}
                  filePath={activeFilePath}
                  projectPath={projectPath ?? undefined}
                  className="app-markdown-preview-surface"
                  onOpenExternalLink={(href) => {
                    void openInAssociatedApplication(href);
                  }}
                />
              </div>
            ) : (
              <div className="h-full w-full flex flex-col min-h-0">
                <MonacoTextEditor
                  key={`${standard}-${claudeScope}-${activeFilePath}-monaco`}
                  filePath={activeFilePath}
                  value={activeDraft}
                  readOnly={false}
                  onChange={handleDraftChange}
                  onSave={() => {
                    void handleSave();
                  }}
                  saveEnabled={canSave && !activeSaving}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default ClaudeMdPage;
