# Multi-session Implementation Notes

작성일: 2026-04-29  
브랜치: `multi-session`  
대상: `server/` 저장 구조 및 conversation 기반 API 1차 구현

## 현재 작업 범위

이번 작업은 UI 구현이 아니라 서버 저장 구조와 인터페이스 기반 작업이다. 기존 Web/PWA 단일 채팅 구조를 바로 깨지 않기 위해 기존 `FileHistoryStore`/`/v1/history` 흐름은 유지하고, SQLite 기반 conversation 저장소를 점진 도입했다.

## 변경 파일

- `server/package.json`
- `server/package-lock.json`
- `server/src/contracts/apiContractV1.ts`
- `server/src/http/messageHandler.ts`
- `server/src/http/conversationHandler.test.ts`
- `server/src/index.ts`
- `server/src/session/SqliteChatStore.ts`
- `server/src/session/SqliteChatStore.test.ts`

참고: `MULTI_SESSION_PLAN.md`는 작업 시작 전부터 수정 상태였고, 이번 구현 기록 작성 전에는 해당 변경을 그대로 유지했다.

## 1. SQLite 도입 및 라이브러리 선택

### 선택

- `better-sqlite3`를 채택했다.
- 타입 패키지로 `@types/better-sqlite3`를 추가했다.

### 이유

- 현재 서버가 단순 Node HTTP 구조이고 DB 접근 패턴도 서버 로컬/관리자 1인 구조이므로 동기 API가 구현을 단순하게 만든다.
- SQLite 파일 기반 저장소는 JSON history 파일보다 conversation 목록 정렬, 세션별 메시지 분리, migration marker 관리에 적합하다.

### 남은 확인

- 현재 개발 환경에서는 설치, 테스트, 빌드가 통과했다.
- 다만 `better-sqlite3`는 native addon이므로 실제 배포 대상 OS/Node 조합에서도 설치 검증이 필요하다.

## 2. DB schema/migration

`server/src/session/SqliteChatStore.ts`에 schema 초기화/migration 코드를 추가했다.

생성 테이블:

- `conversations`
- `messages`
- `attachments`
- `jobs`
- `app_meta`

계획서의 권장 schema와 같은 기본 구조를 따른다.

주요 컬럼:

- `conversations.id`
- `conversations.openclaw_session_id`
- `messages.conversation_id`
- `messages.role`
- `messages.job_id`
- `jobs.conversation_id`
- `app_meta.key/value`

DB 기본 경로:

```text
server/state/chat.sqlite
```

환경변수 override:

```text
CHAT_DB_PATH=<path>
HISTORY_DIR=<path>
```

## 3. Store 인터페이스

`SqliteChatStore.ts`에 얇은 인터페이스 경계를 추가했다.

- `ConversationStore`
- `MessageStore`
- `JobStore`

구현체:

- `SqliteChatStore`

주요 메서드:

- `createConversation`
- `getConversation`
- `listConversations`
- `updateConversation`
- `addMessage`
- `updateMessage`
- `listMessages`
- `createJob`
- `getJob`
- `updateJob`

기존 `FileHistoryStore`는 삭제하거나 대체하지 않고 그대로 유지했다. `/v1/message`에서 `conversation_id`가 없으면 legacy 흐름을 계속 사용한다. `/v1/history`는 `conversation_id` query가 있으면 SQLite conversation history를 사용하고, 없으면 기존 FileHistoryStore 흐름을 유지한다.

## 4. 기존 history migration 정책

기존 단일 history를 SQLite로 자동 import하는 코드는 제거했다.

결정:

- 기존 대화 기록은 필수 migration 대상이 아니다.
- 완성 후 필요하면 별도 수동 작업으로 가져온다.
- 사용자가 원하면 기존 기록을 무시하고 완전히 새로운 앱처럼 시작할 수 있다.
- 따라서 서버 startup에서 `HISTORY_DIR/*.json`을 자동으로 읽어 conversation을 생성하지 않는다.

현재 startup은 SQLite schema만 준비한다.

```ts
const chatStore = new SqliteChatStore(resolve(process.env.CHAT_DB_PATH ?? join(stateDir, "chat.sqlite")));
```

## 5. Conversation API

최소 conversation API를 `server/src/index.ts`에 추가했다.

추가된 endpoint:

```text
GET    /v1/conversations
POST   /v1/conversations
GET    /v1/conversations/:id
PATCH  /v1/conversations/:id
DELETE /v1/conversations/:id
GET    /v1/conversations/:id/history
```

