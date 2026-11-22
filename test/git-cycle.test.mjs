// The Git cycle against real repositories: a bare "GitHub" repository,
// the desktop's sync folder (a clone) and a second clone that plays Day
// Planner, which pushes to the hand-over branch only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { run } = createRequire(import.meta.url)('../src/git-cycle.cjs');

const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@t', ...args], {
    encoding: 'utf8',
  }).trim();

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'tabularium-'));
  const origin = join(root, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  const desktop = join(root, 'desktop');
  execFileSync('git', ['clone', '-q', origin, desktop]);
  git(desktop, 'checkout', '-q', '-B', 'main');
  const phone = join(root, 'phone');
  return { root, origin, desktop, phone };
}

const step = (folder, name) => run({ step: name, folder, git: 'git' });

// Super Productivity writing its sync file into the folder.
const spWrites = (folder, text) => writeFileSync(join(folder, 'sync-data.json'), text);

async function cycle(folder, sync = () => {}) {
  const prepared = await step(folder, 'prepare');
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  sync();
  const finished = await step(folder, 'finish');
  assert.equal(finished.ok, true, JSON.stringify(finished));
  return { prepared, finished };
}

// Day Planner: commits on top of `base` and moves day-planner there.
function phoneSends(env, text, base = 'origin/main') {
  try {
    git(env.phone, 'fetch', '-q', 'origin');
  } catch {
    execFileSync('git', ['clone', '-q', env.origin, env.phone]);
  }
  git(env.phone, 'checkout', '-q', '--detach', base);
  writeFileSync(join(env.phone, 'sync-data.json'), text);
  git(env.phone, 'commit', '-q', '-am', 'Day Planner');
  git(env.phone, 'push', '-q', '-f', 'origin', 'HEAD:refs/heads/day-planner');
}

const remoteFile = (env, ref = 'main') => git(env.origin, 'show', `${ref}:sync-data.json`);

test('first sync commits and pushes what Super Productivity wrote', async () => {
  const env = setup();
  const { finished } = await cycle(env.desktop, () => spWrites(env.desktop, 'v1'));
  assert.equal(finished.pushed, true);
  assert.equal(remoteFile(env), 'v1');
});

test('nothing written, nothing committed or pushed', async () => {
  const env = setup();
  await cycle(env.desktop, () => spWrites(env.desktop, 'v1'));
  const before = git(env.origin, 'rev-parse', 'main');
  const { prepared, finished } = await cycle(env.desktop);
  assert.equal(prepared.took, 0);
  assert.equal(finished.pushed, false);
  assert.equal(git(env.origin, 'rev-parse', 'main'), before);
});

test('a hand-over on top of main is fast-forwarded before the sync', async () => {
  const env = setup();
  await cycle(env.desktop, () => spWrites(env.desktop, 'v1'));
  phoneSends(env, 'v1+phone');
  let seen;
  const { prepared } = await cycle(env.desktop, () => {
    seen = readFileSync(join(env.desktop, 'sync-data.json'), 'utf8');
    spWrites(env.desktop, 'v1+phone+sp');
  });
  assert.equal(prepared.took, 1);
  assert.equal(seen, 'v1+phone', 'Super Productivity syncs against the phone’s file');
  assert.equal(remoteFile(env), 'v1+phone+sp');
  // The hand-over is now part of main: delivered, not taken again.
  const again = await cycle(env.desktop);
  assert.equal(again.prepared.took, 0);
  assert.equal(again.prepared.stale, false);
});

test('several sends on top of each other are taken together', async () => {
  const env = setup();
  await cycle(env.desktop, () => spWrites(env.desktop, 'v1'));
  phoneSends(env, 'a');
  phoneSends(env, 'a+b', 'origin/day-planner');
  const { prepared } = await cycle(env.desktop);
  assert.equal(prepared.took, 2);
  assert.equal(remoteFile(env), 'a+b');
});

