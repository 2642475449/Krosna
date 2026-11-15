import { useShortcutStore } from "@/store/slices/shortcutSlice";
import { createDoubleShiftMatcher, getAppShortcut } from "@/lib/appShortcuts";
import { matchesShortcut, formatShortcutDisplay } from "@/lib/shortcut";
import { SearchOutlined } from "@ant-design/icons";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Empty, Input, Modal, Spin } from "antd";
import type { InputRef } from "antd";
import { listProjectDirectory, searchProjectEntries } from "@/lib/api";
import { revealExplorerPath } from "@/lib/explorer";
import { getFileIcon } from "@/lib/fileIcon";
import { shouldIgnoreShortcut } from "@/hooks/useKeyboardShortcuts";
import { useAppStore } from "@/store";
import { EMPTY_GIT_STATUS, useGitStatusStore } from "@/store/slices/gitStatus";
import { useTranslation } from "react-i18next";
import type { FileTreeEntry } from "@/types";
import {
  buildDefaultQuickSearchItems,
  buildRelativePath,
  getParentPath,
  loadRecentQuickSearchPaths,
  MAX_DEFAULT_QUICK_SEARCH_ITEMS,
  recordRecentQuickSearchPaths,
  type QuickSearchItem,
} from "./titleBarQuickSearchItems";

function highlightMatch(value: string, query: string) {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return value;

  const lowerValue = value.toLocaleLowerCase();
  const exactIndex = lowerValue.indexOf(keyword);
  if (exactIndex >= 0) {
    return (
      <>
        {value.slice(0, exactIndex)}
        <mark className="rounded-[2px] bg-transparent font-semibold text-[var(--cs-primary)]">
          {value.slice(exactIndex, exactIndex + keyword.length)}
        </mark>
        {value.slice(exactIndex + keyword.length)}
      </>
    );
  }

  const matchedIndexes = new Set<number>();
  let queryIndex = 0;
  for (let index = 0; index < lowerValue.length && queryIndex < keyword.length; index += 1) {
    if (lowerValue[index] === keyword[queryIndex]) {
      matchedIndexes.add(index);
      queryIndex += 1;
    }
  }
  if (queryIndex !== keyword.length) return value;

  return Array.from(value).map((character, index) =>
    matchedIndexes.has(index) ? (
      <mark
        key={`${index}:${character}`}
        className="bg-transparent font-semibold text-[var(--cs-primary)]"
      >
        {character}
      </mark>
    ) : (
      character
    )
  );
}

