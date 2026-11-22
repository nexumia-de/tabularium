# Git Sync for Super Productivity

A [Super Productivity](https://super-productivity.com) plugin (code name
tabularium) that keeps Super Productivity's local sync folder in a Git
repository. [Day Planner](https://github.com/nexumia-de/pensum) on a
Phosh phone reads and changes the same data through GitHub, without a
WebDAV server.

Super Productivity still does its own sync into the folder, with its own
conflict handling; around each sync the plugin brings the repository's
and Day Planner's changes into the folder and afterwards commits what
Super Productivity wrote, through GitHub's API. How it works: [docs/protocol.md](docs/protocol.md).

## Requirements

- Super Productivity **20.0.0 or newer as a desktop app** (Linux, macOS,
  Windows; the Flathub build works). The plugin reads and writes the
  folder with small scripts Super Productivity runs itself, which it
  allows only in its desktop app and only after you agree once.
- A GitHub account. No `git`, no SSH keys: the plugin talks to GitHub's
  API with a token you create in the setup.

## Set up

Install the plugin first: Settings → Plugins → upload
`tabularium-<version>.zip` from the
[releases](https://github.com/nexumia-de/tabularium/releases) and allow
it to run Node scripts. Then open **Git Sync** in the menu; the page
walks through the rest with buttons ([details](docs/setup.md)):

1. **Create Repository** opens GitHub's form filled in: name `sp-sync`,
   private.
2. **Create Token** opens GitHub's token form filled in (name, one
   year, Contents: read and write); choose "Only select repositories" and
   the new repository.
3. Paste the token, **Find Repositories**, pick `sp-sync`.
4. **Set Up** (folder, default `~/sp-sync`): Git Sync creates the folder
   if needed, keeps the token on this computer and syncs once: an empty
   folder takes the repository's files, an empty repository the
   folder's.
5. In Super Productivity: Settings → Sync → **Local file**, that folder,
   **manual sync only** on (it still syncs at start and before it quits;
   the plugin handles that). Encryption is optional: the files on GitHub
   are then unreadable without your password, and Day Planner reads them
   with it.

On the phone, Day Planner's sync page has the same buttons for its own
token (Kind **GitHub Repository**).

The plugin syncs every 5 minutes (adjustable), when the window gets the
focus and shortly after you change something.

## Develop

```sh
npm run check
```

Runs the tests (the cycle and plugin.js against a GitHub stand-in on a
real bare repository and a stand-in for Super Productivity's plugin host,
`scripts/host.mjs`) and writes `dist/tabularium-<version>.zip`. The
end-to-end test with a real Super Productivity and Day Planner runs in
Day Planner's repository (`tests/real_app/run_sync.sh`, scenario git).

## Support

Git Sync is free software (AGPL-3.0-or-later). If it helps you:
[liberapay.com/suitably](https://liberapay.com/suitably).