test('a hand-over on an old main is left alone and reported stale', async () => {
  const env = setup();
  await cycle(env.desktop, () => spWrites(env.desktop, 'v1'));
  phoneSends(env, 'v1+phone');
  // Super Productivity syncs at start, outside the plugin, before the cycle.
  spWrites(env.desktop, 'v1+sp');
  const { prepared } = await cycle(env.desktop);
  assert.equal(prepared.committedOutside, true);
  assert.equal(prepared.stale, true);
  assert.equal(prepared.took, 0);
  assert.equal(remoteFile(env), 'v1+sp', 'Super Productivity’s upload is kept');
  assert.equal(remoteFile(env, 'day-planner'), 'v1+phone', 'the hand-over stays for Day Planner');
});

test('main moved by someone else: fast-forward; diverged: stop', async () => {
  const env = setup();
  await cycle(env.desktop, () => spWrites(env.desktop, 'v1'));
  const other = join(env.root, 'other');
  execFileSync('git', ['clone', '-q', env.origin, other]);
  writeFileSync(join(other, 'sync-data.json'), 'v2');
  git(other, 'commit', '-q', '-am', 'other');
  git(other, 'push', '-q', 'origin', 'main');
  const { prepared } = await cycle(env.desktop);
  assert.equal(prepared.ok, true);
  assert.equal(readFileSync(join(env.desktop, 'sync-data.json'), 'utf8'), 'v2');

  writeFileSync(join(other, 'sync-data.json'), 'v3');
  git(other, 'commit', '-q', '-am', 'other');
  git(other, 'push', '-q', 'origin', 'main');
  spWrites(env.desktop, 'v2+sp');
  git(env.desktop, 'commit', '-q', '-am', 'local');
  const result = await step(env.desktop, 'prepare');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'diverged');
});

test('a rejected push is reported, not forced', async () => {
  const env = setup();
  await cycle(env.desktop, () => spWrites(env.desktop, 'v1'));
  assert.equal((await step(env.desktop, 'prepare')).ok, true);
  const other = join(env.root, 'other');
  execFileSync('git', ['clone', '-q', env.origin, other]);
  writeFileSync(join(other, 'sync-data.json'), 'v2');
  git(other, 'commit', '-q', '-am', 'other');
  git(other, 'push', '-q', 'origin', 'main');
  spWrites(env.desktop, 'v1+sp');
  const result = await step(env.desktop, 'finish');
  assert.equal(result.code, 'push-rejected');
  assert.equal(remoteFile(env), 'v2');
});

test('wrong setups are named', async () => {
  const env = setup();
  assert.equal((await step('', 'prepare')).code, 'no-folder');
  assert.equal((await step(join(env.root, 'missing'), 'prepare')).code, 'no-folder');
  const plain = join(env.root, 'plain');
  mkdirSync(plain);
  assert.equal((await step(plain, 'prepare')).code, 'not-a-repository');
  const sub = join(env.desktop, 'sub');
  mkdirSync(sub);
  assert.equal((await step(sub, 'prepare')).code, 'not-a-repository');
  git(env.desktop, 'checkout', '-q', '-b', 'other');
  assert.equal((await step(env.desktop, 'prepare')).code, 'not-on-main');
  const missingGit = await run({ step: 'prepare', folder: env.desktop, git: '/nonexistent/git' });
  assert.equal(missingGit.code, 'no-git');
  assert.equal((await run({ step: 'nope', folder: env.desktop })).code, 'bad-request');
});

test('the script runs as Super Productivity runs it: node -e with an empty environment', async () => {
  const env = setup();
  spWrites(env.desktop, 'v1');
  const { buildNodeScript } = await import('../scripts/build.mjs');
  const script = buildNodeScript();
  // The wrapper of electron/plugin-node-executor.ts (executeViaSpawn), v20.0.0.
  const wrapped = `'use strict';(async function(){const args=${JSON.stringify([
    { step: 'finish', folder: env.desktop, git: '/usr/bin/git' },
  ])};try{const result=await (async function(){${script}})();console.log(JSON.stringify({__result:result}));}catch(e){console.error(e.message);process.exit(1);}})();`;
  const out = execFileSync(process.execPath, ['--no-warnings', '-e', wrapped], {
    env: { NODE_ENV: 'production' },
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(out).__result, { ok: true, pushed: true });
  assert.equal(remoteFile(env), 'v1');
});
