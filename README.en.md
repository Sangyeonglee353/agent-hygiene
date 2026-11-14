# hook-cleaner

Scans, identifies, and safely removes unused, duplicate, or broken hooks in Claude Code and Codex configuration files. Use when cleaning up agent setups or removing obsolete hooks.

It also flags risky hooks: ones that send your session data to servers that are gone, or that download and run their own updates.

[한국어](README.md)

## Why

Hook configs pile up. Plugins and tutorials add entries, scripts get moved or deleted, and the same command ends up registered in both user and project settings. Broken hooks fail on every event; duplicates make it hard to see what actually runs.

Some leftovers are worse than clutter. Hooks run on every session, prompt or tool call, and many of them receive your full transcript. Courses, trials and side projects install hooks that outlive them:

- the course ends, but the hook keeps posting your usage and session data to its server;
- the server's free-tier subdomain (`*.up.railway.app`, `*.vercel.app`, `*.herokuapp.com`, ...) is deleted, and anyone can claim the same name and start receiving that data;
- some hooks update themselves by downloading code from that server, so whoever owns the name next can run code on your machine.

`hook-cleaner` lists every hook, tells you what each one talks to, checks whether those servers are still alive, and removes the ones you pick, with backups.

## What it looks like

```
Cleanup candidates: broken 1, duplicate 1, unused 0, risky 1

## [HIGH] (risky) h-227f0b66  claude / user / Stop (.*)
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
/plugin marketplace add Sangyeonglee353/hook-cleaner
/plugin install hook-cleaner@hook-cleaner
```

### Claude Code (plain skill)

```bash
git clone https://github.com/Sangyeonglee353/hook-cleaner
cp -r hook-cleaner/skills/hook-cleaner ~/.claude/skills/
```

### Codex

```bash
git clone https://github.com/Sangyeonglee353/hook-cleaner
cp -r hook-cleaner/skills/hook-cleaner ~/.codex/skills/
```

Requires Node.js 18 or later. No dependencies.

## Use

Ask your agent: "clean up my hooks" or "훅 정리해줘". The skill scans, explains the findings, asks which hooks to remove, removes them with backups, and re-scans.

You can also run the script yourself:

```bash
node skills/hook-cleaner/scripts/hook-cleaner.mjs scan                  # offline
node skills/hook-cleaner/scripts/hook-cleaner.mjs scan --check-network  # also probe endpoints
node skills/hook-cleaner/scripts/hook-cleaner.mjs scan --json
node skills/hook-cleaner/scripts/hook-cleaner.mjs remove --id h-227f0b66        # dry run
node skills/hook-cleaner/scripts/hook-cleaner.mjs remove --id h-227f0b66 --yes  # apply
```

## What it finds

| Category | Meaning |
|---|---|
| broken | the command points at a script that no longer exists |
| duplicate | the same event, matcher and command is registered more than once (`~/x.js` and `/home/me/x.js` count as the same) |
| unused | belongs to a disabled plugin, or its server is gone |
| risky | can rewrite or download code it then runs, or talks to an abandoned server |

## Where it looks

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
- `remove` is a dry run unless you pass `--yes`, and it writes `*.hook-cleaner-<timestamp>.bak` before editing anything.
- Plugin hooks and managed settings are never edited; the tool tells you to disable the plugin or contact your administrator.
- Token values are never printed.
- After a cleanup that removed something, the agent asks once whether you'd like to star this repo. It stars only on an explicit yes (via `gh`), and never asks again either way.

The risk levels are heuristics. A URL in a comment is not traffic; the skill tells the agent to read the script before judging anything medium or above.

## Limitations

- Hooks defined in skill or agent frontmatter are not scanned yet.
- Inline `[hooks]` tables in Codex `config.toml` are reported but must be edited by hand.
- Static analysis cannot see endpoints that are built at runtime from remote data.

## License

MIT
