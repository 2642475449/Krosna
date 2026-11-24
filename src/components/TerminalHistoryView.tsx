import { useEffect, useRef, useState } from "react";
import { Button, Spin } from "antd";
import { LockOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useTranslation } from "react-i18next";
import type { Session } from "@/types";
import { useAppStore } from "@/store";
import { AgentIcon } from "@/components/AgentIcon";
import { getAgentDefinition, isAiAgentId } from "@/lib/agents";
import { loadTerminalRecovery, retainTerminalRecovery, terminalRecoveryKey, useTerminalRecoveryStore } from "@/store/slices/terminalRecovery";
import { restoreRunnerOutputSnapshot } from "@/lib/runnerOutputSnapshot";
import { getTerminalTheme, TERMINAL_FONT_FAMILY } from "@/lib/terminalTheme";
import { initializePtyTextLayout } from "@/lib/terminalTextLayout";
import { attachTerminalScrollbar } from "@/lib/terminalScrollbar";
import { registerMemoryDiagnosticTerminal } from "@/lib/memoryDiagnostics";
import "@xterm/xterm/css/xterm.css";
import "./TerminalHistoryView.css";

interface TerminalHistoryViewProps {
  session: Session;
  onResume?: () => void | Promise<void>;
  onReturn?: () => void;
}

