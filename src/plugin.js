// Git Sync for Super Productivity (docs/protocol.md). Drives the sync
// cycle: prepare (take the repository's changes and Day Planner's
// hand-over into the folder), Super Productivity's own sync into the local
// folder (triggerSync), finish (commit what it wrote and move main). Runs
// on a timer, when the window gets focus and after local changes. The
// folder is read and written by small scripts (folder.js), the repository
// through GitHub's API (github.js). Settings, token and state are per
// device (PluginAPI secret storage); the settings page (index.html) talks
// to this file through onMessage. Logs and messages name codes and counts,
// never task data. The build puts folder.js, github.js, blob-sha.js and
// cycle.js in front of this file.

const KEYS = { settings: 'settings', token: 'token', state: 'state' };
const DEFAULTS = { folder: '', repository: '', intervalMinutes: 5 };
const MIN_GAP_MS = 60 * 1000; // focus and changes start a cycle at most once a minute
const CHANGE_DELAY_MS = 20 * 1000;
const START_DELAY_MS = 30 * 1000; // after Super Productivity's own start-up sync

const MESSAGES = {
  'not-set-up': 'Git Sync: set it up on its page first.',
  'no-folder': 'Git Sync: the sync folder does not exist.',
  'folder-not-writable':
    'Git Sync: Super Productivity may not write in the sync folder; see Git Sync’s page.',
  'token-refused': 'Git Sync: GitHub refused the token; set up again with a new one.',
  forbidden: 'Git Sync: the token may not write to the repository (Contents: read and write needed).',
  'not-found': 'Git Sync: the repository was not found with this token.',
  unreachable: 'Git Sync: GitHub is not reachable.',
  server: 'Git Sync: GitHub answered with an error.',
  'both-have-data': 'Git Sync: the folder and the repository both hold different data; empty one of them.',
  diverged: 'Git Sync: main in the repository moved on without this computer. Nothing was sent.',
  'push-rejected': 'Git Sync: the repository changed meanwhile; the next sync tries again.',
  node: 'Git Sync: Super Productivity did not run the folder step (allow it for this plugin).',
  error: 'Git Sync: the sync failed.',
};

let settings = { ...DEFAULTS };
let token = '';
let state = null;
let running = null;
let again = false;
let lastStart = 0;
let changeTimer = null;
let intervalTimer = null;
let lastShownError = null;
let status = { state: 'idle', at: null, code: null, detail: '', took: 0, stale: false, pushed: false };

async function loadJson(key, fallback) {
  try {
    const stored = await PluginAPI.getSecret(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch (e) {
    return fallback;
  }
}

async function loadAll() {
  settings = { ...DEFAULTS, ...(await loadJson(KEYS.settings, {})) };
  state = await loadJson(KEYS.state, null);
  try {
    token = (await PluginAPI.getSecret(KEYS.token)) || '';
  } catch (e) {
    token = '';
  }
}

function cleanSettings(input) {
  const minutes = Math.round(Number(input && input.intervalMinutes));
  return {
    folder: String((input && input.folder) || '').trim(),
    repository: String((input && input.repository) || '').trim(),
    intervalMinutes: Number.isFinite(minutes) ? Math.min(Math.max(minutes, 1), 120) : DEFAULTS.intervalMinutes,
  };
}

async function saveSettings(input) {
  settings = cleanSettings({ ...settings, ...input });
  await PluginAPI.setSecret(KEYS.settings, JSON.stringify(settings));
  schedule();
}

function context() {
  let saving = Promise.resolve();
  const ctx = {
    folder: settings.folder,
    repository: settings.repository,
    github: githubClient(token, settings.repository),
    state,
    saveState(next) {
      state = next;
      ctx.state = next;
      saving = PluginAPI.setSecret(KEYS.state, JSON.stringify(next));
    },
    saved: () => saving,
  };
  return ctx;
}

function report(next) {
  status = { ...status, ...next, at: Date.now() };
  if (status.state === 'error') {
    if (lastShownError !== status.code) {
      lastShownError = status.code;
      PluginAPI.showSnack({ msg: MESSAGES[status.code] || MESSAGES.error, type: 'ERROR' });
    }
  } else {
    lastShownError = null;
  }
}

async function runCycle() {
  if (!settings.folder || !settings.repository || !token) {
    report({ state: 'error', code: 'not-set-up', detail: '' });
    return status;
  }
  try {
    const ctx = context();
    const prepared = await cyclePrepare(ctx);
    await ctx.saved();
    await PluginAPI.triggerSync();
    const finished = await cycleFinish(ctx);
    await ctx.saved();
    report({
      state: 'ok',
      code: null,
      detail: '',
      took: prepared.took,
      stale: prepared.stale,
      pushed: finished.pushed || prepared.committedOutside || prepared.took > 0,
    });
  } catch (error) {
    report({ state: 'error', code: (error && error.code) || 'error', detail: (error && error.detail) || '' });
  }
  return status;
}

// One cycle at a time; a request during a cycle runs one more afterwards.
function cycle() {
  if (running) {
    again = true;
    return running;
  }
  lastStart = Date.now();
  running = runCycle().finally(() => {
    running = null;
    if (again) {
      again = false;
      cycle();
    }
  });
  return running;
}

function soon() {
  if (Date.now() - lastStart >= MIN_GAP_MS) cycle();
}

function schedule() {
  if (intervalTimer) clearInterval(intervalTimer);
  intervalTimer = setInterval(cycle, settings.intervalMinutes * 60 * 1000);
}

function onDataChanged() {
  // A cycle's own sync changes data too; those changes are synced already.
  if (running) return;
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    changeTimer = null;
    soon();
  }, CHANGE_DELAY_MS);
}

