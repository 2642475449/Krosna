---
version: 1
slug: "src-components-layout-sidebar-sidebargitpanel-tsx"
primary_target: "src/components/layout/sidebar/SidebarGitPanel.tsx"
related_targets: ["src/components/layout/sidebar/GitBranchPanel.tsx","src/components/layout/sidebar/GitCommitComposer.tsx","src/components/layout/sidebar/GitFileList.tsx","src/components/layout/sidebar/GitGraphSection.tsx"]
---

# Surface Brief: Sidebar Git Panel (`SidebarGitPanel`)

- **Scope:** Local Git sidebar workbench (`SidebarGitPanel`, `GitBranchPanel`, `GitCommitComposer`, `GitFileList`, `GitGraphSection` integration, and worktree occupancy metadata in `git_list_branches`).
- **Visitor Mode:** Operate
- **Audience & Job:** Heavy CLI-agent developers on Windows desktop managing branches, staging/committing changes, syncing remotes, and inspecting commit history alongside embedded terminals.
- **Constraints:** Preserve Krosna's established visual world (`DESIGN.md`: "The Quiet Workbench", 4 solid themes via `--cs-*` tokens, zero hardcoded hex colors, zero PTY reflow, flat workbench + shadowed floating overlays, 3 languages `zh-CN` / `en-US` / `ja-JP`). Keep `GitRemoteToolbar` overflow contract and existing tests passing.

## Direction contract

- **THESIS:** Replace the cramped inline-stacked Git sidebar (where an inline branch drawer crushes the commit box and a 22px Graph bar fights for space) with a focused two-mode workbench: a Popover Branch Switcher with live filtering and worktree awareness, paired with full-height segmented Changes and Graph views.
- **OWN-WORLD:** Inherit Krosna's "The Quiet Workbench" (`DESIGN.md`): flat `--cs-bg-sidebar` canvas, `--cs-border-sidebar` hairlines, `--cs-radius-control` (6px) interactive rows and buttons, `--font-mono` telemetry for branch names, diff stats, and counts, and `.app-overlay-surface` floating popover for branch selection.
- **STORY:** Developers glance at the 36px header to read branch and sync telemetry, open the floating branch popover to filter, create, switch, or inspect worktree-occupied branches without losing working-tree context, commit from a pinned compact composer that states exact commit scope, and switch cleanly between Changes and Graph at full sidebar height.
- **FIRST VIEWPORT:** Top 36px header (branch pill with sync counts on left; refresh and remote overflow on right); 32px segmented tabs (`Changes [N]` | `Graph`) with 2px `--cs-primary` active bar; pinned Commit Composer with inline scope footer and 32px split primary CTA; full-height scrollable Staged/Changes lists with 28px rows.
- **FORM:** Code-led Operate surface refactor inside established Krosna world; seed: none (pinned) "沿用 Krosna 现有设计系统（四套主题与 --cs-* 变量），直接重构该区域布局与交互".
- **FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
