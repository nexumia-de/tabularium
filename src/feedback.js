// The plugin side of "Report a Problem" on Git Sync's page
// (docs/feedback.md): the report token, kept per device in secret storage
// (the page cannot reach it) and stored only after GitHub accepted it,
// and sending the report as an issue. Separate from the sync token, which
// may only write the user's own sync repository. Nothing of the report or
// the token goes into logs or snacks.

const REPORT_TOKEN_KEY = 'report-token';

async function feedbackToken() {
  try {
    return (await PluginAPI.getSecret(REPORT_TOKEN_KEY)) || '';
  } catch (e) {
    return '';
  }
}

// Messages from the page: `report-state`, `report-send` {report: {kind,
// title, text}, token}, `report-forget`. `version` is the plugin's.
async function feedbackMessage(message, version, api) {
  if (message.type === 'report-forget') {
    await PluginAPI.setSecret(REPORT_TOKEN_KEY, '');
    return { hasToken: false };
  }
  const saved = await feedbackToken();
  if (message.type !== 'report-send') return { hasToken: !!saved };
  const input = message.report || {};
  const report = {
    kind: input.kind === 'idea' ? 'idea' : 'problem',
    title: String(input.title || '').trim(),
    text: String(input.text || '').trim(),
    version,
    device: reportDevice(globalThis.navigator && globalThis.navigator.userAgent),
  };
  const token = saved || String(message.token || '').trim();
  if (!token) return { ok: false, code: 'no-token', hasToken: false };
  if (!report.title || !report.text) return { ok: false, code: 'incomplete', hasToken: !!saved };
  try {
    const issue = { title: report.title, body: reportBody(report), labels: reportLabels(report) };
    const url = await githubCreateIssue(token, REPORT_REPOSITORY, issue, api);
    if (!saved) await PluginAPI.setSecret(REPORT_TOKEN_KEY, token);
    return { ok: true, url, hasToken: true };
  } catch (error) {
    return { ok: false, code: (error && error.code) || 'failed', hasToken: !!saved };
  }
}
