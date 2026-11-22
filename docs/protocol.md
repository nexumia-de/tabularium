---
type: Reference
title: Git Sync protocol
description: How Super Productivity's local sync folder travels through a GitHub repository - only the plugin writes main, Day Planner hands its changes over on day-planner, the cycle prepare / Super Productivity sync / finish through GitHub's API, stale hand-overs, and what each side checks.
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

- **The sync folder**: a folder on the desktop. Super Productivity's
  "Local file" sync writes its files there (`sync-data.json`, or the
  split v3 files, optionally compressed and encrypted)[^sp20]. It is not
  a Git checkout: the plugin compares its files with the repository by
  their blob ids.
- **The plugin**: the only writer of `main`, through GitHub's REST API
  (`src/github.js`) with a fine-grained token kept per device; the
  folder is read and written by small scripts that Super Productivity
  runs in its own process (`src/folder.js`, [facts](super-productivity-facts.md)).
- **Day Planner**[^pensum]: reads through the same API and writes only
  the branch `day-planner`, one commit per Send Changes on top of what
  it read.

Why this split: [decision](decisions/branch-handoff.md). Why no `git`
command: [decision](decisions/api-not-git.md).

Set up with the page's guided setup ([setup](setup.md)).

# The cycle (`src/cycle.js`)

The plugin keeps per device which commit the folder matched last and
each file's blob id (`state`).

1. **prepare**:
   - read the folder (top-level files without dotfiles) and hash them;
   - `main` missing (empty repository) → a first commit with the note
     file `.git-sync` through the Contents API;
   - first cycle on this device: the folder empty → take the
     repository's files; the repository without files → keep the folder
     (committed next); both equal → nothing; both different → stop
     (`both-have-data`);
   - `main` moved since the last commit (another computer) and the
     folder unchanged → take its files; folder changed too → stop
     (`diverged`); folder already equal to `main` (a cycle that ended
     before saving) → just note it;
   - files Super Productivity wrote outside a cycle (its sync at start
     and before it quits, a click on its sync button) → one commit on
     top, `main` moved forward (`force: false`);
   - `day-planner` ahead of `main` → its files into the folder, `main`
     moved to it (`took` = commits); behind or equal → delivered; apart →
     `stale`, left alone.
2. **Super Productivity's sync** (`PluginAPI.triggerSync()`, awaited):
   it reads the folder as Day Planner left it, applies Day Planner's ops
   like those of any other client and writes its own.
3. **finish**: what it wrote → one commit on top, `main` moved forward;
   GitHub refusing the move (422, someone moved `main`) is reported
   (`push-rejected`) and the next cycle stops at `diverged`.

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
| Plugin | commit Super Productivity's files, move forward | read |
| Day Planner | read | create, fast-forward; force only after a stale hand-over |

One desktop and one Day Planner per repository; a second desktop is
detected as `diverged` or `push-rejected`, never overwritten.

# Error codes

`not-set-up`, `no-folder`, `token-refused`, `forbidden`, `not-found`,
`unreachable`, `server`, `both-have-data`, `diverged`, `push-rejected`,
`node` (Super Productivity did not run a folder script: no consent, or
not the desktop app), `error`. The plugin shows one snack per new code; the
settings page shows the last result.

[^sp20]: Super Productivity 20.0.0: `packages/sync-providers/src/file-based/local-file/`.
[^pensum]: Day Planner's side: `pensum/sync/github.py` and `pensum/ui/sync_send.py`.
