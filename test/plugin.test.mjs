// plugin.js as Super Productivity runs it, through the host stand-in
// (scripts/host.mjs) and the GitHub stand-in: the guided setup, the order
// prepare → Super Productivity sync → finish, one cycle at a time,
// settings and token per device, one snack per new error, problem reports
// with their own token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIndexHtml, buildPluginJs, buildZip } from '../scripts/build.mjs';
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
  return { api, calls, snacks, github, root, bare, folder: join(root, 'sp-sync') };
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
  assert.equal(home.flatpak, false);
  assert.equal(home.suggested, join(home.home, 'sp-sync'));
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
  // ~/ is the home folder, as people write it.
  const name = `git-sync-test-${process.pid}`;
  const tilde = await setup(REPO, `~/${name}`, 'wrong');
  assert.equal(tilde.result.code, 'token-refused');
  assert.equal(tilde.settings.folder, join(homedir(), name));
  rmSync(join(homedir(), name), { recursive: true, force: true });
  assert.equal((await setup(REPO, env.folder, 'wrong')).result.code, 'token-refused');
  // A folder Super Productivity may not create (Flathub: home is read-only).
  // (A path below a file stands in: root may write everywhere else here.)
  writeFileSync(join(env.root, 'a-file'), '');
  const notWritable = (await setup(REPO, join(env.root, 'a-file', 'sp-sync'))).result;
  assert.equal(notWritable.code, 'folder-not-writable');
  assert.match(notWritable.detail, /ENOTDIR/);
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
  const reports = manifest.dataSharing.find((d) => d.recipient.includes('issue'));
  assert.deepEqual(reports.data, []);
  assert.deepEqual(reports.optionalData.sort(), ['credentials', 'userText']);
});

test('the built page holds the report section with report.js and the version', () => {
  const manifest = JSON.parse(readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8'));
  const page = buildIndexHtml();
  assert.ok(!page.includes('<!-- report.html -->') && !page.includes('/* report.js */'));
  assert.ok(page.includes('id="report-send"') && page.includes('function reportFormUrl('));
  assert.ok(page.includes(`const PLUGIN_VERSION = "${manifest.version}";`));
  assert.ok(buildPluginJs().startsWith(`const PLUGIN_VERSION = "${manifest.version}";`));
});

const REPORT = { kind: 'problem', title: 'Sync stops', text: 'It shows not-found.' };
const REPORT_TOKEN = 'report-token';

test('a report needs a token, a title and a text; the sync token is not used', async (t) => {
  const env = await load(t);
  await env.api.message({ type: 'setup', token: TOKEN, repository: REPO, folder: env.folder });
  assert.deepEqual(await env.api.message({ type: 'report-state' }), { hasToken: false });
  assert.equal((await env.api.message({ type: 'report-send', report: REPORT })).code, 'no-token');
  const incomplete = await env.api.message({ type: 'report-send', report: { ...REPORT, text: ' ' }, token: REPORT_TOKEN });
  assert.equal(incomplete.code, 'incomplete');
  // A token GitHub does not let write issues there (here: the sync token) is not kept.
  const refused = await env.api.message({ type: 'report-send', report: REPORT, token: TOKEN });
  assert.deepEqual(refused, { ok: false, code: 'no-access', hasToken: false });
  assert.ok(!('report-token' in env.api.secrets()));
  assert.deepEqual(env.github.issues, []);
});

test('a report becomes an issue with only the text, version and device; the token is kept until Forget', async (t) => {
  const env = await load(t);
  const manifest = JSON.parse(readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8'));
  const sent = await env.api.message({ type: 'report-send', report: REPORT, token: ` ${REPORT_TOKEN} ` });
  assert.deepEqual(sent, { ok: true, url: 'https://github.com/nexumia-de/tabularium/issues/1', hasToken: true });
  const [issue] = env.github.issues;
  assert.equal(issue.title, 'Sync stops');
  assert.equal(
    issue.body,
    `### What happened\n\nIt shows not-found.\n\n### Version\n\n${manifest.version}\n\n### Device\n\nDesktop`,
  );
  assert.deepEqual(issue.labels, ['bug']);
  assert.equal(env.api.secrets()['report-token'], REPORT_TOKEN);
  assert.ok(!('token' in env.api.secrets()));
  // The saved token sends the next one; Forget removes it.
  const idea = await env.api.message({ type: 'report-send', report: { ...REPORT, kind: 'idea' } });
  assert.equal(idea.ok, true);
  assert.equal(env.github.issues[1].body, '### What do you want to do\n\nIt shows not-found.');
  assert.deepEqual(env.github.issues[1].labels, ['enhancement']);
  assert.deepEqual(await env.api.message({ type: 'report-state' }), { hasToken: true });
  assert.deepEqual(await env.api.message({ type: 'report-forget' }), { hasToken: false });
  assert.deepEqual(await env.api.message({ type: 'report-state' }), { hasToken: false });
  assert.deepEqual(env.snacks, []);
});

test('a report without a connection says offline and keeps no token', async (t) => {
  const env = await load(t);
  env.api.request = async () => {
    throw new Error('[PluginHttp] request failed: fetch failed');
  };
  const sent = await env.api.message({ type: 'report-send', report: REPORT, token: REPORT_TOKEN });
  assert.deepEqual(sent, { ok: false, code: 'offline', hasToken: false });
  assert.ok(!('report-token' in env.api.secrets()));
});
