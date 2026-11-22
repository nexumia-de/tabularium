@../phosh-toolkit/agents/core.md

# tabularium (Git Sync)

A Super Productivity plugin, visible name **Git Sync**: it keeps Super
Productivity's local sync folder in a Git repository, so that Day
Planner (nexumia-de/pensum) on the phone shares the same data through
GitHub. Not a GTK app. Knowledge of this repository: [docs/index.md](docs/index.md).

- The protocol is shared with Day Planner: only this plugin writes
  `main`; Day Planner writes only `day-planner`
  ([protocol](docs/protocol.md)). A change to it changes
  `docs/protocol.md`, the tests here and `pensum/sync/github.py` in the
  same round, with pull requests in both repositories.
- The plugin is `src/folder.js`, `github.js`, `blob-sha.js`, `cycle.js`,
  `report.js`, `feedback.js` and `plugin.js`, joined by
  `scripts/build.mjs`; all run in the app window. The page is
  `index.html` with `report.html` (Report a Problem,
  [feedback](docs/feedback.md)) put in by the build. No `git` command and no Node process: the folder scripts in
  `folder.js` must pass Super Productivity's check for running inside
  its own process (`scripts/host.mjs`, `DIRECT_SCRIPT_CHECK`), or they
  fail in the Flathub build; GitHub goes through `PluginAPI.request`.
- Never move `main` backwards or with force; the cycle only commits what
  Super Productivity wrote and fast-forwards. Never write task data into
  logs, commit messages or snacks.
- No dependencies: Node's test runner, the ZIP is written by
  `scripts/build.mjs`; `scripts/host.mjs` stands in for Super
  Productivity in tests here and in Day Planner's end-to-end test.
- Super Productivity facts come from its source at a recorded commit
  ([facts](docs/super-productivity-facts.md)).

## Before committing

`npm run check` (syntax, tests, build) passes; the end-to-end test with
a real Super Productivity runs in pensum's `real-app` job
(`tests/real_app/run_sync.sh`, scenario git).

## Releases

A tag `v<version>` matching `src/manifest.json` runs the release
workflow (plugin ZIP on the tag's GitHub release, made by hand or by
the workflow). The owner tags releases; agents do not.