정책:

- `DELETE`는 hard delete가 아니라 `archived_at` 설정이다.
- 목록은 archived conversation을 기본 제외한다.
- `GET /v1/conversations?include_archived=1`로 archived 포함 조회가 가능하다.
- 모든 endpoint는 기존 Bearer API Key 인증을 사용한다.

## 6. `/v1/history` conversation_id 연결

기존 `/v1/history` endpoint에 optional query parameter를 추가했다.

```text
GET    /v1/history?conversation_id=conv_xxx
POST   /v1/history?conversation_id=conv_xxx
DELETE /v1/history?conversation_id=conv_xxx
```

동작:

- `conversation_id`가 있으면 SQLite `messages`를 조회/추가/삭제한다.
- `conversation_id`가 없으면 기존 `FileHistoryStore` 흐름을 유지한다.
- `GET /v1/conversations/:id/history`와 같은 응답 구조를 사용한다.
- `meta=1`도 conversation 기준으로 동작한다.

이로써 기존 API를 깨지 않고 Web/PWA가 active conversation만 먼저 붙일 수 있는 경로를 만들었다.

## 7. `/v1/message` conversation_id 지원

`MessageRequestDto`에 optional `conversation_id`를 추가했다.

```json
{
  "conversation_id": "conv_xxx",
  "message": "hello",
  "attachments": [],
  "metadata": {}
}
```

처리 방식:

- `conversation_id`가 있으면 `ConversationStore`에서 conversation을 조회한다.
- 존재하면 conversation의 `openclawSessionId`를 OpenClaw `sessionId`로 사용한다.
- 없는 `conversation_id`면 `CONVERSATION_NOT_FOUND` 404를 반환한다.
- `conversation_id`가 없으면 기존 `x-device-id`/`x-user-id` 기반 `FileHistoryStore` legacy 흐름을 유지한다.

`MessageResponseDto`에는 optional `conversation_id`를 추가했다.

## 8. Job 저장/조회

conversation 기반 메시지 전송 시:

- 기존 in-memory `jobs` Map에도 job을 유지한다.
- SQLite `jobs` table에도 job을 저장/업데이트한다.
- pending assistant placeholder 메시지를 SQLite `messages`에 저장하고, 완료/실패 시 같은 message id를 업데이트한다.

`GET /v1/jobs/:id` 변경:

- conversation job은 `?conversation_id=<id>`가 일치해야 조회된다.
- legacy job은 기존처럼 header 기반 session 검증을 사용한다.

## 9. 테스트/검증

추가/확장된 테스트:

- `server/src/session/SqliteChatStore.test.ts`
  - conversation/message/attachment/job 생성 검증
- `server/src/http/conversationHandler.test.ts`
  - `conversation_id` 제공 시 conversation의 `openclawSessionId` 사용 검증
  - 없는 `conversation_id`는 404 검증

실행한 검증:

```bash
npm --prefix server test
npm --prefix server run build
```

결과:

- test: 통과
- build: 통과

추가 smoke 검증:

- mock server 실행
- `POST /v1/conversations`
- `POST /v1/message` with `conversation_id`
- `GET /v1/jobs/:id?conversation_id=...`
- `GET /v1/conversations/:id/history`
- `GET/POST/DELETE /v1/history?conversation_id=<id>`

결과: 통과

## 10. MULTI_SESSION_PLAN.md 대비 재검증

### 부합하는 부분

- SQLite 우선 도입: 부합
- `better-sqlite3` 선택: 부합
- Conversation/Message/Job 저장소 설계: 부합
- 최소 schema/migration 코드 추가: 부합
- `ConversationStore`/`MessageStore` 또는 통합 store 추가: `SqliteChatStore`로 부합
- 기존 `FileHistoryStore`와 충돌하지 않는 점진 도입: 부합
- 기존 단일 history migration: 사용자 결정에 따라 자동 import 제거. 필요 시 완성 후 수동 처리
- Conversation API 추가: 부합
- 기존 `/v1/history`의 conversation query 지원: 부합
- `/v1/message`에 `conversation_id` 지원: 부합
- conversation별 `openclawSessionId` 사용: 부합
- job 상태 SQLite 저장: 부분 부합
- UI/sidebar/drawer/token streaming 미구현: 부합
- 기존 API를 한 번에 깨지 않음: 대체로 부합. `conversation_id`는 optional이고 legacy fallback 유지
- git push/commit 미실행: 부합

