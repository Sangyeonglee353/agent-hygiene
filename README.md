**한국어** | [English](README.en.md)

# agent-hygiene

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Node 18+](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)

Claude Code와 Codex를 쓸 때 지키면 좋은 기본 보안 습관을 스킬 세 개로 묶었습니다. hygiene은 "위생"이라는 뜻입니다. 손 씻기처럼 거창하지 않지만, 안 하면 나중에 크게 탈이 나는 습관들입니다.

| 스킬 | 하는 일 | 이렇게 말하면 실행됩니다 |
|---|---|---|
| [hook-cleaner](#hook-cleaner) | 쌓인 훅을 찾아서 깨졌거나 중복됐거나 위험한 것을 골라 지웁니다 | "훅 정리해줘" |
| [env-guard](#env-guard) | 에이전트가 `.env` 같은 비밀값 파일을 열지 않고, 변수 이름으로만 쓰게 합니다 | 따로 부르지 않아도 `.env`를 건드리려 할 때 적용됩니다 |
| [permission-checker](#permission-checker) | "다시 묻지 않기"로 쌓인 권한 중 지나치게 넓은 것과 키가 그대로 저장된 것을 찾습니다 | "권한 점검해줘" |

세 스킬 모두 설치할 패키지가 없고(Node.js 18 이상만 필요), 사용 기록을 어디에도 보내지 않습니다.

## 만든 이유

얼마 전 `~/.claude/settings.json`을 열어 봤다가 기억에 없는 Stop 훅을 발견했습니다. 예전에 강의를 따라 하면서 설치한 훅이었는데, 세션이 끝날 때마다 세션 데이터를 외부 서버로 보내고 있었습니다. 강의는 이미 끝났고, 서버도 운영을 멈춘 것처럼 보였습니다.

그 무렵 다른 일도 있었습니다. "환경 변수가 안 잡혀요"라고 말하자 에이전트가 문제를 찾겠다며 `.env.local`을 열었습니다. 파일을 연 순간 그 안의 키는 대화 기록에 들어가고, 되돌릴 수 없습니다.

두 사건 모두 특별한 해킹이 아니라 평소 습관의 문제였습니다. 그래서 같은 일을 겪을 분들을 위해 점검과 정리 과정을 스킬로 만들었습니다.

## 빠른 시작

1. Claude Code에서 설치합니다. 두 줄을 한 줄씩 입력하세요.

   ```
   /plugin marketplace add Sangyeonglee353/agent-hygiene
   /plugin install agent-hygiene@agent-hygiene
   ```

2. 에이전트에게 말합니다.

   > 훅 정리해줘

   > 권한 점검해줘

3. env-guard는 따로 부를 필요가 없습니다. 에이전트가 `.env`를 건드리려 하거나, 오류가 API 키·토큰·환경 변수를 가리킬 때 적용됩니다.

---

## hook-cleaner

### 왜 위험한가

훅은 세션을 시작할 때, 프롬프트를 보낼 때, 도구를 호출할 때마다 자동으로 실행되고, 대부분 대화 기록 전체를 입력으로 받습니다. 그리고 설치한 도구가 사라진 뒤에도 남습니다.

문제는 서버가 내려간 다음입니다. 운영자가 앱을 지우면 `*.up.railway.app`, `*.vercel.app` 같은 무료 서브도메인은 누구나 같은 이름으로 다시 등록할 수 있습니다. 그 훅이 서버에서 코드를 내려받아 스스로 업데이트하는 방식이라면, 이름을 새로 가져간 사람이 내 컴퓨터에서 코드를 실행할 수 있게 됩니다.

깨진 훅과 중복된 훅은 위험하지는 않지만 이벤트마다 오류를 내고, 실제로 무엇이 실행되는지 알아보기 어렵게 만듭니다.

### 실행 화면

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

에이전트는 이 출력을 그대로 보여 주지 않습니다. 무엇이 문제인지 쉬운 말로 설명하고, 어떤 훅을 지울지 물어봅니다. 지울 때는 백업을 남기고, 지운 뒤 다시 스캔해서 확인합니다.

### 찾아내는 훅

| 분류 | 의미 | 예시 |
|---|---|---|
| **broken** (깨진 훅) | 명령이 가리키는 스크립트 파일이 없습니다 | 폴더를 지웠는데 훅 등록은 남은 경우 |
| **duplicate** (중복 훅) | 같은 이벤트, matcher, 명령이 두 번 이상 등록되어 있습니다 | `~/x.js`와 절대 경로로 같은 훅을 두 번 등록한 경우 |
| **unused** (쓰지 않는 훅) | 꺼진 플러그인의 훅이거나, 통신하는 서버가 사라졌습니다 | 운영이 끝난 서비스로 계속 요청하는 경우 |
| **risky** (위험한 훅) | 코드를 내려받거나 고쳐서 실행할 수 있거나, 버려진 서버와 통신합니다 | 자동 업데이트를 하는 강의용 훅 |

| 에이전트 | 점검하는 위치 |
|---|---|
| Claude Code | 사용자, 로컬, 프로젝트, 관리자(managed) `settings.json`, `statusLine`, 설치된 플러그인의 훅 |
| Codex | `~/.codex/hooks.json`, 프로젝트 `.codex/hooks.json`, `config.toml`의 `notify`, 인라인 `[hooks]` 테이블, 플러그인 훅 |

훅이 실행하는 스크립트와 그 옆의 작은 설정 파일까지 읽습니다. 주소를 별도 파일(`api_url` 등)이나 환경 변수에 넣어 둔 훅도 그래서 찾아냅니다.

### 안전 장치

- `scan`은 읽기만 하고 파일을 고치지 않습니다.
- `--check-network`를 주지 않으면 네트워크 요청을 보내지 않습니다. 주면 발견한 서버마다 루트 주소로 GET 요청을 한 번만 보냅니다.
- `remove`는 `--yes` 없이는 바뀔 내용만 보여 줍니다.
- 파일을 고치기 전에 `*.hook-cleaner-<시각>.bak` 백업을 만듭니다. Codex `notify`는 지우지 않고 주석 처리합니다.
- 플러그인 파일과 관리자 설정은 수정하지 않습니다. 대신 플러그인을 끄거나 관리자에게 요청하라고 안내합니다.
- 토큰 같은 비밀값은 출력하지 않고 파일 이름으로만 알려 줍니다.
- star는 훅 정리를 마친 뒤 한 번만 물어봅니다. "예"라고 답했을 때만 `gh`로 누르고, 다시 묻지 않습니다.

위험도는 휴리스틱으로 판정합니다. 주석 안의 URL처럼 실제 통신이 아닌 것도 잡힐 수 있어서, 스킬은 medium 이상인 훅에 대해 에이전트가 스크립트를 직접 읽고 판단하도록 지시합니다.

<details>
<summary>에이전트 없이 스크립트만 직접 실행하기</summary>

```bash
node skills/hook-cleaner/scripts/hook-cleaner.mjs scan                  # 오프라인 점검
node skills/hook-cleaner/scripts/hook-cleaner.mjs scan --check-network  # 서버 생존 여부까지 확인
node skills/hook-cleaner/scripts/hook-cleaner.mjs scan --json           # 결과를 JSON으로 출력
node skills/hook-cleaner/scripts/hook-cleaner.mjs remove --id h-227f0b66        # 미리보기
node skills/hook-cleaner/scripts/hook-cleaner.mjs remove --id h-227f0b66 --yes  # 실제 적용
```

</details>

---

## env-guard

에이전트에게 "API 키가 안 먹어요"라고 말하면 `.env.local`을 `grep`하거나 `cat`하는 경우가 많습니다. 값을 가려서 출력하거나 "한 줄만" 보더라도, 파일을 연 순간 그 안의 키는 대화 기록과 세션 로그에 들어갈 수 있습니다. env-guard는 "비밀값 파일은 열지 않고, 값은 변수 이름으로만 쓴다"는 규칙을 에이전트가 지키게 합니다.

### 무엇이 달라지나

| 상황 | 스킬이 없을 때 흔한 행동 | 스킬이 있을 때 |
|---|---|---|
| "API 키가 안 먹어요" | `.env.local`을 열어 키 확인 | 키를 읽는 코드와 `.env.example`을 보고, 변수 이름과 기대 형식을 알려 준 뒤 사용자가 직접 확인하게 함 |
| 스크립트에 키가 필요함 | 값을 명령어에 그대로 붙여 넣음 | `node --env-file=.env.local app.js`, `$NAME`처럼 실행 도구가 읽게 함 |
| 경로 오타를 고쳐야 함 | `sed -i`로 `.env`를 직접 수정 | 어느 변수를 무엇으로 바꿔야 하는지 알려 주고 사용자가 고침 |
| 서브에이전트에 일을 맡김 | 파일 내용을 프롬프트에 붙여 넣음 | 같은 규칙을 프롬프트에 적고 내용은 넘기지 않음 |
| 실수로 키가 출력됨 | 그대로 다시 인용 | 반복하지 않고, 키를 교체하라고 알림 |

**막는 파일:** `.env`, `.env.local`, `.env.*`, `.envrc`, `.dev.vars`, `secrets.json`·`secrets.yaml` 등, `credentials.json`, `*.pem`, `*.key`

**허용:** `.env.example` 같은 템플릿, 변수를 읽는 코드, 파일 존재 확인(`test -f`), 값을 보이지 않고 설정 여부만 확인(`[ -n "$NAME" ]`)

### 강제로 막고 싶다면 (선택)

스킬은 에이전트에게 주는 지시라서, 도구 호출 자체를 막지는 못합니다. 확실히 막고 싶다면 아래 두 가지를 함께 쓰세요. 에이전트에게 "env-guard 강제 차단 켜 줘"라고 말하면 설정 파일을 백업한 뒤 대신 설정해 줍니다.

| 방법 | 막는 범위 | 못 막는 것 |
|---|---|---|
| **권한 규칙** (`permissions.deny`) | Read, Edit, Write 도구와 그 경로에 대한 Grep, Glob | `cat .env` 같은 셸 명령 |
| **env-guard 훅** (`scripts/env-guard-hook.mjs`) | 파일 도구와 셸 명령 모두. `cat`, `grep`, `sed -i`, `>> .env`, `source .env`, `printenv` 등 | 목록에 없는 이름의 비밀값 파일 |

훅은 실행 도구가 파일을 직접 읽는 방식(`node --env-file=...`, `dotenv -e ...`, `docker compose --env-file ...`)과 `test -f`, `ls`, `git check-ignore`, 템플릿 읽기는 그대로 허용합니다.

<details>
<summary>직접 설정하기</summary>

`~/.claude/settings.json`에 추가합니다. 이미 `permissions`나 `hooks`가 있다면 덮어쓰지 말고 목록에 합치세요.

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

훅 스크립트는 `skills/env-guard/scripts/env-guard-hook.mjs`를 `~/.claude/hooks/`에 복사해서 씁니다. `Read(**/.env.*)`는 `.env.example`도 막으니, 템플릿을 읽게 하려면 `allow`에 따로 추가하세요. 설정을 바꾼 뒤에는 실행 중인 세션을 다시 시작해야 적용됩니다.

</details>

---

## permission-checker

권한을 물을 때 "다시 묻지 않기"를 누르면 설정 파일에 규칙이 하나씩 쌓입니다. 몇 달이 지나면 그중 일부는 생각보다 훨씬 많은 것을 허락하고 있습니다. `Bash(curl:*)`는 어떤 데이터든 어느 서버로든 보낼 수 있게 하고, 한 번 실행한 명령에 API 키가 들어 있었다면 그 키가 `settings.local.json`에 그대로 저장됩니다.

### 찾아내는 설정

| 위험도 | 설정 | 의미 |
|---|---|---|
| high | `defaultMode: bypassPermissions` | 모든 세션에서 아무것도 묻지 않고 실행합니다 |
| high | `allow`에 저장된 API 키·토큰 | 키가 설정 파일에 평문으로 남았습니다. 규칙을 지우고 키를 교체해야 합니다 |
| high | `Bash`, `Bash(*)`, `Bash(sudo:*)`, `Bash(rm -rf:*)` | 모든 명령, 관리자 권한, 파일 삭제를 묻지 않고 허용합니다 |
| high | Codex `approval_policy = "never"` + `sandbox_mode = "danger-full-access"` | 디스크와 네트워크 전체에 접근하는 명령을 묻지 않고 실행합니다 |
| medium | `Bash(curl:*)`, `Bash(python:*)`, `Bash(npx:*)`, `Bash(git push:*)` | 외부 전송, 임의 코드 실행, 강제 푸시를 묻지 않고 허용합니다 |
| medium | 설정 파일 `env`에 저장된 키 | 비밀값이 평문으로 저장되어 있습니다(값은 출력하지 않습니다) |
| medium | `additionalDirectories`에 드라이브 전체나 홈 폴더 | 에이전트가 접근하는 범위가 지나치게 넓습니다 |
| info | `.env` 거부 규칙 없음 | env-guard의 권한 규칙을 추가하라고 안내합니다 |

스크립트는 읽기만 하고, 비밀값은 종류("API key", "Bearer token")로만 알려 줍니다. 에이전트는 결과를 설명하고 더 좁은 규칙을 제안한 뒤, 사용자가 고른 것만 백업을 남기고 고칩니다.

```bash
node skills/permission-checker/scripts/permission-checker.mjs          # 점검
node skills/permission-checker/scripts/permission-checker.mjs --json   # JSON으로 출력
```

---

## 설치

**Claude Code (플러그인, 권장)**

```
/plugin marketplace add Sangyeonglee353/agent-hygiene
/plugin install agent-hygiene@agent-hygiene
```

**Claude Code (스킬만 복사)**

```bash
git clone https://github.com/Sangyeonglee353/agent-hygiene
cp -r agent-hygiene/skills/* ~/.claude/skills/
```

**Codex**

```bash
git clone https://github.com/Sangyeonglee353/agent-hygiene
cp -r agent-hygiene/skills/* ~/.codex/skills/
```

필요한 스킬만 쓰고 싶다면 `skills/` 아래에서 원하는 폴더만 복사하면 됩니다.

## 다른 도구와 비교

이 저장소는 가볍게 시작하는 쪽에 가깝습니다. 더 강한 보호가 필요하다면 아래 도구도 살펴보세요.

| 필요한 것 | 이 저장소 | 다른 선택지 |
|---|---|---|
| 실행 전에 위험한 동작을 모두 막는 방화벽 | env-guard 훅은 비밀값 파일만 막습니다 | [hol-guard](https://github.com/hashgraph-online/hol-guard), [destructive_command_guard](https://github.com/Dicklesworthstone/destructive_command_guard) |
| `.env` 자체를 없애고 키를 금고에 보관 | `.env`는 그대로 두고 에이전트가 열지 않게만 합니다 | [Phase](https://github.com/phasehq/console), [Varlock 스킬](https://github.com/wrsmith108/varlock-claude-skill) |
| 남의 저장소를 받기 전에 `.claude/` 검사 | 내 컴퓨터에 이미 있는 훅과 권한을 점검합니다 | [medusa](https://github.com/Pantheon-Security/medusa) |
| `.claude/` 전체(스킬, 메모리, 토큰 사용량) 점검 | 훅과 권한만 봅니다 | [claude-markdown-health-check](https://github.com/ncoevoet/claude-markdown-health-check) |

## 한계

- hook-cleaner는 스킬이나 에이전트 프론트매터에 정의된 훅을 아직 스캔하지 않습니다. Codex `config.toml`의 인라인 `[hooks]` 테이블은 목록에는 나오지만 직접 수정해야 합니다.
- env-guard 스킬만으로는 강제로 막지 못합니다. 강제 차단 훅은 Claude Code 형식에 맞춰 만들었고, Codex에서는 사용하는 버전이 PreToolUse 훅을 지원하는지 먼저 확인해야 합니다.
- permission-checker는 관리자 설정, 플러그인이 넣은 권한, 실행 옵션(`--dangerously-skip-permissions`, `codex --yolo`)은 읽지 않습니다.
- 세 스킬 모두 판정은 휴리스틱입니다. 오탐이나 놓친 경우가 있으면 이슈로 알려 주세요.

## 기여

이슈와 PR 모두 좋습니다. 특히 이런 제보가 도움이 됩니다.

- 잘못 잡히거나(오탐) 놓친 훅, 권한, 비밀값 파일의 예시
- 아직 지원하지 않는 에이전트의 설정 위치
- 새로운 호스팅 서비스의 "앱 없음" 응답 패턴

테스트는 `npm test`로 실행합니다.

## 라이선스

MIT
