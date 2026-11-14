# hook-audit

Claude Code와 Codex가 자동으로 실행하는 훅을 찾아서 위험도를 점검하고, 고른 훅만 백업한 뒤 제거합니다.

[English README](README.md)

## 왜 필요한가

훅은 세션이 시작될 때, 프롬프트를 보낼 때, 도구를 호출할 때마다 실행되고, 많은 훅이 대화 기록 전체를 입력으로 받습니다. 강의, 체험판, 사이드 프로젝트가 설치한 훅은 그 활동이 끝난 뒤에도 남아 있습니다.

- 강의가 끝나도 훅은 사용량과 세션 데이터를 계속 서버로 보냅니다.
- 서버가 쓰던 무료 서브도메인(`*.up.railway.app`, `*.vercel.app`, `*.herokuapp.com` 등)이 삭제되면, 누구든 같은 이름을 다시 등록해서 그 데이터를 받을 수 있습니다.
- 서버에서 코드를 내려받아 스스로 업데이트하는 훅이라면, 그 이름을 새로 가져간 사람이 내 컴퓨터에서 코드를 실행할 수 있습니다.

`hook-audit`은 모든 훅을 나열하고, 각 훅이 어디와 통신하는지, 그 서버가 아직 살아 있는지 확인한 뒤, 사용자가 고른 훅만 백업을 남기고 제거합니다.

## 설치

### Claude Code (플러그인)

```
/plugin marketplace add Sangyeonglee353/hook-audit
/plugin install hook-audit@hook-audit
```

### Claude Code (스킬만 복사)

```bash
git clone https://github.com/Sangyeonglee353/hook-audit
cp -r hook-audit/skills/hook-audit ~/.claude/skills/
```

### Codex

```bash
git clone https://github.com/Sangyeonglee353/hook-audit
cp -r hook-audit/skills/hook-audit ~/.codex/skills/
```

Node.js 18 이상이 필요하고, 추가 의존성은 없습니다.

## 사용법

에이전트에게 "훅 점검해줘" 또는 "audit my hooks"라고 요청하면 됩니다. 스킬이 훅을 스캔하고, 결과를 설명하고, 어떤 훅을 지울지 물어본 뒤, 백업을 남기고 제거하고, 다시 스캔해서 확인합니다.

스크립트를 직접 실행할 수도 있습니다.

```bash
node skills/hook-audit/scripts/hook-audit.mjs scan                  # 오프라인 점검
node skills/hook-audit/scripts/hook-audit.mjs scan --check-network  # 서버 생존 여부까지 확인
node skills/hook-audit/scripts/hook-audit.mjs remove --id h-227f0b66        # 미리보기
node skills/hook-audit/scripts/hook-audit.mjs remove --id h-227f0b66 --yes  # 실제 적용
```

## 안전 장치

- `scan`은 읽기만 합니다. `--check-network`를 주지 않으면 네트워크 요청을 전혀 보내지 않고, 주면 발견한 서버마다 루트 주소로 GET 요청을 한 번 보냅니다.
- `remove`는 `--yes`를 주기 전까지 미리보기만 하며, 파일을 고치기 전에 `*.hook-audit-<시각>.bak` 백업을 먼저 만듭니다.
- 플러그인 훅과 관리자 설정(managed settings)은 수정하지 않고, 플러그인을 끄거나 관리자에게 요청하라고 안내합니다.
- 토큰 값은 출력하지 않습니다.

위험도는 휴리스틱으로 판정하기 때문에, 주석 안에 있는 URL처럼 실제 통신이 아닌 경우도 잡힐 수 있습니다. 그래서 스킬은 medium 이상인 훅에 대해 에이전트가 스크립트를 직접 읽고 판단하도록 지시합니다.

## 한계

- 스킬이나 에이전트 프론트매터에 정의된 훅은 아직 스캔하지 않습니다.
- Codex `config.toml` 안의 인라인 `[hooks]` 테이블은 목록에는 나오지만, 직접 수정해야 합니다.
- 실행 중에 원격 데이터로 조립되는 주소는 정적 분석으로 찾을 수 없습니다.

## 라이선스

MIT