### 계획과 다르거나 주의가 필요한 부분

1. `GET /v1/jobs/:id` conversation 검증 방식
   - 계획은 “conversationId 검증 포함”이다.
   - 현재 구현은 query parameter `?conversation_id=<id>`로 검증한다.
   - API 형태가 명시적으로 계획에 고정되어 있지는 않지만, 클라이언트 구현 시 반드시 이 query를 붙여야 한다.

2. legacy history migration 미구현
   - 최초 계획에는 기존 history import 설계가 포함되어 있었다.
   - 사용자 결정에 따라 자동 migration 코드는 제거했다.
   - 기존 기록은 완성 후 수동 import하거나 무시하고 새 앱처럼 시작하는 방향이다.

3. `/v1/history` conversation 기반 내부 연결
   - `?conversation_id=` query 방식으로 연결했다.
   - query가 없으면 기존 legacy history 흐름을 유지하므로 Web/PWA 전환을 점진적으로 할 수 있다.

4. `openclaw_session_id` API 응답 노출
   - public API 응답에서는 제거했다.
   - server 내부 store와 OpenClaw routing에는 계속 사용한다.

5. `server/src/index.ts`의 책임 증가
   - 빠른 점진 구현을 위해 route 로직이 `index.ts`에 추가되었다.
   - 계획 12장의 얇은 인터페이스 경계 원칙에는 store 인터페이스 측면에서 대체로 부합한다.
   - 다만 다음 단계에서 `conversationHandler`/`chatService`로 분리하면 유지보수성이 좋아진다.

6. job persistence는 conversation job에만 적용
   - conversation 기반 job은 SQLite에 저장된다.
   - legacy `/v1/message` job은 기존 in-memory Map + FileHistoryStore 흐름을 유지한다.
   - 점진 도입 원칙에는 맞지만, 완전한 job persistence는 아직 아니다.

## 11. 다음 단계 권장

1. Web/PWA UI 개편 전에 단일 active conversation만 서버 DB history를 사용하도록 붙인다.
2. `index.ts`에서 conversation route를 별도 handler/service로 분리한다.
3. 필요하면 `/v1/jobs/:id`의 conversation 검증을 query가 아닌 route/body 정책으로 정리한다.
4. 기존 history가 꼭 필요해지면 별도 수동 import script를 그때 작성한다.
5. 이후 sidebar/drawer UI 구현 전에 PWA cache version 증가 계획을 반영한다.

## 12. 현재 결론

현재 구현은 `MULTI_SESSION_PLAN.md`의 서버 저장 구조/인터페이스 기반 1차 목표에서 크게 벗어나지 않았다. 다만 `/v1/jobs/:id`의 query 기반 conversation 검증과 `index.ts` route 책임 증가는 다음 단계에서 정리하는 것이 좋다.
## 13. Web/PWA active conversation 1차 연결

PLAN의 9.5 단계인 “기존 단일 UI에서 active conversation만 먼저 붙이기”를 수행했다.

변경 파일:

- `server/public/app.js`
- `server/public/sw.js`

적용 내용:

- Web/PWA startup 시 active conversation을 보장한다.
  - `settings.lastActiveConversationId`가 있으면 해당 conversation을 우선 사용한다.
  - 없거나 서버에 없으면 `GET /v1/conversations`의 첫 항목을 사용한다.
  - conversation이 하나도 없으면 `POST /v1/conversations`로 새 conversation을 만든다.
- 기존 단일 UI는 그대로 유지하고, 내부 API 호출만 active conversation 기준으로 연결했다.
- `/v1/message` 전송 body에 `conversation_id`를 포함한다.
- `/v1/history` 조회/메타/삭제/추가는 `?conversation_id=<active>`를 붙인다.
- `/v1/jobs/:id` 조회는 `?conversation_id=<active>`를 붙인다.
- pending job localStorage key에 active conversation id를 포함해 conversation 간 pending job 충돌을 줄였다.
- 설정 패널의 “새 대화 시작”은 더 이상 `/new`를 전송하지 않고, 새 conversation을 생성한다. 기존 대화는 보존된다.
- 이전 localStorage history import 코드는 제거했다. 기존 기록은 자동 migration하지 않는다.
- PWA cache version을 `openclaw-web-channel-v63`으로 올렸다.

PLAN 대비 검증:

