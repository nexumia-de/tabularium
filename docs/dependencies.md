---
type: Reference
title: Dependencies
description: Git Sync has no packages; it needs Node (from Super Productivity's Electron at run time, Node 22 for tests and the build) and the git command.
tags: [dependencies]
generated: { by: claude-code/2.1.330, at: 2026-11-22 }
---

- **Run time**: Super Productivity's own Electron runs the Git step as
  Node (`ELECTRON_RUN_AS_NODE`); the `git` command of the computer.
- **Tests and build**: Node 22 (`.nvmrc`), its test runner and
  `node:zlib` for the ZIP's CRC-32; no npm packages.
- **CI**: GitHub Actions pinned to commits (`.github/workflows/`),
  updated by Dependabot.
