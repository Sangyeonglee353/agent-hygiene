import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isSecretPath, findSecretInCommand, check } from '../skills/env-guard/scripts/env-guard-hook.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'env-guard', 'scripts', 'env-guard-hook.mjs');

function run(payload) {
  return spawnSync(process.execPath, [HOOK], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8' });
}

test('secrets files are recognised, templates and code are not', () => {
  for (const p of ['.env', '.env.local', 'apps/web/.env.production', 'C:\\proj\\.env.local', '.envrc', '.dev.vars', 'config/secrets.json', 'credentials.json', 'id_rsa.pem', 'server.key', '**/.env*']) {
    assert.equal(isSecretPath(p), true, p);
  }
  for (const p of ['.env.example', '.env.local.example', '.env.sample', '.env.template', 'src/env.ts', 'src/secrets.ts', 'environment.md', 'keyboard.js', 'README.md', '', undefined]) {
    assert.equal(isSecretPath(p), false, String(p));
  }
});

test('file tools on secrets files are blocked', () => {
  assert.ok(check({ tool_name: 'Read', tool_input: { file_path: '/p/.env.local' } }));
  assert.ok(check({ tool_name: 'Edit', tool_input: { file_path: '/p/.env' } }));
  assert.ok(check({ tool_name: 'Write', tool_input: { file_path: '/p/.dev.vars' } }));
  assert.ok(check({ tool_name: 'Grep', tool_input: { pattern: 'KEY', path: '.env.local' } }));
  assert.ok(check({ tool_name: 'Grep', tool_input: { pattern: 'KEY', glob: '.env*' } }));
  assert.equal(check({ tool_name: 'Read', tool_input: { file_path: '/p/.env.example' } }), null);
  assert.equal(check({ tool_name: 'Read', tool_input: { file_path: '/p/src/config.ts' } }), null);
  assert.equal(check({ tool_name: 'Grep', tool_input: { pattern: 'process.env', path: 'src' } }), null);
  assert.equal(check({ tool_name: 'Glob', tool_input: { pattern: '**/.env*' } }), null, 'listing names is allowed');
});

test('shell commands that read, search or change secrets files are blocked', () => {
  for (const cmd of [
    'cat .env.local',
    'grep API_KEY .env',
    "grep -E '^KEY=' .env | cut -c1-8",
    'sed -i s/a/b/ .env.local',
    'echo FOO=1 >> .env',
    'echo FOO=1 >>.env',
    'source .env',
    'Get-Content .env.local',
    'type C:\\proj\\.env',
    'head -n 3 "./.env.local"',
    'cp .env.example .env',
    'git add .env',
    'printenv',
    'env',
    'env -0',
    'cd app && cat .env',
  ]) {
    assert.ok(findSecretInCommand(cmd), cmd);
  }
});

test('commands that only load or check the file are allowed', () => {
  for (const cmd of [
    'node --env-file=.env.local app.js',
    'node --env-file .env.local app.js',
    'dotenv -e .env.local -- next build',
    'docker compose --env-file .env up -d',
    'test -f .env.local && echo exists',
    '[ -f .env ] && echo yes',
    'ls -la',
    'ls .env.local',
    'git check-ignore .env.local',
    'git rm --cached .env',
    'chmod 600 .env',
    'cat .env.example',
    'env NODE_ENV=test npm test',
    'FOO=1 npm run dev',
    'npm run dev',
    'grep -rn process.env src',
  ]) {
    assert.equal(findSecretInCommand(cmd), null, cmd);
  }
});

test('hook exits 2 with a reason when blocking, 0 otherwise', () => {
  const blocked = run({ tool_name: 'Bash', tool_input: { command: 'cat .env.local' } });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /env-guard blocked/);
  assert.doesNotMatch(blocked.stderr, /cat \.env/, 'does not echo the command back');

  assert.equal(run({ tool_name: 'Bash', tool_input: { command: 'npm test' } }).status, 0);
  assert.equal(run({ tool_name: 'Read', tool_input: { file_path: 'README.md' } }).status, 0);
});

test('hook accepts Codex-style array commands and fails open on bad input', () => {
  assert.equal(run({ tool_name: 'shell', tool_input: { command: ['bash', '-lc', 'cat .env'] } }).status, 2);
  assert.equal(run('not json').status, 0);
  assert.equal(run('').status, 0);
  assert.equal(run({}).status, 0);
});
