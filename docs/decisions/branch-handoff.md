---
type: Decision Record
title: One writer of main, a hand-over branch for Day Planner
description: Why Git Sync drives Super Productivity's own local-file sync instead of syncing itself, why only the plugin writes main and Day Planner hands over on day-planner, and why stale hand-overs are sent again by Day Planner instead of merged.
tags: [decision, git, sync, protocol]
generated: { by: claude-code/2.1.330, at: 2026-11-22 }
---

# Status

Accepted on 2026-11-22. The owner asked for Git as the way between
Super Productivity on the desktop and Day Planner on the phone, as a
Super Productivity plugin in this repository ("setze um").

# Context

- A plugin cannot add a sync provider to Super Productivity, and has no
  hook around a sync ([facts](../super-productivity-facts.md)).
- Super Productivity's sync files are rewritten whole on each upload
  (v2 `state`, the ops list); Git cannot merge two versions of them.
- Super Productivity counts an upload as done once the file is written;
  if Git later replaced that file, its ops would be lost for the phone.
- With "manual sync only" Super Productivity still syncs at start and
  before it quits, outside any plugin.
- Day Planner already writes sync files the way Super Productivity does,
  on the condition that the file is still the version it read (#30 in
  pensum).

# Decision

1. **Drive Super Productivity's own sync.** It syncs into a local folder
   with its own conflict rules; the plugin only runs Git around it
   (prepare → `triggerSync()` → finish).
2. **Only the plugin writes `main`**, never with force; what Super
   Productivity wrote is always committed and kept.
3. **Day Planner hands over on `day-planner`**: one commit per send on
   top of what it read. The plugin fast-forwards `main` to it before
   Super Productivity syncs, so Super Productivity sees Day Planner's
   ops like another client's.
4. **Stale hand-overs are sent again, not merged**: when `main` moved
   on first, Day Planner sees the branches diverged and sends the
   undelivered edits again on top of `main`.

# Alternatives

- **A lock file in the repository** so that only one side writes at a
  time: two commits per sync, stale locks after a crash, and it does not
  cover Super Productivity's syncs at start and quit.
- **Merging or rebasing the sync files in the plugin**: needs Super
  Productivity's decryption, op format and reducers in the plugin, a
  second copy of what Day Planner already has.
- **Resetting the folder to the remote on conflict**: loses Super
  Productivity's upload for the phone (it counts it as done).
- **The plugin syncing by itself through the plugin API**: no access to
  the archive and no way to write Super Productivity's ops; a second,
  weaker sync next to the real one.

# Consequences

- One desktop and one Day Planner per repository; more are detected and
  reported, never overwritten.
- Changes from the phone reach Super Productivity only while it runs on
  the desktop; until then Day Planner keeps building on its own branch.
- The repository grows with every sync (whole files per commit); fine
  for a personal dataset, to be watched.
