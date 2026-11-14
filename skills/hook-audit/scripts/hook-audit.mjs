#!/usr/bin/env node
// hook-audit: inventory and clean up Claude Code / Codex hooks.
// Zero dependencies. Node >= 18.
//
//   node hook-audit.mjs scan   [--json] [--project DIR] [--check-network]
//   node hook-audit.mjs remove --id ID [--id ID ...] [--yes] [--project DIR]
//
// Read-only unless `remove --yes` is given. Every edit writes a timestamped backup first.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------- options

export function parseArgs(argv) {
  const opts = { cmd: argv[0] || 'scan', ids: [], json: false, yes: false, checkNetwork: false, project: process.cwd(), home: os.homedir() };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--yes') opts.yes = true;
    else if (a === '--check-network') opts.checkNetwork = true;
    else if (a === '--project') opts.project = path.resolve(argv[++i]);
    else if (a === '--home') opts.home = path.resolve(argv[++i]);
    else if (a === '--id') opts.ids.push(argv[++i]);
    else if (a === '-h' || a === '--help') opts.cmd = 'help';
    else throw new Error(`Unknown option: ${a}`);
  }
  opts.claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(opts.home, '.claude');
  opts.codexHome = process.env.CODEX_HOME || path.join(opts.home, '.codex');
  return opts;
}

// ---------------------------------------------------------------- helpers

const readText = (p, max = 1_000_000) => {
  try {
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > max) return null;
    return fs.readFileSync(p, 'utf8');
  } catch { return null; }
};
const readJson = (p) => {
  const t = readText(p, 5_000_000);
  if (t == null) return null;
  try { return JSON.parse(t); } catch { return { __parseError: true }; }
};
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const shortHash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);

function managedSettingsPaths() {
  if (process.platform === 'win32') return ['C:\\ProgramData\\ClaudeCode\\managed-settings.json', 'C:\\Program Files\\ClaudeCode\\managed-settings.json'];
  if (process.platform === 'darwin') return ['/Library/Application Support/ClaudeCode/managed-settings.json'];
  return ['/etc/claude-code/managed-settings.json'];
}

// ---------------------------------------------------------------- discovery

/** A hook "entry" is one runnable thing: a command, an http url, or a statusLine command. */
function entriesFromHooksObject(hooksObj, base) {
  const out = [];
  if (!hooksObj || typeof hooksObj !== 'object') return out;
  for (const [event, groups] of Object.entries(hooksObj)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((group, gi) => {
      const list = Array.isArray(group?.hooks) ? group.hooks : [];
      list.forEach((h, hi) => {
        if (!h || typeof h !== 'object') return;
        out.push({
          ...base,
          event,
          matcher: group.matcher ?? null,
          type: h.type || 'command',
          command: h.command || null,
          url: h.url || null,
          locator: { kind: 'hooks', event, gi, hi },
        });
      });
    });
  }
  return out;
}

function fromSettingsFile(file, agent, scope, extra = {}) {
  const json = readJson(file);
  if (!json) return { entries: [], error: null };
  if (json.__parseError) return { entries: [], error: `Could not parse ${file}` };
  const base = { agent, scope, source: file, editable: scope !== 'managed' && scope !== 'plugin', ...extra };
  const entries = entriesFromHooksObject(json.hooks, base);
  if (json.statusLine?.command) {
    entries.push({ ...base, event: 'statusLine', matcher: null, type: 'command', command: json.statusLine.command, url: null, locator: { kind: 'statusLine' } });
  }
  return { entries, error: null };
}

