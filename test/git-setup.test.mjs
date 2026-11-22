// The guided setup (src/git-setup.cjs): the repository list against a
// local stand-in for GitHub's /user/repos, and the clone with the token
// kept in .git against a bare repository on disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { run, CREDENTIALS_FILE } = createRequire(import.meta.url)('../src/git-setup.cjs');
const cycle = createRequire(import.meta.url)('../src/git-cycle.cjs');
const TOKEN = 'github_pat_test_123';

const helpers = (dir) =>
  execFileSync('git', ['-C', dir, 'config', '--get-all', 'credential.helper'], { encoding: 'utf8' })
    .replace(/\n$/, '')
    .split('\n');

const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@t', ...args], {
    encoding: 'utf8',
  }).trim();

async function api(pages) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401).end('{}');
      return;
    }
    const page = Number(new URL(req.url, 'http://x').searchParams.get('page') || 1);
    const headers = { 'Content-Type': 'application/json' };
    if (page < pages.length) headers.Link = `<http://127.0.0.1:${server.address().port}/user/repos?page=${page + 1}>; rel="next"`;
    res.writeHead(200, headers).end(JSON.stringify(pages[page - 1]));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}`, seen };
}

test('lists the repositories the token reaches, following GitHub’s pages', async () => {
  const { server, url, seen } = await api([
    [{ full_name: 'me/sp-sync', private: true, permissions: { push: true } }],
    [{ full_name: 'me/public', private: false, permissions: { push: false } }],
  ]);
  try {
    const result = await run({ step: 'repositories', token: TOKEN, api: url });
    assert.deepEqual(result, {
      ok: true,
      repositories: [
        { fullName: 'me/sp-sync', private: true, canWrite: true },
        { fullName: 'me/public', private: false, canWrite: false },
      ],
    });
    assert.equal(seen.length, 2);
    assert.match(seen[0].url, /^\/user\/repos\?per_page=100&affiliation=owner,collaborator/);
    assert.equal((await run({ step: 'repositories', token: 'wrong', api: url })).code, 'token-refused');
    assert.equal((await run({ step: 'repositories', token: '', api: url })).code, 'no-token');
  } finally {
    server.close();
  }
});

test('a next page on another host is not followed (the token stays with the API)', async () => {
  const server = createServer((req, res) => {
    res
      .writeHead(200, { 'Content-Type': 'application/json', Link: '<http://evil.example/user/repos?page=2>; rel="next"' })
      .end('[]');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const result = await run({ step: 'repositories', token: TOKEN, api: `http://127.0.0.1:${server.address().port}` });
    assert.deepEqual(result, { ok: true, repositories: [] });
  } finally {
    server.close();
  }
});

function remote() {
  const root = mkdtempSync(join(tmpdir(), 'tabularium-setup-'));
  mkdirSync(join(root, 'me'));
  const bare = join(root, 'me', 'sp-sync.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  return { root, server: `file://${root}`, bare };
}

test('clones an empty repository onto main and keeps the token in .git only', async () => {
  const { root, server } = remote();
  const folder = join(root, 'folder');
  const result = await run({ step: 'clone', token: TOKEN, repository: 'me/sp-sync', folder, server, git: 'git' });
  assert.deepEqual(result, { ok: true, folder, existing: false });
  assert.equal(git(folder, 'symbolic-ref', '--short', 'HEAD'), 'main');
  const file = join(folder, '.git', CREDENTIALS_FILE);
  assert.match(readFileSync(file, 'utf8'), new RegExp(`x-access-token:${TOKEN}@`));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(helpers(folder), ['', `store --file=${file}`]);
  assert.ok(!readFileSync(join(folder, '.git', 'config'), 'utf8').includes(TOKEN));
  // The cycle works in the new folder.
  writeFileSync(join(folder, 'sync-data.json'), 'v1');
  assert.equal((await cycle.run({ step: 'prepare', folder, git: 'git' })).ok, true);
  assert.deepEqual(await cycle.run({ step: 'finish', folder, git: 'git' }), { ok: true, pushed: true });
});

test('setting up the same folder again only replaces the token; other folders are refused', async () => {
  const { root, server } = remote();
  const folder = join(root, 'folder');
  await run({ step: 'clone', token: TOKEN, repository: 'me/sp-sync', folder, server, git: 'git' });
  const again = await run({ step: 'clone', token: 'new_token', repository: 'me/sp-sync', folder, server, git: 'git' });
  assert.deepEqual(again, { ok: true, folder, existing: true });
  assert.match(readFileSync(join(folder, '.git', CREDENTIALS_FILE), 'utf8'), /x-access-token:new_token@/);
  assert.equal(helpers(folder).length, 2);

  const full = join(root, 'full');
  mkdirSync(full);
  writeFileSync(join(full, 'notes.txt'), 'mine');
  const refused = await run({ step: 'clone', token: TOKEN, repository: 'me/sp-sync', folder: full, server, git: 'git' });
  assert.equal(refused.code, 'folder-not-empty');
  assert.equal(readFileSync(join(full, 'notes.txt'), 'utf8'), 'mine');
});

test('bad input and a missing repository are named; the token never shows', async () => {
  const { root, server } = remote();
  const base = { step: 'clone', token: TOKEN, server, git: 'git' };
  assert.equal((await run({ ...base, repository: 'me/../x', folder: join(root, 'a') })).code, 'bad-repository');
  assert.equal((await run({ ...base, repository: 'me/sp-sync', folder: 'relative' })).code, 'no-folder');
  assert.equal((await run({ ...base, token: '', repository: 'me/sp-sync', folder: join(root, 'a') })).code, 'no-token');
  const missing = await run({ ...base, repository: 'me/missing', folder: join(root, 'b') });
  assert.equal(missing.ok, false);
  assert.ok(!JSON.stringify(missing).includes(TOKEN));
  assert.equal((await run({ ...base, git: '/nonexistent/git', repository: 'me/sp-sync', folder: join(root, 'c') })).code, 'no-git');
  const home = await run({ step: 'home' });
  assert.equal(home.ok, true);
  assert.ok(home.home.length > 0);
});
