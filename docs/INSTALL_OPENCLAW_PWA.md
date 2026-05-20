# OpenClaw Custom PWA 설치 가이드

이 문서는 이 저장소를 clone한 뒤, 각자의 OpenClaw Gateway와 AI 모델에 연결해 Web/PWA 채널로 사용하는 절차를 정리합니다.

대상 독자는 사람 또는 로컬 AI 에이전트입니다. 설치를 자동화할 때도 이 문서를 기준으로 필요한 값만 환경에 맞게 바꾸면 됩니다.

## 1. 전체 구조

```text
Browser / PWA
  -> custom channel server :29999
  -> OpenClaw Gateway OpenAI-compatible endpoint /v1/chat/completions
  -> configured OpenClaw agent/model/tools
```

현재 권장 연결 방식은 `OPENCLAW_TRANSPORT=gateway-openai`입니다.

- PWA 서버는 자체 로그인, 대화 목록, 히스토리, 첨부, SSE job 상태를 관리합니다.
- 실제 AI 응답은 OpenClaw Gateway의 OpenAI 호환 `/v1/chat/completions` 엔드포인트로 보냅니다.
- 각 PWA conversation은 `web-conv_*` OpenClaw session key로 분리됩니다.

## 2. 사전 준비

필요한 것:

- Linux/macOS 서버 또는 개발 머신
- Node.js 22 이상 권장
- 실행 가능한 OpenClaw 설치본
- OpenClaw Gateway 실행 중
- Gateway token
- Gateway config에서 OpenAI-compatible chat completions endpoint 활성화

OpenClaw Gateway는 로컬에서 보통 다음 주소를 사용합니다.

```text
http://127.0.0.1:18789
```

Gateway의 `/v1/chat/completions`가 꺼져 있으면 `gateway-openai` transport는 404로 실패합니다. 먼저 OpenClaw 쪽 설정에서 chat completions endpoint를 켜세요.

## 3. 저장소 받기

```bash
git clone https://github.com/goldenman-kr/openclaw-custom-channel.git
cd openclaw-custom-channel/server
npm install
```

## 4. 환경변수 설정

`server/.env.example`을 참고해 `.env` 또는 systemd Environment로 설정합니다.

최소 예시:

```bash
HOST=0.0.0.0
PORT=29999
NODE_ENV=production

# PWA 서버 API key. 길고 랜덤한 값 사용.
BRIDGE_API_KEYS='replace-with-long-random-token'

# 최초 관리자 자동 생성용. 운영 전 반드시 강한 비밀번호 사용.
AUTH_ADMIN_USERNAME=admin
AUTH_ADMIN_PASSWORD='replace-with-strong-password'
AUTH_COOKIE_SECURE=1

# OpenClaw Gateway 연결.
OPENCLAW_TRANSPORT=gateway-openai
OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN='replace-with-openclaw-gateway-token'
OPENCLAW_GATEWAY_MODEL=openclaw

# 긴 작업 허용 시간. 필요 시 조정.
OPENCLAW_GATEWAY_TIMEOUT_MS=1800000
OPENCLAW_TIMEOUT_MS=1800000
STALE_JOB_CLEANUP_AFTER_MS=1800000

# 외부 도메인에서 서비스할 경우 실제 origin으로 변경.
CORS_ALLOW_ORIGIN=https://your-pwa.example.com
VITE_APP_ORIGIN=https://your-pwa.example.com
```

주의:

- `.env`, token, password는 git에 커밋하지 않습니다.
- `BRIDGE_API_KEYS`는 legacy Bearer API 호환용이고, 일반 브라우저 사용자는 `/v1/auth/login` 쿠키 세션을 씁니다.
- HTTPS 도메인에서 운영하면 `AUTH_COOKIE_SECURE=1`을 유지하세요.
- HTTP localhost 개발에서는 secure cookie 때문에 로그인이 안 되면 `AUTH_COOKIE_SECURE=0`으로 테스트할 수 있습니다.

## 5. 빌드와 실행

개발 실행:

```bash
npm run dev
```

운영 빌드:

```bash
npm run build
npm start
```

정상 확인:

```bash
curl http://127.0.0.1:29999/health
curl http://127.0.0.1:29999/v1/version
```

브라우저에서 접속:

```text
http://127.0.0.1:29999/
```

## 6. 관리자 계정 생성

`AUTH_ADMIN_USERNAME` / `AUTH_ADMIN_PASSWORD`를 설정하고 서버를 시작하면 최초 관리자 계정을 자동 보장합니다.

또는 수동으로 생성할 수 있습니다.

```bash
cd server
npm run user:create -- admin --role admin --password '<strong-password>'
```

비밀번호 재설정:

```bash
npm run user:reset-password -- admin --password '<new-strong-password>'
```

사용자 목록 확인:

```bash
npm run user:list
```

## 7. systemd user service 예시

운영 서버에서는 user systemd service로 띄우는 방식이 편합니다.

