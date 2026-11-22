---
type: Reference
title: Git Sync protocol
description: How Super Productivity's local sync folder travels through a Git repository - only the plugin writes main, Day Planner hands its changes over on day-planner, the cycle prepare / Super Productivity sync / finish, stale hand-overs, and what each side checks.
tags: [protocol, git, sync, super-productivity, day-planner]
sources:
  - id: sp20
    title: Super Productivity 20.0.0, commit 4db0e112 (2026-11-06)
    url: https://github.com/johannesjo/super-productivity/tree/4db0e11236bc784d3184a9e252930b4bd53df823
  - id: pensum
    title: Day Planner, pensum/sync/github.py
    url: https://github.com/nexumia-de/pensum/blob/main/pensum/sync/github.py
generated: { by: claude-code/2.1.330, at: 2026-11-22 }
---

# Parts

- **The sync folder**: a clone of a private repository on the desktop,
  on branch `main`. Super Productivity's "Local file" sync writes its
  files there (`sync-data.json`, or the split v3 files, optionally
  compressed and encrypted)[^sp20].
- **The plugin** (`src/plugin.js`, `src/git-cycle.cjs`): the only writer
  of `main`.
- **Day Planner**[^pensum]: reads through GitHub's REST API and writes
  only the branch `day-planner`, one commit per Send Changes on top of
  what it read.

Why this split: [decision](decisions/branch-handoff.md).

Set up with the page's guided setup ([setup](setup.md)) or by hand
(any clone that pushes without asking).

# The cycle

1. **prepare** (Git):
   - check the folder: top level of a repository, on `main`;
   - `git fetch --prune origin`;
   - commit whatever Super Productivity wrote outside the plugin (its
     sync at start and before it quits, a click on its sync button);
   - `main` behind `origin/main` → fast-forward; ahead → fine (pushed in
     finish); apart → stop with `diverged`, nothing is pushed;
   - `origin/day-planner` ahead of `main` → fast-forward `main` to it
     (`took` = number of commits); behind or equal → delivered, nothing
     to do; apart → `stale`, left alone.
2. **Super Productivity's sync** (`PluginAPI.triggerSync()`, awaited):
   it reads the folder as Day Planner left it, applies Day Planner's ops
   like those of any other client and writes its own.
3. **finish** (Git): commit what it wrote, `git push origin HEAD:main`
   without force. A rejected push is reported (`push-rejected`); the
   next cycle fetches and tries again.

Triggers: a timer (5 minutes by default), window focus and 20 s after a
local data change (both at most once a minute), Sync Now, and once 30 s
after start (after Super Productivity's own start-up sync). One cycle
at a time; a request during a cycle runs one more afterwards.

# Stale hand-overs

Day Planner built its commit on a `main` that the desktop has left
before it took the hand-over (Super Productivity synced outside the
plugin in between). Both started from the same file and appended a
syncVersion each, so neither can simply win:

- the plugin keeps Super Productivity's commit (Super Productivity
  counts its upload as done) and leaves `day-planner` alone;
- Day Planner sees `main...day-planner` diverged, reads `main`, tells
  the user, and on the next Send Changes takes the merge base as its
  base again, so the undelivered edits go out once more together with
  the new ones, on a new commit on top of `main` (the branch is moved
  with force, the only forced update in the protocol).

# What each side may do

| | `main` | `day-planner` |
|---|---|---|
| Plugin | commit Super Productivity's files, fast-forward, push | read |
| Day Planner | read | create, fast-forward; force only after a stale hand-over |

One desktop and one Day Planner per repository; a second desktop is
detected as `diverged` or `push-rejected`, never overwritten.

# Error codes

`no-folder`, `no-git`, `not-a-repository`, `not-on-main`,
`fetch-failed`, `diverged`, `push-rejected`, `push-failed`, `git-failed`,
`node` (Super Productivity did not run the step: not the desktop app, or
no consent), `error`. The plugin shows one snack per new code; the
settings page shows the last result.

[^sp20]: Super Productivity 20.0.0: `packages/sync-providers/src/file-based/local-file/`.
[^pensum]: Day Planner's side: `pensum/sync/github.py` and `pensum/ui/sync_send.py`.
