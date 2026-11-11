import type { ISearchOptions, SearchAddon } from "@xterm/addon-search";
import type { Terminal } from "@xterm/xterm";
import type { RunnerLogSearchState } from "@/store/types";

/** 查询变化使用增量搜索；导航只在请求变化时执行，结果回写不能触发下一次跳转。 */
export function createRunnerLogSearch(
  terminal: Pick<Terminal, "clearSelection" | "focus">,
  addon: Pick<SearchAddon, "findNext" | "findPrevious" | "clearDecorations" | "onDidChangeResults">,
  options: {
    pauseFollow: () => void;
    isVisible: () => boolean;
    decorations: () => NonNullable<ISearchOptions["decorations"]>;
    onResults: (index: number, count: number) => void;
  },
) {
  let previous: Pick<RunnerLogSearchState, "open" | "query" | "request"> | null = null;
  const results = addon.onDidChangeResults(({ resultIndex, resultCount }) => {
    if (previous?.open && previous.query) options.onResults(resultIndex, resultCount);
  });
  const clear = () => {
    addon.clearDecorations();
    addon.findNext("");
    terminal.clearSelection();
    options.onResults(-1, 0);
  };
  return {
    update(search: RunnerLogSearchState) {
      const before = previous;
      previous = { open: search.open, query: search.query, request: search.request };
      if (!search.open) {
        if (before?.open) {
          clear();
          if (options.isVisible()) terminal.focus();
        }
        return;
      }
      const changed = !before?.open || before.query !== search.query;
      const navigate = before?.request !== search.request;
      if (!changed && !navigate) return;
      if (!search.query) { clear(); return; }
      options.pauseFollow();
      const searchOptions = { decorations: options.decorations(), incremental: changed };
      if (!changed && search.direction === "previous") addon.findPrevious(search.query, searchOptions);
      else addon.findNext(search.query, searchOptions);
    },
    dispose() { results.dispose(); addon.clearDecorations(); },
  };
}
