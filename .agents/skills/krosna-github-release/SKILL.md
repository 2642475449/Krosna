---
name: krosna-github-release
description: Prepare, publish, and verify Krosna releases and signed Tauri updates on GitHub Releases and the China mirror. Use when changing a release version, creating or repairing a Krosna GitHub Release, updating the updater manifest, investigating an update check, or modifying the release workflow.
---

# Krosna GitHub Release

Build and sign each release once. Publish the original installer, signature and manifest in GitHub Releases. The `legacy-update-bridge` job serves the same signed bytes independently from the China mirror for Krosna and older Termflow clients. Preserve the deployed script, staging path and versioned installer alias.

## Release contract

- Keep `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` on the identical SemVer version. Keep the Krosna package entry in `src-tauri/Cargo.lock` in sync.
- Publish the signed Windows NSIS installer and its `.sig` file as assets of the matching `v<version>` GitHub Release.
- Generate and upload `latest.json` to that same release.
- Publish substantive, user-facing Release notes that explain what was added or upgraded and what was fixed. The automatically generated `Full Changelog` link alone is not an acceptable release description.
- Keep both updater endpoints in `src-tauri/tauri.conf.json` (`https://github.com/2642475449/Krosna/releases/latest/download/latest.json` and `https://termflow.jianglan.online/latest.json`).
- Each manifest must name its own host's immutable artifact. GitHub serves `/2642475449/Krosna/releases/download/v<version>/Krosna_<version>_x64-setup.exe` and the China mirror serves `/releases/Termflow_<version>_x64-setup.exe`. Both manifests carry the same signature, version and notes.

## Prepare a release

1. Inspect the working tree, target commit, and latest published tag. Review the commits and diff between that tag and the target. The new tag publishes the target's committed history, including local commits ahead of the remote. Surface any unexpected committed scope before pushing. Keep unrelated working-tree edits out of the release commit and use an isolated checkout for the preflight if those edits would affect the build.
2. Choose the next SemVer version; never reuse or mutate an already published version.
3. Update the version files and lockfile entry, then confirm they match the planned `v<version>` tag. Keep the release preparation commit scoped to those files and the release notes unless the task requires a separate fix.
4. Draft `release-notes/v<version>.md` from the complete diff and commit range between the previous published release tag and the planned tag. Verify important claims against the implementation.
5. Run the relevant tests and the Windows packaging preflight below on the intended release contents. Inspect the staged diff before committing and confirm that the tag points to the tested source.
6. In the standard tag-triggered workflow, GitHub Actions supplies `TAURI_SIGNING_PRIVATE_KEY`, signs the installer, and runs `pnpm update:manifest --notes-file release-notes/v<version>.md` using the resulting signature. For an authorized manual publication, run the same manifest command after the signed build. Verify the version, signature, GitHub installer URL, and curated notes in the resulting `latest.json`.

## Release notes

- Write for users rather than as a raw commit log. Describe observable behavior and impact; omit internal refactors unless they affect compatibility, reliability, security, packaging, or maintenance.
- Use `## 新增与升级` for new capabilities, meaningful improvements, dependency/runtime upgrades, and changed behavior.
- Use `## 问题修复` for corrected bugs, regressions, crashes, security issues, and release/build fixes.
- Add `## 升级说明` only when users must take action, such as a one-time manual update, configuration migration, known limitation, or installer-size change. State the required action explicitly.
- If a required section has no entries, say `无` rather than inventing content. Keep entries concrete and deduplicate multiple commits that implement the same user-facing change.
- Include the GitHub compare/Full Changelog link after the curated notes as supporting detail, not as a replacement for them.
- Prepare the notes before creating the tag. During an authorized publication, pass them to the release workflow or update the draft release body before making it public.

## Windows packaging preflight

- Do not treat `pnpm build`, TypeScript checks, or unit tests as proof that a Tauri release can be packaged. Before creating the release tag, complete a local Windows `pnpm tauri build` (a no-sign local preflight is acceptable); require it to produce the NSIS installer successfully.
- Re-run this full preflight whenever frontend dependencies that ship assets are added or upgraded, especially document, PDF, Office, font, WASM, or worker packages.
- Preserve the Vite/Rollup asset naming invariant in `vite.config.ts`: use `assets/[name]-[hash][extname]`. Do not replace `[extname]` with `.[ext]` or another pattern that always inserts a dot.
- Some third-party packages ship extensionless files such as `LICENSE` and `NOTICE`. With a `.[ext]` suffix, Rollup can reference them as `LICENSE-<hash>.` or `NOTICE-<hash>.`. Windows cannot reliably address paths ending in a dot, so `tauri::generate_context!` then fails while embedding `dist`, even though the ordinary Vite build succeeded.
- If the build reports `failed to read asset ... because file not found`, inspect the complete path first. A basename ending in `.` is this asset-naming failure; correct the Rollup naming rule, rebuild `dist`, and repeat the full Tauri packaging preflight before tagging. Do not work around it by deleting the dependency license asset.

## Publish and verify

1. Push the matching `v<version>` tag only when the user has explicitly authorized publication.
2. The `Release Krosna` workflow must publish the installer, signature, generated `latest.json`, and curated Release notes, then mark the release as latest.
3. After the workflow finishes, inspect the public Release page and confirm both `新增与升级` and `问题修复` are present with the intended content; reject a body containing only GitHub's generated changelog.
4. Check both public manifests and download the installers they reference. Confirm the expected version, signature, and release notes match, each URL uses its expected host, and both installers have the same SHA-256 and pass updater signature verification with the application's public key.
5. Verify client behavior using the previous packaged Windows version in an isolated environment. Test update detection and download through signature verification with only the China mirror reachable, then with only GitHub reachable. If an isolated previous client is unavailable, report the client verification as untested and state which artifact checks passed. Keep active user sessions intact.
6. In the release report, identify the tag and release commit, summarize the files changed by the release commit, and link the whole version comparison separately. If there are unrelated working-tree changes, report their status separately. Give GitHub publication, mirror deployment, and client verification their own results.

### Retry a mirror deployment

- Check the mirror job result and the public mirror manifest. When GitHub already has the intended latest release and only the mirror job failed with a transient transport error, rerun that job once if the failed run is available.
- Use `workflow_dispatch` in `.github/workflows/release.yml` with the current latest release tag for a standalone mirror sync. The mirror job downloads the existing signed release in either retry path. Keep the original tag and signed assets.
- Wait for the retry result and verify the public mirror artifacts. If the same failure recurs, diagnose it before retrying again. Report GitHub and mirror status independently while the mirror is pending or failed.

## Diagnose update checks

- A green “already up to date” message means Tauri `check()` found no version greater than the app's embedded version; it is not proof that the repository's newest tag was consulted.
- Inspect the exact installed build's endpoints, its proxy mode and the public manifests. A shell process and the installed desktop process can inherit different environment proxies.
- Krosna 1.8.36 and 1.8.37 embed only the GitHub endpoint. When GitHub cannot be reached, those versions can bootstrap by manually installing the new signed package from the China mirror. Older Termflow clients can still read their original mirror manifest.
- Treat an updater error separately from “already up to date”; report the actual failure rather than converting it into a success message.

## Safety

Do not create tags, publish releases, upload assets, alter release assets, or overwrite `latest.json` without explicit user authorization. Validate locally and report the proposed release state first when publication was not requested.