/** 旧画面只作阅读：不连接 PTY，也不注册 OSC、链接或命令生命周期处理器。 */
export function TerminalHistoryView({ session, onResume, onReturn }: TerminalHistoryViewProps) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitViewRef = useRef<(() => void) | null>(null);
  const attentionTimerRef = useRef<number | null>(null);
  const [ctaAttention, setCtaAttention] = useState(false);

  const key = terminalRecoveryKey(session.path, session.id);
  const entry = useTerminalRecoveryStore((state) => state.entries[key]);
  const fontSize = useAppStore((state) => state.terminalFontSize);
  const themeMode = useAppStore((state) => state.activeTheme());
  const latestOptionsRef = useRef({ fontSize, themeMode });
  latestOptionsRef.current = { fontSize, themeMode };

  const snapshot = entry?.snapshot;
  const agentId = session.agentId ?? "claude";
  const agentLabel = isAiAgentId(agentId)
    ? getAgentDefinition(agentId).displayName
    : agentId === "powershell"
      ? "PowerShell"
      : "CMD";
  const sessionTitle = session.name || t("terminal.untitledSession");
  const workingDirectory = session.terminalWorkingDirectory || session.path;
  const starting = session.status === "starting";

  useEffect(() => {
    const release = retainTerminalRecovery(session.path, session.id);
    void loadTerminalRecovery(session.path, session.id).catch(() => undefined);
    return release;
  }, [session.path, session.id]);

  useEffect(() => {
    return () => {
      if (attentionTimerRef.current !== null) {
        window.clearTimeout(attentionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const target = container.current;
    if (!target || !snapshot) return;
    const lifetime = new AbortController();
    const { fontSize: initialFontSize, themeMode: initialTheme } = latestOptionsRef.current;
    const colors = getTerminalTheme(initialTheme);
    const terminal = new XTerm({
      cols: snapshot.cols, rows: snapshot.rows,
      fontFamily: TERMINAL_FONT_FAMILY, fontSize: initialFontSize,
      theme: colors.theme, minimumContrastRatio: colors.minimumContrastRatio,
      disableStdin: true, cursorBlink: false,
      scrollback: snapshot.scrollback ?? 5_000,
    });
    const fit = new FitAddon();
    terminalRef.current = terminal;
    initializePtyTextLayout(terminal);
    terminal.loadAddon(fit);
    terminal.open(target);
    // 让系统复制快捷键触发 xterm 的原生 copy 事件，读取当前选区。
    terminal.attachCustomKeyEventHandler((event) => {
      const copy = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "c";
      return !(copy && terminal.hasSelection());
    });
    const detachScrollbar = attachTerminalScrollbar(target, terminal);
    let ready = false;
    const fitView = () => {
      // 分块回放须保留快照网格，否则后续光标定位和换行会按面板尺寸解析。
      if (!ready || lifetime.signal.aborted || !target.getClientRects().length) return;
      try { fit.fit(); } catch { /* 隐藏 pane 的首次布局可能尚未就绪。 */ }
    };
    fitViewRef.current = fitView;
    const observer = new ResizeObserver(fitView);
    observer.observe(target);
    void restoreRunnerOutputSnapshot(terminal, snapshot, { signal: lifetime.signal }).then(() => {
      ready = true; fitView();
    }).catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.warn("Failed to display terminal history:", error);
    });
    const unregisterMemory = registerMemoryDiagnosticTerminal(terminal);
    return () => {
      unregisterMemory();
      lifetime.abort();
      observer.disconnect();
      detachScrollbar();
      terminalRef.current = null;
      fitViewRef.current = null;
      terminal.dispose();
    };
  }, [snapshot]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const colors = getTerminalTheme(themeMode);
    terminal.options.fontSize = fontSize;
    terminal.options.theme = colors.theme;
    terminal.options.minimumContrastRatio = colors.minimumContrastRatio;
    fitViewRef.current?.();
  }, [fontSize, themeMode]);

  const highlightResumeAction = () => {
    if (!onResume || terminalRef.current?.hasSelection()) return;
    setCtaAttention(true);
    if (attentionTimerRef.current !== null) {
      window.clearTimeout(attentionTimerRef.current);
    }
    attentionTimerRef.current = window.setTimeout(() => {
      setCtaAttention(false);
      attentionTimerRef.current = null;
    }, 900);
  };

  const resumeLabel = starting
    ? t("terminal.resumeConnectingBtn")
    : t("terminal.resumeSession");

  return (
    <div className="app-terminal-history flex h-full min-h-0 flex-col bg-[var(--cs-bg-card-solid)]">
      <div className="app-terminal-history__banner flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
          <AgentIcon agentId={agentId} size={18} />
          <span className="truncate text-sm font-medium text-[var(--cs-text-primary)]" title={sessionTitle}>
            {sessionTitle}
          </span>
          <span className="shrink-0 text-xs text-[var(--cs-text-tertiary)]">{agentLabel}</span>
          {onResume && starting ? (
            <span className="app-terminal-history__badge app-terminal-history__badge--ready" role="status" aria-live="polite">
              {t("terminal.resumeConnecting")}
            </span>
          ) : (
            <span className="app-terminal-history__badge app-terminal-history__badge--muted">
              <LockOutlined />
              <span>{t("terminal.historyReadOnly")}</span>
            </span>
          )}
          {workingDirectory ? (
            <span
              className="app-terminal-history__path hidden max-w-[320px] truncate text-xs text-[var(--cs-text-tertiary)] lg:inline-block"
              title={workingDirectory}
            >
              {workingDirectory}
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {onResume && (
            <Button
              type="primary"
              size="middle"
              className={ctaAttention ? "app-terminal-history__cta-attention" : undefined}
              icon={<PlayCircleOutlined />}
              loading={starting}
              aria-busy={starting}
              onClick={() => void onResume()}
            >
              {resumeLabel}
            </Button>
          )}
          {onReturn && (
            <Button size="middle" onClick={onReturn}>
              {t("terminal.closeHistory")}
            </Button>
          )}
        </div>
      </div>

      {snapshot ? (
        <>
          <div
            className="min-h-0 flex-1 overflow-hidden p-1"
            onClick={highlightResumeAction}
          >
            <div ref={container} className="app-terminal-surface h-full min-h-0 w-full" aria-label={t("terminal.historyPreview")} />
          </div>
          {onResume && (
            <div className="app-terminal-history__footer flex shrink-0 flex-wrap items-center justify-between gap-2 pl-4 pr-16 py-2 text-xs text-[var(--cs-text-secondary)]">
              <span className="flex items-center gap-1.5">
                <LockOutlined className="text-[var(--cs-text-tertiary)]" />
                <span>{t("terminal.historyReadOnlyHint")}</span>
              </span>
              <span className="text-[var(--cs-text-tertiary)]">{t("terminal.resumeManualHint")}</span>
            </div>
          )}
        </>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
            <div
              className="app-terminal-history__empty-indicator"
              role={starting ? "status" : undefined}
              aria-label={starting ? t("terminal.resumeConnecting") : undefined}
            >
              {starting && <span className="app-terminal-history__ring" aria-hidden="true" />}
              <AgentIcon agentId={agentId} size={24} />
            </div>

            <div className="flex flex-col items-center gap-1.5">
              <h2 className="m-0 text-base font-semibold text-[var(--cs-text-primary)]">{sessionTitle}</h2>
              <div
                className="flex items-center justify-center gap-2 text-sm text-[var(--cs-text-secondary)]"
                role={entry?.phase === "error" ? "alert" : "status"}
              >
                {(!entry || entry.phase === "loading") && <Spin size="small" />}
                <span>
                  {t(
                    !entry || entry.phase === "loading"
                      ? "terminal.historyLoading"
                      : entry.phase === "error"
                        ? "terminal.historyLoadFailed"
                        : onResume
                          ? "terminal.resumeWelcomeDesc"
                          : "terminal.historyMissing",
                  )}
                </span>
              </div>
              {workingDirectory && (
                <p
                  className="app-terminal-history__path m-0 max-w-full truncate text-xs text-[var(--cs-text-tertiary)]"
                  title={workingDirectory}
                >
                  {workingDirectory}
                </p>
              )}
            </div>

            {onResume && (
              <div className="flex flex-col items-center gap-2 pt-1">
                <Button
                  type="primary"
                  size="middle"
                  icon={<PlayCircleOutlined />}
                  loading={starting}
                  aria-busy={starting}
                  onClick={() => void onResume()}
                >
                  {resumeLabel}
                </Button>
                <span className="text-xs text-[var(--cs-text-tertiary)]">{t("terminal.resumeManualHint")}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