function claudePlugins(opts) {
  const results = [];
  const userSettings = readJson(path.join(opts.claudeHome, 'settings.json')) || {};
  const enabled = userSettings.enabledPlugins || {};
  const installed = readJson(path.join(opts.claudeHome, 'plugins', 'installed_plugins.json'));
  const seen = new Set();
  const add = (name, installPath) => {
    if (!installPath || seen.has(installPath)) return;
    seen.add(installPath);
    const isEnabled = name in enabled ? enabled[name] === true : null;
    const hookFile = path.join(installPath, 'hooks', 'hooks.json');
    if (exists(hookFile)) {
      const j = readJson(hookFile);
      if (j && !j.__parseError) results.push(...entriesFromHooksObject(j.hooks || j, { agent: 'claude', scope: 'plugin', plugin: name, pluginEnabled: isEnabled, pluginRoot: installPath, source: hookFile, editable: false }));
    }
    const manifest = readJson(path.join(installPath, '.claude-plugin', 'plugin.json'));
    if (manifest && manifest.hooks && typeof manifest.hooks === 'object') {
      results.push(...entriesFromHooksObject(manifest.hooks.hooks || manifest.hooks, { agent: 'claude', scope: 'plugin', plugin: name, pluginEnabled: isEnabled, pluginRoot: installPath, source: path.join(installPath, '.claude-plugin', 'plugin.json'), editable: false }));
    }
  };
  if (installed && installed.plugins) {
    for (const [name, val] of Object.entries(installed.plugins)) {
      const recs = Array.isArray(val) ? val : [val];
      for (const r of recs) add(name, r?.installPath);
    }
  }
  return results;
}

