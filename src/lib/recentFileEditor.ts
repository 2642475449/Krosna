import { createContext } from "react";

const RETENTION_MS = 15_000;
type RetainFileEditor = (onEvict: () => void) => () => void;

export const RecentFileEditorContext = createContext<RetainFileEditor | null>(null);

/** A pane keeps one recently hidden, unedited file editor. Its host owns disposal. */
export function createRecentFileEditorCache(): RetainFileEditor {
  let evictCurrent: (() => void) | null = null;
  return (onEvict) => {
    evictCurrent?.();

    function evict() {
      if (evictCurrent !== evict) return;
      cancel();
      onEvict();
    }
    function cancel() {
      clearTimeout(timer);
      if (evictCurrent === evict) evictCurrent = null;
    }
    const timer = setTimeout(evict, RETENTION_MS);
    evictCurrent = evict;
    return cancel;
  };
}
