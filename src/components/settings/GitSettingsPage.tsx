import { useCallback, useMemo, useRef, useState } from "react";
import {
  CheckOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { Button, Input, Modal, Select, Switch, Tooltip, message } from "antd";
import { useTranslation } from "react-i18next";
import type { GitCommitMessageProfile } from "@/types";
import {
  createDuplicateGitCommitMessageProfileName,
  GIT_COMMIT_MESSAGE_PRESET_TEMPLATES,
  hasBuiltInGitCommitMessageProfileChanges,
  isBuiltInGitCommitMessageProfile,
  isBuiltInGitCommitMessageProfileModified,
  resetBuiltInGitCommitMessageProfiles,
  resetSingleBuiltInGitCommitMessageProfile,
  type GitCommitMessagePresetTemplate,
} from "@/lib/gitCommitMessageProfiles";
import { useAppStore } from "@/store";
import { LedgerRowPopover } from "./LedgerRowPopover";
import { SettingsPageHeader } from "./SettingsPageHeader";

const FETCH_INTERVAL_MINUTES = [1, 3, 5, 10, 20, 30, 60] as const;

/** Manages Git background fetch cadence and AI commit-message profiles in a compact ledger. */
export function GitSettingsPage() {
  const { t } = useTranslation();
  const autoFetch = useAppStore((s) => s.gitAutoFetch);
  const interval = useAppStore((s) => s.gitAutoFetchIntervalMinutes);
  const setAutoFetch = useAppStore((s) => s.setGitAutoFetch);
  const gitCommitMessageProfiles = useAppStore((state) => state.gitCommitMessageProfiles);
  const defaultGitCommitMessageProfileId = useAppStore(
    (state) => state.defaultGitCommitMessageProfileId,
  );
  const setGitCommitMessageProfiles = useAppStore(
    (state) => state.setGitCommitMessageProfiles,
  );

  // 账本行就近锚定编辑浮层状态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [popoverName, setPopoverName] = useState("");
  const [popoverInstructions, setPopoverInstructions] = useState("");
  const [scrollToProfileId, setScrollToProfileId] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const editButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const triggerElRef = useRef<HTMLElement | null>(null);

  // 独立「新建」模态框状态
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createInstructions, setCreateInstructions] = useState("");
  const [createAsDefault, setCreateAsDefault] = useState(false);

  const [deleteProfileId, setDeleteProfileId] = useState<string | null>(null);

  const hasBuiltInChanges = useMemo(
    () => hasBuiltInGitCommitMessageProfileChanges(gitCommitMessageProfiles),
    [gitCommitMessageProfiles],
  );

  const openPopover = useCallback(
    (profile: GitCommitMessageProfile, triggerEl?: HTMLElement | null) => {
      if (editingId === profile.id) {
        setEditingId(null);
        return;
      }
      triggerElRef.current = triggerEl ?? null;
      setScrollToProfileId(null);
      setEditingId(profile.id);
      setPopoverName(profile.name);
      setPopoverInstructions(profile.instructions);
    },
    [editingId],
  );

  const openCreateModal = useCallback(() => {
    setEditingId(null);
    setCreateName("");
    setCreateInstructions("");
    setCreateAsDefault(false);
    setCreateOpen(true);
  }, []);

  const applyPresetTemplate = useCallback(
    (preset: GitCommitMessagePresetTemplate) => {
      setCreateInstructions(preset.instructions);
      if (!createName.trim()) {
        const candidateName = gitCommitMessageProfiles.some(
          (item) =>
            item.name.trim().toLocaleLowerCase() ===
            preset.defaultName.toLocaleLowerCase(),
        )
          ? createDuplicateGitCommitMessageProfileName(
              preset.defaultName,
              gitCommitMessageProfiles,
              t("settings.agents.gitProfiles.copySuffix"),
            )
          : preset.defaultName;
        setCreateName(candidateName);
      }
    },
    [createName, gitCommitMessageProfiles, t],
  );

  const persistProfile = useCallback(
    (input: {
      id: string | null;
      name: string;
      instructions: string;
      makeDefault?: boolean;
    }): boolean => {
      const name = input.name.trim();
      const instructions = input.instructions.trim();
      if (!name) {
        message.warning(t("settings.agents.gitProfiles.nameRequired"));
        return false;
      }
      if (!instructions) {
        message.warning(t("settings.agents.gitProfiles.instructionsRequired"));
        return false;
      }
      if (
        gitCommitMessageProfiles.some(
          (profile) =>
            profile.id !== input.id &&
            profile.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
      ) {
        message.warning(t("settings.agents.gitProfiles.nameDuplicate"));
        return false;
      }

      const id =
        input.id ??
        (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `profile-${Date.now()}`);
      const nextProfile: GitCommitMessageProfile = {
        id,
        name: name.slice(0, 80),
        instructions: instructions.slice(0, 6000),
      };
      const nextProfiles = input.id
        ? gitCommitMessageProfiles.map((profile) =>
            profile.id === input.id ? nextProfile : profile,
          )
        : [...gitCommitMessageProfiles, nextProfile];
      setGitCommitMessageProfiles(
        nextProfiles,
        input.makeDefault ? id : defaultGitCommitMessageProfileId,
      );
      message.success(t("settings.agents.gitProfiles.saved"));
      return true;
    },
    [defaultGitCommitMessageProfileId, gitCommitMessageProfiles, setGitCommitMessageProfiles, t],
  );

  const handleSavePopover = useCallback(() => {
    if (!editingId) return;
    const ok = persistProfile({
      id: editingId,
      name: popoverName,
      instructions: popoverInstructions,
    });
    if (ok) setEditingId(null);
  }, [editingId, persistProfile, popoverInstructions, popoverName]);

  const handleSaveCreate = useCallback(() => {
    const ok = persistProfile({
      id: null,
      name: createName,
      instructions: createInstructions,
      makeDefault: createAsDefault,
    });
    if (ok) setCreateOpen(false);
  }, [createAsDefault, createInstructions, createName, persistProfile]);

  const setDefaultProfile = useCallback(
    (profileId: string) => {
      setGitCommitMessageProfiles(gitCommitMessageProfiles, profileId);
      message.success(t("settings.agents.gitProfiles.defaultChanged"));
    },
    [gitCommitMessageProfiles, setGitCommitMessageProfiles, t],
  );

  const handleDuplicateProfile = useCallback(
    (profile: GitCommitMessageProfile) => {
      const copyName = createDuplicateGitCommitMessageProfileName(
        profile.name,
        gitCommitMessageProfiles,
        t("settings.agents.gitProfiles.copySuffix"),
      );
      const id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `profile-${Date.now()}`;
      const cloned: GitCommitMessageProfile = {
        id,
        name: copyName,
        instructions: profile.instructions,
      };
      setGitCommitMessageProfiles(
        [...gitCommitMessageProfiles, cloned],
        defaultGitCommitMessageProfileId,
      );
      triggerElRef.current = null;
      setScrollToProfileId(id);
      setEditingId(id);
      setPopoverName(cloned.name);
      setPopoverInstructions(cloned.instructions);
      message.success(t("settings.agents.gitProfiles.saved"));
    },
    [defaultGitCommitMessageProfileId, gitCommitMessageProfiles, setGitCommitMessageProfiles, t],
  );

  const handleResetBuiltInProfiles = useCallback(() => {
    const nextProfiles = resetBuiltInGitCommitMessageProfiles(gitCommitMessageProfiles);
    setGitCommitMessageProfiles(nextProfiles, defaultGitCommitMessageProfileId);
    setEditingId(null);
    message.success(t("settings.agents.gitProfiles.resetSuccess"));
  }, [defaultGitCommitMessageProfileId, gitCommitMessageProfiles, setGitCommitMessageProfiles, t]);

  const handleResetSingleBuiltIn = useCallback(
    (profileId: string) => {
      const nextProfiles = resetSingleBuiltInGitCommitMessageProfile(
        gitCommitMessageProfiles,
        profileId,
      );
      setGitCommitMessageProfiles(nextProfiles, defaultGitCommitMessageProfileId);
      setEditingId(null);
      message.success(t("settings.agents.gitProfiles.resetSuccess"));
    },
    [defaultGitCommitMessageProfileId, gitCommitMessageProfiles, setGitCommitMessageProfiles, t],
  );

  const confirmDeleteProfile = useCallback(() => {
    if (!deleteProfileId || gitCommitMessageProfiles.length <= 1) return;
    const nextProfiles = gitCommitMessageProfiles.filter(
      (profile) => profile.id !== deleteProfileId,
    );
    setGitCommitMessageProfiles(
      nextProfiles,
      deleteProfileId === defaultGitCommitMessageProfileId
        ? nextProfiles[0].id
        : defaultGitCommitMessageProfileId,
    );
    if (editingId === deleteProfileId) {
      setEditingId(null);
    }
    setDeleteProfileId(null);
    message.success(t("settings.agents.gitProfiles.deleted"));
  }, [
    defaultGitCommitMessageProfileId,
    deleteProfileId,
    editingId,
    gitCommitMessageProfiles,
    setGitCommitMessageProfiles,
    t,
  ]);

  return (
    <div className="app-settings-page app-git-page">
      <SettingsPageHeader
        title={t("settings.menu.git")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {hasBuiltInChanges && (
              <Button
                size="small"
                icon={<ReloadOutlined aria-hidden="true" />}
                onClick={handleResetBuiltInProfiles}
              >
                {t("settings.agents.gitProfiles.resetBuiltIn")}
              </Button>
            )}
            <Button
              type="primary"
              icon={<PlusOutlined aria-hidden="true" />}
              onClick={openCreateModal}
            >
              {t("settings.agents.gitProfiles.add")}
            </Button>
          </div>
        }
      />

      <section className="app-ledger-prefs app-git-prefs" aria-label={t("sidebar.gitRefreshSettings")}>
        <div className="app-ledger-pref-item">
          <span className="app-ledger-pref-label">{t("sidebar.gitAutoFetch")}</span>
          <Switch
            size="small"
            checked={autoFetch}
            aria-label={t("sidebar.gitAutoFetch")}
            onChange={(enabled) => setAutoFetch(enabled)}
          />
        </div>

        <span className="app-ledger-pref-sep" aria-hidden="true" />

        <div className="app-ledger-pref-item">
          <span className="app-ledger-pref-label">{t("sidebar.gitAutoFetchInterval")}</span>
          <Select
            size="small"
            className="app-git-interval-select"
            value={interval}
            disabled={!autoFetch}
            aria-label={t("sidebar.gitAutoFetchInterval")}
            options={FETCH_INTERVAL_MINUTES.map((value) => ({
              value,
              label: t("sidebar.gitFetchMinutes", { count: value }),
            }))}
            onChange={(value) => setAutoFetch(autoFetch, value)}
          />
        </div>

        <span className="app-ledger-pref-sep" aria-hidden="true" />

        <div className="app-ledger-pref-item">
          <span className="app-ledger-pref-label">
            {t("settings.agents.gitProfiles.defaultSelectLabel")}
          </span>
          <Select
            size="small"
            className="app-git-default-select"
            popupMatchSelectWidth={false}
            value={defaultGitCommitMessageProfileId}
            aria-label={t("settings.agents.gitProfiles.defaultSelectLabel")}
            options={gitCommitMessageProfiles.map((profile) => ({
              value: profile.id,
              label: profile.name,
            }))}
            onChange={setDefaultProfile}
          />
        </div>
      </section>

      <div
        className="app-git-ledger"
        role="region"
        aria-label={t("settings.agents.gitProfiles.layout.title")}
      >
        <div className="app-git-ledger-head" aria-hidden="true">
          <span>{t("settings.agents.gitProfiles.layout.title")}</span>
          <span>{t("settings.agents.gitProfiles.columns.source")}</span>
          <span>{t("settings.agents.gitProfiles.columns.actions")}</span>
        </div>

        <div>
          {gitCommitMessageProfiles.map((profile) => {
            const isDefault = profile.id === defaultGitCommitMessageProfileId;
            const builtIn = isBuiltInGitCommitMessageProfile(profile.id);
            const modified = builtIn && isBuiltInGitCommitMessageProfileModified(profile);
            const isOpen = editingId === profile.id;
            const popoverId = `app-git-popover-${profile.id}`;
            const summary =
              builtIn && !modified
                ? t(`settings.agents.gitProfiles.layout.summaries.${profile.id}`)
                : profile.instructions;

            return (
              <div
                key={profile.id}
                ref={(node) => {
                  if (node) rowRefs.current.set(profile.id, node);
                  else rowRefs.current.delete(profile.id);
                }}
                className={`app-git-row ${isOpen ? "is-active" : ""}`}
              >
                <div className="app-git-cell-name">
                  <div className="app-git-name-line">
                    <button
                      type="button"
                      data-git-trigger="true"
                      className="app-git-name-btn"
                      title={profile.name}
                      aria-expanded={isOpen}
                      aria-controls={popoverId}
                      onClick={(event) => openPopover(profile, event.currentTarget)}
                    >
                      {profile.name}
                    </button>
                    {isDefault && (
                      <span className="app-ledger-default-pill">
                        <CheckOutlined aria-hidden="true" />
                        {t("settings.agents.gitProfiles.default")}
                      </span>
                    )}
                    {modified && (
                      <span className="app-git-modified-badge">
                        {t("settings.agents.gitProfiles.modified")}
                      </span>
                    )}
                  </div>
                  <div className="app-git-summary" title={summary}>
                    {summary}
                  </div>
                </div>

                <div className="app-git-cell-source">
                  <span className="app-git-source-pill">
                    {t(builtIn ? "settings.agents.gitProfiles.builtIn" : "settings.agents.gitProfiles.custom")}
                  </span>
                </div>

                <div className="app-git-cell-actions">
                  <button
                    ref={(node) => {
                      if (node) editButtonRefs.current.set(profile.id, node);
                      else editButtonRefs.current.delete(profile.id);
                    }}
                    type="button"
                    data-git-trigger="true"
                    className={`app-git-action-edit ${isOpen ? "is-open" : ""}`}
                    aria-label={`${t("common.edit")} ${profile.name}`}
                    aria-expanded={isOpen}
                    aria-controls={popoverId}
                    onClick={(event) => openPopover(profile, event.currentTarget)}
                  >
                    <EditOutlined aria-hidden="true" />
                    <span>{t("common.edit")}</span>
                  </button>
                  <Tooltip
                    title={
                      gitCommitMessageProfiles.length <= 1
                        ? t("settings.agents.gitProfiles.keepOne")
                        : t("common.delete")
                    }
                  >
                    <button
                      type="button"
                      className="app-git-action-delete"
                      aria-label={`${t("common.delete")} ${profile.name}`}
                      disabled={gitCommitMessageProfiles.length <= 1}
                      onClick={() => setDeleteProfileId(profile.id)}
                    >
                      <DeleteOutlined aria-hidden="true" />
                    </button>
                  </Tooltip>
                </div>

                <LedgerRowPopover
                  open={isOpen}
                  id={popoverId}
                  ariaLabel={profile.name}
                  className="app-ledger-popover app-git-popover"
                  popoverSelector=".app-git-popover"
                  triggerSelector="[data-git-trigger]"
                  getAnchorEl={() => rowRefs.current.get(profile.id) ?? null}
                  getRestoreFocusEl={() => triggerElRef.current ?? editButtonRefs.current.get(profile.id) ?? null}
                  maxWidth={500}
                  rightInset={16}
                  offset={-4}
                  blocked={createOpen || deleteProfileId !== null}
                  scrollKey={scrollToProfileId === profile.id ? profile.id : null}
                  onClose={() => setEditingId(null)}
                >
                    <header className="app-git-popover-head">
                      <strong title={profile.name}>{profile.name}</strong>
                      <div className="app-git-popover-head-actions">
                        {!isDefault && (
                          <button
                            type="button"
                            className="app-ledger-default-toggle"
                            onClick={() => setDefaultProfile(profile.id)}
                          >
                            {t("settings.agents.gitProfiles.setDefaultShort")}
                          </button>
                        )}
                        <button
                          type="button"
                          className="app-ledger-close-btn"
                          aria-label={t("common.close")}
                          onClick={() => setEditingId(null)}
                        >
                          <CloseOutlined />
                        </button>
                      </div>
                    </header>

                    <label className="app-git-popover-field">
                      <span className="app-git-popover-label">
                        {t("settings.agents.gitProfiles.name")}
                      </span>
                      <Input
                        value={popoverName}
                        maxLength={80}
                        placeholder={t("settings.agents.gitProfiles.namePlaceholder")}
                        onChange={(event) => setPopoverName(event.target.value)}
                      />
                    </label>

                    <label className="app-git-popover-field">
                      <span className="app-git-popover-label">
                        {t("settings.agents.gitProfiles.instructions")}
                      </span>
                      <Input.TextArea
                        value={popoverInstructions}
                        maxLength={6000}
                        autoSize={{ minRows: 4, maxRows: 8 }}
                        showCount
                        placeholder={t("settings.agents.gitProfiles.instructionsPlaceholder")}
                        onChange={(event) => setPopoverInstructions(event.target.value)}
                      />
                      <span className="app-git-popover-hint">
                        {t("settings.agents.gitProfiles.instructionsHint")}
                      </span>
                    </label>

                    <footer className="app-git-popover-foot">
                      <div className="app-git-popover-foot-left">
                        <Button
                          size="small"
                          icon={<CopyOutlined aria-hidden="true" />}
                          onClick={() => handleDuplicateProfile(profile)}
                        >
                          {t("settings.agents.gitProfiles.cloneShort")}
                        </Button>
                        {modified && (
                          <Button
                            size="small"
                            icon={<UndoOutlined aria-hidden="true" />}
                            onClick={() => handleResetSingleBuiltIn(profile.id)}
                          >
                            {t("settings.agents.gitProfiles.resetSingleShort")}
                          </Button>
                        )}
                      </div>
                      <Button type="primary" size="small" onClick={handleSavePopover}>
                        {t("settings.agents.gitProfiles.save")}
                      </Button>
                    </footer>
                </LedgerRowPopover>
              </div>
            );
          })}
        </div>
      </div>

      <p className="app-ledger-footnote">
        {t("settings.agents.gitProfiles.footnote", {
          count: gitCommitMessageProfiles.length,
          hint: t("sidebar.gitRefreshSettingsHint"),
        })}
      </p>

      <Modal
        open={createOpen}
        title={t("settings.agents.gitProfiles.createTitle")}
        okText={t("settings.agents.gitProfiles.save")}
        cancelText={t("common.cancel")}
        onOk={handleSaveCreate}
        onCancel={() => setCreateOpen(false)}
        destroyOnHidden
        width={560}
      >
        <div className="space-y-4 pt-2">
          <div>
            <div className="app-git-settings-text-secondary mb-1.5 text-xs font-medium">
              {t("settings.agents.gitProfiles.presetLabel")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {GIT_COMMIT_MESSAGE_PRESET_TEMPLATES.map((preset) => {
                const isActive = createInstructions.trim() === preset.instructions.trim();
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPresetTemplate(preset)}
                    aria-pressed={isActive}
                    className={`app-git-profile-preset-chip rounded-md px-2.5 py-1 text-xs font-medium ${
                      isActive ? "app-git-profile-preset-chip--active" : ""
                    }`}
                  >
                    {t(preset.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label
              htmlFor="git-profile-name"
              className="app-git-settings-text-secondary mb-1 block text-xs font-medium"
            >
              {t("settings.agents.gitProfiles.name")}
            </label>
            <Input
              id="git-profile-name"
              name="git-profile-name"
              autoComplete="off"
              value={createName}
              maxLength={80}
              placeholder={t("settings.agents.gitProfiles.namePlaceholder")}
              onChange={(event) => setCreateName(event.target.value)}
            />
          </div>

          <div>
            <label
              htmlFor="git-profile-instructions"
              className="app-git-settings-text-secondary mb-1 block text-xs font-medium"
            >
              {t("settings.agents.gitProfiles.instructions")}
            </label>
            <Input.TextArea
              id="git-profile-instructions"
              name="git-profile-instructions"
              aria-describedby="git-profile-instructions-hint"
              value={createInstructions}
              maxLength={6000}
              autoSize={{ minRows: 6, maxRows: 12 }}
              showCount
              placeholder={t("settings.agents.gitProfiles.instructionsPlaceholder")}
              onChange={(event) => setCreateInstructions(event.target.value)}
            />
            <div
              id="git-profile-instructions-hint"
              className="app-git-settings-text-secondary mt-6 text-xs"
            >
              {t("settings.agents.gitProfiles.instructionsHint")}
            </div>
          </div>

          <div className="app-git-profile-modal-row flex items-center justify-between gap-3 rounded-lg px-3.5 py-2.5">
            <label
              htmlFor="git-profile-make-default"
              className="app-git-settings-text-secondary text-sm"
            >
              {t("settings.agents.gitProfiles.makeDefault")}
            </label>
            <Switch
              id="git-profile-make-default"
              checked={createAsDefault}
              onChange={setCreateAsDefault}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={deleteProfileId !== null}
        title={t("settings.agents.gitProfiles.deleteTitle")}
        okText={t("common.delete")}
        cancelText={t("common.cancel")}
        okButtonProps={{ danger: true }}
        onOk={confirmDeleteProfile}
        onCancel={() => setDeleteProfileId(null)}
      >
        {t("settings.agents.gitProfiles.deleteDescription")}
      </Modal>
    </div>
  );
}
