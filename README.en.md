[한국어](README.md) | **English**

# agent-hygiene

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Node 18+](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)

Three skills for the everyday safety habits of working with Claude Code and Codex. Nothing dramatic, like washing your hands, but skipping them catches up with you.

| Skill | What it does | Say this |
|---|---|---|
| [hook-cleaner](#hook-cleaner) | Finds the hooks piling up in your setup and removes the broken, duplicate and risky ones | "clean up my hooks" |
| [env-guard](#env-guard) | Keeps the agent out of `.env` and other secrets files; values are used by variable name only | nothing; it applies when the agent is about to touch a `.env` file |
| [permission-checker](#permission-checker) | Finds over-broad "don't ask again" rules and keys saved in plain text in your settings | "check my permissions" |

No packages to install (Node.js 18+ only), and nothing about your usage is sent anywhere.

## Why

I opened `~/.claude/settings.json` one day and found a Stop hook I didn't remember adding. A course I had followed installed it, and it was posting session data to an outside server at the end of every session. The course was over and the server looked abandoned.

Around the same time, I told an agent "my env var isn't being picked up" and it opened `.env.local` to look. Once a file is opened, the keys in it are in the transcript, and that can't be undone.

Neither was a sophisticated attack. Both were habits. These skills turn the check-and-clean-up routine into something an agent does for you.

## Quick start

1. Install in Claude Code. Enter the two lines one at a time.

   ```
   /plugin marketplace add Sangyeonglee353/agent-hygiene
   /plugin install agent-hygiene@agent-hygiene
   ```

2. Ask your agent:

   > clean up my hooks

   > check my permissions

3. env-guard needs no call. It applies when the agent is about to touch a `.env` file, or when an error points at an API key, token or environment variable.

---

## hook-cleaner

### Why it matters

Hooks run automatically on every session start, prompt and tool call, and most of them receive your full transcript. They also outlive the tools that installed them.

The trouble starts after the server goes away. When the owner deletes the app, a free subdomain such as `*.up.railway.app` or `*.vercel.app` can be registered again by anyone. If the hook updates itself by downloading code from that server, whoever claims the name next can run code on your machine.

Broken and duplicate hooks aren't dangerous, but they fail on every event and make it hard to see what actually runs.

### See it work

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
```

The agent doesn't dump this on you. It explains each problem in plain words and asks which hooks to remove, backs up before removing, and re-scans to confirm.

### What it finds

| Category | Meaning | Typical case |
|---|---|---|
| **broken** | the command points at a script that no longer exists | the folder was deleted, the registration wasn't |
| **duplicate** | the same event, matcher and command is registered more than once | the same hook added as `~/x.js` and as an absolute path |
| **unused** | belongs to a disabled plugin, or its server is gone | still calling a service that shut down |
| **risky** | can download or rewrite code it then runs, or talks to an abandoned server | a self-updating course hook |

| Agent | Where it looks |
|---|---|
| Claude Code | user, local, project and managed `settings.json`, `statusLine`, installed plugin hooks |
| Codex | `~/.codex/hooks.json`, project `.codex/hooks.json`, `notify` in `config.toml`, inline `[hooks]` tables, plugin hooks |

It reads the script each hook runs and the small config files next to it, so it also catches endpoints kept in a separate file (`api_url`, ...) or an environment variable.

### Safety

- `scan` is read-only.
- Without `--check-network` it sends nothing. With it, one GET to the root of each endpoint found.
- `remove` only shows the plan unless you pass `--yes`.
- `*.hook-cleaner-<timestamp>.bak` is written before any edit. Codex `notify` is commented out, not deleted.
- Plugin files and managed settings are never edited; you're told to disable the plugin or ask your administrator.
- Tokens are referred to by file name only.
- After a cleanup it asks once for a star; it stars via `gh` only on an explicit yes, and never asks again.

Risk levels are heuristics, and a URL in a comment is not traffic. The skill tells the agent to read the script itself before judging anything medium or above.

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

---

## env-guard

Tell an agent "my API key doesn't work" and it will often `grep` or `cat` your `.env.local`. Even with values masked or "just one line" shown, once the file is opened its keys can end up in the transcript and session logs. env-guard makes the agent follow one rule: never open a secrets file; use values only by name.

### What changes

| Situation | Common behaviour without it | With it |
|---|---|---|
| "My API key doesn't work" | Opens `.env.local` to check the key | Reads the code and `.env.example`, tells you the variable name and expected format, and lets you check |
| A script needs a key | Pastes the value into the command | Uses `node --env-file=.env.local app.js` or `$NAME` |
| A path in `.env` is wrong | Edits it with `sed -i` | Tells you which variable to change and to what |
| Delegating to a subagent | Pastes the file into the prompt | Passes the rule, not the contents |
| A key gets printed by accident | Quotes it again | Does not repeat it and tells you to rotate it |

**Blocked files:** `.env`, `.env.local`, `.env.*`, `.envrc`, `.dev.vars`, `secrets.json`/`secrets.yaml` and similar, `credentials.json`, `*.pem`, `*.key`

**Allowed:** templates such as `.env.example`, the code that reads variables, checking a file exists (`test -f`), checking a variable is set without showing it (`[ -n "$NAME" ]`)

### Hard blocking (optional)

A skill is an instruction; it can't stop a tool call by itself. For enforcement, use one or both of the following. Ask the agent to "turn on env-guard enforcement" and it backs up your settings and sets them up.

| Method | Covers | Doesn't cover |
|---|---|---|
| **Permission rules** (`permissions.deny`) | the Read, Edit and Write tools, and Grep and Glob on those paths | shell commands such as `cat .env` |
| **The env-guard hook** (`scripts/env-guard-hook.mjs`) | file tools and shell commands: `cat`, `grep`, `sed -i`, `>> .env`, `source .env`, `printenv`, ... | secrets files with names not on the list |

The hook still allows runners that load the file themselves (`node --env-file=...`, `dotenv -e ...`, `docker compose --env-file ...`), plus `test -f`, `ls`, `git check-ignore` and reading templates.

<details>
<summary>Set it up by hand</summary>

Add to `~/.claude/settings.json`. If you already have `permissions` or `hooks`, merge into the lists instead of replacing them.

```json
{
  "permissions": {
    "deny": ["Read(**/.env)", "Read(**/.env.*)", "Edit(**/.env)", "Edit(**/.env.*)"]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read|Edit|Write|MultiEdit|NotebookEdit|Grep|Bash",
        "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/hooks/env-guard-hook.mjs\"" }]
      }
    ]
  }
}
```

Copy `skills/env-guard/scripts/env-guard-hook.mjs` to `~/.claude/hooks/`. `Read(**/.env.*)` also blocks `.env.example`; add an `allow` for the template if you want it readable. Restart running sessions after changing settings.

</details>

---

## permission-checker

Every "Yes, and don't ask again" adds a rule to a settings file. Months later, some of those rules allow far more than you meant: `Bash(curl:*)` lets the agent send any data to any server, and if a one-off command carried an API key, that key now sits in `settings.local.json` in plain text.

### What it finds

| Level | Setting | Meaning |
|---|---|---|
| high | `defaultMode: bypassPermissions` | nothing is asked, in every session |
| high | an API key or token inside an `allow` rule | the key is stored in plain text; remove the rule and rotate the key |
| high | `Bash`, `Bash(*)`, `Bash(sudo:*)`, `Bash(rm -rf:*)` | every command, admin rights or deletion without asking |
| high | Codex `approval_policy = "never"` + `sandbox_mode = "danger-full-access"` | commands with full disk and network access, never asking |
| medium | `Bash(curl:*)`, `Bash(python:*)`, `Bash(npx:*)`, `Bash(git push:*)` | sending data out, running any code, or force-pushing without asking |
| medium | a key in a settings `env` block | a secret stored in plain text (value not shown) |
| medium | a whole drive or home folder in `additionalDirectories` | far more access than a project needs |
| info | no deny rule for `.env` | suggests env-guard's permission rules |

The script is read-only and reports secrets by kind only ("API key", "Bearer token"). The agent explains the findings, suggests narrower rules, and edits only what you pick, with a backup.

```bash
node skills/permission-checker/scripts/permission-checker.mjs          # check
node skills/permission-checker/scripts/permission-checker.mjs --json
```

---

## Install

**Claude Code (plugin, recommended)**

```
/plugin marketplace add Sangyeonglee353/agent-hygiene
/plugin install agent-hygiene@agent-hygiene
```

**Claude Code (plain skills)**

```bash
git clone https://github.com/Sangyeonglee353/agent-hygiene
cp -r agent-hygiene/skills/* ~/.claude/skills/
```

**Codex**

```bash
git clone https://github.com/Sangyeonglee353/agent-hygiene
cp -r agent-hygiene/skills/* ~/.codex/skills/
```

To use only some of the skills, copy just those folders from `skills/`.

## Compared with other tools

This repository is the lightweight starting point. If you need stronger protection, look at these too.

| You need | This repository | Other options |
|---|---|---|
| A firewall that reviews every risky action before it runs | the env-guard hook blocks secrets files only | [hol-guard](https://github.com/hashgraph-online/hol-guard), [destructive_command_guard](https://github.com/Dicklesworthstone/destructive_command_guard) |
| No `.env` at all, keys in a vault | keeps your `.env` and keeps the agent out of it | [Phase](https://github.com/phasehq/console), [Varlock skill](https://github.com/wrsmith108/varlock-claude-skill) |
| Vetting `.claude/` in someone else's repo before cloning | checks the hooks and permissions already on your machine | [medusa](https://github.com/Pantheon-Security/medusa) |
| A checkup of all of `.claude/` (skills, memory, token use) | hooks and permissions only | [claude-markdown-health-check](https://github.com/ncoevoet/claude-markdown-health-check) |

## Limitations

- hook-cleaner doesn't scan hooks defined in skill or agent frontmatter yet. Inline `[hooks]` tables in Codex `config.toml` are listed but must be edited by hand.
- The env-guard skill alone can't enforce anything. The blocking hook follows the Claude Code hook format; for Codex, check that your version supports PreToolUse hooks first.
- permission-checker doesn't read managed settings, plugin-provided permissions or launch flags (`--dangerously-skip-permissions`, `codex --yolo`).
- All three use heuristics. Please report false positives and misses as issues.

## Contributing

Issues and PRs welcome, especially:

- false positives or misses (hooks, permission rules, secrets files) with an example,
- config locations for agents not yet supported,
- "app not found" fingerprints for other hosting providers.

Run tests with `npm test`.

## License

MIT
