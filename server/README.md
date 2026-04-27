# Server (Bridge API)

모바일 앱과 OpenClaw 사이를 연결하는 브릿지 서버 구현 디렉토리입니다.

## 책임

- `POST /v1/message` API 제공
- 서버 내장 Web/PWA 채팅 UI 제공 (`GET /`)
- Bearer Token 인증 처리
- 메시지/첨부를 OpenClawClient를 통해 전달
- 슬래시 커맨드(`/status`, `/new`, `/reset`, `/models`) 원형 전달
- `device_id/user_id -> session_id` 매핑 관리
- 세션별 서버 히스토리 저장/조회 (`/v1/history`)

## 구현 원칙

- 외부 계약(`/v1/message`)은 안정적으로 유지
- OpenClaw 연동은 `OpenClawClient` 인터페이스 뒤로 캡슐화
- MVP 1차 구현은 CLI 방식 우선, 이후 Gateway/Plugin으로 교체 가능
- API/에러/첨부 제한은 `specification.md`의 `8.1.1 API Contract v1 (Locked for MVP)`를 기준으로 고정

## 실행

```bash
npm install
npm run dev
```

기본 바인딩은 외부 접근 가능한 `HOST=0.0.0.0`, `PORT=29999`입니다.
운영/공유 환경에서는 `BRIDGE_API_KEYS` 환경변수로 쉼표 구분 API Key 목록을 설정합니다.
Web UI는 API Key를 자동 입력하지 않으므로, 설정 화면에서 키를 직접 입력해야 합니다.

기본 OpenClaw transport는 `openclaw agent`입니다. 모바일 `device_id` 또는 Web UI의 `user_id`는 브릿지에서 `mobile-<id>` 세션으로 매핑되고, 아래 형식으로 OpenClaw Gateway agent turn을 실행합니다.

```bash
npm run dev
```

선택적으로 특정 agent/thinking/timeout을 지정할 수 있습니다.

```bash
OPENCLAW_AGENT=main \
OPENCLAW_THINKING=medium \
OPENCLAW_AGENT_TIMEOUT_SECONDS=600 \
npm run dev
```

외부 채널 발송용 `openclaw message send` transport가 필요하면 명시적으로 켭니다.

```bash
OPENCLAW_TRANSPORT=cli-message \
OPENCLAW_CHANNEL=telegram \
OPENCLAW_TARGET='<telegram-chat-id-or-username>' \
npm run dev
```

OpenClaw CLI 없이 모바일/브릿지 연동만 먼저 검증하려면 mock transport로 실행합니다.

```bash
OPENCLAW_TRANSPORT=mock npm run dev
```

Web UI:

```bash
open http://localhost:29999/
```

브라우저에서 `현재위치 포함`을 켜면 Geolocation API로 좌표를 가져와 메시지 본문에 `현재위치: <lat>, <lon>` 형식으로 붙입니다. 위치 권한은 HTTPS 또는 localhost 환경에서만 정상 동작합니다.

Web UI는 같은 API Key를 SHA-256 해시한 `x-user-id`를 사용합니다. 같은 API Key를 입력한 PC/모바일 브라우저는 같은 OpenClaw 세션과 서버 히스토리를 공유합니다. UI 대화목록은 `/v1/history`를 통해 시작 시 복원되고, 5초 polling으로 다른 기기의 변경을 반영합니다.

Health check:

```bash
curl http://localhost:29999/health
```

History test:

```bash
curl http://localhost:29999/v1/history \
  -H "Authorization: Bearer <api-key>" \
  -H "x-user-id: web-api-key-example"
```

Message test:

```bash
curl -X POST http://localhost:29999/v1/message \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -H "x-device-id: abc-123" \
  -d '{"message":"hello"}'
```

## 검증

```bash
npm run build
npm test
```

## 현재 추가된 계약 코드

- `src/contracts/apiContractV1.ts`
  - `MessageRequestDto`, `MessageResponseDto`, `ErrorResponseDto`
  - Bearer 헤더 추출 유틸 (`extractBearerToken`)
  - 요청 검증 함수 (`validateMessageRequestDto`)
- `src/index.ts`
  - Node HTTP 기반 `/v1/message` 엔드포인트
  - `public/` 정적 Web/PWA UI 서빙
- `src/http/messageHandler.ts`
  - 인증, DTO 검증, 세션 매핑, OpenClawClient 호출
- `src/openclaw/`
  - `OpenClawClient` 인터페이스
  - Gateway agent turn 기반 `AgentOpenClawClient`
  - CLI 기반 `CliOpenClawClient`
  - 개발 검증용 `MockOpenClawClient`
- `src/session/SessionStore.ts`
  - 인메모리 `device_id/user_id -> session_id` 매핑
- `src/session/HistoryStore.ts`
  - 파일 기반 세션 히스토리 저장소

## 다음 작업 제안

- `/v1/message/stream` SSE 또는 WebSocket 기반 스트리밍 응답 추가
- Agent JSON 응답 구조에 맞춘 reply 추출 정교화
- 표준 로그 포맷 정리

