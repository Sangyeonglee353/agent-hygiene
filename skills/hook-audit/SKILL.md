---
name: hook-audit
description: Inventory, risk-check and clean up the hooks that Claude Code and Codex run automatically (settings.json hooks, statusLine, plugin hooks, Codex hooks.json and notify). Use when the user asks what hooks are installed, wants to remove an old or suspicious hook, worries that a hook sends data to a server that is gone, finished a course or trial that installed hooks, or says things like "audit my hooks", "remove this hook", "훅 점검", "훅 정리", "이 훅 지워줘".
---

# hook-audit

Hooks run on every session, prompt or tool call, often with the user's full transcript as input. A hook left behind by a finished course, a trial tool or an abandoned project keeps sending data, and if its server's subdomain is released, whoever claims the name next receives that data or, for self-updating hooks, gets to ship code that runs on the user's machine.

This skill finds every hook, explains what each one does, and removes the ones the user chooses. It never removes anything without explicit confirmation.

## Workflow

1. **Scan.** Run from the user's current project so project-level hooks are included:

   ```bash
   node <skill-dir>/scripts/hook-audit.mjs scan --check-network
   ```

   `<skill-dir>` is the folder containing this SKILL.md. Drop `--check-network` if the user does not want any outbound requests; the scan is then fully offline. Add `--json` when you need to process results.

2. **Explain.** Summarize for the user, highest risk first. For each item give: where it is configured, what it runs, which endpoints it talks to and whether they are alive, and the reasons listed. Translate the signals into plain words. Do not alarm about `info` items; group them in one line.

3. **Read before judging.** For anything `medium` or above, open the script itself and confirm what it actually sends and when. Static signals are heuristics: a URL in a comment is not traffic, and a self-update check against the vendor's own GitHub is normal. Correct the risk level in your explanation if the code says otherwise.

4. **Ask.** List the hook ids you recommend removing and why, then ask the user which ones to remove. Wait for an answer.

5. **Remove.** Dry-run first, show the plan, then apply:

   ```bash
   node <skill-dir>/scripts/hook-audit.mjs remove --id h-xxxxxxxx --id h-yyyyyyyy
   node <skill-dir>/scripts/hook-audit.mjs remove --id h-xxxxxxxx --id h-yyyyyyyy --yes
   ```

   Every edited file gets a `*.hook-audit-<timestamp>.bak` copy first. Codex `notify` lines are commented out, not deleted.

6. **Leftovers.** A removed hook usually leaves a folder behind (the script, a token, a queue of unsent data). Show the user the folder and the credential-like files the scan found. With their permission, move the folder to a backup location rather than deleting it, and suggest revoking the token on the service side if that service still exists.

7. **Verify.** Run `scan` again and confirm the hooks are gone. Tell the user to restart running Claude Code or Codex sessions, because sessions load hooks at startup and keep running removed ones until restarted.

## What it covers

| Agent | Locations |
|---|---|
| Claude Code | `~/.claude/settings.json`, `settings.local.json`, `<project>/.claude/settings*.json`, managed settings, `statusLine`, installed plugins (`hooks/hooks.json`, `plugin.json`) |
| Codex | `~/.codex/hooks.json`, `<project>/.codex/hooks.json`, `notify` in `config.toml`, inline `[hooks]` tables (reported, edit by hand), plugin `hooks/hooks.json` |

`CLAUDE_CONFIG_DIR` and `CODEX_HOME` are respected.

## Risk levels

- **critical**: talks to an endpoint that looks abandoned on a domain anyone can re-register, or abandoned and the script can update its own code.
- **high**: endpoint looks abandoned, or the script downloads or rewrites code it then runs and also talks to the network.
- **medium**: reads transcripts and sends data to a third party, edits agent settings while talking to the network, points at a missing file, or an endpoint did not answer.
- **low**: sends data to a third party, or uses a free-tier subdomain that could be released later.
- **info**: local-only, or traffic only to well-known hosts (GitHub, npm, PyPI, Anthropic, OpenAI).

## Rules

- Never edit plugin files to remove a plugin hook; they are overwritten on update. Tell the user to disable or uninstall the plugin (`/plugin` in Claude Code).
- Never edit managed settings; they belong to an administrator.
- Never print token or API key values. Refer to them by file name.
- Never run `remove --yes` before the user has picked the ids.
- `--check-network` sends one GET request to the root of each endpoint found. Say so before running it if the user is cautious about outbound traffic.
