import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CaretDownOutlined,
  CaretRightOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  MoreOutlined,
  SearchOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { Button, Checkbox, Dropdown, Empty, Input, Modal, Pagination, Select, Tag, Tooltip, message } from "antd";
import { useTranslation } from "react-i18next";
import { AgentIcon } from "@/components/AgentIcon";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { getAgentDisplayName } from "@/lib/agents";
import {
  filterAndSortArchivedRows,
  groupArchivedRowsByProject,
  normalizeArchivedSessionGroups,
  type AgentFilter,
  type ArchiveSort,
  type ArchivedRow,
} from "@/lib/archivedSessions";
import { useAppStore } from "@/store";
import type { AgentId, AiAgentId, Session } from "@/types";

const PAGE_SIZE_OPTIONS = [20, 50, 100];

function archiveKey({ projectPath, session }: ArchivedRow) {
  return [projectPath, session.id].join("\u0000");
}

function sessionAgent(session: Session): AgentId {
  return session.agentId ?? "claude";
}

function agentName(agentId: AgentId) {
  if (agentId === "powershell") return "PowerShell";
  if (agentId === "cmd") return "CMD";
  return getAgentDisplayName(agentId as AiAgentId);
}

function projectNameFromPath(projectPath: string) {
  return projectPath.split(/[\\/]/).filter(Boolean).pop() || projectPath;
}

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

