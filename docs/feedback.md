---
type: Reference
title: Report a problem
description: The "Report a Problem" section on Git Sync's page - a problem or an idea becomes an issue in nexumia-de/tabularium, directly with a separate report token (the sync token is not reused) or through GitHub's issue form opened filled in; what is sent and where the token is kept.
tags: [feedback, issues, github, token]
sources:
  - id: toolkit
    title: phosh-toolkit docs/feedback.md (the shared spec) and lib/phosh_toolkit/feedback*.py (reference implementation)
    url: ../../phosh-toolkit/docs/feedback.md
  - id: gh-issues-api
    title: GitHub REST API, create an issue
    url: https://docs.github.com/en/rest/issues/issues#create-an-issue
  - id: gh-issue-url
    title: GitHub Docs, creating an issue from a URL query
    url: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue#creating-an-issue-from-a-url-query
  - id: pat
    title: GitHub Docs, Managing your personal access tokens (fine-grained tokens reach only their resource owner's repositories; classic token scopes)
    url: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
  - id: sp20
    title: Super Productivity 20.0.0, commit 4db0e112, packages/plugin-api/src/types.ts and src/app/plugins/util/plugin-data-sharing.util.ts
    url: https://github.com/johannesjo/super-productivity/tree/4db0e11236bc784d3184a9e252930b4bd53df823
generated: { by: claude-code/2.1.330, at: 2026-11-22 }
---

Every nexumia-de app lets users report a problem as a GitHub issue from
inside the app; this is Git Sync's version of the shared spec[^toolkit],
with its wording, fields and privacy rules.

# On the page

**Report a Problem** is a section at the bottom of Git Sync's page
(`src/report.html`, put into `index.html` by the build), the plugin's
only settings and about place. It asks for the kind (Problem or Idea), a
title and the text (headed "What happened" or "What do you want to do"),
then:

| The user has… | Button | Result |
|---|---|---|
| a report token (typed once, kept) | **Send** | `POST https://api.github.com/repos/nexumia-de/tabularium/issues`[^gh-issues-api] through `PluginAPI.request`; the page shows "Thank You. The issue is on GitHub." and **View Issue** |
| no token | **Open on GitHub** | GitHub's issue form opens in the browser with title, text, version and device filled in[^gh-issue-url] (`window.open` from the page; Super Productivity hands new windows to the browser, [setup](setup.md#super-productivity-from-flathub)) |

**Open on GitHub** is always there, also as the way out when sending
fails; the text stays in the field. Failure texts: "GitHub did not
accept the token. Check that it may write issues in this repository.",
"GitHub cannot be reached right now.", "GitHub did not create the
issue." A text too long for an address (above 7000 characters of URL)
is shortened in the form with "[…shortened, please paste the rest]"; the
page puts the full text on the clipboard where the iframe may, and says
so.

# The token

- **The sync token is not reused.** It is a fine-grained token with
  "Contents: read and write" on the user's own private sync repository
  only ([setup](setup.md#the-token)); it cannot write issues in
  nexumia-de/tabularium, and widening it would give a token that can
  rewrite the sync data more reach than it needs.
- A separate **classic** token with the `public_repo` scope; **Create a
  Token** opens `https://github.com/settings/tokens/new?scopes=public_repo&description=Report%20a%20Problem`.
  A fine-grained token only writes to repositories of its resource
  owner[^pat], so it works only for members of nexumia-de; anyone else
  gets `no-access` with one (phosh-toolkit made the same change).
- Sent only with a report and kept only after GitHub created the issue,
  per device in Super Productivity's secret storage for the plugin (key
  `report-token`, not synced, not in backups); the page itself cannot
  read secrets, so `plugin.js` (`src/feedback.js`) keeps and uses it.
  **Forget** empties it.
- GitHub answers 401, 403 or 404: `no-access`; no answer: `offline`;
  anything else: `failed`.

# What is sent

Only what the user typed, the plugin version (from the manifest, put in
by the build as `PLUGIN_VERSION`) and the kind of device: `Desktop`, or
`Phone (Android)` when the user agent says Android; Super Productivity's
window does not tell a Phosh phone from a desktop. No settings, folder,
repository name, token or sync data. Nothing of a report goes into logs
or snacks. The manifest's `dataSharing` lists GitHub's issue list with
`userText` and `credentials` as `optionalData`, sent only when the user
sends a report[^sp20].

The issue follows `.github/ISSUE_TEMPLATE/`:

| Kind | Form | Label | Fields filled |
|---|---|---|---|
| Problem | `bug.yml` | `bug` | `what`, `version`, `device` |
| Idea | `feature.yml` | `enhancement` | `problem` |

Through the API the body is the same `### Heading` sections GitHub
renders for the form (`src/report.js`, shared by `plugin.js` and the
page).

# Checked

`test/report.test.mjs` (body, labels, form address, shortening, device,
the forms' field ids) and `test/plugin.test.mjs` (sending through the
GitHub stand-in: only text, version and device in the issue; the token
kept after success, not after a refusal or without a connection; the
sync token refused; Forget; the built page). Not checked against
github.com: creating an issue with a classic `public_repo` token,
the form prefilling, and the clipboard inside Super Productivity's
iframe.
