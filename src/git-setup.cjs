'use strict';
// The guided setup of the sync folder (docs/setup.md). Super Productivity
// runs this file in a Node process of its own (PluginAPI.executeNodeScript):
//
// - `home`: the user's home directory, for the suggested folder;
// - `repositories`: the repositories a GitHub token reaches
//   (GET /user/repos), so the person picks one instead of typing it;
// - `clone`: clones the chosen repository into the folder with the token
//   and keeps the token for this repository only, in a file inside .git
//   that only the user may read (git's `store` credential helper), so
//   fetch and push work without SSH keys or a desktop keyring. On a folder
//   that is already that clone it only replaces the stored token.
//
// The token is never logged or returned. Results are plain objects
// ({ ok: true, ... } or { ok: false, code, detail }), never throws.

const SETUP_API = 'https://api.github.com';
const SETUP_SERVER = 'https://github.com';
const CREDENTIALS_FILE = 'tabularium-credentials';

function setupEnv() {
  const os = require('os');
  return {
    HOME: process.env.HOME || os.homedir(),
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function setupGit(git, args, cwd) {
  const { execFile } = require('child_process');
  const command = String(git || 'git').trim().split(/\s+/);
  return new Promise((resolve) => {
    execFile(
      command[0],
      [...command.slice(1), ...args],
      { env: setupEnv(), cwd, maxBuffer: 16 * 1024 * 1024, timeout: 200000 },
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

// Removes anything that looks like the token from git's messages.
function setupDetail(result, token) {
  let text = result ? (result.stderr || result.stdout || '').split('\n').slice(-3).join('\n') : '';
  if (token) text = text.split(token).join('***');
  return text.replace(/x-access-token:[^@\s]*@/g, 'x-access-token:***@');
}

function setupRepositoryName(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) && !value.includes('..');
}

function setupGet(url, token) {
  const lib = url.startsWith('http:') ? require('http') : require('https');
  return new Promise((resolve) => {
    const request = lib.get(
      url,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'GitSync',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        timeout: 30000,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
      },
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', (error) => resolve({ status: 0, error: error.message }));
  });
}

async function setupRepositories(request) {
  const token = String(request.token || '').trim();
  if (!token) return { ok: false, code: 'no-token', detail: '' };
  const api = String(request.api || SETUP_API).replace(/\/+$/, '');
  const repositories = [];
  let url = `${api}/user/repos?per_page=100&affiliation=owner,collaborator&sort=pushed`;
  for (let page = 0; page < 3 && url; page++) {
    const answer = await setupGet(url, token);
    if (answer.status === 0) return { ok: false, code: 'unreachable', detail: answer.error || '' };
    if (answer.status === 401) return { ok: false, code: 'token-refused', detail: '' };
    if (answer.status !== 200) return { ok: false, code: 'server', detail: String(answer.status) };
    let list;
    try {
      list = JSON.parse(answer.body);
    } catch (e) {
      return { ok: false, code: 'server', detail: 'bad answer' };
    }
    if (!Array.isArray(list)) return { ok: false, code: 'server', detail: 'bad answer' };
    for (const item of list) {
      if (item && typeof item.full_name === 'string') {
        repositories.push({
          fullName: item.full_name,
          private: item.private === true,
          canWrite: !!(item.permissions && item.permissions.push),
        });
      }
    }
    const next = /<([^>]+)>\s*;\s*rel="next"/.exec(answer.headers.link || '');
    // The token goes only to the API it was given for.
    url = next && next[1].startsWith(`${api}/`) ? next[1] : null;
  }
  return { ok: true, repositories };
}

async function setupClone(request) {
  const fs = require('fs');
  const path = require('path');
  const token = String(request.token || '').trim();
  const repository = request.repository;
  const folder = request.folder;
  const server = String(request.server || SETUP_SERVER).replace(/\/+$/, '');
  if (!token) return { ok: false, code: 'no-token', detail: '' };
  if (!setupRepositoryName(repository)) return { ok: false, code: 'bad-repository', detail: '' };
  if (!folder || !path.isAbsolute(folder)) return { ok: false, code: 'no-folder', detail: '' };
  const url = `${server}/${repository}.git`;
  const credentials = path.join(folder, '.git', CREDENTIALS_FILE);
  const helper = `store --file=${credentials}`;

  let existing = false;
  if (fs.existsSync(folder) && fs.readdirSync(folder).length > 0) {
    const origin = await setupGit(request.git, ['-C', folder, 'remote', 'get-url', 'origin']);
    if (origin.missing) return { ok: false, code: 'no-git', detail: '' };
    if (origin.code !== 0 || origin.stdout !== url) return { ok: false, code: 'folder-not-empty', detail: '' };
    existing = true;
  }

  const host = new URL(server);
  const line = `${host.protocol}//x-access-token:${encodeURIComponent(token)}@${host.host}\n`;
  const writeCredentials = (file) => {
    fs.writeFileSync(file, line, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  };

  if (!existing) {
    // The token goes to git through a file only the user can read, never
    // on a command line.
    const temporary = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tabularium-'));
    const file = path.join(temporary, CREDENTIALS_FILE);
    try {
      writeCredentials(file);
      const clone = await setupGit(request.git, [
        '-c', 'credential.helper=',
        '-c', `credential.helper=store --file=${file}`,
        'clone', '-q', url, folder,
      ]);
      if (clone.missing) return { ok: false, code: 'no-git', detail: '' };
      if (clone.code !== 0) {
        return { ok: false, code: /not found|403|401|Authentication/i.test(clone.stderr) ? 'clone-refused' : 'clone-failed', detail: setupDetail(clone, token) };
      }
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  writeCredentials(credentials);
  // An empty helper first: the user's other helpers do not answer for this
  // repository, so an old login cannot shadow the token.
  await setupGit(request.git, ['-C', folder, 'config', '--replace-all', 'credential.helper', '']);
  const add = await setupGit(request.git, ['-C', folder, 'config', '--add', 'credential.helper', helper]);
  if (add.code !== 0) return { ok: false, code: 'git-failed', detail: setupDetail(add, token) };
  // An empty repository is cloned onto the default branch of the computer.
  const head = await setupGit(request.git, ['-C', folder, 'rev-parse', '--verify', '--quiet', 'HEAD']);
  if (head.code !== 0) {
    await setupGit(request.git, ['-C', folder, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  }
  const branch = await setupGit(request.git, ['-C', folder, 'symbolic-ref', '--short', 'HEAD']);
  if (branch.stdout !== 'main') return { ok: false, code: 'not-on-main', detail: branch.stdout };
  return { ok: true, folder, existing };
}

async function setupRun(request) {
  try {
    if (request.step === 'home') return { ok: true, home: require('os').homedir() };
    if (request.step === 'repositories') return await setupRepositories(request);
    if (request.step === 'clone') return await setupClone(request);
    return { ok: false, code: 'bad-request', detail: String(request.step) };
  } catch (error) {
    return { ok: false, code: 'error', detail: setupDetail({ stderr: error && error.message ? error.message : String(error) }, request && request.token) };
  }
}

if (typeof module === 'object' && module && module.exports) {
  module.exports = { run: setupRun, CREDENTIALS_FILE };
}
