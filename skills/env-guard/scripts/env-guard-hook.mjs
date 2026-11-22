#!/usr/bin/env node
// env-guard hook: an optional PreToolUse hook that blocks reading, searching or editing
// secrets files (.env, .env.local, .envrc, .dev.vars, secrets.json, credentials.json, *.pem, *.key).
//
// Contract (Claude Code PreToolUse): the tool call arrives as JSON on stdin.
// Exit 2 with a reason on stderr blocks the call; exit 0 lets it through.
// Anything the hook cannot parse is let through, so a bug here never breaks a session.

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TEMPLATE = /\.(example|sample|template|dist)$/i;

function baseName(p) {
  return String(p).trim().replace(/^['"]+|['"]+$/g, '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
}

// True for a path or glob whose last segment names a secrets file. Templates are allowed.
export function isSecretPath(p) {
  if (!p || typeof p !== 'string') return false;
  const name = baseName(p);
  if (!name || TEMPLATE.test(name)) return false;
  if (/^\.env([.*].*)?$/i.test(name)) return true; // .env, .env.local, .env.production, .env*
  if (/^\.envrc$/i.test(name) || /^\.dev\.vars$/i.test(name)) return true;
  if (/^secrets\.(json|ya?ml|toml|ini|env|txt)$/i.test(name)) return true;
  if (/^credentials\.json$/i.test(name)) return true;
  if (/\.(pem|key)$/i.test(name)) return true;
  return false;
}

// Commands that may name a secrets file without exposing its contents.
const SAFE_FIRST_WORDS = new Set(['test', '[', '[[', 'ls', 'stat', 'chmod', 'touch']);
const SAFE_GIT = new Set(['check-ignore', 'ls-files', 'status']);
// Flags whose next argument is a file the runtime loads by itself.
const LOADER_FLAGS = new Set(['--env-file', '-e', '--env']);

function splitSegments(cmd) {
  return cmd.split(/\|\||&&|[|;&\n]/).map((s) => s.trim()).filter(Boolean);
}

function tokens(segment) {
  return segment.split(/[\s<>()`]+/).map((t) => t.replace(/^['"]+|['"]+$/g, '')).filter(Boolean);
}

// Returns the secrets file a shell command touches, or null.
export function findSecretInCommand(command) {
  const cmd = Array.isArray(command) ? command.join(' ') : String(command || '');
  for (const segment of splitSegments(cmd)) {
    const words = tokens(segment);
    let i = 0;
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++; // FOO=1 cmd
    const first = (words[i] || '').toLowerCase();
    if (first === 'printenv' || (first === 'env' && words.slice(i + 1).every((w) => w.startsWith('-')))) return 'the environment (printenv/env)';
    if (SAFE_FIRST_WORDS.has(first)) continue;
    if (first === 'git' && (SAFE_GIT.has(words[i + 1]) || (words[i + 1] === 'rm' && words.includes('--cached')))) continue;
    for (let j = i; j < words.length; j++) {
      const word = words[j];
      if (LOADER_FLAGS.has(words[j - 1])) continue;
      const eq = word.indexOf('=');
      if (eq > 0) {
        if (LOADER_FLAGS.has(word.slice(0, eq))) continue;
        if (isSecretPath(word.slice(eq + 1))) return word.slice(eq + 1);
        continue;
      }
      if (isSecretPath(word)) return word;
    }
  }
  return null;
}

// Returns a block reason for a PreToolUse payload, or null to allow.
export function check(payload) {
  const tool = String(payload?.tool_name || '');
  const input = payload?.tool_input || {};
  const fileTools = ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
  if (fileTools.includes(tool)) {
    const target = input.file_path || input.notebook_path || input.path;
    return isSecretPath(target) ? `${tool} on ${baseName(target)}` : null;
  }
  if (tool === 'Grep') {
    for (const target of [input.path, input.glob]) {
      if (isSecretPath(target)) return `Grep on ${baseName(target)}`;
    }
    return null;
  }
  if (input.command !== undefined) {
    const hit = findSecretInCommand(input.command);
    return hit ? `a command that touches ${hit === 'the environment (printenv/env)' ? hit : baseName(hit)}` : null;
  }
  return null;
}

export function message(reason) {
  return [
    `env-guard blocked ${reason}.`,
    'Secrets files are not read, searched, printed or edited.',
    'Use the value by name instead: process.env.NAME, $NAME, or a runner that loads the file (node --env-file=.env.local, dotenv -e .env.local -- <cmd>).',
    'If the file itself needs checking or changing, tell the user which variable and what it should be, and let them do it.',
  ].join(' ');
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    process.exit(0);
  }
  const reason = check(payload);
  if (reason) {
    process.stderr.write(message(reason) + '\n');
    process.exit(2);
  }
  process.exit(0);
}

const invokedDirectly = (() => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) main();