- 데스크톱 sidebar UI는 구현하지 않았다.
- 모바일 drawer UI는 구현하지 않았다.
- token-level streaming은 구현하지 않았다.
- 기존 단일 UI를 유지하면서 active conversation만 서버 DB에 연결했으므로 PLAN 9.5와 부합한다.
- UI의 새 대화 시작이 `/new` 전송이 아니라 conversation 생성 방식으로 바뀌어 PLAN 6.4/5.6 방향과 부합한다.
- API Key는 여전히 인증에만 사용되고, 채팅 구분은 `conversation_id`가 담당한다. 단, legacy 호환용 `x-user-id` header는 일부 요청에 남아 있다.

남은 주의점:

- 아직 conversation 목록 UI가 없으므로 사용자가 과거 conversation으로 직접 전환할 방법은 없다.
- active conversation 선택은 `lastActiveConversationId` 또는 서버 목록 첫 항목 기준이다.
- 다음 단계는 데스크톱 sidebar 구현 또는 route/service 분리 중 하나다. PLAN 순서상 데스크톱 sidebar가 다음이다.
## 14. 데스크톱 sidebar 1차 구현

PLAN의 6.2/9.6 단계인 데스크톱 sidebar를 구현했다.

변경 파일:

- `server/public/index.html`
- `server/public/app.js`
- `server/public/styles.css`
- `server/public/sw.js`

적용 내용:

- 데스크톱 폭(`min-width: 900px`)에서 왼쪽 sidebar를 표시한다.
- sidebar 구성:
  - 앱 타이틀
  - `새 대화` 버튼
  - conversation list
  - 하단 `설정` 버튼
- 기존 우상단 floating settings button은 데스크톱에서 숨긴다.
- conversation list는 `GET /v1/conversations` 기준으로 렌더링한다.
- active conversation을 강조 표시한다.
- sidebar의 conversation을 클릭하면 active conversation을 전환하고 `GET /v1/history?conversation_id=<id>`로 메시지를 다시 렌더링한다.
- sidebar의 `새 대화`는 `POST /v1/conversations`로 새 conversation을 만들고 즉시 active로 전환한다.
- PWA cache version을 `openclaw-web-channel-v64`로 올렸다.

PLAN 대비 검증:

- 데스크톱 sidebar 요구사항에 부합한다.
- 설정 진입 버튼을 sidebar 하단에 추가했다.
- 기존 우상단 설정 floating button은 데스크톱에서 숨긴다.
- active conversation 강조 표시를 구현했다.
- 아직 모바일 drawer는 구현하지 않았다. PLAN 순서상 다음 단계다.
- token-level streaming은 건드리지 않았다.

남은 주의점:

- conversation title 자동 갱신은 아직 없다. 현재는 생성 시 `새 대화` 또는 서버에 저장된 title을 사용한다.
- conversation list polling은 아직 없다. 메시지 전송 후 한 번 refresh하고, 수동 새로고침/전환으로 갱신된다.
## 15. 모바일 drawer/menu 1차 구현

PLAN의 6.3/9.7 단계인 모바일 drawer/menu를 구현했다.

변경 파일:

- `server/public/index.html`
- `server/public/app.js`
- `server/public/styles.css`
- `server/public/sw.js`

적용 내용:

- 모바일 기본 화면은 채팅 패널 중심으로 유지한다.
- 좌상단 floating menu button(`☰`)을 추가했다.
- 버튼 클릭 시 conversation sidebar를 drawer로 표시한다.
- drawer에는 기존 sidebar와 동일하게 다음 항목이 들어간다.
  - 새 대화
  - conversation list
  - 설정
- drawer backdrop 클릭 시 닫힌다.
- ESC 입력 시 media viewer가 열려 있으면 viewer를 먼저 닫고, 그렇지 않으면 drawer를 닫는다.
- conversation 선택, 새 대화 생성, 설정 진입 시 drawer를 닫는다.
- 데스크톱(`min-width: 900px`)에서는 기존 sidebar 레이아웃을 유지하고 모바일 menu button/backdrop은 숨긴다.
- PWA cache version을 `openclaw-web-channel-v65`로 올렸다.

PLAN 대비 검증:

- 모바일 drawer/menu 요구사항에 부합한다.
- drawer 외부 클릭 닫기를 구현했다.
- ESC 닫기를 구현했다.
- 데스크톱 sidebar와 모바일 drawer는 같은 conversation list 상태를 공유한다.
- token-level streaming은 건드리지 않았다.

