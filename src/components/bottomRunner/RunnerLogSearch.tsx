import { useEffect, useRef } from "react";
import { ArrowUpOutlined, ArrowDownOutlined, CloseOutlined, SearchOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import { EMPTY_RUNNER_LOG_SEARCH, useBottomRunnerStore } from "@/store/slices/bottomRunner";

export function RunnerLogSearch({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const search = useBottomRunnerStore((state) => state.searchBySession[sessionId] ?? EMPTY_RUNNER_LOG_SEARCH);
  const setQuery = useBottomRunnerStore((state) => state.setLogSearchQuery);
  const navigate = useBottomRunnerStore((state) => state.navigateLogSearch);
  const close = () => useBottomRunnerStore.getState().setLogSearchOpen(sessionId, false);
  useEffect(() => {
    if (search.open) { input.current?.focus(); input.current?.select(); }
  }, [sessionId, search.open, search.focusRequest]);
  if (!search.open) return null;
  const status = !search.query ? "0/0" : search.resultCount === 0 ? t("bottomRunner.searchNoResults")
    : search.resultIndex < 0 ? `${search.resultCount}+` : `${search.resultIndex + 1}/${search.resultCount}`;
  const button = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
    <Tooltip title={label}><button type="button" className="app-bottom-runner-tool flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
      aria-label={label} onClick={onClick} disabled={disabled}>{icon}</button></Tooltip>
  );
  return <div role="search" aria-label={t("bottomRunner.search")}
    className="app-runner-log-search flex shrink-0 items-center justify-end gap-1 px-2 py-1 text-xs"
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === "Enter") {
        event.preventDefault(); event.stopPropagation();
        navigate(sessionId, event.shiftKey ? "previous" : "next");
      }
    }}>
    <label className="app-runner-log-search-field flex min-w-0 flex-1 items-center gap-2 rounded-md px-2">
      <SearchOutlined aria-hidden="true" />
      <input ref={input} type="search" value={search.query} maxLength={512}
        aria-label={t("bottomRunner.search")} placeholder={t("bottomRunner.searchPlaceholder")}
        className="min-w-0 flex-1 bg-transparent py-1 outline-none"
        onChange={(event) => setQuery(sessionId, event.target.value)} />
    </label>
    <span role="status" aria-live="polite" aria-atomic="true" className="app-runner-log-search-status shrink-0 px-1 tabular-nums">{status}</span>
    {button(t("bottomRunner.searchPrevious"), <ArrowUpOutlined />, () => navigate(sessionId, "previous"), search.resultCount === 0)}
    {button(t("bottomRunner.searchNext"), <ArrowDownOutlined />, () => navigate(sessionId, "next"), search.resultCount === 0)}
    {button(t("bottomRunner.searchClose"), <CloseOutlined />, close)}
  </div>;
}
