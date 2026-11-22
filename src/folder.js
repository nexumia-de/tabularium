// The sync folder on disk, through PluginAPI.executeNodeScript. The scripts
// use only `fs`, `path` and `os` and none of the words Super Productivity
// looks for, so it runs them in its own process (a `vm` context) instead of
// starting a Node process: that also works where it cannot start one, as
// in the Flathub build (docs/super-productivity-facts.md). Each run may
// take 5 s; file contents travel as base64 in the arguments and results.

const FOLDER_SCRIPTS = {
  // { missing: true } or { files: { name: base64 } } for the regular files
  // directly in the folder, without dotfiles.
  list: `
const fs = require('fs');
const path = require('path');
const dir = args[0];
if (!fs.existsSync(dir)) return { missing: true };
const files = {};
for (const name of fs.readdirSync(dir)) {
  if (name.startsWith('.')) continue;
  const full = path.join(dir, name);
  if (!fs.statSync(full).isFile()) continue;
  files[name] = fs.readFileSync(full, 'base64');
}
return { files };`,
  // args[1]: { name: base64 to write, or null to remove }. Each file is
  // written to a temporary name first and then renamed over the old one.
  write: `
const fs = require('fs');
const path = require('path');
const dir = args[0];
fs.mkdirSync(dir, { recursive: true });
for (const [name, content] of Object.entries(args[1])) {
  if (!name || name.includes('/') || name.includes('\\\\') || name.startsWith('.')) {
    throw new Error('bad file name');
  }
  const full = path.join(dir, name);
  if (content === null) {
    if (fs.existsSync(full)) fs.unlinkSync(full);
    continue;
  }
  const temporary = path.join(dir, '.' + name + '.git-sync');
  fs.writeFileSync(temporary, content, 'base64');
  fs.renameSync(temporary, full);
}
return { ok: true };`,
  // The home folder, the suggested sync folder (~/sp-sync) and whether
  // Super Productivity runs as Flatpak: from Flathub its home folder is
  // read-only, so the page shows the one command that lets it write in
  // the sync folder (docs/super-productivity-facts.md).
  home: `
const fs = require('fs');
const os = require('os');
const path = require('path');
const home = os.homedir();
let appId = null;
if (fs.existsSync('/.flatpak-info')) {
  const info = fs.readFileSync('/.flatpak-info', 'utf8').match(/^name=(.+)$/m);
  appId = info ? info[1].trim() : 'com.super_productivity.SuperProductivity';
}
return { home, flatpak: appId !== null, appId, suggested: path.join(home, 'sp-sync') };`,
};

async function folderRun(name, args) {
  if (typeof PluginAPI.executeNodeScript !== 'function') {
    throw Object.assign(new Error('no node scripts'), { code: 'node' });
  }
  const result = await PluginAPI.executeNodeScript({ script: FOLDER_SCRIPTS[name], args, timeout: 5000 });
  if (!result || !result.success) {
    const message = (result && result.error) || 'node script failed';
    // A file system error means the folder, not the permission to run.
    const code = /\b(ENOENT|EROFS|EACCES|EPERM|ENOTDIR)\b/.test(message) ? 'folder-not-writable' : 'node';
    throw Object.assign(new Error(message), { code, detail: message });
  }
  return result.result;
}

async function folderList(folder) {
  return folderRun('list', [folder]);
}

async function folderWrite(folder, changes) {
  if (Object.keys(changes).length) await folderRun('write', [folder, changes]);
}

async function folderHome() {
  return folderRun('home', []);
}