남은 주의점:

- 브라우저/Android WebView의 native back button 연동은 아직 별도 구현하지 않았다. 필요하면 history state 기반으로 추가한다.
- conversation title 자동 생성/갱신은 아직 없다.
## 16. Conversation title 자동 생성

PLAN의 desktop sidebar 요구사항 중 “conversation title은 첫 사용자 메시지 기반으로 임시 생성하거나 서버에서 업데이트” 항목을 보강했다.

변경 파일:

- `server/src/index.ts`

적용 내용:

- conversation title이 `새 대화`이고 첫 사용자 메시지가 저장되는 시점이면, 서버가 해당 메시지 앞부분으로 title을 자동 갱신한다.
- title은 공백을 정규화하고 최대 40자까지 사용하며 초과 시 `…`를 붙인다.
- 첨부만 보낸 경우 fallback 메시지로 title이 만들어진다.

검증:

- `npm --prefix server test` 통과
- `npm --prefix server run build` 통과
- mock server smoke로 첫 메시지 전송 후 `GET /v1/conversations` title 갱신 확인

PLAN 대비 검증:

- sidebar의 임시 title 요구사항에 부합한다.
- UI 전용 로직이 아니라 서버 conversation metadata 갱신으로 처리했다.
## 17. SSE job events PoC

PLAN의 7장/9.10 단계인 streaming 구조 검토를 코드 수준의 작은 PoC로 반영했다. token-level streaming은 구현하지 않았다.

변경 파일:

- `server/src/index.ts`

추가 endpoint:

```text
GET /v1/jobs/:id/events
GET /v1/jobs/:id/events?conversation_id=conv_xxx
```

동작:

- `text/event-stream` SSE 응답을 제공한다.
- 현재 job 상태를 `event: job`으로 전송한다.
- job이 `completed` 또는 `failed`가 되면 최종 상태를 보내고 연결을 닫는다.
- job이 없어지면 `event: expired`를 보내고 닫는다.
- conversation job은 기존 job 조회와 동일하게 `conversation_id` query가 일치해야 한다.
- legacy job은 기존 header 기반 session 검증을 따른다.

PLAN 대비 검증:

- token-level streaming은 구현하지 않았다.
- 현재 polling 구조를 유지하면서 SSE status/final event PoC만 추가했다.
- Web/PWA는 아직 이 endpoint를 사용하지 않으므로 기존 UX를 깨지 않는다.

## 18. PLAN completion sweep

현재 구현 기준으로 `MULTI_SESSION_PLAN.md`의 주요 항목을 다시 점검했다.

완료/반영:

- SQLite store 및 migration 기반 추가
- Conversation API 추가
- 기존 `/v1/history`의 conversation 기반 query 연결
- `/v1/message`에 `conversation_id` 지원
- 기존 단일 UI에서 active conversation 연결
- 데스크톱 sidebar 추가
- 모바일 drawer/menu 추가
- 새 대화 시작을 conversation 생성 방식으로 변경
- legacy localStorage history 자동 import 제거
- PWA cache version 증가
- SSE job status events PoC 추가
- API Key는 인증 용도로 유지하고, 채팅 구분은 `conversation_id` 기준으로 전환
- conversation별 `openclawSessionId` 사용
- conversation 기반 messages/jobs SQLite 저장

의도적으로 미구현/보류:

- token-level streaming: 사용자가 금지한 범위이고 PLAN에서도 OpenClaw token stream 접근 가능 시 추후 검토로 분리되어 있어 구현하지 않았다.
- legacy file history 자동 migration: 사용자 결정에 따라 제거했다. 필요하면 완성 후 수동 import script로 처리한다.
- Android native back button drawer 연동: PLAN에서 “검토” 항목이며 현재 ESC/backdrop 닫기까지만 구현했다.
- route/service 파일 분리: store/runtime 경계는 두었지만 `index.ts` route 책임은 아직 크다. 기능 완성 후 리팩터링 후보로 남긴다.

현재 기준으로 multi-session PLAN의 기능 흐름은 1차 완료 상태다. 다음 작업은 기능 추가보다 안정화/리팩터링/실기기 QA 성격이 강하다.

## 19. `/new` direct command 차단 정책 반영

PLAN 5.6의 `/new` 정책 변경을 반영했다.

변경 파일:

