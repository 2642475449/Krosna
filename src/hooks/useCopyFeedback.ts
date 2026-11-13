import { useCallback, useEffect, useRef, useState } from "react";

/** 管理原地复制确认态的限时重置，配合图标/文案微反馈减少全局打断。 */
export function useCopyFeedback(resetMs = 1500) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const markCopied = useCallback(
    (key = "default") => {
      clearTimer();
      setCopiedKey(key);
      timerRef.current = window.setTimeout(() => {
        setCopiedKey(null);
        timerRef.current = null;
      }, resetMs);
    },
    [clearTimer, resetMs],
  );

  const isCopied = useCallback(
    (key = "default") => copiedKey === key,
    [copiedKey],
  );

  return { copiedKey, isCopied, markCopied };
}
