// The sync cycle against a GitHub stand-in on a real bare repository and a
// real folder, run through a stand-in for Super Productivity's plugin host
// (scripts/host.mjs: folder scripts in a vm context, requests by fetch).
// Day Planner is played with git commands on the hand-over branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEngine } from '../scripts/build.mjs';
import { createHost, DIRECT_SCRIPT_CHECK } from '../scripts/host.mjs';
import { startGithub } from './github-fake.mjs';

const TOKEN = 'test-token';
const REPO = 'me/sp-sync';

const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();

async function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'git-sync-'));
  const bare = join(root, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  const github = await startGithub({ bare, token: TOKEN, repository: REPO });
  t.after(() => github.close());
  const host = createHost();
  const engine = loadEngine(host);
  const folder = join(root, 'sp');
  mkdirSync(folder);
  const device = (dir = folder, token = TOKEN) => {
    const ctx = {
      folder: dir,
      repository: REPO,
      github: engine.githubClient(token, REPO, github.api),
      state: null,
      saveState(next) {
        ctx.state = next;
      },
    };
    return ctx;
  };
  // Day Planner: a commit on `base` (default main) with the file, pushed
  // to day-planner.
  const phoneSends = (text, base = 'main') => {
    const phone = join(root, `phone-${Math.random().toString(36).slice(2)}`);
    execFileSync('git', ['clone', '-q', bare, phone], { stdio: 'ignore' });
    git(phone, 'checkout', '-q', '--detach', `origin/${base}`);
    writeFileSync(join(phone, 'sync-data.json'), text);
    git(phone, 'add', '-A');
    git(phone, 'commit', '-q', '-m', 'Day Planner');
    git(phone, 'push', '-q', '-f', 'origin', 'HEAD:refs/heads/day-planner');
  };
  const remote = (name = 'sync-data.json', ref = 'main') => git(bare, 'show', `${ref}:${name}`);
  return { root, bare, folder, engine, device, phoneSends, remote, github };
}

const write = (folder, text, name = 'sync-data.json') => writeFileSync(join(folder, name), text);
const read = (folder, name = 'sync-data.json') => readFileSync(join(folder, name), 'utf8');

async function cycle(env, ctx, sync = () => {}) {
  const prepared = await env.engine.cyclePrepare(ctx);
  sync();
  const finished = await env.engine.cycleFinish(ctx);
  return { prepared, finished };
}

test('the folder scripts run inside Super Productivity, never as a new process', () => {
  const { FOLDER_SCRIPTS } = loadEngine(createHost());
  for (const [name, script] of Object.entries(FOLDER_SCRIPTS)) {
    assert.equal(DIRECT_SCRIPT_CHECK.test(script), false, `${name} would need a Node process`);
    assert.ok(script.length < 100000);
  }
});

test('blob ids are git’s', async () => {
  const { blobSha } = loadEngine(createHost());
  for (const text of ['', 'v1', 'ü\n'.repeat(1000)]) {
    const expected = execFileSync('git', ['hash-object', '--stdin'], { input: text }).toString().trim();
    assert.equal(await blobSha(Buffer.from(text).toString('base64')), expected);
  }
});

test('first sync into an empty repository: started, then the folder committed', async (t) => {
  const env = await setup(t);
  write(env.folder, 'v1');
  const ctx = env.device();
  const { prepared, finished } = await cycle(env, ctx);
  assert.equal(prepared.committedOutside, true);
  assert.equal(finished.pushed, false);
  assert.equal(env.remote(), 'v1');
  assert.match(env.remote('.git-sync'), /Git Sync/);
  assert.equal(ctx.state.commit, git(env.bare, 'rev-parse', 'main'));
  // Nothing changed: no commit.
  const again = await cycle(env, ctx);
  assert.deepEqual([again.prepared.committedOutside, again.finished.pushed], [false, false]);
});

test('Super Productivity’s writes during the cycle are committed in finish; removals too', async (t) => {
  const env = await setup(t);
  write(env.folder, 'v1');
  write(env.folder, 'old', 'sync-data.json.bak');
  const ctx = env.device();
  await cycle(env, ctx);
  const { finished } = await cycle(env, ctx, () => {
    write(env.folder, 'v2');
    rmSync(join(env.folder, 'sync-data.json.bak'));
  });
  assert.equal(finished.pushed, true);
  assert.equal(env.remote(), 'v2');
  assert.throws(() => env.remote('sync-data.json.bak'));
});