- `server/src/contracts/apiContractV1.ts`
- `server/src/http/messageHandler.ts`
- `server/src/http/messageHandler.test.ts`
- `server/public/app.js`
- `server/public/sw.js`

적용 내용:

- 사용자가 직접 `/new` 또는 `/new ...`를 입력해 `/v1/message`로 보내면 서버 validation 단계에서 차단한다.
- 차단 응답 code는 `VALIDATION_NEW_COMMAND_BLOCKED`이고 HTTP status는 400이다.
- 안내 문구는 PLAN의 예시 문구를 그대로 사용한다.
  - `이 웹챗에서는 /new 대신 “새 대화 시작” 버튼을 사용해주세요.`
- 차단은 OpenClaw 호출 전에 수행되므로 `openclaw agent`로 `/new`가 전달되지 않는다.
- Web/PWA slash command palette에서 `/new` 항목을 제거했다.
- UI의 새 대화 생성은 계속 `POST /v1/conversations` 버튼/메뉴 액션으로만 처리한다.
- PWA cache version을 `openclaw-web-channel-v66`으로 올렸다.

PLAN 대비 검증:

- UI 새 채팅 생성은 `/new` 전송이 아니라 새 conversation 생성으로 처리한다: 부합.
- 사용자가 직접 `/new`를 입력하면 OpenClaw로 전달하지 않고 차단한다: 부합.
- 새 conversation 생성은 버튼/메뉴 액션으로만 처리한다: 부합.
- `/reset` 정책은 변경하지 않았다. 현재 active conversation의 `conversation_id`와 함께 전송되므로 현재 conversation의 OpenClaw 세션에만 적용된다.

## 20. Conversation rename/delete UI

사용자 요청에 따라 Web/PWA 대화 목록에 per-conversation action menu를 추가했다.

### 반영 내용

- 대화 제목 옆 `⋯` 메뉴 추가
- 메뉴 항목:
  - `이름 변경`
  - `삭제`
- `이름 변경` 선택 시 native `<dialog>` 기반 이름 변경 다이얼로그 표시
- `삭제` 선택 시 native `<dialog>` 기반 삭제 확인 다이얼로그 표시
- 제목 변경은 기존 `PATCH /v1/conversations/:id`를 사용한다.
- 삭제는 `DELETE /v1/conversations/:id`를 archive가 아닌 hard delete로 변경했다.
  - SQLite `conversations` row 삭제
  - FK `ON DELETE CASCADE`로 messages/attachments/jobs 삭제
  - in-memory job map에서 해당 conversation job 제거
  - OpenClaw explicit session index/file을 best-effort로 삭제
- PWA cache version을 `openclaw-web-channel-v67`로 올렸다.

### OpenClaw 세션 삭제 방식

`openclaw agent --session-id <openclawSessionId>`는 OpenClaw 내부에서 `agent:<agentId>:explicit:<openclawSessionId>` session key로 매핑된다. 서버 삭제 처리 시 다음을 수행한다.

- `~/.openclaw/agents/<agentId>/sessions/sessions.json`에서 해당 explicit session key 제거
- index entry에 연결된 session file과 같은 session id의 trajectory/checkpoint 파일 제거
- session index가 없거나 이미 없으면 skipped로 처리하고 DB 삭제는 계속 진행

### 검증

- `npm --prefix server test` 통과
- `npm --prefix server run build` 통과
- `node --check server/public/app.js` 통과
- mock server smoke:
  - conversation 생성
  - title PATCH
  - message enqueue
  - DELETE hard delete
  - 삭제 후 GET 404 확인
  - UI menu marker 및 SW v67 확인

## 21. Per-conversation FIFO job queue

실전 테스트 중 같은 conversation에서 응답 대기 중 추가 입력이 가능해지면 동일 `openclawSessionId`로 병렬 `openclaw agent` 호출이 발생할 수 있다는 문제가 확인되어 서버 레벨 큐를 추가했다.

### 반영 내용

- 서버에 `jobQueueTails`를 추가해 job 실행을 key별 Promise chain으로 직렬화했다.
- queue key는 conversation job이면 `conversation:<conversationId>`, legacy job이면 `session:<sessionId>`이다.
- 같은 conversation의 메시지는 FIFO로 순차 실행된다.
- 다른 conversation의 메시지는 서로 다른 queue key라 병렬 실행 가능하다.
- job 생성 직후 assistant placeholder는 `응답 대기 중입니다…`로 저장한다.
- 실제 실행이 시작되면 job state를 `running`으로 바꾸고 placeholder를 `응답을 처리 중입니다…`로 업데이트한다.
- UI pending detection이 `응답 대기 중입니다…`와 `응답을 처리 중입니다…`를 모두 pending으로 인식하도록 업데이트했다.
- PWA cache version을 `openclaw-web-channel-v71`로 올렸다.

