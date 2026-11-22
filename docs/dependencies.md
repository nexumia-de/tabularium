---
type: Reference
title: Dependencies
description: Git Sync has no packages; it runs on Super Productivity's plugin API and needs Node 22 only for tests and the build.
tags: [dependencies]
generated: { by: claude-code/2.1.330, at: 2026-11-22 }
---

- **Run time**: Super Productivity's plugin API (`request` to
  api.github.com, folder scripts through `executeNodeScript`), WebCrypto
  for the blob ids.
- **Tests and build**: Node 22 (`.nvmrc`), its test runner and
  `node:zlib` for the ZIP's CRC-32; `git` for the GitHub stand-in's bare
  repository; no npm packages.
- **CI**: GitHub Actions pinned to commits (`.github/workflows/`),
  updated by Dependabot.