function TitleBarQuickSearch() {
  const searchShortcut = useShortcutStore((s) => getAppShortcut(s.overrides, "searchEverywhere"));
  const { t } = useTranslation();
  const currentProject = useAppStore((s) => s.currentProject);
  const tabsById = useAppStore((s) => s.tabsById);
  const openFileTab = useAppStore((s) => s.openFileTab);
  const gitStatuses = useGitStatusStore(
    (s) => (currentProject ? (s.entries[currentProject.path] ?? EMPTY_GIT_STATUS).fileStatuses : EMPTY_GIT_STATUS.fileStatuses)
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QuickSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentFilePaths, setRecentFilePaths] = useState<string[]>([]);
  const [fallbackState, setFallbackState] = useState<{
    projectPath: string;
    entries: FileTreeEntry[];
  } | null>(null);
  const deferredQuery = useDeferredValue(query);
  const inputRef = useRef<InputRef | null>(null);
  const resultListRef = useRef<HTMLDivElement | null>(null);

  const openFileTabs = useMemo(
    () =>
      Object.values(tabsById)
        .filter((tab) => tab.kind === "file")
        .sort((left, right) => right.lastActivatedAt - left.lastActivatedAt),
    [tabsById]
  );

  useEffect(() => {
    if (!currentProject) {
      setRecentFilePaths([]);
      setFallbackState(null);
      return;
    }
    const tabPaths = openFileTabs.map((tab) => tab.resourceId);
    const base = loadRecentQuickSearchPaths(currentProject.path);
    const updated =
      tabPaths.length > 0
        ? recordRecentQuickSearchPaths(currentProject.path, tabPaths, base)
        : base;
    setRecentFilePaths(updated);
  }, [currentProject, openFileTabs]);

  const fallbackEntries = useMemo(
    () =>
      currentProject && fallbackState?.projectPath === currentProject.path
        ? fallbackState.entries
        : [],
    [currentProject, fallbackState]
  );

  const recentItemsWithoutFallback = useMemo(
    () =>
      currentProject
        ? buildDefaultQuickSearchItems({
            projectPath: currentProject.path,
            openFileTabs,
            recentFilePaths,
            gitStatuses,
            fallbackEntries: [],
            limit: MAX_DEFAULT_QUICK_SEARCH_ITEMS,
          })
        : [],
    [currentProject, gitStatuses, openFileTabs, recentFilePaths]
  );

  useEffect(() => {
    if (!open || !currentProject || query.trim()) return;
    if (recentItemsWithoutFallback.length >= MAX_DEFAULT_QUICK_SEARCH_ITEMS) return;
    if (fallbackState?.projectPath === currentProject.path) return;

    const projectPath = currentProject.path;
    let cancelled = false;
    void listProjectDirectory(projectPath)
      .then((listing) => {
        if (cancelled) return;
        setFallbackState({ projectPath, entries: listing.entries });
      })
      .catch(() => {
        if (cancelled) return;
        setFallbackState({ projectPath, entries: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [currentProject, fallbackState?.projectPath, open, query, recentItemsWithoutFallback.length]);

  const recentItems = useMemo<QuickSearchItem[]>(() => {
    if (!currentProject) return [];
    if (recentItemsWithoutFallback.length >= MAX_DEFAULT_QUICK_SEARCH_ITEMS) {
      return recentItemsWithoutFallback;
    }
    return buildDefaultQuickSearchItems({
      projectPath: currentProject.path,
      openFileTabs,
      recentFilePaths,
      gitStatuses,
      fallbackEntries,
      limit: MAX_DEFAULT_QUICK_SEARCH_ITEMS,
    });
  }, [
    currentProject,
    fallbackEntries,
    gitStatuses,
    openFileTabs,
    recentFilePaths,
    recentItemsWithoutFallback,
  ]);

  const visibleItems = useMemo(() => {
    const trimmedQuery = query.trim();
    return trimmedQuery ? results : recentItems;
  }, [query, recentItems, results]);

  const openSearch = useCallback(() => {
    setOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setSearching(false);
    setActiveIndex(0);
  }, []);

  const handleOpenItem = useCallback(
    (item: QuickSearchItem) => {
      if (item.kind === "directory") {
        revealExplorerPath(item.path, "directory");
      } else {
        if (currentProject) {
          setRecentFilePaths((prev) =>
            recordRecentQuickSearchPaths(currentProject.path, [item.path], prev)
          );
        }
        openFileTab(item.path, { preview: false });
      }
      closeSearch();
    },
    [closeSearch, currentProject, openFileTab]
  );

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      inputRef.current?.focus({ cursor: "all" });
    }, 10);
    return () => window.clearTimeout(handle);
  }, [open]);

  useEffect(() => {
    if (!open || !currentProject) return;

    const trimmedQuery = deferredQuery.trim();
    if (!trimmedQuery) {
      setResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timer = window.setTimeout(() => {
      void searchProjectEntries(currentProject.path, trimmedQuery)
        .then((entries) => {
          if (cancelled) return;
          const nextItems = entries
            .slice(0, 50)
            .map((entry) => {
              const relativePath = buildRelativePath(currentProject.path, entry.path);
              return {
                key: `search:${entry.path}`,
                path: entry.path,
                name: entry.name,
                relativePath,
                parentPath: getParentPath(relativePath),
                kind: entry.kind,
                section: "search" as const,
              };
            });
          setResults(nextItems);
          setActiveIndex(0);
        })
        .catch(() => {
          if (!cancelled) {
            setResults([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setSearching(false);
          }
        });
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [currentProject, deferredQuery, open]);

  useEffect(() => {
    if (visibleItems.length === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((prev) => Math.min(prev, visibleItems.length - 1));
  }, [visibleItems]);

  useEffect(() => {
    const activeRow = resultListRef.current?.querySelector<HTMLElement>(
      `[data-quick-search-index="${activeIndex}"]`
    );
    activeRow?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  useEffect(() => {
    const doubleShift = createDoubleShiftMatcher();
    function handleKey(event: KeyboardEvent) {
      if (event.isComposing || useShortcutStore.getState().recordingAction) return;
      const target = event.target;
      const isEditorOrTerminal = target instanceof HTMLElement && !!target.closest(".monaco-editor, .xterm");
      const isEditableTarget = !isEditorOrTerminal && shouldIgnoreShortcut(event);
      const matches = searchShortcut === "Double Shift"
        ? doubleShift(event, Date.now())
        : event.type === "keydown" && !event.repeat && matchesShortcut(event, searchShortcut);
      if (!open && !isEditableTarget && matches) {
        event.preventDefault();
        event.stopPropagation();
        openSearch();
        return;
      }
      if (event.type === "keydown" && open && !shouldIgnoreShortcut(event) && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeSearch();
      }
    }
    function handleMouse(event: MouseEvent) {
      if (open || useShortcutStore.getState().recordingAction || !matchesShortcut(event, searchShortcut)) return;
      event.preventDefault();
      event.stopPropagation();
      openSearch();
    }
    document.addEventListener("mousedown", handleMouse, true);
    document.addEventListener("keydown", handleKey, true);
    document.addEventListener("keyup", handleKey, true);
    return () => {
      document.removeEventListener("mousedown", handleMouse, true);
      document.removeEventListener("keydown", handleKey, true);
      document.removeEventListener("keyup", handleKey, true);
    };
  }, [closeSearch, open, openSearch, searchShortcut]);

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (visibleItems.length > 0) {
          setActiveIndex((prev) => (prev + 1) % visibleItems.length);
        }
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (visibleItems.length > 0) {
          setActiveIndex((prev) => (prev - 1 + visibleItems.length) % visibleItems.length);
        }
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const item = visibleItems[activeIndex];
        if (item) {
          handleOpenItem(item);
        }
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        if (visibleItems.length > 0) {
          setActiveIndex(
            (prev) =>
              (prev + (event.shiftKey ? -1 : 1) + visibleItems.length) % visibleItems.length
          );
        }
      }
    },
    [activeIndex, handleOpenItem, visibleItems]
  );

  return (
    <>
      <button
        type="button"
        className="app-titlebar-search"
        data-active={open ? "true" : "false"}
        onClick={openSearch}
        title={`${t("titleBar.quickSearch")}${searchShortcut ? ` (${searchShortcut === "Double Shift" ? t("settings.shortcuts.doubleShift") : formatShortcutDisplay(searchShortcut)})` : ""}`}
      >
        <SearchOutlined className="text-[11px]" />
        <span className="text-[12px]">{t("titleBar.quickSearch")}</span>
      </button>

      <Modal
        open={open}
        footer={null}
        onCancel={closeSearch}
        closeIcon={null}
        width={820}
        style={{ top: "12vh", maxWidth: "calc(100vw - 32px)" }}
        styles={{
          container: {
            padding: 8,
            background: "var(--cs-bg-card)",
            border: "1px solid var(--cs-overlay-border)",
            boxShadow: "var(--cs-overlay-shadow)",
          },
        }}
      >
        <div
          className="flex flex-col gap-1 rounded-[10px]"
          style={{ background: "var(--cs-bg-card)" }}
        >
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={
              currentProject
                ? t("titleBar.quickSearchPlaceholder")
                : t("titleBar.quickSearchNoProjectPlaceholder")
            }
            prefix={<SearchOutlined style={{ color: "var(--cs-text-tertiary)" }} />}
            allowClear
            size="middle"
          />

          <div
            className="overflow-hidden rounded-[8px] border"
            style={{
              borderColor: "var(--cs-border-card, var(--cs-border))",
              background: "var(--cs-bg-card)",
            }}
          >
            {!currentProject ? (
              <div className="px-3 py-8">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t("titleBar.quickSearchNoProject")}
                />
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="px-3 py-8">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    query.trim()
                      ? t("titleBar.quickSearchEmpty")
                      : t("titleBar.quickSearchRecentEmpty")
                  }
                />
              </div>
            ) : (
              <div
                ref={resultListRef}
                className="max-h-[min(520px,65vh)] overflow-y-auto py-1"
                style={{ background: "var(--cs-bg-card)" }}
              >
                {visibleItems.map((item, index) => {
                  const active = index === activeIndex;
                  const visual = getFileIcon(item.name, item.kind === "directory");
                  return (
                    <button
                      key={item.key}
                      type="button"
                      data-quick-search-index={index}
                      className="flex h-[34px] w-full items-center gap-2 px-2.5 text-left transition-colors"
                      style={{
                        background: active ? "var(--cs-bg-hover)" : "var(--cs-bg-card)",
                      }}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => handleOpenItem(item)}
                    >
                      <div
                        className="flex h-5 w-5 shrink-0 items-center justify-center"
                        style={{ color: visual.color }}
                      >
                        {visual.icon}
                      </div>
                      <div className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span
                          className="min-w-0 shrink truncate text-[13px] font-medium"
                          style={{ color: "var(--cs-text-primary)" }}
                        >
                          {highlightMatch(item.name, query)}
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate text-[11px]"
                          style={{ color: "var(--cs-text-tertiary)" }}
                        >
                          {highlightMatch(item.parentPath, query)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div
              className="flex h-7 items-center justify-between gap-3 border-t px-2.5 text-[10px]"
              style={{
                borderColor: "var(--cs-border-card, var(--cs-border))",
                color: "var(--cs-text-tertiary)",
              }}
            >
              <span className="min-w-0 flex-1 truncate">
                {visibleItems[activeIndex]?.relativePath ??
                  (query.trim() ? t("titleBar.quickSearchResults") : t("titleBar.quickSearchRecent"))}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                {searching ? <Spin size="small" /> : null}
                <span>{t("titleBar.quickSearchKeyboardHint")}</span>
              </span>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}

export default TitleBarQuickSearch;
