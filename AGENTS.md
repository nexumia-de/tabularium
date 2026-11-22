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
- `src/git-cycle.cjs` and `src/git-setup.cjs` run in a Node process Super Productivity starts
  with an empty environment (`executeNodeScript`); only Node built-ins
  and the `git` command. `src/plugin.js` runs in the app window.
- Never force-push, reset, merge or rebase `main` in the user's
  repository; the cycle only commits what Super Productivity wrote,
  fast-forwards and pushes. Never write task data into logs, commit
  messages or snacks.
- No dependencies: Node's test runner, the ZIP is written by
  `scripts/build.mjs`.
- Super Productivity facts come from its source at a recorded commit
  ([facts](docs/super-productivity-facts.md)).

## Before committing

`npm run check` (syntax, tests, build) passes; the end-to-end test with
a real Super Productivity runs in pensum's `real-app` job
(`tests/real_app/run_sync.sh`, scenario git).

## Releases

A tag `v<version>` matching `src/manifest.json` runs the release
workflow (plugin ZIP on a GitHub release). The owner tags releases;
agents do not.