export function ArchivedSessionsPage() {
  const { t, i18n } = useTranslation();
  const [modal, modalContextHolder] = Modal.useModal();
  const [messageApi, messageContextHolder] = message.useMessage();
  const projectArchivedSessions = useAppStore((state) => state.projectArchivedSessions);
  const restoreArchivedSessions = useAppStore((state) => state.restoreArchivedSessions);
  const removeArchivedSessions = useAppStore((state) => state.removeArchivedSessions);
  const controlId = useId();
  const searchField = useRef<HTMLDivElement>(null);
  const operationInFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState<AgentFilter>("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [sort, setSort] = useState<ArchiveSort>("recent");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const archivedSessionGroups = useMemo(
    () => normalizeArchivedSessionGroups(projectArchivedSessions),
    [projectArchivedSessions],
  );

  const { allRows, projectOptions, duplicateNames } = useMemo(() => {
    const entries = Object.entries(archivedSessionGroups).filter(([, sessions]) => sessions.length > 0);
    const nameCounts = new Map<string, number>();
    for (const [projectPath] of entries) {
      const key = projectNameFromPath(projectPath).toLocaleLowerCase();
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
    const duplicateNames = new Set(
      [...nameCounts].filter(([, count]) => count > 1).map(([name]) => name),
    );
    return {
      duplicateNames,
      allRows: entries.flatMap(([projectPath, sessions]) => {
        const projectName = projectNameFromPath(projectPath);
        return sessions.map((session) => ({ projectPath, projectName, session }));
      }),
      projectOptions: entries.map(([projectPath, sessions]) => {
        const name = projectNameFromPath(projectPath);
        const label = duplicateNames.has(name.toLocaleLowerCase()) ? projectPath : name;
        return { value: projectPath, label: label + " (" + sessions.length + ")", title: projectPath };
      }).sort((left, right) => left.label.localeCompare(right.label)),
    };
  }, [archivedSessionGroups]);

  const availableAgents = useMemo(
    () => [...new Set(allRows.map(({ session }) => sessionAgent(session)))]
      .sort((left, right) => agentName(left).localeCompare(agentName(right))),
    [allRows],
  );

  const matchingGroups = useMemo(() => groupArchivedRowsByProject(
    filterAndSortArchivedRows(allRows, { query, agent: agentFilter, project: projectFilter, sort }),
  ), [agentFilter, allRows, projectFilter, query, sort]);
  const matchingRows = useMemo(() => [...matchingGroups.values()].flat(), [matchingGroups]);
  const lastPage = Math.max(1, Math.ceil(matchingRows.length / pageSize));
  const currentPage = Math.min(page, lastPage);
  const pageRows = useMemo(
    () => matchingRows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, matchingRows, pageSize],
  );
  const groupedPageRows = useMemo(() => [...groupArchivedRowsByProject(pageRows)], [pageRows]);
  const visibleRows = useMemo(
    () => pageRows.filter((row) => !collapsedProjects.has(row.projectPath)),
    [collapsedProjects, pageRows],
  );
  const selectedRows = visibleRows.filter((row) => selectedKeys.has(archiveKey(row)));
  const allPageSelected = visibleRows.length > 0 && selectedRows.length === visibleRows.length;

  const dateFormats = useMemo(() => ({
    time: new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }),
    short: new Intl.DateTimeFormat(i18n.language, {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    }),
    older: new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }),
    full: new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "medium" }),
  }), [i18n.language]);

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [currentPage, page]);

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  function archiveTime(timestamp?: number) {
    if (!timestamp) return null;
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return null;
    const primary = isSameDay(date, now)
      ? t("settings.archived.todayAt", { time: dateFormats.time.format(date) })
      : isSameDay(date, yesterday)
        ? t("settings.archived.yesterdayAt", { time: dateFormats.time.format(date) })
        : (date.getFullYear() === now.getFullYear() ? dateFormats.short : dateFormats.older).format(date);
    return { primary, full: dateFormats.full.format(date), iso: date.toISOString() };
  }

  function resetView() {
    setPage(1);
    setSelectedKeys(new Set());
    setCollapsedProjects(new Set());
  }

  function clearFilters() {
    setQuery("");
    setAgentFilter("all");
    setProjectFilter("all");
    resetView();
  }

  function toggleProject(projectPath: string, rows: ArchivedRow[]) {
    const next = new Set(collapsedProjects);
    if (next.delete(projectPath)) {
      setCollapsedProjects(next);
      return;
    }
    next.add(projectPath);
    setCollapsedProjects(next);
    setSelectedKeys((current) => {
      const updated = new Set(current);
      for (const row of rows) updated.delete(archiveKey(row));
      return updated;
    });
  }

  function toggleRow(row: ArchivedRow, checked: boolean) {
    const key = archiveKey(row);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function mutateRows(action: "restore" | "remove", rows: ArchivedRow[]) {
    if (operationInFlight.current || rows.length === 0) return;
    operationInFlight.current = true;
    setBusy(true);
    const targets = rows.map(({ projectPath, session }) => ({ projectPath, sessionId: session.id }));
    const mutation = action === "restore" ? restoreArchivedSessions : removeArchivedSessions;
    try {
      const count = await mutation(targets);
      if (count > 0) {
        messageApi.success(t(action === "restore" ? "settings.archived.sessionsRestored" : "settings.archived.sessionsDeleted", { count }));
        setSelectedKeys((current) => {
          const next = new Set(current);
          for (const row of rows) next.delete(archiveKey(row));
          return next;
        });
      } else {
        messageApi.info(t("settings.archived.sessionsChanged"));
      }
    } catch {
      messageApi.error(t(action === "restore" ? "settings.archived.restoreFailed" : "settings.archived.deleteFailed"));
    } finally {
      operationInFlight.current = false;
      setBusy(false);
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) searchField.current?.querySelector("input")?.focus();
      });
    }
  }

  function confirmDelete(row?: ArchivedRow) {
    const targets = row ? [row] : allRows;
    modal.confirm({
      centered: true,
      focusable: { autoFocusButton: "cancel" },
      title: row
        ? t("settings.archived.confirmDeleteNamed", { session: row.session.name })
        : t("settings.archived.confirmDeleteAllProjects", { count: targets.length }),
      content: row
        ? t("settings.archived.confirmDeleteProject", { project: row.projectPath })
        : t("settings.archived.confirmDeleteAllScope"),
      okText: t("settings.archived.deletePermanently"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: () => mutateRows("remove", targets),
    });
  }

  return (
    <div>
      {modalContextHolder}
      {messageContextHolder}
      <SettingsPageHeader title={
        <span className="flex flex-wrap items-center gap-2.5">
          <span>{t("settings.archived.title")}</span>
          <Tag className="app-archived-count">{t("settings.archived.countLabel", { count: allRows.length })}</Tag>
        </span>
      }>
        <div className="app-archived-toolbar">
          <div ref={searchField} className="app-archived-field app-archived-search">
            <label htmlFor={controlId + "-search"}>{t("settings.archived.searchLabel")}</label>
            <Input
              id={controlId + "-search"}
              allowClear
              value={query}
              onChange={(event) => { setQuery(event.target.value); resetView(); }}
              prefix={<SearchOutlined />}
              placeholder={t("settings.archived.searchPlaceholder")}
            />
          </div>
          <div className="app-archived-field">
            <label htmlFor={controlId + "-agent"}>{t("settings.archived.columnAgent")}</label>
            <Select<AgentFilter>
              id={controlId + "-agent"}
              aria-label={t("settings.archived.columnAgent")}
              value={agentFilter}
              onChange={(value) => { setAgentFilter(value); resetView(); }}
              options={[
                { value: "all", label: t("settings.archived.allAgents") },
                ...availableAgents.map((agentId) => ({
                  value: agentId,
                  label: <span className="inline-flex items-center gap-2"><AgentIcon agentId={agentId} size={14} />{agentName(agentId)}</span>,
                })),
              ]}
            />
          </div>
          <div className="app-archived-field">
            <label htmlFor={controlId + "-project"}>{t("settings.archived.projectLabel")}</label>
            <Select
              id={controlId + "-project"}
              aria-label={t("settings.archived.projectLabel")}
              value={projectFilter}
              onChange={(value) => { setProjectFilter(value); resetView(); }}
              options={[{ value: "all", label: t("settings.archived.allProjects") }, ...projectOptions]}
            />
          </div>
          <div className="app-archived-field">
            <label htmlFor={controlId + "-sort"}>{t("settings.archived.sortWithinProject")}</label>
            <Select<ArchiveSort>
              id={controlId + "-sort"}
              aria-label={t("settings.archived.sortWithinProject")}
              value={sort}
              onChange={(value) => { setSort(value); resetView(); }}
              options={[
                { value: "recent", label: t("settings.archived.sortRecent") },
                { value: "oldest", label: t("settings.archived.sortOldest") },
                { value: "name", label: t("settings.archived.sortName") },
              ]}
            />
          </div>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [{
                key: "delete-all",
                danger: true,
                icon: <DeleteOutlined />,
                label: t("settings.archived.deleteAcrossProjects"),
                disabled: busy || allRows.length === 0,
              }],
              onClick: () => confirmDelete(),
            }}
          >
            <Button icon={<MoreOutlined />} disabled={busy || allRows.length === 0} aria-haspopup="menu">
              {t("settings.archived.manage")}
            </Button>
          </Dropdown>
        </div>
      </SettingsPageHeader>

      <div className="app-settings-list app-archived-list">
        <div className={selectedRows.length ? "app-archived-selection" : "sr-only"}>
          <span role="status">{t("settings.archived.selectedInline", { count: selectedRows.length })}</span>
          {selectedRows.length > 0 && (
            <>
              <Button type="primary" size="small" icon={<UndoOutlined />} disabled={busy} onClick={() => void mutateRows("restore", selectedRows)}>
                {t("settings.archived.restoreSelected")}
              </Button>
              <Button type="text" size="small" disabled={busy} onClick={() => {
                setSelectedKeys(new Set());
                searchField.current?.querySelector("input")?.focus();
              }}>
                {t("settings.archived.clearSelection")}
              </Button>
            </>
          )}
        </div>
        {allRows.length === 0 ? (
          <div className="py-16">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={
              <div>
                <div>{t("settings.archived.empty")}</div>
                <div className="app-archived-muted mt-1 text-xs">{t("settings.archived.emptyDesc")}</div>
              </div>
            } />
          </div>
        ) : matchingRows.length === 0 ? (
          <div className="py-14">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("settings.archived.noResults")}>
              <Button onClick={clearFilters}>{t("settings.archived.clearFilters")}</Button>
            </Empty>
          </div>
        ) : (
          <>
            <div className="app-archived-table" role="table" aria-label={t("settings.archived.title")} aria-busy={busy}>
              <div className="app-archived-grid app-archived-header" role="row">
                <div role="columnheader">
                  <Checkbox
                    aria-label={t("settings.archived.selectVisible")}
                    disabled={busy || visibleRows.length === 0}
                    checked={allPageSelected}
                    indeterminate={!allPageSelected && selectedRows.length > 0}
                    onChange={(event) => setSelectedKeys(event.target.checked ? new Set(visibleRows.map(archiveKey)) : new Set())}
                  />
                </div>
                <span role="columnheader">{t("settings.archived.columnSession")}</span>
                <span role="columnheader" className="app-archived-wide-meta">{t("settings.archived.columnAgent")}</span>
                <span role="columnheader" className="app-archived-wide-meta">{t("settings.archived.columnArchivedAt")}</span>
                <span role="columnheader" className="text-center">{t("settings.archived.columnActions")}</span>
              </div>

              {groupedPageRows.map(([projectPath, rows], index) => {
                const collapsed = collapsedProjects.has(projectPath);
                const groupId = controlId + "-group-" + index;
                const projectName = rows[0].projectName;
                const sameName = duplicateNames.has(projectName.toLocaleLowerCase());
                const totalInProject = matchingGroups.get(projectPath)?.length ?? 0;
                return (
                  <div role="rowgroup" key={projectPath} aria-label={sameName ? projectPath : projectName}>
                    <div role="row" className="app-archived-group-row">
                      <div role="cell" aria-colspan={5}>
                        <button
                          type="button"
                          className="app-archived-group-button"
                          aria-expanded={!collapsed}
                          aria-controls={groupId}
                          title={projectPath}
                          onClick={() => toggleProject(projectPath, rows)}
                        >
                          {collapsed ? <CaretRightOutlined /> : <CaretDownOutlined />}
                          <FolderOpenOutlined className="app-archived-folder-icon" />
                          <span className="app-archived-group-name">{projectName}</span>
                          {sameName && <span className="app-archived-group-path">{projectPath}</span>}
                          <span className="app-archived-muted shrink-0">{totalInProject}</span>
                        </button>
                      </div>
                    </div>
                    <div id={groupId} role="presentation" hidden={collapsed}>
                      {!collapsed && rows.map((row) => {
                        const key = archiveKey(row);
                        const agentId = sessionAgent(row.session);
                        const time = archiveTime(row.session.archivedAt);
                        const name = row.session.name;
                        const date = time ? <time dateTime={time.iso} title={time.full}>{time.primary}</time> : null;
                        return (
                          <div key={key} className="app-archived-grid app-archived-row" role="row" data-session-id={row.session.id}>
                            <div role="cell">
                              <Checkbox
                                aria-label={t("settings.archived.selectSession", { session: name })}
                                disabled={busy}
                                checked={selectedKeys.has(key)}
                                onChange={(event) => toggleRow(row, event.target.checked)}
                              />
                            </div>
                            <div role="rowheader" className="min-w-0">
                              <div className="truncate text-sm font-medium" title={name}>{name}</div>
                              <div className="app-archived-compact-meta">
                                <AgentIcon agentId={agentId} size={14} />
                                <span className="truncate">{agentName(agentId)}</span>
                                {date ?? <span className="app-archived-muted">{t("settings.archived.unknownTime")}</span>}
                              </div>
                            </div>
                            <div role="cell" className="app-archived-agent app-archived-wide-meta">
                              <AgentIcon agentId={agentId} size={17} />
                              <span className="truncate">{agentName(agentId)}</span>
                            </div>
                            <div role="cell" className="app-archived-date app-archived-wide-meta">
                              {date ?? <span className="app-archived-muted">{t("settings.archived.unknownTime")}</span>}
                            </div>
                            <div role="cell" className="app-archived-actions">
                              <Tooltip title={t("settings.archived.unarchive")}>
                                <Button
                                  size="small"
                                  type="text"
                                  icon={<UndoOutlined />}
                                  aria-label={t("settings.archived.restoreNamed", { session: name })}
                                  disabled={busy}
                                  onClick={() => void mutateRows("restore", [row])}
                                />
                              </Tooltip>
                              <Dropdown trigger={["click"]} menu={{
                                items: [{ key: "delete", danger: true, icon: <DeleteOutlined />, label: t("settings.archived.delete") }],
                                onClick: () => confirmDelete(row),
                              }}>
                                <Button
                                  size="small"
                                  type="text"
                                  icon={<MoreOutlined />}
                                  aria-haspopup="menu"
                                  aria-label={t("settings.archived.sessionActions", { session: name })}
                                  disabled={busy}
                                />
                              </Dropdown>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="app-archived-pagination">
              <span>{t("settings.archived.sessionCount", { count: matchingRows.length })}</span>
              <Pagination
                size="small"
                current={currentPage}
                pageSize={pageSize}
                total={matchingRows.length}
                showSizeChanger
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                onChange={(nextPage, nextPageSize) => {
                  setSelectedKeys(new Set());
                  setPage(nextPageSize === pageSize ? nextPage : 1);
                  setPageSize(nextPageSize);
                  searchField.current?.closest(".app-settings-scroll")?.scrollTo({ top: 0, behavior: "instant" });
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ArchivedSessionsPage;
