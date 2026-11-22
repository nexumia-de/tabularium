// Git Sync for Super Productivity (docs/protocol.md). Drives the sync
// cycle: Git `prepare` (fetch, take Day Planner's hand-over), Super
// Productivity's own sync into the local folder (triggerSync), Git
// `finish` (commit, push). Runs on a timer, when the window gets focus and
// after local changes. Settings are per device (PluginAPI secret storage);
// the settings page (index.html) talks to this file through onMessage.
// Logs and messages name codes and counts, never task data.

const NODE_SCRIPT = '__TABULARIUM_NODE_SCRIPT__';
const SETTINGS_KEY = 'settings';
const DEFAULTS = { folder: '', git: '/usr/bin/git', intervalMinutes: 5 };
const MIN_GAP_MS = 60 * 1000; // focus and changes start a cycle at most once a minute
const CHANGE_DELAY_MS = 20 * 1000;
const START_DELAY_MS = 30 * 1000; // after Super Productivity's own start-up sync
const NODE_TIMEOUT_MS = 120 * 1000;

const MESSAGES = {
  'no-folder': 'Git Sync: choose the sync folder in its settings.',
  'no-git': 'Git Sync: the git command was not found.',
  'not-a-repository': 'Git Sync: the sync folder is not the top folder of a Git repository.',
  'not-on-main': 'Git Sync: the repository in the sync folder is not on the branch main.',
  'fetch-failed': 'Git Sync: could not fetch from the repository (offline or no access).',
  diverged: 'Git Sync: main in the repository and in the sync folder went apart. Nothing was pushed.',
  'push-rejected': 'Git Sync: the push was rejected; the next sync tries again.',
  'push-failed': 'Git Sync: could not push to the repository.',
  'git-failed': 'Git Sync: a git command failed.',
  node: 'Git Sync: Super Productivity did not run the Git step (permission or desktop app needed).',
  error: 'Git Sync: the sync failed.',
};

let settings = { ...DEFAULTS };
let running = null;
let again = false;
let lastStart = 0;
let changeTimer = null;
let intervalTimer = null;
let lastShownError = null;
let status = { state: 'idle', at: null, code: null, detail: '', took: 0, stale: false, pushed: false };

async function loadSettings() {
  try {
    const stored = await PluginAPI.getSecret(SETTINGS_KEY);
    settings = { ...DEFAULTS, ...(stored ? JSON.parse(stored) : {}) };
  } catch (e) {
    settings = { ...DEFAULTS };
  }
}

function cleanSettings(input) {
  const minutes = Math.round(Number(input && input.intervalMinutes));
  return {
    folder: String((input && input.folder) || '').trim(),
    git: String((input && input.git) || DEFAULTS.git).trim() || DEFAULTS.git,
    intervalMinutes: Number.isFinite(minutes) ? Math.min(Math.max(minutes, 1), 120) : DEFAULTS.intervalMinutes,
  };
}

async function saveSettings(input) {
  settings = cleanSettings(input);
  await PluginAPI.setSecret(SETTINGS_KEY, JSON.stringify(settings));
  schedule();
}

async function nodeStep(step) {
  if (typeof PluginAPI.executeNodeScript !== 'function') return { ok: false, code: 'node', detail: '' };
  const result = await PluginAPI.executeNodeScript({
    script: NODE_SCRIPT,
    args: [{ step, folder: settings.folder, git: settings.git }],
    timeout: NODE_TIMEOUT_MS,
  });
  if (!result || !result.success) return { ok: false, code: 'node', detail: (result && result.error) || '' };
  return result.result || { ok: false, code: 'error', detail: '' };
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
  if (!settings.folder) {
    report({ state: 'error', code: 'no-folder', detail: '' });
    return status;
  }
  const prepared = await nodeStep('prepare');
  if (!prepared.ok) {
    report({ state: 'error', code: prepared.code, detail: prepared.detail });
    return status;
  }
  await PluginAPI.triggerSync();
  const finished = await nodeStep('finish');
  if (!finished.ok) {
    report({ state: 'error', code: finished.code, detail: finished.detail });
    return status;
  }
  report({
    state: 'ok',
    code: null,
    detail: '',
    took: prepared.took || 0,
    stale: !!prepared.stale,
    pushed: !!finished.pushed,
  });
  return status;
}

// One cycle at a time; a request during a cycle runs one more afterwards.
function cycle() {
  if (running) {
    again = true;
    return running;
  }
  lastStart = Date.now();
  running = runCycle()
    .catch((e) => {
      report({ state: 'error', code: 'error', detail: e && e.message ? e.message : String(e) });
      return status;
    })
    .finally(() => {
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

async function onMessage(message) {
  const type = message && message.type;
  if (type === 'get') return { settings, status, running: !!running };
  if (type === 'save') {
    await saveSettings(message.settings);
    return { settings, status, running: !!running };
  }
  if (type === 'sync') return { settings, status: await cycle(), running: false };
  return { error: 'unknown message' };
}

async function start() {
  await loadSettings();
  PluginAPI.registerMenuEntry({ label: 'Git Sync', icon: 'cloud_sync', onClick: () => PluginAPI.showIndexHtmlAsView() });
  if (PluginAPI.onMessage) PluginAPI.onMessage(onMessage);
  PluginAPI.registerHook('dataChanged', onDataChanged);
  if (PluginAPI.onWindowFocusChange) PluginAPI.onWindowFocusChange((focused) => focused && soon());
  schedule();
  setTimeout(cycle, START_DELAY_MS);
}

if (PluginAPI.onReady) PluginAPI.onReady(start);
else start();
