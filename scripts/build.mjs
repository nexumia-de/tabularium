// Builds the plugin: plugin.js is folder.js, github.js, blob-sha.js and
// cycle.js followed by src/plugin.js, one script for Super Productivity's
// plugin runner. `node scripts/build.mjs` writes
// dist/tabularium-<version>.zip with manifest.json, plugin.js and
// index.html. No dependencies: the ZIP is written here (stored entries,
// CRC-32 from node:zlib).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(join(root, name), 'utf8');

export const ENGINE_FILES = ['src/folder.js', 'src/github.js', 'src/blob-sha.js', 'src/cycle.js'];

export function engineSource() {
  return ENGINE_FILES.map(read).join('\n');
}

export function buildPluginJs() {
  return `${engineSource()}\n${read('src/plugin.js')}`;
}

// The engine's functions with `api` as PluginAPI, for tests and for the
// end-to-end test in Day Planner's repository (scripts/host.mjs).
export function loadEngine(api) {
  const names = ['cyclePrepare', 'cycleFinish', 'folderList', 'folderWrite', 'folderHome', 'folderRun',
    'githubClient', 'githubRepositories', 'blobSha', 'FOLDER_SCRIPTS'];
  return new Function('PluginAPI', `${engineSource()}\nreturn { ${names.join(', ')} };`)(api);
}

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text, 'utf8');
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(0, 10); // time and date: 1980-01-00, reproducible
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function buildZip() {
  const manifest = JSON.parse(read('src/manifest.json'));
  const files = [
    ['manifest.json', read('src/manifest.json')],
    ['plugin.js', buildPluginJs()],
    ['index.html', read('src/index.html')],
  ];
  return { name: `tabularium-${manifest.version}.zip`, data: zip(files) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { name, data } = buildZip();
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'dist', name), data);
  console.log(`dist/${name}`);
}
