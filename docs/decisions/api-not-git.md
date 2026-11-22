---
type: Decision Record
title: GitHub's API instead of the git command
description: Git Sync 0.3.0 talks to GitHub's REST API and reads the folder with scripts Super Productivity runs in its own process, because the Flathub build cannot start a Node process and has no git; the folder is compared with the repository by blob ids instead of being a checkout.
tags: [decision, github, flatpak, git]
generated: { by: claude-code/2.1.330, at: 2026-11-22 }
---

# Status

Accepted on 2026-11-22, after the owner's first try of 0.2.0 in Super
Productivity from Flathub failed at the setup's first step ("spawn
/app/superproductivity/superproductivity-bin ENOENT").

# Context

- Super Productivity runs a plugin's Node script either inside its own
  process (`vm`, only `fs`/`path`/`os`) or as a new process; only the
  new process could run `git`, and the Flathub build cannot start it
  ([facts](../super-productivity-facts.md)). Its sandbox has no `git`
  either.
- `PluginAPI.request` reaches allowed hosts from the app window.
- Day Planner already talks to the same repository through the same
  API (pensum, `pensum/sync/github.py`).

# Decision

- The plugin reads and writes the folder only with scripts that pass
  Super Productivity's check for running inside its own process
  (`src/folder.js`; a test runs them through the same check).
- Commits, branch moves and downloads go through GitHub's REST API
  (`src/github.js`); the first commit of an empty repository through the
  Contents API, as the git data API needs one to build on.
- The folder is not a Git checkout: the plugin keeps per device which
  commit it matched last and the files' blob ids, and compares the
  folder's hashes with them.
- The protocol (only the plugin moves `main`, Day Planner hands over on
  `day-planner`) stays as it was.

# Consequences

- Works in every Super Productivity desktop build, without `git`, SSH
  keys or credential helpers; setup needs only a token and a folder.
- Only GitHub (api.github.com); another Git host would need its own API
  client.
- Each changed file is uploaded whole per commit, as before; GitHub's
  API rate limit (5,000 requests per hour per token) is far above a
  cycle every few minutes.
