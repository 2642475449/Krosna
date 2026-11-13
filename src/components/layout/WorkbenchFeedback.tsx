import { useEffect, useRef, type ReactNode } from "react";
import { useWorkbenchFeedback } from "@/lib/workbenchFeedback";

export function WorkbenchFeedback({ children }: { children: ReactNode }) {
  const notice = useWorkbenchFeedback((state) => state.notice);
  const hadNoticeRef = useRef(false);
  if (notice) {
    hadNoticeRef.current = true;
  }

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => {
      if (useWorkbenchFeedback.getState().notice === notice) {
        useWorkbenchFeedback.setState({ notice: null });
      }
    }, Math.max(0, notice.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [notice]);

  return <>
    <span role="status" aria-live="polite" aria-atomic="true"
      className={notice ? "min-w-0 truncate" : "sr-only"} title={notice?.text}>
      {notice ? <span key={notice.text} className="app-text-swap">{notice.text}</span> : ""}
    </span>
    <div
      className={notice ? "hidden" : `flex min-w-0 flex-1 items-center${hadNoticeRef.current ? " app-text-swap" : ""}`}
    >
      {children}
    </div>
  </>;
}
