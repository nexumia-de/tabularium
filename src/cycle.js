// One sync cycle (docs/protocol.md) on the GitHub repository's branches:
// `prepare` before Super Productivity syncs into the folder, `finish`
// after. Only this code moves `main`, and only forward; Day Planner hands
// its changes over on `day-planner`. What the folder held at the last
// commit is kept per device (`state`: the commit and each file's blob
// sha), so a file Super Productivity changed is found without downloads.
// Errors are thrown with a `code` (protocol.md, error codes).

const CYCLE_MAIN = 'main';
const CYCLE_HANDOFF = 'day-planner';

function cycleFail(code, detail) {
  return Object.assign(new Error(code), { code, detail: detail || '' });
}

function cycleDiff(from, to) {
  const changed = {};
  for (const [name, sha] of Object.entries(to)) if (from[name] !== sha) changed[name] = sha;
  for (const name of Object.keys(from)) if (!(name in to)) changed[name] = null;
  return changed;
}

const cycleSame = (a, b) => Object.keys(cycleDiff(a, b)).length === 0;

async function cycleLocal(ctx) {
  const listed = await folderList(ctx.folder);
  if (listed.missing) throw cycleFail('no-folder');
  return { files: listed.files, shas: await blobShas(listed.files) };
}

// Makes the folder hold the commit's files: downloads what differs.
async function cycleCheckout(ctx, local, target) {
  const changes = {};
  for (const [name, sha] of Object.entries(cycleDiff(local.shas, target))) {
    changes[name] = sha === null ? null : await ctx.github.blob(sha);
  }
  await folderWrite(ctx.folder, changes);
  return Object.keys(changes).length;
}

// Commits the folder's changes since `state` on top of it and moves main.
async function cycleCommit(ctx, state, local, message) {
  const changed = cycleDiff(state.files, local.shas);
  if (!Object.keys(changed).length) return null;
  const changes = {};
  for (const [name, sha] of Object.entries(changed)) changes[name] = sha === null ? null : local.files[name];
  const commit = await ctx.github.commit(state.commit, changes, message);
  try {
    await ctx.github.moveBranch(CYCLE_MAIN, commit);
  } catch (error) {
    if (error.code === 'conflict') throw cycleFail(message.includes('outside') ? 'diverged' : 'push-rejected');
    throw error;
  }
  return { commit, files: { ...local.shas } };
}

async function cyclePrepare(ctx) {
  const github = ctx.github;
  let local = await cycleLocal(ctx);
  let main = await github.ref(CYCLE_MAIN);
  if (!main) main = await github.start();
  const remote = await github.files(main);
  let state = ctx.state && ctx.state.repository === ctx.repository ? ctx.state : null;
  const result = { committedOutside: false, took: 0, stale: false, downloaded: 0 };

  if (!state) {
    // First cycle on this device: one side must be empty or both equal.
    const localEmpty = !Object.keys(local.shas).length;
    if (localEmpty || cycleSame(local.shas, remote)) {
      result.downloaded = await cycleCheckout(ctx, local, remote);
      state = { commit: main, files: { ...remote } };
    } else if (!Object.keys(remote).length) {
      state = { commit: main, files: {} };
    } else {
      throw cycleFail('both-have-data');
    }
  } else if (main !== state.commit) {
    if (cycleSame(local.shas, remote)) {
      state = { commit: main, files: { ...remote } }; // a cycle that ended before saving
    } else if (!cycleSame(local.shas, state.files)) {
      throw cycleFail('diverged');
    } else {
      const compared = await github.compare(state.commit, main);
      if (compared.status !== 'ahead') throw cycleFail('diverged');
      result.downloaded = await cycleCheckout(ctx, local, remote);
      state = { commit: main, files: { ...remote } };
    }
  }
  state.repository = ctx.repository;

  // What Super Productivity wrote outside a cycle (its sync at start and
  // before it quits) belongs on top of the last commit.
  local = await cycleLocal(ctx);
  const outside = await cycleCommit(ctx, state, local, 'Super Productivity sync (outside Git Sync)');
  if (outside) {
    state = { ...state, ...outside };
    result.committedOutside = true;
  }

  const handoff = await github.ref(CYCLE_HANDOFF);
  if (handoff && handoff !== state.commit) {
    const compared = await github.compare(state.commit, handoff);
    if (compared.status === 'ahead') {
      const files = await github.files(handoff);
      await cycleCheckout(ctx, local, files);
      await github.moveBranch(CYCLE_MAIN, handoff);
      state = { ...state, commit: handoff, files: { ...files } };
      result.took = compared.aheadBy || 1;
    } else if (compared.status === 'diverged') {
      // Day Planner sent on top of a state main has left; it sees that and
      // sends again (protocol.md, stale hand-overs).
      result.stale = true;
    }
  }
  ctx.saveState(state);
  return result;
}

async function cycleFinish(ctx) {
  const state = ctx.state;
  if (!state || state.repository !== ctx.repository) throw cycleFail('not-prepared');
  const local = await cycleLocal(ctx);
  const done = await cycleCommit(ctx, state, local, 'Super Productivity sync');
  if (done) ctx.saveState({ ...state, ...done });
  return { pushed: !!done };
}
