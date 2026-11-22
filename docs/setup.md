---
type: Reference
title: Guided setup
description: The click-through setup on Git Sync's page - GitHub's new-repository and new-token forms opened filled in by link, the repository picked from the list the token reaches, the clone with the token kept in .git for that repository only, and what stays manual.
tags: [setup, github, token, git]
sources:
  - id: newrepo
    title: GitHub Docs, Creating a new repository (URL query parameters)
    url: https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository
  - id: pat
    title: GitHub Changelog 2025-08-26, Template URLs for fine-grained PATs; GitHub Docs, Managing your personal access tokens
    url: https://github.blog/changelog/2025-08-26-template-urls-for-fine-grained-pats-and-updated-permissions-ui/
  - id: store
    title: Git, git-credential-store
    url: https://git-scm.com/docs/git-credential-store
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
3. **Find Repositories**: the `repositories` step of `src/git-setup.cjs`
   calls `GET https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator&sort=pushed`
   (up to three pages, a next page only on the same host) and the page
   offers those the token may write to, `…/sp-sync` first; a public one
   is marked.
4. **Set Up Folder** (`clone` step): the folder must be new or empty, or
   already a clone of exactly that repository (then only the token is
   replaced). The token goes to `git clone` through a temporary file
   readable only by the user (credential helper `store --file`[^store]),
   never on a command line, and is then kept in
   `.git/tabularium-credentials` (mode 600) with the repository's
   `credential.helper` set to an empty value and then that file, so the
   user's other helpers do not answer for it. An empty repository is put
   on branch `main`. The folder becomes the plugin's setting.
5. Super Productivity's own sync settings (Local file, the folder,
   manual sync only) stay manual: a plugin cannot read or set them
   ([facts](super-productivity-facts.md)).

Links open in the system browser: the page's iframe may open popups and
Super Productivity's window hands every new window to the browser
(`electron/main-window.ts`, `setWindowOpenHandler`, v20.0.0).

# The token

- One per device: this one for the desktop, another for Day Planner.
  Each can be revoked alone.
- It reaches Super Productivity's Node process as an argument of
  `executeNodeScript`, which puts its arguments on that process's
  command line (`electron/plugin-node-executor.ts`); other users of the
  computer could see it there for the seconds the step runs. The cycle
  itself never handles the token.
- An expired token makes fetch fail (`fetch-failed`); the setup run
  again on the same folder stores a new one.

# Checked

`test/git-setup.test.mjs`: the repository list against a local
stand-in (pages, the next link on another host not followed, a refused
token), the clone of an empty bare repository (main, the credential file
and its mode, the helpers, no token in `.git/config`, a cycle afterwards),
a second setup on the same folder, a full folder refused, bad input, the
token never in a result. Not checked against github.com: the forms'
prefilling, `/user/repos` for a fine-grained token, HTTPS auth with the
stored token.
