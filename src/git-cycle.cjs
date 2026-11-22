'use strict';
// The Git side of one sync cycle (docs/protocol.md). Super Productivity
// runs this file in a Node process of its own (PluginAPI.executeNodeScript)
// twice per cycle: `prepare` before its sync, `finish` after it. Only this
// code writes the branch `main`; Day Planner hands its changes over on the
// branch `day-planner`, which `prepare` fast-forwards into `main`.
// No dependencies besides Node and the git command; results are plain
// objects ({ ok: true, ... } or { ok: false, code, detail }), never throws.

const MAIN = 'main';
const HANDOFF = 'day-planner';
const IDENTITY = ['-c', 'user.name=Tabularium', '-c', 'user.email=tabularium@localhost'];
// Directories under /run/user/<uid> where desktops put the SSH agent socket.
const SSH_SOCKETS = ['keyring/ssh', 'gcr/ssh', 'ssh-agent.socket', 'openssh_agent'];

function tabulariumEnv() {
  const fs = require('fs');
  const os = require('os');
  // Super Productivity starts this process with an empty environment
  // (electron/plugin-node-executor.ts), so git would find neither the home
  // directory (config, credentials, SSH keys) nor PATH (ssh, helpers).
  const env = {
    HOME: os.homedir(),
    PATH: '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C',
    GIT_TERMINAL_PROMPT: '0',
  };
  if (typeof process.getuid === 'function') {
    const run = `/run/user/${process.getuid()}`;
    if (fs.existsSync(run)) {
      env.XDG_RUNTIME_DIR = run;
      if (fs.existsSync(`${run}/bus`)) env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${run}/bus`;
      const socket = SSH_SOCKETS.map((name) => `${run}/${name}`).find((p) => fs.existsSync(p));
      if (socket) env.SSH_AUTH_SOCK = socket;
    }
  }
  for (const name of ['HOME', 'PATH', 'SSH_AUTH_SOCK', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'GIT_SSH_COMMAND']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return env;
}

function tabulariumGit(cfg, args) {
  const { execFile } = require('child_process');
  const command = String(cfg.git || 'git').trim().split(/\s+/);
  return new Promise((resolve) => {
    execFile(
      command[0],
      [...command.slice(1), '-C', cfg.folder, ...IDENTITY, ...args],
      { env: cfg.env, maxBuffer: 16 * 1024 * 1024, timeout: 100000 },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof error.code === 'number' ? error.code : -1) : 0,
          missing: !!error && error.code === 'ENOENT',
          stdout: String(stdout).trim(),
          stderr: String(stderr).trim(),
        });
      },
    );
  });
}

function tabulariumFail(code, result) {
  const detail = result ? (result.stderr || result.stdout || '').split('\n').slice(-3).join('\n') : '';
  return { ok: false, code, detail };
}

async function tabulariumRev(cfg, ref) {
  const r = await tabulariumGit(cfg, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return r.code === 0 ? r.stdout : null;
}

async function tabulariumIsAncestor(cfg, older, newer) {
  return (await tabulariumGit(cfg, ['merge-base', '--is-ancestor', older, newer])).code === 0;
}

// Commits whatever Super Productivity wrote into the folder.
async function tabulariumCommit(cfg, message) {
  const status = await tabulariumGit(cfg, ['status', '--porcelain']);
  if (status.code !== 0) return tabulariumFail('git-failed', status);
  if (!status.stdout) return { ok: true, committed: false };
  const add = await tabulariumGit(cfg, ['add', '-A']);
  if (add.code !== 0) return tabulariumFail('git-failed', add);
  const commit = await tabulariumGit(cfg, ['commit', '-q', '-m', message]);
  if (commit.code !== 0) return tabulariumFail('git-failed', commit);
  return { ok: true, committed: true };
}

async function tabulariumCheck(cfg) {
  const fs = require('fs');
  const path = require('path');
  if (!cfg.folder || !path.isAbsolute(cfg.folder) || !fs.existsSync(cfg.folder)) {
    return { ok: false, code: 'no-folder', detail: '' };
  }
  const top = await tabulariumGit(cfg, ['rev-parse', '--show-toplevel']);
  if (top.missing) return { ok: false, code: 'no-git', detail: '' };
  if (top.code !== 0 || fs.realpathSync(top.stdout) !== fs.realpathSync(cfg.folder)) {
    return tabulariumFail('not-a-repository', top);
  }
  const branch = await tabulariumGit(cfg, ['symbolic-ref', '--short', 'HEAD']);
  if (branch.stdout !== MAIN) return { ok: false, code: 'not-on-main', detail: branch.stdout };
  return { ok: true };
}

async function tabulariumPrepare(cfg) {
  const check = await tabulariumCheck(cfg);
  if (!check.ok) return check;
  const fetch = await tabulariumGit(cfg, ['fetch', '-q', '--prune', 'origin']);
  if (fetch.code !== 0) return tabulariumFail('fetch-failed', fetch);
  // Super Productivity also syncs at start and before it quits, without
  // this plugin; what it wrote then belongs on top of the last commit.
  const outside = await tabulariumCommit(cfg, 'Super Productivity sync (outside Git Sync)');
  if (!outside.ok) return outside;

  const head = await tabulariumRev(cfg, 'HEAD');
  const remote = await tabulariumRev(cfg, `refs/remotes/origin/${MAIN}`);
  if (head && remote && head !== remote) {
    if (await tabulariumIsAncestor(cfg, head, remote)) {
      const ff = await tabulariumGit(cfg, ['merge', '-q', '--ff-only', remote]);
      if (ff.code !== 0) return tabulariumFail('git-failed', ff);
    } else if (!(await tabulariumIsAncestor(cfg, remote, head))) {
      return { ok: false, code: 'diverged', detail: '' };
    }
  }

  let took = 0;
  let stale = false;
  const handoff = await tabulariumRev(cfg, `refs/remotes/origin/${HANDOFF}`);
  const current = await tabulariumRev(cfg, 'HEAD');
  if (handoff && current && handoff !== current && !(await tabulariumIsAncestor(cfg, handoff, current))) {
    if (await tabulariumIsAncestor(cfg, current, handoff)) {
      const count = await tabulariumGit(cfg, ['rev-list', '--count', `${current}..${handoff}`]);
      const ff = await tabulariumGit(cfg, ['merge', '-q', '--ff-only', handoff]);
      if (ff.code !== 0) return tabulariumFail('git-failed', ff);
      took = Number(count.stdout) || 1;
    } else {
      // Day Planner sent on top of a state that main has left; it notices
      // that and sends again (docs/protocol.md, stale hand-over).
      stale = true;
    }
  }
  return { ok: true, committedOutside: outside.committed, took, stale };
}

async function tabulariumFinish(cfg) {
  const check = await tabulariumCheck(cfg);
  if (!check.ok) return check;
  const commit = await tabulariumCommit(cfg, 'Super Productivity sync');
  if (!commit.ok) return commit;
  const head = await tabulariumRev(cfg, 'HEAD');
  const remote = await tabulariumRev(cfg, `refs/remotes/origin/${MAIN}`);
  if (!head || head === remote) return { ok: true, pushed: false };
  const push = await tabulariumGit(cfg, ['push', '-q', 'origin', `HEAD:refs/heads/${MAIN}`]);
  if (push.code !== 0) {
    return tabulariumFail(/rejected|non-fast-forward|fetch first/.test(push.stderr) ? 'push-rejected' : 'push-failed', push);
  }
  return { ok: true, pushed: true };
}

async function tabulariumRun(request) {
  const cfg = { folder: request && request.folder, git: (request && request.git) || 'git', env: tabulariumEnv() };
  try {
    if (request.step === 'prepare') return await tabulariumPrepare(cfg);
    if (request.step === 'finish') return await tabulariumFinish(cfg);
    return { ok: false, code: 'bad-request', detail: String(request.step) };
  } catch (error) {
    return { ok: false, code: 'error', detail: error && error.message ? error.message : String(error) };
  }
}

if (typeof module === 'object' && module && module.exports) {
  module.exports = { run: tabulariumRun, MAIN, HANDOFF };
}
