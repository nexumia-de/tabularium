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
- `git` on the computer, and access to a **private** repository that
  pushes without asking (SSH key, or HTTPS with a stored credential).
- Super Productivity from Flathub runs in a sandbox without the
  computer's `git`: set the git command to `flatpak-spawn --host git` and
  give the app `--talk-name=org.freedesktop.Flatpak` (Flatseal), or use
  the .deb, .rpm or AppImage.

## Set up

1. Create a private repository on GitHub, for example `sp-sync`, with
   nothing in it.
2. Clone it where the sync folder should be:

   ```sh
   git clone git@github.com:you/sp-sync.git ~/sp-sync
   ```

3. In Super Productivity: Settings → Sync → **Local file**, choose
   `~/sp-sync`, and switch on **manual sync only**, so that Super
   Productivity syncs only when the plugin asks (it still syncs once at
   start and before it quits; the plugin handles that). Switch on
   encryption if you like: the files on GitHub are then unreadable
   without your password, and Day Planner reads them with it.
4. Install the plugin: Settings → Plugins → upload
   `tabularium-<version>.zip` from the
   [releases](https://github.com/nexumia-de/tabularium/releases), and
   allow it to run Node scripts.
5. Open **Git Sync** in the menu, enter the folder (`/home/you/sp-sync`)
   and the git command (default `/usr/bin/git`), Save, Sync Now.
6. In Day Planner: Sync Folder → Kind **GitHub Repository**, the
   repository (`you/sp-sync`) and a
   [fine-grained token](https://github.com/settings/personal-access-tokens/new)
   for this one repository with **Contents: read and write**.

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