function parseTomlNotify(text) {
  // notify = ["node", "C:\\path\\x.js"]  (possibly multi-line)
  const m = text.match(/^\s*notify\s*=\s*\[([\s\S]*?)\]/m);
  if (!m) return null;
  const parts = [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((x) => (x[1] !== undefined ? x[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"') : x[2]));
  return { command: parts.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' '), raw: m[0] };
}

function codexSources(opts) {
  const entries = [];
  const errors = [];
  for (const [file, scope] of [[path.join(opts.codexHome, 'hooks.json'), 'user'], [path.join(opts.project, '.codex', 'hooks.json'), 'project']]) {
    const j = readJson(file);
    if (!j) continue;
    if (j.__parseError) { errors.push(`Could not parse ${file}`); continue; }
    entries.push(...entriesFromHooksObject(j.hooks || j, { agent: 'codex', scope, source: file, editable: true }));
  }
  for (const [file, scope] of [[path.join(opts.codexHome, 'config.toml'), 'user'], [path.join(opts.project, '.codex', 'config.toml'), 'project']]) {
    const text = readText(file);
    if (!text) continue;
    const n = parseTomlNotify(text);
    if (n) entries.push({ agent: 'codex', scope, source: file, editable: true, event: 'notify', matcher: null, type: 'command', command: n.command, url: null, locator: { kind: 'toml-notify' } });
    // Inline [hooks.*] tables: list commands, but leave editing to a human.
    let inHooks = false;
    let lastEvent = null;
    for (const line of text.split(/\r?\n/)) {
      const sec = line.match(/^\s*\[\[?\s*hooks(?:\.([A-Za-z]+))?/);
      if (sec) { inHooks = true; lastEvent = sec[1] || lastEvent || 'hooks'; continue; }
      if (/^\s*\[/.test(line)) { inHooks = false; continue; }
      const c = inHooks && line.match(/^\s*command\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/);
      if (c) entries.push({ agent: 'codex', scope, source: file, editable: false, event: lastEvent, matcher: null, type: 'command', command: (c[1] ?? c[2]).replace(/\\\\/g, '\\'), url: null, locator: { kind: 'toml-inline' } });
    }
  }
  // Codex plugin hooks
  const pluginRoot = path.join(opts.codexHome, 'plugins');
  for (const file of findFiles(pluginRoot, (p) => p.endsWith(path.join('hooks', 'hooks.json')), 6)) {
    const j = readJson(file);
    if (j && !j.__parseError) entries.push(...entriesFromHooksObject(j.hooks || j, { agent: 'codex', scope: 'plugin', plugin: path.basename(path.dirname(path.dirname(file))), pluginRoot: path.dirname(path.dirname(file)), source: file, editable: false }));
  }
  return { entries, errors };
}

function findFiles(root, pred, depth) {
  const out = [];
  const walk = (dir, d) => {
    if (d < 0) return;
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (it.name === 'node_modules' || it.name === '.git') continue;
      const p = path.join(dir, it.name);
      if (it.isDirectory()) walk(p, d - 1);
      else if (pred(p)) out.push(p);
    }
  };
  walk(root, depth);
  return out;
}

export function discover(opts) {
  const entries = [];
  const errors = [];
  const push = (r) => { entries.push(...r.entries); if (r.error) errors.push(r.error); };
  push(fromSettingsFile(path.join(opts.claudeHome, 'settings.json'), 'claude', 'user'));
  push(fromSettingsFile(path.join(opts.claudeHome, 'settings.local.json'), 'claude', 'user-local'));
  if (path.resolve(opts.project) !== path.resolve(opts.home)) {
    push(fromSettingsFile(path.join(opts.project, '.claude', 'settings.json'), 'claude', 'project'));
    push(fromSettingsFile(path.join(opts.project, '.claude', 'settings.local.json'), 'claude', 'project-local'));
  }
  for (const f of managedSettingsPaths()) push(fromSettingsFile(f, 'claude', 'managed'));
  entries.push(...claudePlugins(opts));
  const cx = codexSources(opts);
  entries.push(...cx.entries);
  errors.push(...cx.errors);
  for (const e of entries) e.id = 'h-' + shortHash([e.source, e.event, e.locator.kind, e.command || e.url || ''].join('|'));
  return { entries, errors };
}

// ---------------------------------------------------------------- analysis

const SCRIPT_EXT = /\.(m?js|cjs|ts|py|sh|bash|zsh|ps1|rb|pl|bat|cmd|vbs|exe)$/i;

export function tokenize(cmd) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(cmd))) out.push(m[1] !== undefined ? m[1].replace(/\\"/g, '"') : m[2] !== undefined ? m[2] : m[3]);
  return out;
}

function expandPath(tok, ctx) {
  let t = tok;
  const vars = { HOME: ctx.home, USERPROFILE: ctx.home, CLAUDE_PLUGIN_ROOT: ctx.pluginRoot || '', CLAUDE_PROJECT_DIR: ctx.project, CODEX_HOME: ctx.codexHome };
  t = t.replace(/^~(?=[\\/]|$)/, ctx.home);
  t = t.replace(/\$\{(\w+)\}|\$(\w+)|%(\w+)%/g, (all, a, b, c) => {
    const k = a || b || c;
    return vars[k] ?? process.env[k] ?? all;
  });
  // Git-Bash style /c/Users/... on Windows
  if (process.platform === 'win32' && /^\/[a-zA-Z]\//.test(t)) t = `${t[1]}:${t.slice(2)}`;
  return t;
}

const URL_RE = /\bhttps?:\/\/[^\s'"`<>)\]}\\,;]+/g;
const IGNORE_HOSTS = /(^|\.)(localhost|127\.0\.0\.1|0\.0\.0\.0|example\.(com|org)|schema(s)?\.\w+|json-schema\.org|w3\.org|nodejs\.org|github\.com\/[^/]+\/[^/]+\/(issues|blob)|mozilla\.org|opensource\.org|apache\.org)$/i;

export const SHARED_HOST_SUFFIXES = [
  'up.railway.app', 'railway.app', 'herokuapp.com', 'vercel.app', 'netlify.app', 'onrender.com', 'fly.dev',
  'pages.dev', 'workers.dev', 'ngrok-free.app', 'ngrok.io', 'ngrok.app', 'github.io', 'glitch.me', 'repl.co',
  'replit.app', 'replit.dev', 'trycloudflare.com', 'loca.lt', 'azurewebsites.net', 'web.app', 'firebaseapp.com',
  'appspot.com', 'deno.dev', 'supabase.co', 'run.app', 'koyeb.app', 'zeabur.app', 'surge.sh',
];

export const TRUSTED_HOSTS = [
  'github.com', 'api.github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com', 'registry.npmjs.org',
  'www.npmjs.com', 'pypi.org', 'files.pythonhosted.org', 'anthropic.com', 'api.anthropic.com', 'docs.anthropic.com',
  'code.claude.com', 'docs.claude.com', 'claude.ai', 'openai.com', 'api.openai.com', 'developers.openai.com',
];
export const isTrustedHost = (host) => TRUSTED_HOSTS.includes(host);
export const isSharedHost = (host) => SHARED_HOST_SUFFIXES.some((s) => host === s || host.endsWith('.' + s));

function extractUrls(text) {
  const hosts = new Map();
  for (const m of text.matchAll(URL_RE)) {
    let u;
    try { u = new URL(m[0]); } catch { continue; }
    const h = u.hostname.toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) || IGNORE_HOSTS.test(h)) continue;
    if (!hosts.has(h)) hosts.set(h, `${u.protocol}//${u.host}`);
  }
  return hosts;
}

const SIGNALS = [
  ['network', /require\(['"]https?['"]\)|from ['"]node:https?['"]|\bfetch\(|axios|\bcurl\b|\bwget\b|Invoke-WebRequest|Invoke-RestMethod|\brequests\.(get|post)|urllib|http\.client|XMLHttpRequest|\bnc\s+-/i],
  ['remote-code', /(writeFileSync|writeFile)\(\s*(__filename|currentPath|selfPath|scriptPath)|\|\s*(ba|z)?sh\b|Invoke-Expression|\biex\b\s*\(|\beval\(\s*(await\s+)?(body|res|data|response)|new Function\(/i],
  ['reads-transcript', /transcript_path|transcriptPath/],
  ['credentials', /\b(api[_-]?key|token|authorization|bearer|secret|password)\b/i],
  ['edits-agent-settings', /settings\.json|config\.toml|hooks\.json/i],
];

function envUrlRefs(text) {
  const found = new Map();
  const re = /process\.env\.(\w+)|process\.env\[['"](\w+)['"]\]|\$env:(\w+)|os\.environ(?:\.get)?\(?\[?['"](\w+)['"]|os\.getenv\(['"](\w+)['"]|\$\{?([A-Z][A-Z0-9_]*)\}?/g;
  for (const m of text.matchAll(re)) {
    const name = m.slice(1).find(Boolean);
    if (!name || !/URL|ENDPOINT|HOST|BASE|SERVER|API/i.test(name)) continue;
    const val = process.env[name];
    if (val && /^https?:\/\//i.test(val)) found.set(name, val);
  }
  return found;
}

function credentialFilesNear(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => /^(token|\.?env|credentials?|secret|auth|api[_-]?key)(\.\w+)?$/i.test(n)).map((n) => path.join(dir, n));
  } catch { return []; }
}

export function analyze(entry, opts) {
  const ctx = { home: opts.home, project: opts.project, codexHome: opts.codexHome, pluginRoot: entry.pluginRoot };
  const result = { scripts: [], missing: [], hosts: {}, envUrls: {}, signals: [], credentialFiles: [] };
  const corpus = [];
  if (entry.url) corpus.push(entry.url);
  if (entry.command) {
    corpus.push(entry.command);
    for (const tok of tokenize(entry.command)) {
      const p = expandPath(tok, ctx);
      const looksLikePath = SCRIPT_EXT.test(p) || /[\\/]/.test(p);
      if (!looksLikePath || /^https?:/i.test(p) || /^-/.test(p)) continue;
      if (exists(p)) {
        if (!fs.statSync(p).isFile()) continue;
        result.scripts.push(p);
        const t = readText(p);
        if (t) corpus.push(t);
        // small sibling config files often hold the real endpoint (e.g. an "api_url" file)
        const dir = path.dirname(p);
        const isAgentHome = [opts.claudeHome, opts.codexHome, opts.home].some((h) => path.resolve(dir) === path.resolve(h));
        if (!isAgentHome) {
          try {
            for (const n of fs.readdirSync(dir).slice(0, 40)) {
              const sp = path.join(dir, n);
              if (sp === p || !/^(\w|-)+(\.(txt|json|conf|cfg|url))?$/i.test(n)) continue;
              const st = fs.statSync(sp);
              if (st.isFile() && st.size < 4096) { const s = readText(sp); if (s) corpus.push(s); }
            }
          } catch {}
          result.credentialFiles.push(...credentialFilesNear(dir));
        }
      } else if (SCRIPT_EXT.test(p) && /[\\/]/.test(p)) {
        result.missing.push(p);
      }
    }
  }
  const all = corpus.join('\n');
  for (const [h, origin] of extractUrls(all)) result.hosts[h] = origin;
  for (const [k, v] of envUrlRefs(all)) {
    result.envUrls[k] = v;
    try { const u = new URL(v); result.hosts[u.hostname.toLowerCase()] = `${u.protocol}//${u.host}`; } catch {}
  }
  if (entry.type === 'http') result.signals.push('network');
  for (const [name, re] of SIGNALS) if (re.test(all) && !result.signals.includes(name)) result.signals.push(name);
  return result;
}

// ---------------------------------------------------------------- network probe

export function classifyResponse({ status, headers = {}, body = '' }) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const b = body.slice(0, 8192);
  const fp = [
    [/Application not found/i.test(b) || h['x-railway-fallback'] === 'true', 'Railway: application not found'],
    [/no-such-app|There's nothing here, yet|no such app/i.test(b), 'Heroku: no such app'],
    [/DEPLOYMENT_NOT_FOUND|NOT_FOUND/.test(h['x-vercel-error'] || '') || /DEPLOYMENT_NOT_FOUND/.test(b), 'Vercel: deployment not found'],
    [/Not Found - Request ID/i.test(b) && /netlify/i.test(h.server || ''), 'Netlify: site not found'],
    [h['x-render-routing'] === 'no-server', 'Render: no server'],
    [/There isn't a GitHub Pages site here/i.test(b), 'GitHub Pages: no site'],
    [/ERR_NGROK_\d+/.test(b), 'ngrok: tunnel offline'],
    [/NoSuchBucket/.test(b), 'S3: no such bucket'],
    [/project (is )?(paused|not found)/i.test(b) && /supabase/i.test(b), 'Supabase: project paused/missing'],
  ];
  const hit = fp.find(([cond]) => cond);
  if (hit) return { state: 'dangling', detail: hit[1] };
  if (status >= 500) return { state: 'erroring', detail: `HTTP ${status}` };
  return { state: 'alive', detail: `HTTP ${status}` };
}

function probeOrigin(origin, timeoutMs = 6000) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(origin); } catch { return resolve({ state: 'invalid', detail: 'bad url' }); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'GET', timeout: timeoutMs, headers: { 'user-agent': 'hook-audit/1.0' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 8192) body += c; });
      res.on('end', () => resolve(classifyResponse({ status: res.statusCode, headers: res.headers, body })));
      res.on('error', () => resolve({ state: 'unreachable', detail: 'read error' }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ state: 'unreachable', detail: 'timeout' }); });
    req.on('error', (e) => resolve({ state: 'unreachable', detail: e.code || e.message }));
    req.end();
  });
}

async function probeHost(host, origin) {
  try { await dns.lookup(host); } catch (e) { return { state: 'dead', detail: `DNS ${e.code || 'failure'}` }; }
  return probeOrigin(origin);
}

// ---------------------------------------------------------------- risk

export function assess(entry, a, probes) {
  const reasons = [];
  let level = 'info';
  const bump = (l) => { const order = ['info', 'low', 'medium', 'high', 'critical']; if (order.indexOf(l) > order.indexOf(level)) level = l; };
  const external = Object.keys(a.hosts).filter((h) => !isTrustedHost(h));
  const talks = a.signals.includes('network');

  for (const h of external) {
    const p = probes?.[h];
    const shared = isSharedHost(h);
    if (p && (p.state === 'dead' || p.state === 'dangling')) {
      reasons.push(`${h} looks abandoned (${p.detail})${shared ? ' on a shared hosting domain anyone can re-register' : ''}`);
      bump(shared || a.signals.includes('remote-code') ? 'critical' : 'high');
    } else if (p && p.state === 'unreachable') {
      reasons.push(`${h} did not answer (${p.detail})`);
      bump('medium');
    } else if (shared) {
      reasons.push(`${h} is a free-tier subdomain; if the owner deletes the app, someone else can claim the name`);
      bump('low');
    }
  }
  if (a.signals.includes('remote-code')) { reasons.push('script can download or rewrite code it then runs (self-update, pipe-to-shell, eval)'); bump(talks ? 'high' : 'medium'); }
  if (a.signals.includes('edits-agent-settings') && talks && external.length) { reasons.push('script touches agent settings files and talks to the network'); bump('medium'); }
  if (talks && external.length && a.signals.includes('reads-transcript')) { reasons.push(`reads session transcripts and can send data to ${external.join(', ')}`); bump('medium'); }
  else if (talks && external.length) { reasons.push(`sends data to ${external.join(', ')}`); bump('low'); }
  if (a.missing.length) { reasons.push(`referenced file is missing: ${a.missing.join(', ')}`); bump('medium'); }
  if (a.credentialFiles.length) reasons.push(`credential-like files next to the script: ${a.credentialFiles.map((f) => path.basename(f)).join(', ')}`);
  if (entry.scope === 'plugin' && entry.pluginEnabled === false) { reasons.push('plugin is disabled, so this hook does not run'); level = 'info'; }
  return { level, reasons };
}

// ---------------------------------------------------------------- scan

export async function scan(opts) {
  const { entries, errors } = discover(opts);
  const analyzed = entries.map((e) => ({ entry: e, a: analyze(e, opts) }));
  let probes = null;
  if (opts.checkNetwork) {
    probes = {};
    const hosts = new Map();
    for (const { a } of analyzed) for (const [h, o] of Object.entries(a.hosts)) hosts.set(h, o);
    await Promise.all([...hosts].map(async ([h, o]) => { probes[h] = await probeHost(h, o); }));
  }
  const items = analyzed.map(({ entry, a }) => ({ ...entry, analysis: a, risk: assess(entry, a, probes) }));
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  items.sort((x, y) => order[x.risk.level] - order[y.risk.level]);
  return { generatedAt: new Date().toISOString(), networkChecked: !!opts.checkNetwork, probes, errors, items };
}

function renderMarkdown(report) {
  const L = [];
  const counts = report.items.reduce((m, i) => ((m[i.risk.level] = (m[i.risk.level] || 0) + 1), m), {});
  L.push(`# Hook audit`);
  L.push('');
  L.push(`Found ${report.items.length} hook entries. ` + ['critical', 'high', 'medium', 'low', 'info'].filter((k) => counts[k]).map((k) => `${k}: ${counts[k]}`).join(', '));
  if (!report.networkChecked) L.push('', '_Network not checked. Re-run with `--check-network` to test whether endpoints are still alive._');
  for (const e of report.errors) L.push('', `> warning: ${e}`);
  for (const i of report.items) {
    L.push('', `## [${i.risk.level.toUpperCase()}] ${i.id}  ${i.agent} / ${i.scope}${i.plugin ? ` / plugin ${i.plugin}` : ''} / ${i.event}${i.matcher ? ` (${i.matcher})` : ''}`);
    L.push(`- source: \`${i.source}\``);
    if (i.command) L.push(`- command: \`${i.command}\``);
    if (i.url) L.push(`- url: \`${i.url}\``);
    const hosts = Object.keys(i.analysis.hosts);
    if (hosts.length) L.push(`- endpoints: ${hosts.map((h) => (report.probes?.[h] ? `${h} (${report.probes[h].state}: ${report.probes[h].detail})` : h)).join(', ')}`);
    if (i.analysis.signals.length) L.push(`- signals: ${i.analysis.signals.join(', ')}`);
    for (const r of i.risk.reasons) L.push(`- ${r}`);
    if (!i.editable) L.push(`- removal: ${i.scope === 'plugin' ? 'disable or uninstall the plugin instead of editing its files' : i.scope === 'managed' ? 'managed by an administrator; ask them' : 'edit this file by hand'}`);
  }
  return L.join('\n');
}

// ---------------------------------------------------------------- remove

function stamp() { return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14); }

export function removeEntries(opts) {
  const { entries } = discover(opts);
  const chosen = entries.filter((e) => opts.ids.includes(e.id));
  const unknown = opts.ids.filter((id) => !chosen.some((e) => e.id === id));
  const plan = [];
  for (const e of chosen) if (!e.editable) plan.push({ id: e.id, skipped: `not editable (${e.scope}); ${e.scope === 'plugin' ? `disable plugin ${e.plugin}` : 'edit by hand'}` });
  const byFile = new Map();
  for (const e of chosen.filter((x) => x.editable)) byFile.set(e.source, [...(byFile.get(e.source) || []), e]);

  for (const [file, list] of byFile) {
    const original = fs.readFileSync(file, 'utf8');
    let next;
    if (file.endsWith('.toml')) {
      next = original.replace(/^(\s*notify\s*=\s*\[[\s\S]*?\])/m, (m) => m.split(/\r?\n/).map((l) => `# disabled by hook-audit ${stamp()}: ${l}`).join('\n'));
    } else {
      const json = JSON.parse(original);
      // delete from the highest index down so earlier indices stay valid
      const hooksLoc = list.filter((e) => e.locator.kind === 'hooks').sort((a, b) => b.locator.gi - a.locator.gi || b.locator.hi - a.locator.hi);
      const root = json.hooks && typeof json.hooks === 'object' ? json.hooks : json;
      for (const e of hooksLoc) {
        const groups = root[e.locator.event];
        groups?.[e.locator.gi]?.hooks?.splice(e.locator.hi, 1);
      }
      for (const ev of Object.keys(root)) {
        if (!Array.isArray(root[ev])) continue;
        root[ev] = root[ev].filter((g) => !Array.isArray(g?.hooks) || g.hooks.length > 0);
        if (root[ev].length === 0) delete root[ev];
      }
      if (json.hooks && Object.keys(json.hooks).length === 0) delete json.hooks;
      if (list.some((e) => e.locator.kind === 'statusLine')) delete json.statusLine;
      const eol = original.includes('\r\n') ? '\r\n' : '\n';
      next = JSON.stringify(json, null, 2).replace(/\n/g, eol) + (original.endsWith('\n') ? eol : '');
    }
    const backup = `${file}.hook-audit-${stamp()}.bak`;
    if (opts.yes) {
      fs.writeFileSync(backup, original);
      fs.writeFileSync(file, next);
    }
    for (const e of list) plan.push({ id: e.id, file, backup: opts.yes ? backup : null, applied: !!opts.yes, command: e.command || e.url });
  }
  return { applied: !!opts.yes, plan, unknown };
}

// ---------------------------------------------------------------- main

const HELP = `hook-audit: inventory and clean up Claude Code / Codex hooks

  scan   [--json] [--check-network] [--project DIR]
  remove --id ID [--id ID ...] [--yes] [--project DIR]

remove is a dry run unless --yes is given; it always writes a .bak first.`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.cmd === 'help') return console.log(HELP);
  if (opts.cmd === 'scan') {
    const report = await scan(opts);
    console.log(opts.json ? JSON.stringify(report, null, 2) : renderMarkdown(report));
    return;
  }
  if (opts.cmd === 'remove') {
    if (!opts.ids.length) throw new Error('remove needs at least one --id (get ids from `scan`)');
    const r = removeEntries(opts);
    console.log(JSON.stringify(r, null, 2));
    if (!r.applied) console.error('\nDry run. Re-run with --yes to apply.');
    return;
  }
  throw new Error(`Unknown command: ${opts.cmd}\n\n${HELP}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
