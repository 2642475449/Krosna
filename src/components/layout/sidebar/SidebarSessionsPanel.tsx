import {
  CodeOutlined,
  DownOutlined,
  InboxOutlined,
  PushpinOutlined,
  PushpinFilled,
  RightOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { Dropdown, Empty, Tooltip } from "antd";
import { WorkbenchEmptyArtwork } from "@/components/ui/WorkbenchGlyph";
import type { MenuProps } from "antd";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";
import type { Session } from "@/types";
import { AgentActivityIcon } from "@/components/AgentActivityIcon";
import { AgentSessionStatus } from "@/components/AgentSessionStatus";
import { useTranslation } from "react-i18next";
import type { AttentionItem } from "@/lib/attention";

dayjs.extend(relativeTime);

interface SidebarSessionsPanelProps {
  currentProject: { name: string; path: string } | null;
  sessions: Session[];
  attentionItems: AttentionItem[];
  activeSessionId: string | null;
  locale: string;
  noProjectText: string;
  noSessionsText: string;
  archiveSessionText: string;
  pinSessionText: string;
  unpinSessionText: string;
  pinnedSectionText: string;
  sessionsSectionText: string;
  pinnedCollapsed: boolean;
  sessionsCollapsed: boolean;
  onTogglePinned: () => void;
  onToggleSessions: () => void;
  onOpenSession: (sessionId: string) => void;
  onArchiveSession: (sessionId: string) => void;
  onTogglePinSession: (sessionId: string) => void;
  onOpenCheckpointReview: (sessionId: string) => void;
  getSessionMenuItems: (session: Session) => MenuProps["items"];
}

function SidebarSessionsPanel({
  currentProject,
  sessions,
  activeSessionId,
  locale,
  noProjectText,
  noSessionsText,
  archiveSessionText,
  pinSessionText,
  unpinSessionText,
  pinnedSectionText,
  sessionsSectionText,
  pinnedCollapsed,
  sessionsCollapsed,
  onTogglePinned,
  onToggleSessions,
  onOpenSession,
  onArchiveSession,
  onTogglePinSession,
  onOpenCheckpointReview,
  getSessionMenuItems,
}: SidebarSessionsPanelProps) {
  const { t } = useTranslation();
  if (!currentProject) {
    return (
      <Empty
        description={noProjectText}
        className="mt-16"
        image={<WorkbenchEmptyArtwork kind="terminal" />}
      />
    );
  }

  if (sessions.length === 0) {
    return (
      <Empty
        description={noSessionsText}
        className="mt-16"
        image={<WorkbenchEmptyArtwork kind="terminal" />}
      />
    );
  }

  const pinnedSessions = sessions.filter((session) => session.pinned);
  const normalSessions = sessions.filter((session) => !session.pinned);

  function renderSessionItem(session: Session) {
    const isActive = activeSessionId === session.id;
    const titleColor = isActive ? "var(--cs-text-primary)" : "var(--cs-text-secondary)";
    const hasPendingCheckpoint = (session.checkpointPendingTurns ?? 0) > 0;
    const timestamp = session.lastEventAt ?? session.createdAt;
    const relative = dayjs(timestamp)
      .locale(locale.startsWith("zh") ? "zh-cn" : "en")
      .fromNow();

    return (
      <Dropdown
        key={session.id}
        menu={{ items: getSessionMenuItems(session) }}
        trigger={["contextMenu"]}
      >
        <div
          data-active={isActive ? "true" : "false"}
          className="app-sidebar-list-item app-session-list-item app-marker-host app-marker-left group flex items-center gap-2 cursor-pointer"
          onClick={() => onOpenSession(session.id)}
        >
          <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center">
            <AgentActivityIcon
              agentId={session.agentId ?? "claude"}
              active={session.active}
              status={session.status}
              size={17}
            />
          </span>
          <div className="flex-1 min-w-0">
            <div
              className="flex min-w-0 items-center text-[13px] font-medium"
              style={{ color: titleColor }}
            >
              <Tooltip title={session.name} mouseEnterDelay={0.5}>
                <span className="min-w-0 flex-1 truncate">{session.name}</span>
              </Tooltip>
            </div>
            {hasPendingCheckpoint && (
              <div className="app-session-meta mt-0.5 flex min-w-0 items-center gap-1.5">
                {hasPendingCheckpoint && (
                  <Tooltip
                    title={t("checkpointReview.pendingHint", {
                      files: session.checkpointFileCount ?? 0,
                      additions: session.checkpointInsertions ?? 0,
                      deletions: session.checkpointDeletions ?? 0,
                    })}
                    mouseEnterDelay={0.35}
                  >
                    <button
                      type="button"
                      className="inline-flex min-w-0 items-center gap-1 truncate font-medium"
                      style={{ color: "var(--cs-primary)" }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenCheckpointReview(session.id);
                      }}
                    >
                      <SafetyCertificateOutlined className="shrink-0 text-[10px]" />
                      <span className="truncate">
                        {t("checkpointReview.pendingBadge", {
                          count: session.checkpointPendingTurns,
                        })}
                      </span>
                    </button>
                  </Tooltip>
                )}
              </div>
            )}
          </div>

          <div className="app-session-trailing ml-auto grid shrink-0 items-center">
            <div className="app-session-summary flex items-center justify-end gap-2">
              <Tooltip title={dayjs(timestamp).format("YYYY-MM-DD HH:mm:ss")} mouseEnterDelay={0.5}>
                <span className="app-session-time whitespace-nowrap text-xs">
                  {relative}
                </span>
              </Tooltip>
              <AgentSessionStatus session={session} />
            </div>
            <div className="app-session-actions flex items-center justify-end">
              <Tooltip title={session.pinned ? unpinSessionText : pinSessionText} mouseEnterDelay={0.5}>
                <button
                  type="button"
                  aria-label={session.pinned ? unpinSessionText : pinSessionText}
                  className="flex h-6 w-6 items-center justify-center rounded-sm"
                  style={{ color: "var(--cs-text-tertiary)" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePinSession(session.id);
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--cs-primary)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--cs-text-tertiary)")}
                >
                  {session.pinned ? <PushpinFilled className="text-sm" /> : <PushpinOutlined className="text-sm" />}
                </button>
              </Tooltip>
              <Tooltip title={archiveSessionText} mouseEnterDelay={0.5}>
                <button
                  type="button"
                  aria-label={archiveSessionText}
                  className="flex h-6 w-6 items-center justify-center rounded-sm"
                  style={{ color: "var(--cs-text-tertiary)" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onArchiveSession(session.id);
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--cs-primary)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--cs-text-tertiary)")}
                >
                  <InboxOutlined className="text-sm" />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      </Dropdown>
    );
  }

  return (
    <div className="app-sidebar-panel space-y-0.5">
      <div
        className="mb-1.5 flex items-center gap-2 px-2.5 py-1"
        style={{ color: "var(--cs-text-secondary)" }}
      >
        <span className="text-[11px] font-semibold">
          {t("sidebar.sessionSummary", { count: sessions.length })}
        </span>
      </div>
      {pinnedSessions.length > 0 && (
        <>
          <div
            className="app-sidebar-section-header flex items-center gap-1.5 px-2.5 pt-1.5 pb-1 cursor-pointer select-none rounded-lg"
            style={{ color: "var(--cs-text-secondary)" }}
            onClick={onTogglePinned}
          >
            <PushpinOutlined className="text-[10px]" />
            <span className="text-[10px] font-medium uppercase tracking-wider flex-1">
              {pinnedSectionText}
            </span>
            <span
              className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
              style={{
                background: "color-mix(in srgb, var(--cs-text-secondary) 8%, transparent)",
                color: "var(--cs-text-tertiary)",
              }}
            >
              {pinnedSessions.length}
            </span>
            {pinnedCollapsed ? (
              <RightOutlined className="text-[9px]" />
            ) : (
              <DownOutlined className="text-[9px]" />
            )}
          </div>
          {!pinnedCollapsed && pinnedSessions.map(renderSessionItem)}
        </>
      )}
      {pinnedSessions.length > 0 && normalSessions.length > 0 && (
        <div
          className="mx-3 my-1.5"
          style={{ borderTop: "1px solid var(--cs-border-sidebar)" }}
        />
      )}
      {normalSessions.length > 0 && (
        <>
          <div
            className="app-sidebar-section-header flex items-center gap-1.5 px-2.5 py-1 cursor-pointer select-none rounded-lg"
            style={{ color: "var(--cs-text-secondary)" }}
            onClick={onToggleSessions}
          >
            <CodeOutlined className="text-[10px]" />
            <span className="text-[10px] font-medium uppercase tracking-wider flex-1">
              {sessionsSectionText}
            </span>
            <span
              className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
              style={{
                background: "color-mix(in srgb, var(--cs-text-secondary) 8%, transparent)",
                color: "var(--cs-text-tertiary)",
              }}
            >
              {normalSessions.length}
            </span>
            {sessionsCollapsed ? (
              <RightOutlined className="text-[9px]" />
            ) : (
              <DownOutlined className="text-[9px]" />
            )}
          </div>
          {!sessionsCollapsed && normalSessions.map(renderSessionItem)}
        </>
      )}
    </div>
  );
}

export default SidebarSessionsPanel;
