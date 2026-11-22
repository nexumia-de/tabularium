// GitHub's REST API through PluginAPI.request (permission `http`, host
// api.github.com in the manifest): the git data endpoints for one
// repository, compare, the Contents API for the first commit of an empty
// repository, and the repositories a token reaches. A failed request
// rejects with an error carrying `.status` (Super Productivity's plugin
// HTTP layer); these are turned into error codes for the page.

const GITHUB_API = 'https://api.github.com';

function githubError(error) {
  const status = error && error.status;
  const code =
    status === 401
      ? 'token-refused'
      : status === 403
        ? 'forbidden'
        : status === 404
          ? 'not-found'
          : status === 409
            ? 'empty'
            : status === 422
              ? 'conflict'
              : status
                ? 'server'
                : 'unreachable';
  return Object.assign(new Error(code), { code, status: status || 0 });
}

function githubClient(token, repository, api) {
  const base = `${api || GITHUB_API}/repos/${repository}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const call = async (method, path, body) => {
    try {
      return await PluginAPI.request(`${base}/${path}`, { method, body, headers, timeout: 60000 });
    } catch (error) {
      throw githubError(error);
    }
  };
  const maybe = async (method, path) => {
    try {
      return await call(method, path);
    } catch (error) {
      if (error.code === 'not-found' || error.code === 'empty') return null;
      throw error;
    }
  };
  return {
    async ref(branch) {
      const found = await maybe('GET', `git/ref/heads/${branch}`);
      return found ? found.object.sha : null;
    },
    async compare(older, newer) {
      const found = await call('GET', `compare/${older}...${newer}`);
      return { status: found.status, aheadBy: found.ahead_by || 0, mergeBase: found.merge_base_commit.sha };
    },
    // { name: blob sha } of the files at the top of the commit's tree.
    async files(commit) {
      const tree = (await call('GET', `git/commits/${commit}`)).tree.sha;
      const listing = await call('GET', `git/trees/${tree}`);
      const files = {};
      for (const entry of listing.tree) {
        if (entry.type === 'blob' && !entry.path.startsWith('.') && !entry.path.includes('/')) files[entry.path] = entry.sha;
      }
      return files;
    },
    async blob(sha) {
      return (await call('GET', `git/blobs/${sha}`)).content.replace(/\s/g, '');
    },
    // One commit on `parent` with the files in `changes` (base64, or null
    // to remove); returns its sha.
    async commit(parent, changes, message) {
      const baseTree = (await call('GET', `git/commits/${parent}`)).tree.sha;
      const entries = [];
      for (const [name, content] of Object.entries(changes)) {
        const sha = content === null ? null : (await call('POST', 'git/blobs', { content, encoding: 'base64' })).sha;
        entries.push({ path: name, mode: '100644', type: 'blob', sha });
      }
      const tree = (await call('POST', 'git/trees', { base_tree: baseTree, tree: entries })).sha;
      return (await call('POST', 'git/commits', { message, tree, parents: [parent] })).sha;
    },
    // Fast-forward only: GitHub answers 422 when `sha` does not contain the
    // branch's commit (code `conflict`).
    async moveBranch(branch, sha) {
      await call('PATCH', `git/refs/heads/${branch}`, { sha, force: false });
    },
    // An empty repository has no commit for the git data API to build on;
    // the Contents API makes the first one, with a small note file.
    async start() {
      const content = btoa('Super Productivity sync folder, kept by Git Sync (nexumia-de/tabularium).\n');
      const made = await call('PUT', 'contents/.git-sync', { message: 'Git Sync: start', content, branch: 'main' });
      return made.commit.sha;
    },
  };
}

// The repositories the token may write to, for the guided setup (one page
// of 100; the plugin HTTP layer does not show the Link header).
async function githubRepositories(token, api) {
  try {
    const list = await PluginAPI.request(
      `${api || GITHUB_API}/user/repos?per_page=100&affiliation=owner,collaborator&sort=pushed`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        timeout: 60000,
      },
    );
    return (Array.isArray(list) ? list : [])
      .filter((r) => r && typeof r.full_name === 'string')
      .map((r) => ({ fullName: r.full_name, private: r.private === true, canWrite: !!(r.permissions && r.permissions.push) }));
  } catch (error) {
    throw githubError(error);
  }
}
