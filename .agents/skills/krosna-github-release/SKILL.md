---
name: krosna-github-release
description: Prepare, publish, and verify Krosna releases and signed Tauri updates on GitHub Releases and the China mirror. Use when changing a release version, creating or repairing a Krosna GitHub Release, updating the updater manifest, investigating an update check, or modifying the release workflow.
---

# Krosna GitHub Release

Build and sign each release once. Publish the original installer, signature and manifest in GitHub Releases. The `legacy-update-bridge` job serves the same signed bytes independently from the China mirror for Krosna and older Termflow clients. Preserve the deployed script, staging path and versioned installer alias.

## Release contract

- Keep `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` on the identical SemVer version.
- Publish the signed Windows NSIS installer and its `.sig` file as assets of the matching `v<version>` GitHub Release.
- Generate and upload `latest.json` to that same release.
- Publish substantive, user-facing Release notes that explain what was added or upgraded and what was fixed. The automatically generated `Full Changelog` link alone is not an acceptable release description.
- Keep both updater endpoints in `src-tauri/tauri.conf.json` (`https://github.com/2642475449/Krosna/releases/latest/download/latest.json` and `https://termflow.jianglan.online/latest.json`).
- Each manifest must name its own host's immutable artifact. GitHub serves `/2642475449/Krosna/releases/download/v<version>/Krosna_<version>_x64-setup.exe` and the China mirror serves `/releases/Termflow_<version>_x64-setup.exe`. Both manifests carry the same signature, version and notes.

## Prepare a release

1. Inspect the working tree and preserve unrelated changes.
2. Choose the next SemVer version; never reuse or mutate an already published version.
3. Update all three version files and confirm they match the planned `v<version>` tag.
4. Run the relevant build and test checks, including the Windows packaging preflight below. A release build must have `TAURI_SIGNING_PRIVATE_KEY` configured so its installer has a fresh matching `.sig` file.
5. Draft the Release notes from the complete diff and commit range between the previous published release tag and the planned tag. Verify important claims against the implementation; do not infer features from commit subjects alone.
6. Run `pnpm update:manifest --notes "<concise user-facing summary>"`. Do not leave the updater notes as only `Krosna v<version>`. Confirm the generated `latest.json` has the intended version, a non-empty signature, the GitHub Release installer URL, and useful notes.

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
4. Check both public manifests and their actual downloads. Confirm the expected version, signature and release notes match, each installer downloads from its own source, and both files have the same SHA-256 and pass updater signature verification. To retry a mirror deployment, dispatch the workflow for the current latest release tag.
5. Exercise a packaged Windows updater with the previous version. Test the China path with GitHub unavailable and the GitHub path with the China mirror unavailable. Check update detection and the download through signature verification. An active user's session can be preserved by running the test in a separate profile.

## Diagnose update checks

- A green “already up to date” message means Tauri `check()` found no version greater than the app's embedded version; it is not proof that the repository's newest tag was consulted.
- Inspect the exact installed build's endpoints, its proxy mode and the public manifests. A shell process and the installed desktop process can inherit different environment proxies.
- Krosna 1.8.36 and 1.8.37 embed only the GitHub endpoint. When GitHub cannot be reached, those versions can bootstrap by manually installing the new signed package from the China mirror. Older Termflow clients can still read their original mirror manifest.
- Treat an updater error separately from “already up to date”; report the actual failure rather than converting it into a success message.

## Safety

Do not create tags, publish releases, upload assets, alter release assets, or overwrite `latest.json` without explicit user authorization. Validate locally and report the proposed release state first when publication was not requested.
