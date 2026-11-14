# hook-audit

Find, risk-check and remove the hooks that Claude Code and Codex run automatically.

[한국어 README](README.ko.md)

## Why

Hooks run on every session, prompt or tool call, and many of them receive your full transcript. Courses, trials and side projects install hooks that outlive them:

- the course ends, but the hook keeps posting your usage and session data to its server;
- the server's free-tier subdomain (`*.up.railway.app`, `*.vercel.app`, `*.herokuapp.com`, ...) is deleted, and anyone can claim the same name and start receiving that data;
- some hooks update themselves by downloading code from that server, so whoever owns the name next can run code on your machine.

`hook-audit` lists every hook, tells you what each one talks to, checks whether those servers are still alive, and removes the ones you pick, with backups.

## What it looks like

```
## [HIGH] h-227f0b66  claude / user / Stop (.*)
- source: ~/.claude/settings.json
- command: node ~/.config/some-course/hook.js
- endpoints: some-course.up.railway.app (alive: HTTP 200)
- signals: network, remote-code, reads-transcript, credentials, edits-agent-settings
- some-course.up.railway.app is a free-tier subdomain; if the owner deletes the app, someone else can claim the name
- script can download or rewrite code it then runs (self-update, pipe-to-shell, eval)
- reads session transcripts and can send data to some-course.up.railway.app
- credential-like files next to the script: token
```

## Install

### Claude Code (plugin)

```
/plugin marketplace add Sangyeonglee353/hook-audit
/plugin install hook-audit@hook-audit
```

### Claude Code (plain skill)

```bash
git clone https://github.com/Sangyeonglee353/hook-audit
cp -r hook-audit/skills/hook-audit ~/.claude/skills/
```

### Codex

```bash
git clone https://github.com/Sangyeonglee353/hook-audit
cp -r hook-audit/skills/hook-audit ~/.codex/skills/
```

Requires Node.js 18 or later. No dependencies.

## Use

Ask your agent: "audit my hooks" or "훅 점검해줘". The skill scans, explains the findings, asks which hooks to remove, removes them with backups, and re-scans.

You can also run the script yourself:

```bash
node skills/hook-audit/scripts/hook-audit.mjs scan                  # offline
node skills/hook-audit/scripts/hook-audit.mjs scan --check-network  # also probe endpoints
node skills/hook-audit/scripts/hook-audit.mjs scan --json
node skills/hook-audit/scripts/hook-audit.mjs remove --id h-227f0b66        # dry run
node skills/hook-audit/scripts/hook-audit.mjs remove --id h-227f0b66 --yes  # apply
```

## What it checks

| Agent | Locations |
|---|---|
| Claude Code | user, local, project and managed `settings.json`, `statusLine`, installed plugin hooks |
| Codex | `~/.codex/hooks.json`, project `.codex/hooks.json`, `notify` in `config.toml`, inline `[hooks]` tables, plugin hooks |

For each hook it reads the script the command points at (and small config files next to it, where endpoints often live), then reports:

- endpoints it talks to, including ones read from environment variables;
- whether each endpoint is alive, gone (DNS), or showing a hosting provider's "app not found" page (`--check-network`);
- whether the script can rewrite or download code it then runs;
- whether it reads transcripts, touches agent settings, or keeps credential files nearby;
- commands that point at files that no longer exist.

## Safety

- `scan` is read-only. Without `--check-network` it makes no network requests. With it, it sends one GET to the root of each endpoint found.
- `remove` is a dry run unless you pass `--yes`, and it writes `*.hook-audit-<timestamp>.bak` before editing anything.
- Plugin hooks and managed settings are never edited; the tool tells you to disable the plugin or contact your administrator.
- Token values are never printed.

The risk levels are heuristics. A URL in a comment is not traffic; the skill tells the agent to read the script before judging anything medium or above.

## Limitations

- Hooks defined in skill or agent frontmatter are not scanned yet.
- Inline `[hooks]` tables in Codex `config.toml` are reported but must be edited by hand.
- Static analysis cannot see endpoints that are built at runtime from remote data.

## License

MIT
