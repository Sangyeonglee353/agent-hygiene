**한국어** | [English](README.en.md)

# hook-cleaner

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Node 18+](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-blue)
![Claude Code](https://img.shields.io/badge/Claude_Code-supported-D97757)
![Codex](https://img.shields.io/badge/Codex-supported-111111)

**Claude Code와 Codex에 쌓인 훅을 한 번에 정리합니다.**

_강의는 끝났는데, 그때 설치한 훅은 아직도 내 대화를 어딘가로 보내고 있을 수 있습니다._

[빠른 시작](#빠른-시작) • [실행 화면](#실행-화면) • [찾아내는 훅](#찾아내는-훅) • [설치](#설치) • [안전 장치](#안전-장치)

---

## 이런 분께 필요합니다

- 강의, 부트캠프, 체험판 도구를 따라 하면서 **설치 명령을 그대로 붙여 넣은 적이 있는 분**
- `settings.json`을 열어 봐도 **어떤 훅이 왜 등록되어 있는지 모르겠는 분**
- 플러그인을 여러 개 쓰다 보니 **훅이 중복되거나 깨져서 오류가 나는 분**
- 회사 컴퓨터에서 **내 세션 데이터가 어디로 나가는지 확인해야 하는 분**

## 왜 위험한가

훅은 세션을 시작할 때, 프롬프트를 보낼 때, 도구를 호출할 때마다 자동으로 실행되고, 대부분 **대화 기록 전체를 입력으로 받습니다.** 그런데 훅은 설치한 도구보다 오래 남습니다.

1. 강의가 끝나도 훅은 사용량과 세션 데이터를 계속 서버로 보냅니다.
2. 운영자가 서버를 내리면 `*.up.railway.app`, `*.vercel.app` 같은 무료 서브도메인이 풀리고, **누구나 같은 이름을 다시 등록할 수 있습니다.**
3. 그 훅이 서버에서 코드를 내려받아 스스로 업데이트하는 방식이라면, 이름을 새로 가져간 사람이 **내 컴퓨터에서 코드를 실행할 수 있습니다.**

깨진 훅과 중복된 훅은 위험하지는 않지만, 이벤트마다 오류를 내고 실제로 무엇이 실행되는지 알아보기 어렵게 만듭니다.

## 빠른 시작

1. Claude Code에서 설치합니다. 두 줄을 **한 줄씩** 입력하세요.

   ```
   /plugin marketplace add Sangyeonglee353/hook-cleaner
   /plugin install hook-cleaner@hook-cleaner
   ```

2. 에이전트에게 말합니다.

   > 훅 정리해줘

3. 결과를 읽고 지울 훅을 고르면 끝입니다. 에이전트가 백업을 남기고 지운 뒤, 다시 스캔해서 확인합니다.

여기까지만 해 보셔도 이 도구가 필요한지 바로 아실 수 있습니다.

## 실행 화면

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

에이전트는 이 결과를 그대로 보여 주지 않고, 무엇이 문제인지 쉬운 말로 설명한 뒤 어떤 훅을 지울지 물어봅니다.

## 찾아내는 훅

| 분류 | 의미 | 예시 |
|---|---|---|
| **broken** (깨진 훅) | 명령이 가리키는 스크립트 파일이 없습니다 | 폴더를 지웠는데 훅 등록은 남은 경우 |
| **duplicate** (중복 훅) | 같은 이벤트, matcher, 명령이 두 번 이상 등록되어 있습니다 | `~/x.js`와 절대 경로로 같은 훅을 두 번 등록한 경우 |
| **unused** (쓰지 않는 훅) | 꺼진 플러그인의 훅이거나, 통신하는 서버가 사라졌습니다 | 운영이 끝난 서비스로 계속 요청하는 경우 |
| **risky** (위험한 훅) | 코드를 내려받거나 고쳐서 실행할 수 있거나, 버려진 서버와 통신합니다 | 자동 업데이트를 하는 강의용 훅 |

### 점검하는 위치

| 에이전트 | 위치 |
|---|---|
| Claude Code | 사용자, 로컬, 프로젝트, 관리자(managed) `settings.json`, `statusLine`, 설치된 플러그인의 훅 |
| Codex | `~/.codex/hooks.json`, 프로젝트 `.codex/hooks.json`, `config.toml`의 `notify`, 인라인 `[hooks]` 테이블, 플러그인 훅 |

훅이 실행하는 스크립트와 그 옆의 작은 설정 파일까지 읽기 때문에, 주소를 별도 파일(`api_url` 등)이나 환경 변수에 넣어 둔 훅도 찾아냅니다.

## 설치

Node.js 18 이상이 필요하고, 추가로 설치할 패키지는 없습니다.

**Claude Code (플러그인, 권장)**

```
/plugin marketplace add Sangyeonglee353/hook-cleaner
/plugin install hook-cleaner@hook-cleaner
```

**Claude Code (스킬만 복사)**

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
<summary>에이전트 없이 스크립트만 직접 실행하기</summary>

```bash
node skills/hook-cleaner/scripts/hook-cleaner.mjs scan                  # 오프라인 점검
node skills/hook-cleaner/scripts/hook-cleaner.mjs scan --check-network  # 서버 생존 여부까지 확인
node skills/hook-cleaner/scripts/hook-cleaner.mjs scan --json           # 결과를 JSON으로 출력
node skills/hook-cleaner/scripts/hook-cleaner.mjs remove --id h-227f0b66        # 미리보기
node skills/hook-cleaner/scripts/hook-cleaner.mjs remove --id h-227f0b66 --yes  # 실제 적용
```

</details>

## 안전 장치

훅을 지우는 도구는 그 자체로 설정 파일을 고치기 때문에, 다음 원칙을 지킵니다.

- **읽기 전용이 기본입니다.** `scan`은 파일을 고치지 않습니다.
- **네트워크 요청은 선택 사항입니다.** `--check-network`를 주지 않으면 요청을 전혀 보내지 않습니다. 주면 발견한 서버마다 루트 주소로 GET 요청을 한 번만 보냅니다.
- **미리보기 후 적용합니다.** `remove`는 `--yes` 없이는 바뀔 내용만 보여 줍니다.
- **항상 백업합니다.** 파일을 고치기 전에 `*.hook-cleaner-<시각>.bak`을 만듭니다. Codex `notify`는 지우지 않고 주석 처리합니다.
- **남의 파일은 건드리지 않습니다.** 플러그인 파일과 관리자 설정은 수정하지 않고, 플러그인을 끄거나 관리자에게 요청하라고 안내합니다.
- **비밀 값은 출력하지 않습니다.** 토큰은 파일 이름으로만 알려 줍니다.
- **텔레메트리가 없습니다.** 이 도구는 사용 기록을 어디에도 보내지 않습니다.
- **star는 동의할 때만 누릅니다.** 정리를 마친 뒤 한 번만 물어보고, "예"라고 답했을 때만 `gh`로 star를 누르며, 다시는 묻지 않습니다.

위험도는 휴리스틱으로 판정하기 때문에 주석 안의 URL처럼 실제 통신이 아닌 경우도 잡힐 수 있습니다. 그래서 스킬은 medium 이상인 훅에 대해 에이전트가 스크립트를 직접 읽고 판단하도록 지시합니다.

## 한계

- 스킬이나 에이전트 프론트매터에 정의된 훅은 아직 스캔하지 않습니다.
- Codex `config.toml`의 인라인 `[hooks]` 테이블은 목록에는 나오지만 직접 수정해야 합니다.
- 실행 중에 원격 데이터로 조립되는 주소는 정적 분석으로 찾을 수 없습니다.

## 기여

이슈와 PR을 환영합니다. 특히 다음 제보가 도움이 됩니다.

- 잘못 잡히거나(오탐) 놓친 훅의 예시
- 아직 지원하지 않는 에이전트의 훅 설정 위치
- 새로운 호스팅 서비스의 "앱 없음" 응답 패턴

테스트는 `npm test`로 실행합니다.

## 라이선스

MIT
