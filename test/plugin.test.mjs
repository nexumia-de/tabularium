// plugin.js as Super Productivity runs it, through the host stand-in
// (scripts/host.mjs) and the GitHub stand-in: the guided setup, the order
// prepare → Super Productivity sync → finish, one cycle at a time,
// settings and token per device, one snack per new error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPluginJs, buildZip } from '../scripts/build.mjs';
import { createHost, request } from '../scripts/host.mjs';
import { startGithub } from './github-fake.mjs';

const TOKEN = 'test-token';
const REPO = 'me/sp-sync';

async function load(t, { sync } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'git-sync-plugin-'));
  const bare = join(root, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  const github = await startGithub({ bare, token: TOKEN, repository: REPO });
  t.after(() => github.close());
  const calls = [];
  const snacks = [];
  const api = createHost({
    extra: {
      hooks: {},
      // The plugin asks api.github.com; the stand-in answers instead.
      request: (url, options) => request(url.replace('https://api.github.com', github.api), options),
      registerMenuEntry(cfg) {
        api.menu = cfg;
      },
      registerHook(name, fn) {
        api.hooks[name] = fn;
      },
      onMessage(fn) {
        api.message = fn;
      },
      onReady(fn) {
        api.ready = fn;
      },
      onWindowFocusChange() {},
      showIndexHtmlAsView() {},
      showSnack(cfg) {
        snacks.push(cfg);
      },
      async triggerSync() {
        calls.push('sync');
        if (sync) sync();
      },
    },
  });
  const noTimers = { set: () => 0, clear: () => {} };
  new Function('PluginAPI', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', buildPluginJs())(
    api,
    noTimers.set,
    noTimers.clear,
    noTimers.set,
    noTimers.clear,
  );
  await api.ready();
  return { api, calls, snacks, root, bare, folder: join(root, 'sp-sync') };
}

const remote = (env) => execFileSync('git', ['-C', env.bare, 'show', 'main:sync-data.json'], { encoding: 'utf8' });

test('starts on onReady and registers the menu entry and the hook', async (t) => {
  const { api } = await load(t);
  assert.equal(api.menu.label, 'Git Sync');
  assert.equal(typeof api.hooks.dataChanged, 'function');
});

test('guided setup: repositories, then setup creates the folder and runs the first cycle', async (t) => {
  let folder;
  const env = await load(t, { sync: () => writeFileSync(join(folder, 'sync-data.json'), 'v1') });
  folder = env.folder;
  const home = await env.api.message({ type: 'home' });
  assert.equal(home.ok, true);
  const found = await env.api.message({ type: 'repositories', token: TOKEN });
  assert.deepEqual(found.repositories.map((r) => r.fullName), [REPO]);
  const done = await env.api.message({ type: 'setup', token: TOKEN, repository: REPO, folder });
  assert.deepEqual(done.result, { ok: true, folder });
  assert.ok(existsSync(folder));
  assert.equal(remote(env), 'v1');
  assert.equal(env.api.secrets().token, TOKEN);
  assert.ok(!env.api.secrets().settings.includes(TOKEN));
  assert.equal(done.status.state, 'ok');
  assert.equal(done.status.pushed, true);
});

test('a cycle: prepare, Super Productivity sync, finish; requests during one run one more', async (t) => {
  let folder;
  let n = 0;
  const env = await load(t, { sync: () => writeFileSync(join(folder, 'sync-data.json'), `v${++n}`) });
  folder = env.folder;
  await env.api.message({ type: 'setup', token: TOKEN, repository: REPO, folder });
  const first = env.api.message({ type: 'sync' });
  const second = env.api.message({ type: 'sync' });
  await Promise.all([first, second]);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(env.calls, ['sync', 'sync', 'sync']);
  assert.equal(readFileSync(join(folder, 'sync-data.json'), 'utf8'), 'v3');
  assert.equal(remote(env), 'v3');
});

test('not set up, a bad setup and a wrong token are named; one snack per new error', async (t) => {
  const env = await load(t);
  const state = await env.api.message({ type: 'sync' });
  assert.equal(state.status.code, 'not-set-up');
  await env.api.message({ type: 'sync' });
  assert.equal(env.snacks.length, 1);
  const setup = (repository, folder, token = TOKEN) => env.api.message({ type: 'setup', token, repository, folder });
  assert.equal((await setup('x', env.folder)).result.code, 'bad-repository');
  assert.equal((await setup(REPO, 'relative')).result.code, 'bad-folder');
  assert.equal((await setup(REPO, env.folder, 'wrong')).result.code, 'token-refused');
  assert.deepEqual(env.calls, []);
  assert.equal((await env.api.message({ type: 'repositories', token: 'wrong' })).code, 'token-refused');
});

test('settings are cleaned and kept per device', async (t) => {
  const env = await load(t);
  const state = await env.api.message({ type: 'save', settings: { intervalMinutes: '0' } });
  assert.equal(state.settings.intervalMinutes, 1);
  assert.deepEqual(JSON.parse(env.api.secrets().settings), state.settings);
});

test('the ZIP holds manifest, plugin and page; the plugin declares only what it uses', () => {
  const { name, data } = buildZip();
  assert.match(name, /^tabularium-\d+\.\d+\.\d+\.zip$/);
  const text = data.toString('latin1');
  for (const file of ['manifest.json', 'plugin.js', 'index.html']) assert.ok(text.includes(file));
  const manifest = JSON.parse(readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.allowedHosts, ['api.github.com']);
  assert.ok(manifest.permissions.includes('http') && manifest.permissions.includes('nodeExecution'));
  assert.ok(manifest.dataSharing.flatMap((d) => d.hosts || []).includes('api.github.com'));
});