`~/.config/systemd/user/openclaw-custom-channel.service` 예시:

```ini
[Unit]
Description=OpenClaw Custom Web/PWA Channel
After=network-online.target openclaw-gateway.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/openclaw-custom-channel/server
Environment=NODE_ENV=production
Environment=HOST=0.0.0.0
Environment=PORT=29999
Environment=OPENCLAW_TRANSPORT=gateway-openai
Environment=OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
Environment=OPENCLAW_GATEWAY_MODEL=openclaw
EnvironmentFile=%h/.config/openclaw-custom-channel/env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

`~/.config/openclaw-custom-channel/env`에는 secret을 둡니다.

```bash
BRIDGE_API_KEYS=replace-with-long-random-token
AUTH_ADMIN_USERNAME=admin
AUTH_ADMIN_PASSWORD=replace-with-strong-password
AUTH_COOKIE_SECURE=1
OPENCLAW_GATEWAY_TOKEN=replace-with-openclaw-gateway-token
CORS_ALLOW_ORIGIN=https://your-pwa.example.com
VITE_APP_ORIGIN=https://your-pwa.example.com
```

적용:

```bash
npm run build
systemctl --user daemon-reload
systemctl --user enable --now openclaw-custom-channel.service
systemctl --user status openclaw-custom-channel.service --no-pager
```

## 8. Reverse proxy / HTTPS

PWA, push notification, 위치 권한은 HTTPS에서 가장 안정적으로 동작합니다.

예시 Caddy 설정:

```caddyfile
your-pwa.example.com {
  reverse_proxy 127.0.0.1:29999
}
```

도메인을 붙이면 다음 값을 맞춥니다.

```bash
CORS_ALLOW_ORIGIN=https://your-pwa.example.com
VITE_APP_ORIGIN=https://your-pwa.example.com
AUTH_COOKIE_SECURE=1
```

## 9. 데이터 저장 위치

기본 경로는 `server/state/`입니다.

주요 파일:

```text
server/state/chat.sqlite                 # 로그인 사용자, 대화 목록, 메시지, 첨부 메타, jobs, push, plugin records
server/state/chat.sqlite-wal             # SQLite WAL
server/state/chat.sqlite-shm             # SQLite shared memory
server/state/history/                    # legacy device/user 기반 history JSON
server/state/history-media/              # 대화 history 첨부 저장본
server/state/uploads/                    # OpenClaw로 전달한 첨부 임시/저장본
server/state/workspaces/                 # PWA 로그인 사용자별 runtime workspace
server/state/restart-followups/          # 재시작 follow-up 예약 상태
```

백업하려면 최소한 `server/state/chat.sqlite*`, `server/state/history-media/`, `server/state/uploads/`, `server/state/workspaces/`를 포함하세요.

`server/state/`와 `server/public/download/`는 git에 올리지 않는 런타임 데이터입니다.

## 10. OpenClaw 연결 확인

Gateway endpoint smoke:

```bash
OPENCLAW_GATEWAY_TOKEN='<gateway-token>' npm run smoke:gateway-openai
```

PWA bridge까지 포함한 smoke:

```bash
npm run build
OPENCLAW_GATEWAY_TOKEN='<gateway-token>' npm run smoke:bridge-gateway-openai
```

브라우저에서 로그인 후 `/status`, `/model`, `/think` 같은 native command로 현재 세션과 모델 상태를 확인할 수 있습니다.

## 11. 다른 AI 에이전트에게 설치를 맡길 때 줄 작업 지시 예시

```text
이 repo를 clone해서 내 OpenClaw Gateway에 연결되는 PWA custom channel을 설치해줘.
반드시 docs/INSTALL_OPENCLAW_PWA.md를 먼저 읽고 따라라.
내 Gateway URL은 http://127.0.0.1:18789 이고, Gateway token은 <TOKEN>이다.
도메인은 https://your-pwa.example.com 이다.
secret은 git에 커밋하지 말고 ~/.config/openclaw-custom-channel/env에 둬라.
npm install, npm run build, systemd user service 등록, /health 확인까지 해라.
```

## 12. 문제 해결 체크리스트

- `/health`는 되지만 답변이 안 옴: `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_GATEWAY_URL`, chat completions endpoint 활성화 여부 확인
- 브라우저 로그인 유지가 안 됨: HTTPS + `AUTH_COOKIE_SECURE=1` 조합 확인. localhost HTTP 테스트는 `AUTH_COOKIE_SECURE=0`
- CORS 오류: `CORS_ALLOW_ORIGIN`이 실제 접속 origin과 정확히 일치하는지 확인
- 긴 작업이 중간에 끊김: `OPENCLAW_GATEWAY_TIMEOUT_MS`, `OPENCLAW_TIMEOUT_MS`, reverse proxy timeout 확인
- 대화가 섞임: conversation별 `web-conv_*` session key가 유지되는지 확인. DB를 지우면 기존 conversation mapping도 사라짐
