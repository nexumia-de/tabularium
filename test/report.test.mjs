// The report's issue body and the filled-in issue form (src/report.js),
// as phosh-toolkit's feedback module writes them (docs/feedback.md), and
// that the forms in .github/ISSUE_TEMPLATE have the fields filled in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadEngine } from '../scripts/build.mjs';
import { createHost } from '../scripts/host.mjs';

const { reportBody, reportLabels, reportFormUrl, reportDevice, REPORT_MAX_URL } = loadEngine(createHost());
const PROBLEM = { kind: 'problem', title: 'Sync stops', text: 'It shows not-found.', version: '0.4.0', device: 'Desktop' };
const query = (url) => Object.fromEntries(new URL(url).searchParams);

test('the device is Desktop, or Phone (Android) when the user agent says so', () => {
  assert.equal(reportDevice('Mozilla/5.0 (X11; Linux x86_64) superProductivity/20.0.0 Electron/38'), 'Desktop');
  assert.equal(reportDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8)'), 'Phone (Android)');
  assert.equal(reportDevice(undefined), 'Desktop');
});

test('the body reads like the bug form; an idea has only the text', () => {
  assert.equal(
    reportBody(PROBLEM),
    '### What happened\n\nIt shows not-found.\n\n### Version\n\n0.4.0\n\n### Device\n\nDesktop',
  );
  assert.deepEqual(reportLabels(PROBLEM), ['bug']);
  const idea = { ...PROBLEM, kind: 'idea', text: '' };
  assert.equal(reportBody(idea), '### What do you want to do\n\n_No response_');
  assert.deepEqual(reportLabels(idea), ['enhancement']);
});

test('the form address fills the template fields', () => {
  const { url, shortened } = reportFormUrl(PROBLEM);
  assert.equal(new URL(url).origin + new URL(url).pathname, 'https://github.com/nexumia-de/tabularium/issues/new');
  assert.equal(shortened, false);
  assert.deepEqual(query(url), {
    template: 'bug.yml',
    title: 'Sync stops',
    what: 'It shows not-found.',
    version: '0.4.0',
    device: 'Desktop',
  });
  const idea = reportFormUrl({ ...PROBLEM, kind: 'idea', title: 'Two folders', text: 'Work and home' });
  assert.deepEqual(query(idea.url), { template: 'feature.yml', title: 'Two folders', problem: 'Work and home' });
});

test('a text too long for an address is shortened with a note', () => {
  const { url, shortened } = reportFormUrl({ ...PROBLEM, text: 'ä '.repeat(6000) });
  assert.ok(url.length <= REPORT_MAX_URL);
  assert.equal(shortened, true);
  assert.ok(query(url).what.endsWith('please paste the rest]'));
});

test('the issue forms have the fields the report fills in', () => {
  const form = (name) => readFileSync(new URL(`../.github/ISSUE_TEMPLATE/${name}`, import.meta.url), 'utf8');
  const bug = form('bug.yml');
  for (const id of ['what', 'steps', 'version', 'device', 'logs']) assert.match(bug, new RegExp(`id: ${id}\\n`));
  assert.match(bug, /- Desktop\n/);
  assert.match(bug, /- Phone \(Android\)\n/);
  assert.match(bug, /label: What happened\n/);
  const feature = form('feature.yml');
  for (const id of ['problem', 'idea']) assert.match(feature, new RegExp(`id: ${id}\\n`));
  assert.match(feature, /label: What do you want to do\n/);
});
