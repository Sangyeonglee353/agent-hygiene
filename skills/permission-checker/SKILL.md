---
name: permission-checker
description: Checks Claude Code and Codex permission settings for risky choices and explains them in plain words, without printing any secret. Finds bypass mode, blanket allow rules (Bash(*), sudo, rm, curl, git push, any interpreter), API keys or tokens saved inside allow rules or settings env blocks, whole-drive additionalDirectories, a missing deny rule for .env files, and Codex approval_policy = never with sandbox_mode = danger-full-access. Use when the user asks what the agent is allowed to do, wants to tighten or review permissions, after accepting many "always allow" prompts, or says "권한 점검", "권한 확인", "permissions audit", "what can Claude run without asking".
---

# permission-checker

Every "Yes, and don't ask again" adds a rule to a settings file. Over months those rules pile up, and a few of them hand the agent far more than the user meant: `Bash(curl:*)` lets it send any data anywhere, `Bash(python:*)` runs any code, and a one-off command that carried an API key gets saved into `settings.local.json` with the key in plain text. Codex has the same problem in one line: `approval_policy = "never"` with `sandbox_mode = "danger-full-access"`.

This skill finds those settings and helps the user decide what to keep. It changes nothing on its own.

## Workflow

1. **Scan.** Run from the user's current project so project settings are included:

   ```bash
   node <skill-dir>/scripts/permission-checker.mjs
   ```

   `<skill-dir>` is the folder containing this SKILL.md. Add `--json` when you need to process results. The script is read-only and never prints secret values; a key is reported by its kind only.

2. **Explain.** Start with the counts, then go through findings from high to low. For each one say where it is, what it lets the agent do without asking, and a realistic example of how that goes wrong. Keep `info` items to one line.

3. **Do not open the settings files to look at secrets.** If a finding says a key sits in an allow rule or an `env` block, do not read or print that value. The fix does not need it: the rule or entry is removed as a whole, and the user rotates the key on the provider's side.

4. **Recommend.** Offer a narrower replacement where one exists:
   - `Bash(curl:*)` → the specific commands actually used, such as `Bash(curl -s https://api.github.com/*)`, or no rule at all.
   - `Bash(python:*)`, `Bash(node:*)`, `Bash(npx:*)` → the scripts actually run, such as `Bash(npm test:*)`.
   - `Bash(git push:*)` → remove it; pushing is worth one prompt.
   - `defaultMode: bypassPermissions` → `acceptEdits` if the goal is fewer prompts for file edits.
   - Codex `danger-full-access` + `never` → `workspace-write` + `on-request`, or keep full access only in a named profile used on purpose.
   - Missing `.env` deny → add `"Read(**/.env)", "Read(**/.env.*)", "Edit(**/.env)", "Edit(**/.env.*)"` to `permissions.deny`. Note that `Read(**/.env.*)` also blocks `.env.example`; add an `allow` for the template if the user wants it readable. Point to the env-guard skill for the shell side.

   Then ask which changes to make. Wait for an answer.

5. **Change.** For each file you edit, copy it to `<file>.permission-checker-<timestamp>.bak` first, then make only the agreed edits. For a rule or `env` entry that holds a secret, delete the whole line with a structural edit (parse and rewrite the JSON, or remove the exact array element by index) so the value never appears in your output. Never touch managed or enterprise settings; tell the user to ask their administrator.

6. **Verify.** Run the scan again and show the new counts. Remind the user that running sessions keep the old permissions until restarted, and that any key that was stored in plain text should be rotated even after removal, because the settings file may have been synced or backed up.

## What it checks

| Agent | Files | Findings |
|---|---|---|
| Claude Code | `~/.claude/settings.json`, `~/.claude/settings.local.json`, `<project>/.claude/settings.json`, `<project>/.claude/settings.local.json` | `bypassPermissions`, skipped bypass warning, blanket `allow` rules, secrets inside `allow` rules, secrets in `env`, whole-drive or home `additionalDirectories`, no `.env` deny rule |
| Codex | `~/.codex/config.toml` (or `$CODEX_HOME`) | `never` + `danger-full-access` at top level or in a profile, either one alone, workspace sandbox with network on, secrets stored as plain values |

## Limits

- Rule matching is a heuristic. A broad rule can be fine in a throwaway container; say so when the user's context suggests it.
- Managed settings, plugin-provided permissions and command-line flags (`--dangerously-skip-permissions`, `codex --yolo`) are not read.
- A secret saved under a name and format the patterns do not know will be missed.
