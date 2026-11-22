---
type: Reference
title: Super Productivity facts for Git Sync
description: What the plugin relies on in Super Productivity 20.0.0 - no sync provider plugins, node execution in a separate process with an empty environment, triggerSync awaits the sync, manual-only sync and the syncs it still does, the local file provider, the iframe message bridge and per-device secrets.
tags: [super-productivity, plugin-api, sync, facts]
sources:
  - id: sp20
    title: Super Productivity 20.0.0, commit 4db0e112 (2026-11-06)
    url: https://github.com/johannesjo/super-productivity/tree/4db0e11236bc784d3184a9e252930b4bd53df823
generated: { by: claude-code/2.1.330, at: 2026-11-22 }
---

All facts from Super Productivity 20.0.0[^sp20]; paths relative to its
repository.

# Plugins

- Plugin types are only `standard` and `issueProvider`; a plugin cannot
  register a sync provider (`packages/plugin-api/src/types.ts`).
- No hook before or after a sync. `dataChanged` fires for changes from
  any source, remote sync included, coalesced, without payload
  (`PluginHooks.DATA_CHANGED`).
- `plugin.js` runs in the app window through `new Function('plugin',
  'PluginAPI', code)` (`src/app/plugins/plugin-runner.ts`); timers work.
  Start-up code belongs in `PluginAPI.onReady`, after which declared
  APIs such as node execution are available.
- `triggerSync()` awaits `SyncWrapperService.sync()`
  (`src/app/plugins/plugin-bridge.service.ts`, `_triggerSync`); it also
  resolves when the sync is skipped or ends in a handled error.
- `executeNodeScript({script, args, timeout})`: Electron only, needs the
  `nodeExecution` permission and the user's consent, stored per plugin
  (`electron/plugin-node-consent-store.ts`). A script that passes
  `canExecuteDirectly` (no `child_process`, `exec`, `spawn`, `eval`,
  `Function`, `process.exit`, and `require` only of `fs`, `path`, `os`)
  runs in Super Productivity's main process in a `vm` context with only
  those three modules, `console`, `JSON` and `args`, wrapped as an async
  function, limited to 5 s; the script at most 100 KB
  (`executeDirectly`, `validateScriptRequest`). Any other script runs in
  a new process, `process.execPath -e` (`executeViaSpawn`).
- **In the Flathub build that new process cannot start**: the owner got
  "Failed to execute script: spawn
  /app/superproductivity/superproductivity-bin ENOENT" (2026-11-22), and
  the sandbox has no `git` anyway. So Git Sync uses only scripts that run
  directly ([decision](decisions/api-not-git.md)).
- `request(url, {method, body, headers, timeout})`: needs the `http`
  permission and the host in `allowedHosts`; `fetch` without following
  redirects, an object body sent as JSON, the answer parsed as JSON; a
  non-2xx answer rejects with an error carrying `.status`; no response
  headers (`src/app/plugins/plugin-bridge.service.ts`, `request`;
  `src/app/plugins/issue-provider/plugin-http.service.ts`). `PATCH` and
  `PUT` are allowed methods.
- Per-device storage: `setSecret`/`getSecret` (not synced, not in
  backups); not available inside the iframe
  (`src/app/plugins/util/plugin-iframe.util.ts`,
  `ALLOWED_IFRAME_API_METHODS`).
- The iframe talks to `plugin.js` by posting `{type: 'PLUGIN_MESSAGE',
  messageId, message}` to its parent; the answer comes back as
  `PLUGIN_MESSAGE_RESPONSE` (or `PLUGIN_MESSAGE_ERROR`) with the same
  `messageId`; `plugin.js` answers through `PluginAPI.onMessage`.
- The manifest's `dataSharing` lists where user data goes; `userServer`
  marks a server the user chooses (`validate-manifest.util.ts`).

# Sync

- **Manual sync only** (`isManualSyncOnly`) sets the sync interval to 0
  (`src/app/imex/sync/sync-wrapper.service.ts`, `syncInterval$`), which
  turns off all background triggers: timer, focus, idle, resume
  (`src/app/imex/sync/sync.effects.ts`, `scheduleBackgroundSync$`).
- It does not turn off the initial sync at start
  (`SYNC_INITIAL_SYNC_TRIGGER`) or, on Electron, the sync before quit
  (`syncBeforeQuit$`); the plugin commits those writes at its next
  `prepare`.
- **Local file** on Electron writes the files directly into the chosen
  folder (`local-file-sync-electron.ts`, `getFilePath`); a file's
  revision is a hash of its content and uploads check it
  (`local-file-sync-base.ts`), so files replaced by Git are seen as
  changed by another client.

[^sp20]: https://github.com/johannesjo/super-productivity/tree/4db0e11236bc784d3184a9e252930b4bd53df823
