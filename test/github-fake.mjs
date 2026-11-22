// A stand-in for the part of GitHub's REST API Git Sync uses, on a real
// bare repository through git plumbing: refs, compare, commits, trees,
// blobs, the Contents API's first commit in an empty repository, and
// /user/repos. Answers like GitHub where the plugin relies on it: 404 for a
// missing ref, 409 for an empty repository, 422 for a ref update that is
// not a fast-forward, 401 for a wrong token. Problem reports: POST
// /repos/<issueRepository>/issues with `issueToken` makes an issue; the
// sync token gets 403 there, like a fine-grained token without access.
import { createServer } from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ZERO = '0'.repeat(40);

export async function startGithub({
  bare,
  token = 'test',
  repository = 'me/sp-sync',
  issueRepository = 'nexumia-de/tabularium',
  issueToken = 'report-token',
}) {
  const issues = [];
  const git = (args, { input, env } = {}) => {
    const r = spawnSync('git', ['-C', bare, ...args], { input, env: { ...process.env, ...env } });
    if (r.status !== 0) throw Object.assign(new Error(String(r.stderr)), { git: true });
    return String(r.stdout).trim();
  };
  const ref = (branch) => {
    const r = spawnSync('git', ['-C', bare, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return r.status === 0 ? String(r.stdout).trim() : null;
  };
  const isAncestor = (a, b) => spawnSync('git', ['-C', bare, 'merge-base', '--is-ancestor', a, b]).status === 0;
  const empty = () => !git(['for-each-ref', 'refs/heads']);
  const commitTree = (tree, parents, message) =>
    git(['commit-tree', tree, ...parents.flatMap((p) => ['-p', p]), '-m', message], {
      env: { GIT_AUTHOR_NAME: 'Git Sync', GIT_AUTHOR_EMAIL: 'g@s', GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: 'n@g' },
    });
  const prefix = `/repos/${repository}/`;

  const handle = (method, url, body) => {
    const path = new URL(url, 'http://x').pathname;
    if (path === '/user/repos' && method === 'GET') {
      return [200, [{ full_name: repository, private: true, permissions: { push: true } }]];
    }
    if (!path.startsWith(prefix)) return [404];
    const parts = path.slice(prefix.length).split('/');
    const rest = (n) => parts.slice(n).join('/');
    if (parts[0] === 'git' && parts[1] === 'ref' && parts[2] === 'heads' && method === 'GET') {
      if (empty()) return [409, { message: 'Git Repository is empty.' }];
      const sha = ref(rest(3));
      return sha ? [200, { object: { sha } }] : [404];
    }
    if (parts[0] === 'compare' && method === 'GET') {
      const [base, head] = parts[1].split('...');
      const mergeBase = git(['merge-base', base, head]);
      const status = base === head ? 'identical' : mergeBase === base ? 'ahead' : mergeBase === head ? 'behind' : 'diverged';
      const aheadBy = Number(git(['rev-list', '--count', `${base}..${head}`]));
      return [200, { status, ahead_by: aheadBy, merge_base_commit: { sha: mergeBase } }];
    }
    if (parts[0] === 'git' && parts[1] === 'commits' && method === 'GET') {
      return [200, { sha: parts[2], tree: { sha: git(['rev-parse', `${parts[2]}^{tree}`]) } }];
    }
    if (parts[0] === 'git' && parts[1] === 'trees' && method === 'GET') {
      const tree = git(['ls-tree', parts[2]])
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [meta, name] = line.split('\t');
          const [mode, type, sha] = meta.split(' ');
          return { path: name, mode, type, sha };
        });
      return [200, { sha: parts[2], tree, truncated: false }];
    }
    if (parts[0] === 'git' && parts[1] === 'blobs' && method === 'GET') {
      const content = execFileSync('git', ['-C', bare, 'cat-file', 'blob', parts[2]]).toString('base64');
      return [200, { sha: parts[2], encoding: 'base64', content: content.replace(/(.{60})/g, '$1\n') }];
    }
    if (empty() && parts[0] === 'git' && method === 'POST') return [409, { message: 'Git Repository is empty.' }];
    if (parts[0] === 'git' && parts[1] === 'blobs' && method === 'POST') {
      const data = body.encoding === 'base64' ? Buffer.from(body.content, 'base64') : Buffer.from(body.content);
      return [201, { sha: git(['hash-object', '-w', '--stdin'], { input: data }) }];
    }
    if (parts[0] === 'git' && parts[1] === 'trees' && method === 'POST') {
      const dir = mkdtempSync(join(tmpdir(), 'fake-index-'));
      const env = { GIT_INDEX_FILE: join(dir, 'index') };
      try {
        if (body.base_tree) git(['read-tree', body.base_tree], { env });
        for (const e of body.tree) {
          if (e.sha === null) git(['update-index', '--index-info'], { env, input: `0 ${ZERO}\t${e.path}\n` });
          else git(['update-index', '--add', '--cacheinfo', `${e.mode},${e.sha},${e.path}`], { env });
        }
        return [201, { sha: git(['write-tree'], { env }) }];
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    if (parts[0] === 'git' && parts[1] === 'commits' && method === 'POST') {
      return [201, { sha: commitTree(body.tree, body.parents || [], body.message) }];
    }
    if (parts[0] === 'git' && parts[1] === 'refs' && parts[2] === 'heads' && method === 'PATCH') {
      const branch = rest(3);
      const old = ref(branch);
      if (!old) return [422, { message: 'Reference does not exist' }];
      if (!body.force && !isAncestor(old, body.sha)) return [422, { message: 'Update is not a fast forward' }];
      git(['update-ref', `refs/heads/${branch}`, body.sha, old]);
      return [200, { object: { sha: body.sha } }];
    }
    if (parts[0] === 'git' && parts[1] === 'refs' && method === 'POST') {
      if (ref(body.ref.replace('refs/heads/', ''))) return [422, { message: 'Reference already exists' }];
      git(['update-ref', body.ref, body.sha, ZERO]);
      return [201, { ref: body.ref }];
    }
    if (parts[0] === 'contents' && method === 'PUT') {
      const branch = body.branch || 'main';
      const parent = ref(branch);
      const dir = mkdtempSync(join(tmpdir(), 'fake-index-'));
      const env = { GIT_INDEX_FILE: join(dir, 'index') };
      try {
        if (parent) git(['read-tree', parent], { env });
        const blob = git(['hash-object', '-w', '--stdin'], { input: Buffer.from(body.content, 'base64') });
        git(['update-index', '--add', '--cacheinfo', `100644,${blob},${rest(1)}`], { env });
        const commit = commitTree(git(['write-tree'], { env }), parent ? [parent] : [], body.message);
        git(['update-ref', `refs/heads/${branch}`, commit, parent || ZERO]);
        return [201, { commit: { sha: commit } }];
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    return [404];
  };

  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push(`${req.method} ${req.url}`);
      let answer;
      const issuePath = `/repos/${issueRepository}/issues`;
      if (req.method === 'POST' && req.url === issuePath && req.headers.authorization === `Bearer ${issueToken}`) {
        const body = JSON.parse(raw);
        issues.push({ ...body, headers: req.headers });
        const number = issues.length;
        answer = [201, { number, html_url: `https://github.com/${issueRepository}/issues/${number}` }];
      } else if (req.method === 'POST' && req.url === issuePath && req.headers.authorization === `Bearer ${token}`) {
        answer = [403, { message: 'Resource not accessible by personal access token' }];
      } else if (req.headers.authorization !== `Bearer ${token}`) answer = [401, { message: 'Bad credentials' }];
      else {
        try {
          answer = handle(req.method, req.url, raw ? JSON.parse(raw) : null);
        } catch (error) {
          answer = error.git ? [422, { message: 'git failed' }] : [500, { message: error.message }];
        }
      }
      const [status, payload] = answer;
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload ?? { message: String(status) }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { api: `http://127.0.0.1:${server.address().port}`, seen, issues, close: () => server.close() };
}