### 검증

- `node --check server/public/app.js` 통과
- `npm --prefix server run build` 통과
- `npm --prefix server test` 통과

## 22. 실전 테스트 후 UX/queue 보정

실제 OpenClaw 연동 테스트 중 확인된 Web/PWA UX 문제를 보정했다.

### 플로팅 설정 버튼 제거

- 모바일/우측 상단의 `⚙️` 플로팅 설정 버튼을 제거했다.
- 설정 진입은 sidebar/drawer 하단의 `설정` 버튼으로 단일화했다.
- 버튼 DOM이 없어도 JS가 안전하게 동작하도록 optional chaining 처리했다.
- PWA cache version을 `openclaw-web-channel-v68`로 올렸다.

### 대화 메뉴 표시 오류 수정

- `⋯` conversation menu가 클릭 전에도 항상 보이던 문제를 수정했다.
- 원인은 뒤쪽에 추가된 `.conversation-menu { display: grid; }`가 전역 `.hidden { display: none; }`보다 우선한 것이었다.
- `.conversation-menu.hidden { display: none; }`를 추가해 점3개 클릭 시에만 표시되도록 했다.
- PWA cache version을 `openclaw-web-channel-v69`로 올렸다.

### 대화별 입력 잠금 분리

- A 대화 응답 대기 중 B 대화 입력창까지 비활성화되는 문제를 수정했다.
- 기존 `isSendingMessage` 전역 잠금은 요청 enqueue/준비 중에만 적용되도록 축소했다.
- pending job 조회/저장은 conversation id별 key로 분리했다.
- active conversation이 아닌 job 완료 시에는 현재 화면을 강제로 갱신하지 않고 conversation list만 갱신하도록 조정했다.
- PWA cache version을 `openclaw-web-channel-v70`으로 올렸다.

### Same-conversation FIFO queue

- 같은 conversation에서 응답 대기 중 추가 입력을 보내면 동일 `openclawSessionId`에 병렬 호출이 발생할 수 있어 서버 레벨 FIFO queue를 추가했다.
- `jobQueueTails` Promise chain으로 queue key별 순차 실행을 보장한다.
- queue key:
  - conversation job: `conversation:<conversationId>`
  - legacy job: `session:<sessionId>`
- 같은 conversation은 FIFO 순차 실행, 다른 conversation은 병렬 실행 가능하다.
- job placeholder 문구를 상태별로 구분했다.
  - queued: `응답 대기 중입니다…`
  - running: `응답을 처리 중입니다…`
- UI pending detector가 두 문구를 모두 pending으로 인식하도록 업데이트했다.
- PWA cache version을 `openclaw-web-channel-v71`으로 올렸다.

### PC 스크롤바 스타일 개선

- PC/마우스 환경에서 대화창, 대화목록, 설정 패널, textarea의 scrollbar를 얇은 반투명 thumb으로 변경했다.
- scrollbar track 배경은 transparent로 처리했다.
- hover 시 thumb만 약간 진해지도록 했다.
- PWA cache version을 `openclaw-web-channel-v72`로 올렸다.

### Message ordering 안정화

- queue placeholder가 완료 시점에 `created_at`을 갱신하면서 답변 위치가 뒤로 이동하는 문제를 수정했다.
- conversation message update 시 완료/실패/처리중 전환은 최초 placeholder 위치를 유지하고 role/text만 바꾸도록 했다.
- 같은 millisecond에 user message와 assistant placeholder가 생성되면 id 정렬 때문에 `job_...`이 `msg_...`보다 앞에 표시될 수 있어 SQLite history 조회 정렬을 보정했다.
- 동일 `created_at`에서는 `user → assistant → system` 순서가 되도록 했다.
- 동일 timestamp에서 user가 assistant placeholder보다 먼저 표시되는 테스트를 추가했다.
- PWA cache version을 `openclaw-web-channel-v73`으로 올렸다.

### 검증

- `node --check server/public/app.js` 통과
- `npm --prefix server run build` 통과
- `npm --prefix server test` 통과
