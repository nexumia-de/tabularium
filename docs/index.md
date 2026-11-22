---
okf_version: "0.2"
---

# tabularium knowledge bundle

[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
(OKF v0.2) bundle of Git Sync, the Super Productivity plugin. Shared
knowledge lives in [../../phosh-toolkit/docs/index.md](../../phosh-toolkit/docs/index.md).
Change history is in [log.md](log.md).

# Git Sync

* [Protocol](protocol.md) - Only the plugin writes main, Day Planner hands over on day-planner; the cycle prepare / sync / finish, stale hand-overs, error codes.
* [Super Productivity facts](super-productivity-facts.md) - What the plugin relies on in Super Productivity 20.0.0: plugin API, node execution, manual-only sync, the local file provider.
* [Dependencies](dependencies.md) - None besides Node and git.

# Decisions

* [One writer of main, a hand-over branch](decisions/branch-handoff.md) - Drive Super Productivity's own sync, plugin writes main, Day Planner hands over and sends again when stale.