test('a hand-over on top of main reaches the folder before Super Productivity syncs', async (t) => {
  const env = await setup(t);
  write(env.folder, 'v1');
  const ctx = env.device();
  await cycle(env, ctx);
  env.phoneSends('v1+phone');
  env.phoneSends('v1+phone+more', 'day-planner');
  let seen;
  const { prepared } = await cycle(env, ctx, () => {
    seen = read(env.folder);
    write(env.folder, 'v1+phone+more+sp');
  });
  assert.equal(prepared.took, 2);
  assert.equal(seen, 'v1+phone+more');
  assert.equal(env.remote(), 'v1+phone+more+sp');
  const again = await cycle(env, ctx);
  assert.deepEqual([again.prepared.took, again.prepared.stale], [0, false]);
});

test('a hand-over on an old main is left alone and reported stale', async (t) => {
  const env = await setup(t);
  write(env.folder, 'v1');
  const ctx = env.device();
  await cycle(env, ctx);
  env.phoneSends('v1+phone');
  write(env.folder, 'v1+sp'); // Super Productivity syncs at start, outside the plugin
  const { prepared } = await cycle(env, ctx);
  assert.deepEqual([prepared.committedOutside, prepared.stale, prepared.took], [true, true, 0]);
  assert.equal(env.remote(), 'v1+sp');
  assert.equal(env.remote('sync-data.json', 'day-planner'), 'v1+phone');
});

test('a second computer: folder follows main; both changed: stop', async (t) => {
  const env = await setup(t);
  write(env.folder, 'v1');
  const first = env.device();
  await cycle(env, first);
  const otherFolder = join(env.root, 'other');
  mkdirSync(otherFolder);
  const second = env.device(otherFolder);
  const join1 = await cycle(env, second);
  assert.equal(join1.prepared.downloaded, 1);
  assert.equal(read(otherFolder), 'v1');
  await cycle(env, second, () => write(otherFolder, 'v2'));
  const followed = await cycle(env, first);
  assert.equal(followed.prepared.downloaded, 1);
  assert.equal(read(env.folder), 'v2');
  await cycle(env, second, () => write(otherFolder, 'v3'));
  write(env.folder, 'v2+mine');
  await assert.rejects(env.engine.cyclePrepare(first), { code: 'diverged' });
  assert.equal(env.remote(), 'v3');
});

test('a new device with data on both sides is refused; equal data is fine', async (t) => {
  const env = await setup(t);
  write(env.folder, 'v1');
  await cycle(env, env.device());
  const otherFolder = join(env.root, 'other');
  mkdirSync(otherFolder);
  write(otherFolder, 'something else');
  await assert.rejects(env.engine.cyclePrepare(env.device(otherFolder)), { code: 'both-have-data' });
  write(otherFolder, 'v1');
  assert.equal((await env.engine.cyclePrepare(env.device(otherFolder))).downloaded, 0);
});

test('a cycle that ended before its state was kept picks up where main is', async (t) => {
  const env = await setup(t);
  write(env.folder, 'v1');
  const ctx = env.device();
  await cycle(env, ctx);
  const old = ctx.state;
  await cycle(env, ctx, () => write(env.folder, 'v2'));
  ctx.state = old; // the state of the cycle before
  const { prepared } = await cycle(env, ctx);
  assert.deepEqual([prepared.committedOutside, prepared.downloaded], [false, 0]);
  assert.equal(ctx.state.commit, git(env.bare, 'rev-parse', 'main'));
});

test('errors are named: wrong token, missing folder', async (t) => {
  const env = await setup(t);
  write(env.folder, 'v1');
  await assert.rejects(env.engine.cyclePrepare(env.device(env.folder, 'wrong')), { code: 'token-refused' });
  await assert.rejects(env.engine.cyclePrepare(env.device(join(env.root, 'missing'))), { code: 'no-folder' });
  await assert.rejects(env.engine.cycleFinish(env.device()), { code: 'not-prepared' });
});

test('the repository list for the guided setup', async (t) => {
  const env = await setup(t);
  assert.deepEqual(await env.engine.githubRepositories(TOKEN, env.github.api), [
    { fullName: REPO, private: true, canWrite: true },
  ]);
  await assert.rejects(env.engine.githubRepositories('wrong', env.github.api), { code: 'token-refused' });
  assert.ok(existsSync(env.folder));
});
