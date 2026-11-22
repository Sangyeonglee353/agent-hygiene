import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkClaude, checkCodex, findToken, scan } from '../skills/permission-checker/scripts/permission-checker.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'permission-checker', 'scripts', 'permission-checker.mjs');

// Fake secrets are assembled at runtime so the repository never contains a token-shaped string.
const FAKE_KEY = 'sk-' + 'x'.repeat(32);
const FAKE_BEARER = 'Bearer ' + 'y'.repeat(40);

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'permission-checker-'));
  const project = path.join(home, 'proj');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
    permissions: { defaultMode: 'bypassPermissions', allow: ['Bash(npm test:*)', 'Bash(curl:*)'] },
    env: { OPENAI_API_KEY: FAKE_KEY, LOG_LEVEL: 'debug' },
  }));
  fs.writeFileSync(path.join(project, '.claude', 'settings.local.json'), JSON.stringify({
    permissions: { allow: [`Bash(curl -H "Authorization: ${FAKE_BEARER}" https://api.example.com)`, 'Bash(git status)'] },
  }));
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), [
    'model = "gpt-5"',
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
    '',
    '[model_providers.custom]',
    'env_key = "CUSTOM_API_KEY"',
    '',
    '[profiles.safe]',
    'approval_policy = "on-request"',
    'sandbox_mode = "workspace-write"',
  ].join('\n'));
  return { home, project };
}

test('token detection labels without returning the value', () => {
  assert.equal(findToken(FAKE_KEY), 'API key (sk-...)');
  assert.equal(findToken(FAKE_BEARER), 'Bearer token');
  assert.equal(findToken('Bash(npm test:*)'), null);
  assert.equal(findToken('OPENAI_API_KEY'), null);
});

test('claude settings: bypass mode, broad allows, secrets in rules and env', () => {
  const f = checkClaude({
    permissions: {
      defaultMode: 'bypassPermissions',
      allow: ['Bash', 'Bash(sudo apt:*)', 'Bash(rm -rf:*)', 'Bash(git push:*)', 'Bash(npm test:*)', 'Read', `Bash(export TOKEN=${FAKE_KEY})`],
      additionalDirectories: ['C:\\', '~/work'],
    },
    skipDangerousModePermissionPrompt: true,
    env: { GITHUB_TOKEN: 'abc', NODE_ENV: 'production' },
  }, 'test');
  const rules = f.map((x) => `${x.severity} ${x.rule}`);
  assert.ok(rules.includes('high permissions.defaultMode = bypassPermissions'));
  assert.ok(rules.includes('medium skipDangerousModePermissionPrompt = true'));
  assert.ok(rules.includes('high allow Bash'));
  assert.ok(rules.includes('high allow Bash(sudo apt:*)'));
  assert.ok(rules.includes('high allow Bash(rm -rf:*)'));
  assert.ok(rules.includes('medium allow Bash(git push:*)'));
  assert.ok(rules.includes('high allow rule containing a API key (sk-...)'));
  assert.ok(rules.includes('medium additionalDirectories C:\\'));
  assert.ok(rules.includes('medium env.GITHUB_TOKEN'));
  assert.ok(!rules.some((r) => r.includes('npm test') || r.includes('NODE_ENV') || r.includes('~/work')));
  assert.ok(!JSON.stringify(f).includes(FAKE_KEY), 'never echoes the secret');
});

test('codex config: never + full access, profiles, env_key names are not secrets', () => {
  const f = checkCodex([
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
    '[model_providers.x]',
    'env_key = "X_API_KEY"',
    '[profiles.yolo]',
    'sandbox_mode = "danger-full-access"',
    '[sandbox_workspace_write]',
    'network_access = true',
  ].join('\n'), '~/.codex/config.toml');
  const rules = f.map((x) => `${x.severity} ${x.where} ${x.rule}`);
  assert.ok(rules.includes('high ~/.codex/config.toml approval_policy = never + sandbox_mode = danger-full-access'));
  assert.ok(rules.includes('medium ~/.codex/config.toml [profiles.yolo] sandbox_mode = danger-full-access'));
  assert.ok(rules.includes('low ~/.codex/config.toml sandbox_workspace_write.network_access = true'));
  assert.ok(!rules.some((r) => r.includes('env_key')));
});

test('scan reads user and project files, suggests a .env deny rule, never prints secrets', () => {
  const { home, project } = fixture();
  const result = scan({ home, project, codexHome: path.join(home, '.codex') });
  assert.equal(result.scanned.length, 3);
  const rules = result.findings.map((x) => x.rule);
  assert.ok(rules.includes('permissions.defaultMode = bypassPermissions'));
  assert.ok(rules.includes('allow Bash(curl:*)'));
  assert.ok(rules.includes('allow rule containing a Bearer token'));
  assert.ok(rules.includes('env.OPENAI_API_KEY'));
  assert.ok(rules.includes('no deny rule for .env files'));
  assert.ok(rules.includes('approval_policy = never + sandbox_mode = danger-full-access'));
  assert.equal(result.findings[0].severity, 'high', 'sorted by severity');

  const text = execFileSync(process.execPath, [CLI, '--home', home, '--project', project], { encoding: 'utf8' });
  const json = execFileSync(process.execPath, [CLI, '--home', home, '--project', project, '--json'], { encoding: 'utf8' });
  for (const out of [text, json]) {
    assert.ok(!out.includes(FAKE_KEY) && !out.includes('y'.repeat(40)), 'output contains no secret');
  }
  assert.match(text, /# Permission checker/);
});

test('a deny rule for .env silences the suggestion', () => {
  const { home, project } = fixture();
  const file = path.join(home, '.claude', 'settings.json');
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  s.permissions.deny = ['Read(**/.env)', 'Read(**/.env.*)'];
  fs.writeFileSync(file, JSON.stringify(s));
  const rules = scan({ home, project, codexHome: path.join(home, '.codex') }).findings.map((x) => x.rule);
  assert.ok(!rules.includes('no deny rule for .env files'));
});

test('codex config: single quotes, inline comments and lowercase variable names', () => {
  const rules = checkCodex([
    "approval_policy = 'never' # yolo",
    "sandbox_mode = 'danger-full-access'",
    '[model_providers.x]',
    'base_url = "https://api.example.com/v1 # prod"',
    'env_key = "my_custom_api_key"',
  ].join('\n'), 'c').map((x) => `${x.severity} ${x.rule}`);
  assert.deepEqual(rules, ['high approval_policy = never + sandbox_mode = danger-full-access']);
});

test('CLI does not crash on a flag without a value', () => {
  const { home, project } = fixture();
  const out = execFileSync(process.execPath, [CLI, '--project', project, '--home'], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.match(out, /# Permission checker/);
});
