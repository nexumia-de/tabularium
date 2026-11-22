---
type: Reference
title: Guided setup
description: The click-through setup on Git Sync's page - GitHub's new-repository and new-token forms opened filled in by link, the repository picked from the list the token reaches, the folder created and the first cycle run, and what stays manual.
tags: [setup, github, token]
sources:
  - id: newrepo
    title: GitHub Docs, Creating a new repository (URL query parameters)
    url: https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository
  - id: pat
    title: GitHub Changelog 2025-08-26, Template URLs for fine-grained PATs; GitHub Docs, Managing your personal access tokens
    url: https://github.blog/changelog/2025-08-26-template-urls-for-fine-grained-pats-and-updated-permissions-ui/
generated: { by: claude-code/2.1.330, at: 2026-11-22 }
---

Asked for by the owner (2026-11-22), after the setup screen of domus.

# Steps on the page (`src/index.html`)

1. **Create Repository**: `https://github.com/new?name=sp-sync&visibility=private&description=…`;
   GitHub documents `name`, `description` and `visibility` as query
   parameters of that form[^newrepo].
2. **Create Token**: `https://github.com/settings/personal-access-tokens/new?name=Git+Sync+(desktop)&description=…&expires_in=366&contents=write`;
   GitHub documents `name`, `description`, `expires_in` and one
   parameter per permission[^pat]. The repository selection has no
   parameter; the page tells the person to choose "Only select
   repositories" and the new one.
3. **Find Repositories**: `GET https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator&sort=pushed`
   through `PluginAPI.request` (one page: the plugin HTTP layer does not
   show the Link header); the page offers those the token may write to,
   `…/sp-sync` first, and marks a public one.
4. **Set Up** (folder, default `~/sp-sync` from the `home` folder
   script): the folder is created if missing, token, repository and
   folder are kept per device (secret storage; a new repository or
   folder starts a new state) and the first cycle runs: an empty
   repository takes the folder's files, an empty folder takes the
   repository's ([protocol](protocol.md#the-cycle-srccyclejs)).
5. Super Productivity's own sync settings (Local file, the folder,
   manual sync only) stay manual: a plugin cannot read or set them
   ([facts](super-productivity-facts.md)).

Links open in the system browser: the page's iframe may open popups and
Super Productivity's window hands every new window to the browser
(`electron/main-window.ts`, `setWindowOpenHandler`, v20.0.0).

# The token

- One per device: this one for the desktop, another for Day Planner.
  Each can be revoked alone.
- Kept in Super Productivity's secret storage for the plugin, per
  device, not synced and not in backups; sent only to api.github.com
  (`allowedHosts`).
- An expired token gives `token-refused`; Set Up again with a new one
  keeps folder, repository and state.

# Checked

`test/plugin.test.mjs` and `test/cycle.test.mjs` against
`test/github-fake.mjs` (the API on a real bare repository) and
`scripts/host.mjs` (Super Productivity's folder scripts and requests):
repository list, setup with folder creation and first cycle, wrong
token, bad input. Not checked against github.com: the forms'
prefilling and `/user/repos` for a fine-grained token.
