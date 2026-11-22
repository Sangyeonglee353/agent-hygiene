---
name: env-guard
description: Keeps the agent from reading, searching, printing or editing environment and secrets files (.env, .env.local, .env.*, .envrc, .dev.vars, secrets.*, credentials.json, *.pem, *.key). Values are used only by variable name, loaded by the runtime itself. Use before any action that would touch such a file, and whenever a bug, error or setup step points at an environment variable, API key, token or connection string. Triggers include "환경변수", "env 파일", ".env", "API 키", "토큰", "시크릿", "env var not set", "missing API key", "unauthorized", "401", and any plan to cat, grep, Read, Edit, sed or parse such a file.
---

# env-guard

Secrets files hold real keys. Once a value appears in the conversation it is in the model's context, the session transcript and possibly logs, and it cannot be taken back. Masking the output, looking at "only one line" or fixing an obvious typo does not change that: opening the file is the problem.

Rule: **never read, search, print or edit a secrets file. Use a value only by its variable name, and let the runtime load it.**

## Off limits

Files: `.env`, `.env.local`, `.env.*` (except the templates below), `.envrc`, `.dev.vars`, `secrets.*`, `credentials.json`, service-account JSON, `*.pem`, `*.key`, and any file a project uses to hold real secrets.

Actions on those files, with any tool:

- Reading: Read, `cat`, `head`, `tail`, `type`, `Get-Content`, an editor, a script that opens the file.
- Searching: Grep, `grep`, `rg`, `findstr`, `Select-String`, even with values cut or masked by `sed`, `cut` or `awk`.
- Editing: Edit, Write, `sed -i`, a patch script, appending with `>>`.
- Copying the contents elsewhere: into a subagent prompt, another CLI, a log, a commit, a chat message, a request to an outside service.

Printing a secret that is already in the environment is the same thing by another route: no `echo $API_KEY`, `printenv`, `env`, `set`, `Get-ChildItem Env:`, no `console.log(process.env.X)`.

## Allowed

- Templates with no real values: `.env.example`, `.env.sample`, `.env.template`, `.env.*.example`. Read them to learn which variables exist.
- The code that reads the variables (`process.env.X`, `os.environ["X"]`, `import.meta.env.X`) and the docs that describe them.
- Checking that a file exists without opening it: `test -f .env.local`.
- Checking whether a variable is set without showing it: `[ -n "$NAME" ] && echo set || echo unset`. Only for a variable already in the environment; do not source the file to make it so.

## Using a value: by name, never by content

- Run through a tool that loads the file itself: `next dev`, `vite`, `node --env-file=.env.local app.js` (Node 20.6+), `dotenv -e .env.local -- <cmd>`, `docker compose --env-file`. The value goes from the file to the process, never through the conversation.
- In code, read `process.env.NAME` and pass it on. Do not log it, return it, or write it into a test fixture.
- In a shell command, write `$NAME` (or `$env:NAME`) and let the shell expand it. Never paste the literal value into a command, URL, header or file.
- If a command would echo the value (verbose curl, debug logs, stack traces with headers), turn that output off or do not run it.

## When a problem points at an env value

1. Diagnose from what is allowed: the error text, the code that reads the variable, the template.
2. Tell the user the variable's name, what the code expects, and what is probably wrong. Example: "`DATABASE_URL` is read in `src/db.ts:12` and must be a `postgres://` URL. The template has `postgres://user:pass@localhost:5432/app`; if your `.env.local` still has that, it needs your real database."
3. The user checks and changes the file. Then continue.

Do not ask the user to paste the value. If the exact value matters, ask a yes/no question ("does it start with `sk-`?", "is the host `localhost`?").

If reading the real file seems unavoidable, stop and ask first, naming the file and the reason, and wait for an explicit yes for that one file, that one time. An earlier general go-ahead does not cover it.

## Also

- A subagent or another CLI working on the user's behalf is under the same rule: say so in its prompt, and never hand it the file's contents.
- If a secret reaches the conversation by accident (a tool printed it, the user pasted it), do not repeat it or write it anywhere, and tell the user so they can rotate the key.
- Never commit these files. Check `git status` before staging.

## Hard blocking (optional)

This skill is an instruction; it cannot stop a tool call by itself. When the user wants enforcement, offer one or both of these, explain what each covers, and set up only what they agree to. Back up any settings file before editing it.

1. **Permission rules (Claude Code).** Add to `permissions.deny` in `~/.claude/settings.json`:

   ```json
   "Read(**/.env)", "Read(**/.env.*)", "Edit(**/.env)", "Edit(**/.env.*)"
   ```

   This stops the Read, Edit and Write tools (and Grep and Glob on those paths), but not shell commands such as `cat .env`. `Read(**/.env.*)` also blocks `.env.example`.

2. **The env-guard hook (Claude Code).** `scripts/env-guard-hook.mjs` is a PreToolUse hook. It blocks file tools and shell commands that read, search, print or edit a secrets file, while allowing `node --env-file=...`, `dotenv -e ...`, `docker compose --env-file ...`, `test -f`, `ls`, `git check-ignore` and templates. To install, copy the script to `~/.claude/hooks/env-guard-hook.mjs` and add to `~/.claude/settings.json`:

   ```json
   "hooks": {
     "PreToolUse": [
       {
         "matcher": "Read|Edit|Write|MultiEdit|NotebookEdit|Grep|Bash",
         "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/hooks/env-guard-hook.mjs\"" }]
       }
     ]
   }
   ```

   Merge into an existing `PreToolUse` list rather than replacing it. Tell the user to restart running sessions. When the hook blocks a step the user really wants, they can run that one command themselves with the `!` prefix.

Codex reads PreToolUse hooks from `~/.codex/hooks.json` in recent versions. The script accepts Codex's array-style commands, but check that the user's Codex version supports PreToolUse before promising enforcement there.
