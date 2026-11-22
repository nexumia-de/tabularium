// A stand-in for the parts of Super Productivity 20.0.0 that Git Sync uses
// (docs/super-productivity-facts.md), for the tests here and the
// end-to-end test in Day Planner's repository (tests/real_app):
//
// - executeNodeScript as electron/plugin-node-executor.ts does it: a script
//   that passes its check runs in a vm context with only fs, path and os
//   and a 5 s limit; any other would start a Node process, which this host
//   refuses the way the Flathub build fails ("spawn … ENOENT");
// - request as the plugin HTTP layer: fetch, JSON bodies, a non-2xx
//   answer rejects with `.status`;
// - per-device secrets, in memory or in a JSON file (`secretsFile`).
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// electron/plugin-node-executor.ts, canExecuteDirectly (v20.0.0).
export const DIRECT_SCRIPT_CHECK =
  /require\s*\(\s*['"`](?!fs|path|os)[^'"]+['"`]\s*\)|child_process|exec|spawn|eval|Function|process\.exit/;

export async function executeNodeScript(request) {
  if (DIRECT_SCRIPT_CHECK.test(request.script)) {
    return { success: false, error: 'Failed to execute script: spawn /app/superproductivity/superproductivity-bin ENOENT' };
  }
  const sandbox = {
    require: (name) => {
      if (name === 'fs') return fs;
      if (name === 'path') return path;
      if (name === 'os') return os;
      throw new Error(`Module '${name}' is not allowed`);
    },
    console,
    JSON,
    args: request.args || [],
    __result: undefined,
  };
  const wrapped = `(async function() { const result = await (async function() { ${request.script} })(); __result = result; })().catch(err => { throw err; });`;
  try {
    await vm.runInContext(wrapped, vm.createContext(sandbox), { timeout: 5000 });
    return { success: true, result: sandbox.__result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function request(url, options = {}) {
  const { method = 'GET', body, headers = {} } = options;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body == null ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body == null ? undefined : JSON.stringify(body),
      redirect: 'error',
    });
  } catch (error) {
    throw new Error(`[PluginHttp] request failed: ${error.message}`);
  }
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (response.status < 200 || response.status >= 300) {
    throw Object.assign(new Error(`[PluginHttp] Request failed with status ${response.status}`), {
      status: response.status,
      error: parsed,
    });
  }
  return parsed;
}

// A PluginAPI with the parts the engine and plugin.js use; `extra` adds or
// replaces members (hooks, triggerSync, timers are the caller's).
export function createHost({ secretsFile, extra = {} } = {}) {
  const read = () => (secretsFile && fs.existsSync(secretsFile) ? JSON.parse(fs.readFileSync(secretsFile, 'utf8')) : {});
  let secrets = read();
  const save = () => secretsFile && fs.writeFileSync(secretsFile, JSON.stringify(secrets));
  return {
    executeNodeScript,
    request,
    async getSecret(key) {
      return key in secrets ? secrets[key] : null;
    },
    async setSecret(key, value) {
      secrets = { ...secrets, [key]: value };
      save();
    },
    secrets: () => secrets,
    ...extra,
  };
}