// The guided setup (docs/setup.md): the token is kept per device, the
// folder is created, and the first cycle shows whether it all works.
async function setUp(message) {
  const repository = String(message.repository || '').trim();
  const folder = String(message.folder || '').trim();
  const newToken = String(message.token || '').trim() || token;
  if (!newToken) return { ok: false, code: 'no-token' };
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return { ok: false, code: 'bad-repository' };
  if (!folder.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(folder)) return { ok: false, code: 'bad-folder' };
  try {
    await folderRun('write', [folder, {}]);
  } catch (error) {
    return { ok: false, code: error.code || 'node', detail: error.detail || error.message };
  }
  if (repository !== settings.repository || folder !== settings.folder) {
    state = null;
    await PluginAPI.setSecret(KEYS.state, JSON.stringify(null));
  }
  token = newToken;
  await PluginAPI.setSecret(KEYS.token, token);
  await saveSettings({ repository, folder });
  const result = await cycle();
  return result.state === 'ok' ? { ok: true, folder } : { ok: false, code: result.code, detail: result.detail };
}

async function onMessage(message) {
  const type = message && message.type;
  const view = () => ({ settings, status, running: !!running, hasToken: !!token });
  if (type === 'get') return view();
  if (type === 'save') {
    await saveSettings(message.settings);
    return view();
  }
  if (type === 'sync') {
    await cycle();
    return view();
  }
  if (type === 'home') {
    try {
      return { ok: true, ...(await folderHome()) };
    } catch (error) {
      return { ok: false, code: error.code || 'node' };
    }
  }
  if (type === 'repositories') {
    try {
      return { ok: true, repositories: await githubRepositories(String(message.token || '').trim() || token) };
    } catch (error) {
      return { ok: false, code: error.code || 'error' };
    }
  }
  if (type === 'setup') return { result: await setUp(message), ...view() };
  return { error: 'unknown message' };
}

async function start() {
  await loadAll();
  PluginAPI.registerMenuEntry({ label: 'Git Sync', icon: 'cloud_sync', onClick: () => PluginAPI.showIndexHtmlAsView() });
  if (PluginAPI.onMessage) PluginAPI.onMessage(onMessage);
  PluginAPI.registerHook('dataChanged', onDataChanged);
  if (PluginAPI.onWindowFocusChange) PluginAPI.onWindowFocusChange((focused) => focused && soon());
  schedule();
  setTimeout(cycle, START_DELAY_MS);
}

if (PluginAPI.onReady) PluginAPI.onReady(start);
else start();
