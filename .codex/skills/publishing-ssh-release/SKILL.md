---
name: publishing-ssh-release
description: Use when working inside this ssh-release repository to prepare, verify, publish, or post-check a project release, including npm Trusted Publishing, v* tags, GitHub Releases, release scripts, and release-readiness answers.
---

# Publishing ssh-release

## Overview

Use this project-local skill to close an `ssh-release` release without relying on memory. Treat npm publication as complete only after local gates, tag workflow, npm registry, GitHub Release, and installed-package smoke tests agree.

## Start From Facts

Work in this repository root. Before recommending or executing a release, read the current facts:

```bash
git status --short --branch
git log --oneline --decorate -5
node -p "require('./package.json').version"
sed -n '1,80p' CHANGELOG.md
sed -n '1,180p' docs/release-checklist.md
```

Also inspect `AGENTS.md` when the task involves edits or commits.

## Release Readiness

Use the repo script as the standard gate:

```bash
npm run release:preflight
```

This script checks a clean `main`, matching package and lockfile versions, no existing local or remote tag, `prepublishOnly`, `npm publish --dry-run`, and local tarball smoke.

If the script is unavailable or must be debugged, follow `docs/release-checklist.md` and keep the same checks. Use `--cache /private/tmp/ssh-release-npm-cache` for npm dry-runs or installs when the default npm cache has permission noise.

Run real-server dogfood only when release risk justifies it or the change affects SSH/SCP, locks, deploy, rollback, packaging, cleanup, or verification:

```bash
scripts/dogfood-real.sh
```

Only use one-time `/tmp/ssh-release-dogfood-*` remote targets, and never include real host, password, private key, or production path in repo files, logs, release notes, or final answers.

## Human Release Switch

Do not create tags, push tags, publish npm, or create GitHub Releases unless the user explicitly approves the release. If approval is missing, ask one question:

`是否现在发布 v<version>？我的推荐答案：是，前提是 preflight 已通过。`

After approval, execute:

```bash
git push origin main
VERSION=$(node -p "require('./package.json').version")
git tag -a "v$VERSION" -m "v$VERSION"
git push origin "v$VERSION"
```

Pushing the `v*` tag triggers `.github/workflows/publish.yml`, which publishes through npm Trusted Publishing. Do not run local `npm publish` for the official release.

## Post-Release Closure

Wait for the Publish workflow, then run:

```bash
npm run release:postcheck -- <version>
```

This must confirm:

- Publish workflow completed successfully.
- `npm view ssh-release version dist-tags.latest --json` reports the released version as both current version and `latest`.
- A fresh global install of `ssh-release@<version>` runs `--version`, `--help`, and `init --template static-site`.
- GitHub Release `v<version>` exists and is not draft or prerelease.

If the GitHub Release is missing after npm succeeds, create it from the existing tag:

```bash
VERSION=$(node -p "require('./package.json').version")
gh release create "v$VERSION" --verify-tag --title "v$VERSION" --notes-file /path/to/release-notes.md
```

Use the matching `CHANGELOG.md` section as release notes.

## Common Mistakes

| Mistake | Correction |
|---|---|
| Calling local tests enough | A release is not closed until npm latest, workflow, GitHub Release, and installed smoke all pass. |
| Publishing from memory | Re-read package, changelog, workflow, release checklist, and git state. |
| Hiding irreversible actions in a script | Keep tag creation, tag push, and release creation visible and user-approved. |
| Passing a short SHA to `gh release create` | Use the already-pushed tag with `--verify-tag`. |
| Printing secrets while debugging dogfood | Redact credentials and keep dogfood on `/tmp/ssh-release-dogfood-*`. |
