# Server (Bridge API)

모바일 앱과 OpenClaw 사이를 연결하는 브릿지 서버 구현 디렉토리입니다.

## 책임

- `POST /v1/message` API 제공
- Bearer Token 인증 처리
- 메시지/첨부를 OpenClawClient를 통해 전달
- 슬래시 커맨드(`/status`, `/new`, `/reset`, `/models`) 원형 전달
- `device_id -> session_id` 매핑 관리

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
기본 개발 API Key는 `dev-api-key`입니다.
운영/공유 환경에서는 `BRIDGE_API_KEYS` 환경변수로 쉼표 구분 API Key 목록을 설정합니다.

OpenClaw CLI 없이 모바일/브릿지 연동만 먼저 검증하려면 mock transport로 실행합니다.

```bash
OPENCLAW_TRANSPORT=mock npm run dev
```

Health check:

```bash
curl http://localhost:29999/health
```

Message test:

```bash
curl -X POST http://localhost:29999/v1/message \
  -H "Authorization: Bearer dev-api-key" \
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
- `src/http/messageHandler.ts`
  - 인증, DTO 검증, 세션 매핑, OpenClawClient 호출
- `src/openclaw/`
  - `OpenClawClient` 인터페이스
  - CLI 기반 `CliOpenClawClient`
  - 개발 검증용 `MockOpenClawClient`
- `src/session/SessionStore.ts`
  - 인메모리 `device_id -> session_id` 매핑

## 다음 작업 제안

- OpenClaw CLI 실제 옵션 확인 및 CLI 어댑터 보정
- 표준 로그 포맷 정리

