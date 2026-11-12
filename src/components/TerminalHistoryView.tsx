import { useEffect, useRef } from "react";
import { Button, Spin } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useTranslation } from "react-i18next";
import type { Session } from "@/types";
import { useAppStore } from "@/store";
import { loadTerminalRecovery, retainTerminalRecovery, terminalRecoveryKey, useTerminalRecoveryStore } from "@/store/slices/terminalRecovery";
import { restoreRunnerOutputSnapshot } from "@/lib/runnerOutputSnapshot";
import { getTerminalTheme, TERMINAL_FONT_FAMILY } from "@/lib/terminalTheme";
import { initializePtyTextLayout } from "@/lib/terminalTextLayout";
import "@xterm/xterm/css/xterm.css";

interface TerminalHistoryViewProps {
  session: Session;
  onResume?: () => void | Promise<void>;
  onReturn?: () => void;
}

/** 旧画面只作阅读：不连接 PTY，也不注册 OSC、链接或命令生命周期处理器。 */
export function TerminalHistoryView({ session, onResume, onReturn }: TerminalHistoryViewProps) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const key = terminalRecoveryKey(session.path, session.id);
  const entry = useTerminalRecoveryStore((state) => state.entries[key]);
  const fontSize = useAppStore((state) => state.terminalFontSize);
  const themeMode = useAppStore((state) => state.activeTheme());
  const snapshot = entry?.snapshot;

  useEffect(() => {
    const release = retainTerminalRecovery(session.path, session.id);
    void loadTerminalRecovery(session.path, session.id).catch(() => undefined);
    return release;
  }, [session.path, session.id]);

  useEffect(() => {
    const target = container.current;
    if (!target || !snapshot) return;
    const lifetime = new AbortController();
    const colors = getTerminalTheme(themeMode);
    const terminal = new XTerm({
      cols: snapshot.cols, rows: snapshot.rows,
      fontFamily: TERMINAL_FONT_FAMILY, fontSize,
      theme: colors.theme, minimumContrastRatio: colors.minimumContrastRatio,
      disableStdin: true, cursorBlink: false,
      scrollback: snapshot.scrollback ?? 5_000,
    });
    const fit = new FitAddon();
    initializePtyTextLayout(terminal);
    terminal.loadAddon(fit);
    terminal.open(target);
    let ready = false;
    const fitView = () => {
      if (!ready || !target.getClientRects().length) return;
      try { fit.fit(); } catch { /* 隐藏 pane 的首次布局可能尚未就绪。 */ }
    };
    const observer = new ResizeObserver(fitView);
    observer.observe(target);
    void restoreRunnerOutputSnapshot(terminal, snapshot, { signal: lifetime.signal }).then(() => {
      ready = true; fitView();
    }).catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.warn("Failed to display terminal history:", error);
    });
    return () => { lifetime.abort(); observer.disconnect(); terminal.dispose(); };
  }, [snapshot, fontSize, themeMode]);

  return (
    <div className="app-terminal-history flex h-full min-h-0 flex-col bg-[var(--cs-bg-app)]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--cs-border)] bg-[var(--cs-bg-header)] px-3 py-2 text-xs text-[var(--cs-text-secondary)]">
        <span role="status" className="min-w-0 flex-1">{t("terminal.historyReadOnly")}</span>
        {onResume && <Button size="small" icon={<ReloadOutlined />} loading={session.status === "starting"} onClick={() => void onResume()}>
          {t("terminal.resumeSession")}
        </Button>}
        {onReturn && <Button size="small" onClick={onReturn}>{t("terminal.closeHistory")}</Button>}
      </div>
      {snapshot ? <div ref={container} className="min-h-0 flex-1 overflow-hidden p-1" aria-label={t("terminal.historyPreview")} /> : (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 p-6 text-sm text-[var(--cs-text-secondary)]" role="status">
          {(!entry || entry.phase === "loading") && <Spin size="small" />}
          <span>{t(!entry || entry.phase === "loading" ? "terminal.historyLoading" : entry.phase === "error" ? "terminal.historyLoadFailed" : "terminal.historyMissing")}</span>
        </div>
      )}
    </div>
  );
}
