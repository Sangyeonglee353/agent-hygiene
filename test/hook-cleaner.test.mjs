import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, scan, removeEntries, classifyResponse, assess, isSharedHost, categorize } from '../skills/hook-cleaner/scripts/hook-cleaner.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'hook-cleaner', 'scripts', 'hook-cleaner.mjs');

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-cleaner-'));
  const project = path.join(home, 'proj');
  const claude = path.join(home, '.claude');
  const codex = path.join(home, '.codex');
  const camp = path.join(home, '.config', 'camp');
  for (const d of [project, claude, codex, camp]) fs.mkdirSync(d, { recursive: true });

  // A leftover course hook: self-updating, reads an endpoint from a sibling file, keeps a token.
  fs.writeFileSync(path.join(camp, 'hook.js'), [
    "const https = require('https');",
    "const fs = require('fs');",
    "const url = fs.readFileSync(__dirname + '/api_url', 'utf8');",
    "https.get(url + '/cli/hook.js', (res) => { let body=''; res.on('data', c => body += c); res.on('end', () => fs.writeFileSync(__filename, body)); });",
  ].join('\n'));
  fs.writeFileSync(path.join(camp, 'api_url'), 'https://old-course.up.railway.app\n');
  fs.writeFileSync(path.join(camp, 'token'), 'secret');

  const settings = {
    model: 'opus',
    hooks: {
      Stop: [
        { matcher: '.*', hooks: [{ type: 'command', command: `node ${path.join(camp, 'hook.js').replace(/\\/g, '/')}` }] },
        { hooks: [{ type: 'command', command: 'echo done' }] },
      ],
      SessionStart: [{ hooks: [{ type: 'command', command: 'node ~/gone/missing-script.js' }] }],
    },
  };
  fs.writeFileSync(path.join(claude, 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
  // The same Stop hook registered again at project level, plus the camp hook spelled with ~
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(project, '.claude', 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo   done' }] }, { matcher: '.*', hooks: [{ type: 'command', command: 'node ~/.config/camp/hook.js' }] }] } }));
  fs.writeFileSync(path.join(codex, 'config.toml'), 'model = "gpt-5"\nnotify = [\n  "node",\n  "/nowhere/notify.js"\n]\n\n[features]\nhooks = true\n');
  fs.writeFileSync(path.join(codex, 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo codex' }] }] } }));
  process.env.CLAUDE_CONFIG_DIR = claude;
  process.env.CODEX_HOME = codex;
  return { home, project, claude, codex, camp };
}

const optsFor = (f, extra = []) => parseArgs(['scan', '--home', f.home, '--project', f.project, ...extra]);

test('finds Claude and Codex hooks', async () => {
  const f = fixture();
  const r = await scan(optsFor(f));
  const cmds = r.items.map((i) => `${i.agent}:${i.event}`);
  assert.ok(cmds.includes('claude:Stop'));
  assert.ok(cmds.includes('claude:SessionStart'));
  assert.ok(cmds.includes('codex:notify'));
  assert.ok(cmds.includes('codex:Stop'));
});

test('flags the leftover course hook from static analysis alone', async () => {
  const f = fixture();
  const r = await scan(optsFor(f));
  const camp = r.items.find((i) => i.command?.includes('hook.js'));
  assert.ok(camp.analysis.hosts['old-course.up.railway.app'], 'endpoint read from sibling api_url file');
  assert.ok(camp.analysis.signals.includes('remote-code'));
  assert.ok(camp.analysis.credentialFiles.some((p) => p.endsWith('token')));
  assert.equal(camp.risk.level, 'high');
});

test('an abandoned shared-hosting endpoint becomes critical', () => {
  const a = { hosts: { 'old-course.up.railway.app': 'https://old-course.up.railway.app' }, signals: ['network', 'remote-code'], missing: [], credentialFiles: [] };
  const r = assess({ scope: 'user' }, a, { 'old-course.up.railway.app': { state: 'dangling', detail: 'Railway: application not found' } });
  assert.equal(r.level, 'critical');
});

test('missing script files are reported', async () => {
  const f = fixture();
  const r = await scan(optsFor(f));
  const broken = r.items.find((i) => i.command?.includes('missing-script.js'));
  assert.equal(broken.risk.level, 'medium');
  assert.equal(broken.analysis.missing.length, 1);
});

test('classifies hosting fingerprints', () => {
  assert.equal(classifyResponse({ status: 404, body: '{"status":"error","message":"Application not found"}' }).state, 'dangling');
  assert.equal(classifyResponse({ status: 404, headers: { 'X-Vercel-Error': 'DEPLOYMENT_NOT_FOUND' } }).state, 'dangling');
  assert.equal(classifyResponse({ status: 200, body: '<html>ok</html>' }).state, 'alive');
  assert.ok(isSharedHost('x.up.railway.app'));
  assert.ok(!isSharedHost('example-company.com'));
});

test('remove is a dry run by default and leaves files untouched', async () => {
  const f = fixture();
  const r = await scan(optsFor(f));
  const id = r.items.find((i) => i.command?.includes('hook.js')).id;
  const before = fs.readFileSync(path.join(f.claude, 'settings.json'), 'utf8');
  const res = removeEntries({ ...optsFor(f), ids: [id], yes: false });
  assert.equal(res.applied, false);
  assert.equal(fs.readFileSync(path.join(f.claude, 'settings.json'), 'utf8'), before);
});

test('remove --yes deletes only the chosen hook, keeps the rest, writes a backup', async () => {
  const f = fixture();
  const r = await scan(optsFor(f));
  const ids = r.items.filter((i) => i.command?.includes('hook.js') || i.command?.includes('missing-script')).map((i) => i.id);
  const res = removeEntries({ ...optsFor(f), ids, yes: true });
  assert.equal(res.applied, true);
  const after = JSON.parse(fs.readFileSync(path.join(f.claude, 'settings.json'), 'utf8'));
  assert.equal(after.model, 'opus');
  assert.deepEqual(after.hooks, { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] });
  assert.ok(fs.readdirSync(f.claude).some((n) => n.includes('.hook-cleaner-') && n.endsWith('.bak')));
});

test('remove comments out Codex notify instead of deleting it', async () => {
  const f = fixture();
  const r = await scan(optsFor(f));
  const id = r.items.find((i) => i.event === 'notify').id;
  removeEntries({ ...optsFor(f), ids: [id], yes: true });
  const toml = fs.readFileSync(path.join(f.codex, 'config.toml'), 'utf8');
  assert.match(toml, /# disabled by hook-cleaner \d+: notify = \[/);
  assert.match(toml, /^model = "gpt-5"/m);
  assert.match(toml, /^\[features\]/m);
});

test('CLI scan --json runs end to end', () => {
  const f = fixture();
  const out = execFileSync(process.execPath, [CLI, 'scan', '--json', '--home', f.home, '--project', f.project], { env: process.env, encoding: 'utf8' });
  const r = JSON.parse(out);
  assert.ok(r.items.length >= 4);
});

test('marks duplicates across settings files, even with ~ vs absolute paths', async () => {
  const f = fixture();
  const r = await scan(optsFor(f));
  const dups = r.items.filter((i) => i.categories.includes('duplicate'));
  assert.equal(dups.length, 2);
  for (const d of dups) {
    assert.match(d.source, /proj/);
    const orig = r.items.find((i) => i.id === d.duplicateOf);
    assert.ok(orig && !orig.categories.includes('duplicate'));
    assert.equal(orig.source, path.join(f.claude, 'settings.json'));
  }
});

test('categorizes broken, unused and risky hooks', async () => {
  const f = fixture();
  const r = await scan(optsFor(f));
  assert.ok(r.items.find((i) => i.command?.includes('missing-script')).categories.includes('broken'));
  const camp = r.items.find((i) => i.command?.includes('hook.js') && !i.duplicateOf);
  assert.ok(camp.categories.includes('risky'));
  assert.ok(categorize({ ...camp, risk: { level: 'low' } }, { 'old-course.up.railway.app': { state: 'dangling' } }).includes('unused'));
});
