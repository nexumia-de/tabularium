# Git Sync for Super Productivity

A [Super Productivity](https://super-productivity.com) plugin (code name
tabularium) that keeps Super Productivity's local sync folder in a Git
repository. [Day Planner](https://github.com/nexumia-de/pensum) on a
Phosh phone reads and changes the same data through GitHub, without a
WebDAV server.

Super Productivity still does its own sync into the folder, with its own
conflict handling; the plugin only moves that folder through Git around
each sync: fetch, take what Day Planner sent, let Super Productivity
sync, commit, push. How it works: [docs/protocol.md](docs/protocol.md).

## Requirements

- Super Productivity **20.0.0 or newer as a desktop app** (Linux, macOS,
  Windows). The plugin runs `git`, which Super Productivity allows only in
  its desktop app and only after you agree once.
- `git` on the computer and a GitHub account. The guided setup creates
  the access itself; an existing clone with your own SSH key or stored
  credential works too.
- Super Productivity from Flathub runs in a sandbox without the
  computer's `git`: set the git command to `flatpak-spawn --host git` and
  give the app `--talk-name=org.freedesktop.Flatpak` (Flatseal), or use
  the .deb, .rpm or AppImage.

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
4. **Set Up Folder** (default `~/sp-sync`): Git Sync copies the
   repository there and keeps the token for it inside the folder's
   `.git`, readable only by you.
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

Runs the tests (the Git cycle against real repositories, plugin.js with
a fake PluginAPI) and writes `dist/tabularium-<version>.zip`. The
end-to-end test with a real Super Productivity and Day Planner runs in
Day Planner's repository (`tests/real_app/run_sync.sh`, scenario git).

## Support

Git Sync is free software (AGPL-3.0-or-later). If it helps you:
[liberapay.com/suitably](https://liberapay.com/suitably).
