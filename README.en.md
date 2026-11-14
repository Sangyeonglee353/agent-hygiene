[한국어](README.md) | **English**

# hook-cleaner

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Node 18+](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-blue)
![Claude Code](https://img.shields.io/badge/Claude_Code-supported-D97757)
![Codex](https://img.shields.io/badge/Codex-supported-111111)

**Clean up the hooks piling up in Claude Code and Codex, in one pass.**

_The course is over. The hook it installed may still be sending your conversations somewhere._

[Quick start](#quick-start) • [See it work](#see-it-work) • [What it finds](#what-it-finds) • [Install](#install) • [Safety](#safety)

---

## Who this is for

- You pasted install commands from a **course, bootcamp or trial tool** and never looked back.
- You open `settings.json` and **can't tell what each hook does or why it's there**.
- You run several plugins and get **errors from broken or duplicated hooks**.
- You need to know **where your session data goes** from a work machine.

## Why it matters

Hooks run automatically on every session start, prompt and tool call, and most of them **receive your full transcript**. They also outlive the tools that installed them.

1. The course ends, but the hook keeps posting your usage and session data.
2. The owner shuts the server down, the free subdomain (`*.up.railway.app`, `*.vercel.app`, ...) is released, and **anyone can register the same name**.
3. If the hook updates itself by downloading code from that server, whoever claims the name next **can run code on your machine**.

Broken and duplicate hooks aren't dangerous, but they fail on every event and make it hard to see what actually runs.

## Quick start

1. Install in Claude Code. Enter the two lines **one at a time**.

   ```
   /plugin marketplace add Sangyeonglee353/hook-cleaner
   /plugin install hook-cleaner@hook-cleaner
   ```

2. Ask your agent:

   > clean up my hooks

3. Read the findings and pick what to remove. The agent backs up, removes, and re-scans to confirm.

That's enough to know whether you need it.

## See it work

```
# Hook cleaner

Found 38 hook entries. high: 1, medium: 1, low: 1, info: 35
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

## [MEDIUM] (broken) h-5c01e9d2  claude / user / SessionStart
- command: node ~/old-tool/start.js
- referenced file is missing: ~/old-tool/start.js

## [LOW] (duplicate) h-91b7a3f0  claude / project / Stop
- command: npx some-notifier
- duplicate of h-0d44c2aa (~/.claude/settings.json); Claude Code runs identical commands once, so this copy is clutter
```

The agent doesn't dump this on you. It explains each problem in plain words and asks which hooks to remove.

## What it finds

| Category | Meaning | Typical case |
|---|---|---|
| **broken** | the command points at a script that no longer exists | the folder was deleted, the registration wasn't |
| **duplicate** | the same event, matcher and command is registered more than once | the same hook added as `~/x.js` and as an absolute path |
| **unused** | belongs to a disabled plugin, or its server is gone | still calling a service that shut down |
| **risky** | can download or rewrite code it then runs, or talks to an abandoned server | a self-updating course hook |

### Where it looks

| Agent | Locations |
|---|---|
| Claude Code | user, local, project and managed `settings.json`, `statusLine`, installed plugin hooks |
| Codex | `~/.codex/hooks.json`, project `.codex/hooks.json`, `notify` in `config.toml`, inline `[hooks]` tables, plugin hooks |

It reads the script each hook runs and the small config files next to it, so it also catches endpoints kept in a separate file (`api_url`, ...) or an environment variable.

## Install

Requires Node.js 18 or later. No packages to install.

**Claude Code (plugin, recommended)**

```
/plugin marketplace add Sangyeonglee353/hook-cleaner
/plugin install hook-cleaner@hook-cleaner
```

**Claude Code (plain skill)**

```bash
git clone https://github.com/Sangyeonglee353/hook-cleaner
cp -r hook-cleaner/skills/hook-cleaner ~/.claude/skills/
```

**Codex**

```bash
git clone https://github.com/Sangyeonglee353/hook-cleaner
cp -r hook-cleaner/skills/hook-cleaner ~/.codex/skills/
```

<details>
<summary>Run the script without an agent</summary>

```bash
node skills/hook-cleaner/scripts/hook-cleaner.mjs scan                  # offline
node skills/hook-cleaner/scripts/hook-cleaner.mjs scan --check-network  # also probe endpoints
node skills/hook-cleaner/scripts/hook-cleaner.mjs scan --json
node skills/hook-cleaner/scripts/hook-cleaner.mjs remove --id h-227f0b66        # dry run
node skills/hook-cleaner/scripts/hook-cleaner.mjs remove --id h-227f0b66 --yes  # apply
```

</details>

## Safety

A tool that removes hooks edits your config files, so it follows these rules:

- **Read-only by default.** `scan` never edits anything.
- **Network is opt-in.** Without `--check-network` it sends nothing. With it, one GET to the root of each endpoint found.
- **Dry run first.** `remove` only shows the plan unless you pass `--yes`.
- **Always backed up.** `*.hook-cleaner-<timestamp>.bak` is written before any edit. Codex `notify` is commented out, not deleted.
- **Hands off other people's files.** Plugin files and managed settings are never edited; you're told to disable the plugin or ask your administrator.
- **No secrets in output.** Tokens are referred to by file name only.
- **No telemetry.** This tool sends nothing about your usage anywhere.
- **Stars only with consent.** After a cleanup it asks once; it stars via `gh` only on an explicit yes, and never asks again.

Risk levels are heuristics, and a URL in a comment is not traffic. The skill tells the agent to read the script itself before judging anything medium or above.

## Limitations

- Hooks defined in skill or agent frontmatter are not scanned yet.
- Inline `[hooks]` tables in Codex `config.toml` are listed but must be edited by hand.
- Endpoints assembled at runtime from remote data can't be found statically.

## Contributing

Issues and PRs welcome, especially:

- false positives or missed hooks (with an example),
- hook config locations for agents not yet supported,
- "app not found" fingerprints for other hosting providers.

Run tests with `npm test`.

## License

MIT
