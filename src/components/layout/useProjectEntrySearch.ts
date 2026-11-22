import { useEffect, useMemo, useRef, useState } from "react";
import { searchProjectEntries } from "@/lib/api";
import type { FileTreeEntry } from "@/types";
import { buildRelativePath } from "./titleBarQuickSearchItems";

interface SearchReply {
  projectPath: string;
  query: string;
  entries: FileTreeEntry[];
  failed: boolean;
}

const NO_ENTRIES: FileTreeEntry[] = [];

export function useProjectEntrySearch(projectPath: string | undefined, input: string) {
  const query = input.trim().toLowerCase().replaceAll("\\", "/");
  const [reply, setReply] = useState<SearchReply | null>(null);
  const inFlight = useRef<{ projectPath: string; done: Promise<void> } | null>(null);

  useEffect(() => {
    if (!projectPath || !query) {
      setReply(null);
      if (!projectPath) inFlight.current = null;
      return;
    }
    let current = true;
    let retryTimer: number | undefined;
    // 空闲时立即查；索引忙时，让最后一次输入接着查，跳过中间词。
    const search = () => {
      if (!current) return;
      const done = searchProjectEntries(projectPath, query).then(
        (entries) => { if (current) setReply({ projectPath, query, entries, failed: false }); },
        (error: unknown) => {
          if (!current) return;
          if ((error instanceof Error ? error.message : String(error)) === "search-index-building") {
            // The native wait timed out during discovery. Rejoin it with the same input.
            retryTimer = window.setTimeout(search, 0);
          } else {
            setReply({ projectPath, query, entries: NO_ENTRIES, failed: true });
          }
        },
      );
      inFlight.current = { projectPath, done };
      void done.then(() => {
        if (inFlight.current?.done === done) inFlight.current = null;
      });
    };
    if (inFlight.current?.projectPath === projectPath) void inFlight.current.done.then(search);
    else search();
    return () => { current = false; window.clearTimeout(retryTimer); };
  }, [projectPath, query]);

  const previous = reply?.projectPath === projectPath ? reply : null;
  const pending = Boolean(projectPath && query && previous?.query !== query);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!pending) return;
    const timer = window.setTimeout(() => setSlow(true), 200);
    return () => window.clearTimeout(timer);
  }, [pending, projectPath]);

  const entries = useMemo(() => {
    if (!projectPath || !query || !previous) return NO_ENTRIES;
    if (previous.query === query) return previous.entries;
    // 已返回的候选数有上限。先从中找能显示的项，后台仍按完整索引重新匹配和排序。
    return previous.entries.filter((entry) => {
      const path = buildRelativePath(projectPath, entry.path).toLowerCase();
      let offset = 0;
      for (const char of query) {
        const next = path.indexOf(char, offset);
        if (next === -1) return false;
        offset = next + char.length;
      }
      return true;
    });
  }, [previous, projectPath, query]);

  return { entries, pending, showLoading: pending && slow, failed: previous?.query === query && previous.failed };
}
