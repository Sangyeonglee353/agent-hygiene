#!/usr/bin/env node
// permission-checker: find risky permission settings in Claude Code and Codex configs.
// Read-only. Never prints secret values: a token-like string is reported by its kind only.
//
// Usage:
//   node permission-checker.mjs [--json] [--project DIR] [--home DIR]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseArgs(argv) {
  const opts = { json: false, project: process.cwd(), home: os.homedir() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--project' && i + 1 < argv.length) opts.project = path.resolve(argv[++i]);
    else if (a === '--home' && i + 1 < argv.length) opts.home = path.resolve(argv[++i]);
    else if (a === '-h' || a === '--help') opts.help = true;
  }
  opts.codexHome = process.env.CODEX_HOME && !argv.includes('--home') ? process.env.CODEX_HOME : path.join(opts.home, '.codex');
  return opts;
}

// Token-like patterns. Only the label is ever printed.
const TOKEN_PATTERNS = [
  [/\bsk-(ant-|proj-)?[A-Za-z0-9_-]{20,}/, 'API key (sk-...)'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/, 'GitHub token'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i, 'Bearer token'],
  [/\b(api[_-]?key|token|secret|password|passwd)\s*[=:]\s*['"]?[^\s'"$]{12,}/i, 'credential assignment'],
];

export function findToken(text) {
  for (const [re, label] of TOKEN_PATTERNS) if (re.test(String(text))) return label;
  return null;
}

const SECRET_KEY_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE)/i;

// Allow rules that hand the agent far more than they look like.
const BROAD_ALLOW = [
  [/^Bash$|^Bash\(\s*\*?\s*\)$|^Bash\(\s*:?\*\s*\)$/, 'high', 'allows every shell command without asking'],
  [/^Bash\((sudo|su|doas)\b/, 'high', 'allows commands as administrator without asking'],
  [/^Bash\((rm|del|rmdir|Remove-Item)\b[^)]*\*/, 'high', 'allows deleting files without asking'],
  [/^Bash\((curl|wget|Invoke-WebRequest|iwr|nc|ncat|scp|rsync)\b[^)]*\*/, 'medium', 'allows sending data to any server without asking'],
  [/^Bash\((bash|sh|zsh|pwsh|powershell|cmd|node|python3?|deno|bun|npx|eval)\b[^)]*\*/, 'medium', 'allows running any script or code through an interpreter without asking'],
  [/^Bash\(git push\b[^)]*\*/, 'medium', 'allows pushing to any remote, including force pushes, without asking'],
  [/^(Edit|Write)$|^(Edit|Write)\(\s*(\*\*|\/\*\*|~\/\*\*|\/\/\*\*)\s*\)$/, 'medium', 'allows editing any file without asking'],
  [/^mcp__\*$|^mcp__[^_]+__\*$/, 'low', 'allows every tool of an MCP server without asking'],
  [/^WebFetch$/, 'low', 'allows fetching any URL without asking'],
];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function tilde(file, home) {
  return file.startsWith(home) ? '~' + file.slice(home.length).replace(/\\/g, '/') : file.replace(/\\/g, '/');
}

function claudeFiles(opts) {
  return [
    ['user', path.join(opts.home, '.claude', 'settings.json')],
    ['user-local', path.join(opts.home, '.claude', 'settings.local.json')],
    ['project', path.join(opts.project, '.claude', 'settings.json')],
    ['project-local', path.join(opts.project, '.claude', 'settings.local.json')],
  ].filter(([, f], i, all) => fs.existsSync(f) && all.findIndex(([, g]) => path.resolve(g) === path.resolve(f)) === i);
}

export function checkClaude(settings, where) {
  const out = [];
  const add = (severity, rule, detail) => out.push({ agent: 'claude', where, severity, rule, detail });
  const perms = settings?.permissions || {};

  if (perms.defaultMode === 'bypassPermissions') add('high', 'permissions.defaultMode = bypassPermissions', 'every tool call runs without asking, in every session');
  if (settings?.skipDangerousModePermissionPrompt === true) add('medium', 'skipDangerousModePermissionPrompt = true', 'bypass mode starts without its warning');

  for (const rule of Array.isArray(perms.allow) ? perms.allow : []) {
    const token = findToken(rule);
    if (token) {
      add('high', `allow rule containing a ${token}`, 'a secret was saved into the permission list in plain text; remove the rule and rotate the key');
      continue;
    }
    for (const [re, severity, why] of BROAD_ALLOW) {
      if (re.test(String(rule).trim())) {
        add(severity, `allow ${rule}`, why);
        break;
      }
    }
  }

  for (const dir of Array.isArray(perms.additionalDirectories) ? perms.additionalDirectories : []) {
    const d = String(dir).replace(/\\/g, '/').replace(/\/+$/, '');
    if (d === '' || d === '/' || d === '~' || /^[A-Za-z]:$/.test(d)) add('medium', `additionalDirectories ${dir}`, 'gives the agent a whole drive or home folder');
  }

  const env = settings?.env && typeof settings.env === 'object' ? settings.env : {};
  for (const [name, value] of Object.entries(env)) {
    if (SECRET_KEY_NAME.test(name) || findToken(value)) add('medium', `env.${name}`, 'a secret is stored in plain text in a settings file (value not shown); prefer the OS keychain or a shell profile outside synced folders');
  }
  return out;
}

export function denyCoversEnv(allSettings) {
  return allSettings.some((s) => (s?.permissions?.deny || []).some((r) => /^Read\([^)]*\.env/.test(String(r))));
}

// A TOML value without its quotes; a trailing comment is dropped only outside quotes.
function tomlValue(raw) {
  const v = raw.trim();
  const q = v[0];
  if (q === '"' || q === "'") {
    const end = v.indexOf(q, 1);
    if (end > 0) return v.slice(1, end);
  }
  return v.replace(/\s*#.*$/, '').trim();
}

// Minimal TOML reading: top-level keys and [profiles.<name>] keys.
export function parseCodexToml(text) {
  const sections = { '': {} };
  let current = '';
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(/^\[([^\]]+)\]\s*(#.*)?$/);
    if (header) {
      current = header[1].trim();
      sections[current] = sections[current] || {};
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (kv) sections[current][kv[1]] = tomlValue(kv[2]);
  }
  return sections;
}

export function checkCodex(text, where) {
  const out = [];
  const sections = parseCodexToml(text);
  for (const [name, keys] of Object.entries(sections)) {
    if (name !== '' && !name.startsWith('profiles.')) continue;
    const label = name === '' ? where : `${where} [${name}]`;
    const add = (severity, rule, detail) => out.push({ agent: 'codex', where: label, severity, rule, detail });
    const never = keys.approval_policy === 'never';
    const full = keys.sandbox_mode === 'danger-full-access';
    if (never && full) add('high', 'approval_policy = never + sandbox_mode = danger-full-access', 'every command runs with full disk and network access and never asks');
    else if (full) add('medium', 'sandbox_mode = danger-full-access', 'commands run outside the sandbox');
    else if (never) add('low', 'approval_policy = never', 'commands never ask; the sandbox is the only limit');
  }
  const sww = sections.sandbox_workspace_write || {};
  if (sww.network_access === 'true') out.push({ agent: 'codex', where, severity: 'low', rule: 'sandbox_workspace_write.network_access = true', detail: 'sandboxed commands can reach the network' });
  for (const [name, keys] of Object.entries(sections)) {
    for (const [k, v] of Object.entries(keys)) {
      const looksLikeVarName = /^[A-Z][A-Z0-9_]*$/.test(v) || (/^[a-z][a-z0-9_]*$/.test(v) && v.includes('_'));
      if ((SECRET_KEY_NAME.test(k) && !looksLikeVarName && /^[^${]/.test(v) && v.length >= 12) || findToken(v)) {
        out.push({ agent: 'codex', where: name ? `${where} [${name}]` : where, severity: 'medium', rule: `${k}`, detail: 'a secret is stored in plain text in config.toml (value not shown)' });
      }
    }
  }
  return out;
}

const ORDER = { high: 0, medium: 1, low: 2, info: 3 };

export function scan(opts) {
  const findings = [];
  const files = claudeFiles(opts);
  const parsed = [];
  for (const [scope, file] of files) {
    const s = readJson(file);
    if (!s) continue;
    parsed.push(s);
    findings.push(...checkClaude(s, `${tilde(file, opts.home)} (${scope})`));
  }
  if (files.length && !denyCoversEnv(parsed)) {
    findings.push({ agent: 'claude', where: 'all settings', severity: 'info', rule: 'no deny rule for .env files', detail: 'add "Read(**/.env)", "Read(**/.env.*)", "Edit(**/.env)", "Edit(**/.env.*)" to permissions.deny (see the env-guard skill)' });
  }
  const codexConfig = path.join(opts.codexHome, 'config.toml');
  if (fs.existsSync(codexConfig)) findings.push(...checkCodex(fs.readFileSync(codexConfig, 'utf8'), tilde(codexConfig, opts.home)));
  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  return { scanned: [...files.map(([, f]) => tilde(f, opts.home)), ...(fs.existsSync(codexConfig) ? [tilde(codexConfig, opts.home)] : [])], findings };
}

export function format(result) {
  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of result.findings) counts[f.severity]++;
  const lines = ['# Permission checker', '', `Scanned ${result.scanned.length} file(s). high: ${counts.high}, medium: ${counts.medium}, low: ${counts.low}, info: ${counts.info}`];
  for (const f of result.findings) lines.push('', `## [${f.severity.toUpperCase()}] ${f.agent} / ${f.rule}`, `- where: ${f.where}`, `- ${f.detail}`);
  if (!result.findings.length) lines.push('', 'Nothing risky found.');
  return lines.join('\n');
}

const HELP = `permission-checker: find risky permission settings in Claude Code and Codex
  node permission-checker.mjs [--json] [--project DIR] [--home DIR]
Read-only. Secret values are never printed.`;

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return console.log(HELP);
  const result = scan(opts);
  console.log(opts.json ? JSON.stringify(result, null, 2) : format(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
