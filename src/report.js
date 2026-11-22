// What a problem report says (docs/feedback.md): the GitHub issue body,
// or the address of GitHub's new-issue form filled in. Follows the issue
// forms in .github/ISSUE_TEMPLATE (bug.yml, feature.yml), so a report
// reads the same whichever way it was sent. Only what the user typed, the
// plugin version and the kind of device. Pure: the build puts it into
// plugin.js and into the page (index.html).

const REPORT_REPOSITORY = 'nexumia-de/tabularium';
// GitHub serves addresses up to about 8 KiB; stay well below.
const REPORT_MAX_URL = 7000;
const REPORT_CUT = '\n\n[…shortened, please paste the rest]';
const REPORT_DESKTOP = 'Desktop';
const REPORT_ANDROID = 'Phone (Android)';

// field: the form field id that takes the user's text; heading: its label,
// the heading GitHub renders; details: the form has version and device.
const REPORT_KINDS = {
  problem: { template: 'bug.yml', label: 'bug', field: 'what', heading: 'What happened', details: true },
  idea: { template: 'feature.yml', label: 'enhancement', field: 'problem', heading: 'What do you want to do', details: false },
};

// An option of the form's `device` field. Super Productivity's window does
// not tell a Phosh phone from a desktop; Android says so in its user agent.
function reportDevice(userAgent) {
  return /Android/i.test(String(userAgent || '')) ? REPORT_ANDROID : REPORT_DESKTOP;
}

function reportKind(report) {
  return REPORT_KINDS[report && report.kind] || REPORT_KINDS.problem;
}

// Markdown like GitHub renders the issue form: one `###` section per field.
function reportBody(report) {
  const kind = reportKind(report);
  const sections = [[kind.heading, String(report.text || '').trim()]];
  if (kind.details) sections.push(['Version', report.version], ['Device', report.device]);
  return sections.map(([heading, value]) => `### ${heading}\n\n${value || '_No response_'}`).join('\n\n');
}

function reportLabels(report) {
  return [reportKind(report).label];
}

// The form for the report's kind, filled in. Text that would make the
// address too long is shortened with a note (`shortened`); the page puts
// the full text on the clipboard.
function reportFormUrl(report, repository) {
  const kind = reportKind(report);
  const full = String(report.text || '').trim();
  let text = full;
  for (;;) {
    const fields = { template: kind.template, title: String(report.title || '').trim(), [kind.field]: text };
    if (kind.details) Object.assign(fields, { version: report.version, device: report.device });
    const url = `https://github.com/${repository || REPORT_REPOSITORY}/issues/new?${new URLSearchParams(fields)}`;
    if (url.length <= REPORT_MAX_URL || !text) return { url, shortened: text !== full };
    const chars = Array.from(text); // whole characters, as Python's slicing in phosh-toolkit
    const keep = Math.max(0, chars.length - Math.floor((url.length - REPORT_MAX_URL) / 3) - REPORT_CUT.length);
    text = keep ? chars.slice(0, keep).join('').trimEnd() + REPORT_CUT : '';
  }
}
