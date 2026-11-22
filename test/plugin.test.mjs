// plugin.js with a fake PluginAPI: the order prepare → Super Productivity
// sync → finish, one cycle at a time, settings per device, one snack per
// new error, and the settings page's messages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPluginJs, buildNodeScript, buildZip } from '../scripts/build.mjs';

function load({ results = {}, secret = null } = {}) {
  const calls = [];
  const timers = [];
  const api = {
    secrets: new Map(secret ? [['settings', secret]] : []),
    hooks: {},
    snacks: [],
    async getSecret(key) {
      return this.secrets.get(key) ?? null;
    },
    async setSecret(key, value) {
      this.secrets.set(key, value);
    },
    registerMenuEntry(cfg) {
      this.menu = cfg;
    },
    registerHook(name, fn) {
      this.hooks[name] = fn;
    },
    onMessage(fn) {
      this.message = fn;
    },
    onWindowFocusChange(fn) {
      this.focus = fn;
    },
    onReady(fn) {
      this.ready = fn;
    },
    showIndexHtmlAsView() {},
    showSnack(cfg) {
      this.snacks.push(cfg);
    },
    async triggerSync() {
      calls.push('sync');
      await new Promise((r) => setImmediate(r));
    },
    async executeNodeScript(request) {
      const { step } = request.args[0];
      calls.push(step);
      assert.equal(request.script, buildNodeScript());
      const result = results[step] ?? { ok: true };
      return { success: true, result: typeof result === 'function' ? result() : result };
    },
  };
  const fakeTimers = {
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    clearTimeout: () => {},
    setInterval: (fn, ms) => timers.push({ fn, ms, every: true }),
    clearInterval: () => {},
  };
  new Function('PluginAPI', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', buildPluginJs())(
    api,
    fakeTimers.setTimeout,
    fakeTimers.clearTimeout,
    fakeTimers.setInterval,
    fakeTimers.clearInterval,
  );
  return { api, calls, timers };
}

const SETTINGS = JSON.stringify({ folder: '/home/u/sp', git: '/usr/bin/git', intervalMinutes: 5 });

test('starts on onReady, registers the menu, hook and a timer', async () => {
  const { api, timers } = load({ secret: SETTINGS });
  assert.equal(api.menu, undefined);
  await api.ready();
  assert.equal(api.menu.label, 'Git Sync');
  assert.equal(typeof api.hooks.dataChanged, 'function');
  assert.ok(timers.some((t) => t.every && t.ms === 5 * 60 * 1000));
});

test('a cycle runs prepare, Super Productivity sync, finish in this order', async () => {
  const { api, calls } = load({
    secret: SETTINGS,
    results: { prepare: { ok: true, took: 1, stale: false }, finish: { ok: true, pushed: true } },
  });
  await api.ready();
  const state = await api.message({ type: 'sync' });
  assert.deepEqual(calls, ['prepare', 'sync', 'finish']);
  assert.equal(state.status.state, 'ok');
  assert.equal(state.status.took, 1);
  assert.equal(state.status.pushed, true);
});

test('a failed prepare stops before Super Productivity syncs; one snack per new error', async () => {
  const { api, calls } = load({ secret: SETTINGS, results: { prepare: { ok: false, code: 'diverged', detail: '' } } });
  await api.ready();
  await api.message({ type: 'sync' });
  await api.message({ type: 'sync' });
  assert.deepEqual(calls, ['prepare', 'prepare']);
  assert.equal(api.snacks.length, 1);
  assert.match(api.snacks[0].msg, /went apart/);
});

test('requests during a cycle run one more cycle, never two at once', async () => {
  const { api, calls } = load({ secret: SETTINGS });
  await api.ready();
  const first = api.message({ type: 'sync' });
  const second = api.message({ type: 'sync' });
  await Promise.all([first, second]);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls, ['prepare', 'sync', 'finish', 'prepare', 'sync', 'finish']);
});

test('without a folder nothing runs and the user is told', async () => {
  const { api, calls } = load();
  await api.ready();
  const state = await api.message({ type: 'sync' });
  assert.deepEqual(calls, []);
  assert.equal(state.status.code, 'no-folder');
});

test('settings are kept per device and cleaned', async () => {
  const { api } = load();
  await api.ready();
  const state = await api.message({
    type: 'save',
    settings: { folder: '  /home/u/sp ', git: '', intervalMinutes: '0' },
  });
  assert.deepEqual(state.settings, { folder: '/home/u/sp', git: '/usr/bin/git', intervalMinutes: 1 });
  assert.deepEqual(JSON.parse(api.secrets.get('settings')), state.settings);
});

test('the ZIP holds manifest, plugin and page', () => {
  const { name, data } = buildZip();
  assert.match(name, /^tabularium-\d+\.\d+\.\d+\.zip$/);
  const text = data.toString('latin1');
  for (const file of ['manifest.json', 'plugin.js', 'index.html']) assert.ok(text.includes(file));
  assert.equal(data.readUInt32LE(data.length - 22), 0x06054b50);
});
