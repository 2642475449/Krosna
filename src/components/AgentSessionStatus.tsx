import { useEffect, useState } from "react";
import { LoadingOutlined } from "@ant-design/icons";
import { Badge, Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import type { Session } from "@/types";
import { useAppStore } from "@/store";
import { getSessionFeedback } from "@/lib/sessionFeedback";

const dotColors = {
  waiting: "var(--cs-warning)", permission: "var(--cs-warning)",
  completed: "var(--cs-success)", error: "var(--cs-error)",
};

export function AgentSessionStatus({ session, visible = false }: {
  session: Session; visible?: boolean;
}) {
  const { t } = useTranslation();
  const item = useAppStore(state => state.projectAttentionItems?.[session.path]?.find(entry => entry.sessionId === session.id));
  const [, tick] = useState(0);
  const candidate = getSessionFeedback(session, item);
  const feedback = candidate?.state === "unknown" ? null : candidate;
  const expiresAt = feedback?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setTimeout(() => tick(value => value + 1), Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);
  useEffect(() => {
    if (!visible) return;
    const observe = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      if ((session.unreadCount ?? 0) > 0 || (item?.disposition === "open" && (item.kind === "completion" || item.seenAt === undefined))) {
        useAppStore.getState().markSessionRead(session.id);
      }
    };
    observe();
    window.addEventListener("focus", observe);
    document.addEventListener("visibilitychange", observe);
    return () => {
      window.removeEventListener("focus", observe);
      document.removeEventListener("visibilitychange", observe);
    };
  }, [visible, session.id, session.unreadCount, item]);
  const label = feedback ? t(`sessionFeedback.${feedback.unread ? "completedUnread" : feedback.state}`) : "";
  const running = feedback?.state === "running" || feedback?.state === "starting";
  const content = <span
    className="app-agent-session-status"
    data-state={feedback?.state ?? "idle"}
    data-unread={feedback?.unread ? "true" : undefined}
    role={feedback ? "img" : undefined}
    aria-label={label || undefined}
    aria-hidden={!feedback || undefined}
  >
    {running ? <LoadingOutlined spin /> : feedback && feedback.state in dotColors
      ? <Badge color={dotColors[feedback.state as keyof typeof dotColors]} /> : null}
  </span>;
  return feedback ? <Tooltip title={feedback.detail ? <>{label}<br />{feedback.detail}</> : label} mouseEnterDelay={0.4}>{content}</Tooltip> : content;
}
