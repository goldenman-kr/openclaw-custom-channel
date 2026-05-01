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

## 22. Web/PWA SSE job events UI 연결

PLAN 7.4의 “SSE로 job 상태와 최종 응답 이벤트 제공” 단계를 Web/PWA UI에 연결했다. token-level streaming은 아직 구현하지 않았다.

변경 파일:

- `server/public/app.js`
- `server/public/sw.js`

적용 내용:

- 기존 `waitForJob()`의 public 동작은 유지하되, 내부에서 먼저 `GET /v1/jobs/:id/events?conversation_id=...` SSE endpoint를 `fetch()` stream으로 연결한다.
- native `EventSource`는 Authorization header를 보낼 수 없으므로 사용하지 않았다. 대신 `fetch()` + `ReadableStream`으로 `text/event-stream` 응답을 파싱한다.
- `event: job`에서 `completed`/`failed`를 받으면 pending job을 정리하고 기존 완료 처리 흐름으로 반환한다.
- `event: expired`를 받으면 pending job을 정리하고 `expired` 상태로 반환한다.
- 브라우저/프록시/네트워크 문제로 SSE 연결이 실패하거나 중간에 끊기면 기존 `/v1/jobs/:id` polling 루틴으로 자동 fallback한다.
- PWA cache version을 `openclaw-web-channel-v77`로 올렸다.

검증:

- `node --check server/public/app.js` 통과
- `npm --prefix server run build` 통과
- `npm --prefix server test` 통과
- mock server smoke에서 conversation 생성 → message enqueue → `/v1/jobs/:id/events?conversation_id=...` 수신 → `event: job` 및 `state: completed` 확인

주의:

- 현재 단계는 상태/완료 이벤트 스트리밍이다. 토큰 단위 텍스트 streaming은 OpenClaw runtime/transport가 생성 중 텍스트 조각을 제공할 수 있을 때 `token`/`done` 이벤트를 추가하는 별도 단계로 남긴다.

## 23. ChatRuntime 인터페이스 경계 1차 분리

나중에 OpenClaw CLI transport를 Gateway/plugin/streaming transport로 교체하기 쉽게 하기 위해 server 내부 runtime 경계를 1차로 분리했다.

변경 파일:

- `server/src/runtime/ChatRuntime.ts`
- `server/src/runtime/OpenClawChatRuntime.ts`
- `server/src/http/messageHandler.ts`
- `server/src/http/messageHandler.test.ts`
- `server/src/http/conversationHandler.test.ts`
- `server/src/index.ts`

적용 내용:

- `ChatRuntime` 인터페이스를 추가했다.
  - 입력: `sessionId`, `message`, `userId`, `attachments`, `metadata`
  - 출력: `reply`, optional `raw`
- `OpenClawChatRuntime` adapter를 추가해 기존 `OpenClawClient` 구현체를 감싼다.
- HTTP message handler는 더 이상 `OpenClawClient`에 직접 의존하지 않고 `ChatRuntime`에 의존한다.
- 기존 `AgentOpenClawClient`/`CliOpenClawClient`/`MockOpenClawClient`는 그대로 유지해 기능 변경을 최소화했다.
- 테스트 fake도 `OpenClawClient` 대신 `ChatRuntime` 기준으로 바꿨다.

의미:

- 현재 동작은 그대로 유지하면서, 이후 streaming 가능한 runtime을 추가할 때 `ChatRuntime` 구현체만 교체/확장하는 방향으로 갈 수 있다.
- token-level streaming은 아직 구현하지 않았다. 다음 분리 후보는 SSE/polling 전달 책임을 `EventPublisher` 계층으로 빼는 작업이다.

검증:

- `npm --prefix server test` 통과
- `npm --prefix server run build` 통과

## 24. EventPublisher 경계 1차 분리

SSE job event 전달 책임을 `index.ts`에서 분리해 `EventPublisher` 계층의 첫 구현체로 옮겼다.

변경 파일:

- `server/src/events/SseJobEventPublisher.ts`
- `server/src/index.ts`
- `MULTI_SESSION_IMPL.md`

적용 내용:

- `SseJobEventPublisher`를 추가했다.
- `GET /v1/jobs/:id/events` 라우트는 계속 `index.ts`에서 잡지만, 실제 인증 확인, SSE header 작성, `event: job`/`event: expired` 송신, interval cleanup은 publisher가 담당한다.
- publisher는 `getJob(jobId, request, url)` 콜백으로 job 상태를 가져오므로, polling/SSE/WebSocket 등 전달 방식이 job 저장소 구현에 직접 묶이지 않는다.
- 기존 SSE endpoint contract와 Web/PWA fetch-stream fallback 동작은 유지했다.

의미:

- PLAN 12의 `EventPublisher` 분리 방향에 맞춰 첫 경계를 만들었다.
- 이후 token-level streaming이 가능해지면 같은 publisher 계층에 `token`/`done` 이벤트를 추가하거나, WebSocket publisher를 별도 구현체로 추가할 수 있다.

검증:

- `npm --prefix server test` 통과
- `npm --prefix server run build` 통과
- mock server smoke에서 conversation 생성 → message enqueue → `/v1/jobs/:id/events?conversation_id=...` 수신 → `event: job` 및 `state: completed` 확인

## 25. Job route handler 분리

`index.ts`의 route 책임을 줄이기 위해 job 조회/SSE route 처리를 별도 handler로 분리했다.

변경 파일:

- `server/src/http/jobRoutes.ts`
- `server/src/index.ts`
- `MULTI_SESSION_IMPL.md`

적용 내용:

- `handleJobRoute()`를 추가했다.
- `GET /v1/jobs/:id` 조회와 `GET /v1/jobs/:id/events` SSE route 판단/응답을 `jobRoutes.ts`로 옮겼다.
- 실제 SSE 송신은 기존 `SseJobEventPublisher`에 위임한다.
- `index.ts`는 `handleJobRoute(...)` 호출 후 처리 여부만 확인하도록 줄였다.

의미:

- route/service 분리의 첫 작고 안전한 단계다.
- 다음 분리 후보는 conversation route 또는 history route다.

검증:

- `npm --prefix server test` 통과
- `npm --prefix server run build` 통과

## 26. Conversation route handler 분리

`index.ts`의 conversation route 책임을 별도 handler로 분리했다.

변경 파일:

- `server/src/http/conversationRoutes.ts`
- `server/src/index.ts`
- `MULTI_SESSION_IMPL.md`

적용 내용:

- `handleConversationRoute()`를 추가했다.
- `GET/POST /v1/conversations`, `GET/PATCH/DELETE /v1/conversations/:id`, `GET /v1/conversations/:id/history` 처리를 `conversationRoutes.ts`로 옮겼다.
- conversation DTO 변환, conversation path parsing, conversation history response 생성도 같은 모듈로 이동했다.
- 삭제 시 OpenClaw session cleanup과 in-memory job 정리는 `index.ts`에서 콜백으로 주입해 route handler가 runtime/session 파일 구조에 직접 묶이지 않게 했다.
- `/v1/history?conversation_id=...`에서 재사용하는 `conversationHistoryResponse()`는 export해서 유지했다.

의미:

- `index.ts`의 route 책임이 더 줄었다.
- 다음 분리 후보는 `/v1/history` route다.

검증:

- `npm --prefix server test` 통과
- `npm --prefix server run build` 통과

## 27. History route handler 분리

`index.ts`의 `/v1/history` route 책임을 별도 handler로 분리했다.

변경 파일:

- `server/src/http/historyRoutes.ts`
- `server/src/index.ts`
- `MULTI_SESSION_IMPL.md`

적용 내용:

- `handleHistoryRoute()`를 추가했다.
- `GET/POST/DELETE /v1/history` 처리를 `historyRoutes.ts`로 옮겼다.
- legacy `FileHistoryStore` 흐름과 conversation 기반 history 흐름을 모두 유지했다.
- history import payload 정규화(`normalizeHistoryMessages`)와 attachment 정규화도 history route 모듈로 이동했다.
- conversation 기반 history response는 기존 `conversationRoutes.ts`의 `conversationHistoryResponse()`를 재사용한다.
- `index.ts`는 `handleHistoryRoute(...)` 호출 후 처리 여부만 확인한다.

의미:

- job/conversation/history route가 모두 `index.ts` 밖으로 빠져 route 책임이 더 명확해졌다.
- 다음 후보는 message send route 또는 media/static route 분리다.

검증:

- `npm --prefix server test` 통과
- `npm --prefix server run build` 통과

## 28. Message route handler 분리

`index.ts`의 `POST /v1/message` route 책임을 별도 handler로 분리했다.

변경 파일:

- `server/src/http/messageRoutes.ts`
- `server/src/runtime/MessageJob.ts`
- `server/src/index.ts`
- `MULTI_SESSION_IMPL.md`

적용 내용:

- `handleMessageRoute()`를 추가했다.
- `POST /v1/message`의 validation, sync request 처리, conversation 조회, queued job 생성, assistant placeholder 저장, job enqueue, route-level error handling을 `messageRoutes.ts`로 옮겼다.
- `MessageJob`/`JobState` 타입을 `runtime/MessageJob.ts`로 분리해 `index.ts`, `messageRoutes.ts`, job/event 흐름에서 공유할 수 있게 했다.
- user message persistence와 job 실행/완료 처리 콜백은 기존 `index.ts` 구현을 주입해 기능 변경을 최소화했다.
- `index.ts`는 `handleMessageRoute(...)` 호출 후 미처리 요청을 404로 응답한다.

의미:

- job/conversation/history/message 주요 API route가 모두 `index.ts` 밖으로 분리됐다.
- `index.ts`는 아직 server bootstrap, static/media, shared stores/jobs orchestration 책임을 갖고 있다.
- 다음 후보는 media/static route 분리 또는 job orchestration(`enqueueMessageJob`/`runMessageJob`) service 분리다.

검증:

- `npm --prefix server test` 통과
- `npm --prefix server run build` 통과

## 29. Message job runner 분리

message job queue/run/complete/fail orchestration을 `index.ts`에서 `MessageJobRunner`로 분리했다.

변경 파일:

- `server/src/runtime/MessageJobRunner.ts`
- `server/src/index.ts`
- `MULTI_SESSION_IMPL.md`

적용 내용:

- `MessageJobRunner`를 추가했다.
- conversation/session별 순차 queue 관리, `handlePostMessage()` 실행, running/completed/failed 상태 갱신, assistant/system placeholder 업데이트를 runner가 담당한다.
- raw OpenClaw output이 UI에 그대로 저장되지 않도록 막는 `sanitizeAssistantReply()`/embedded payload 추출 로직도 runner로 이동했다.
- `index.ts`는 job 생성/등록과 route callback 주입만 담당하고, 실제 job 실행 세부사항은 runner에 위임한다.

의미:

- message route와 job execution 책임이 분리되어, 추후 streaming-capable runtime이 생길 때 job runner에서 `token`/`done` 이벤트 발행을 붙이기 쉬워졌다.
- 다음 후보는 static/media route 분리 또는 MessageJobRunner가 EventPublisher에 직접 이벤트를 publish하도록 확장하는 작업이다.

검증:

- `npm --prefix server test` 통과
- `npm --prefix server run build` 통과

## 30. SSE job event 즉시 publish 연결

SSE job event가 polling interval에만 의존하지 않도록 `MessageJobRunner`의 job 상태 변경과 `SseJobEventPublisher`를 연결했다.

변경 파일:

- `server/src/events/SseJobEventPublisher.ts`
- `server/src/index.ts`
- `MULTI_SESSION_IMPL.md`

적용 내용:

- `SseJobEventPublisher`에 job별 subscriber 관리와 `publishJob(job)` 메서드를 추가했다.
- `/v1/jobs/:id/events` 연결은 최초 상태를 보낸 뒤 해당 job id subscriber로 등록된다.
- `updateJob()`이 job 상태를 바꿀 때마다 `jobEventPublisher.publishJob(job)`을 호출한다.
- `completed`/`failed` terminal 상태를 publish하면 해당 SSE 연결을 닫고 subscriber를 정리한다.
- 기존 interval polling은 안전장치로 유지해, publish 이벤트를 놓치거나 subscriber 등록 전 상태가 바뀐 경우에도 기존 동작이 유지된다.

의미:

- 현재 SSE 상태/완료 스트리밍이 2초 polling tick보다 빠르게 반응할 수 있다.
- 나중에 token-level streaming을 붙일 때도 같은 publisher subscriber 구조에 `token`/`done` 이벤트를 추가하기 쉽다.

검증:

- `npm --prefix server test` 통과
- `npm --prefix server run build` 통과

## 31. Static/media route handler 분리

정적 Web/PWA asset serving과 `/v1/media` file serving을 `index.ts`에서 분리했다.

변경 파일:

- `server/src/http/staticRoutes.ts`
- `server/src/index.ts`
- `MULTI_SESSION_IMPL.md`

적용 내용:

- `handleStaticRoute()`를 추가했다.
- public directory traversal 방어, content-type 판정, cache-control 설정, `GET`/`HEAD` 정적 파일 응답을 static route 모듈로 이동했다.
- `handleMediaRoute()`를 추가했다.
- `/v1/media?path=...` bearer auth, allowed media root 검증, content-type/content-length/content-disposition 응답을 static route 모듈로 이동했다.
- `index.ts`는 `handleMediaRoute(...)`, `handleStaticRoute(...)` 호출만 담당한다.

의미:

- `index.ts`에서 HTTP bootstrap/orchestration 외 route 세부 구현이 대부분 제거됐다.
- Web/PWA asset serving과 authenticated media serving이 API route와 분리되어 테스트/교체가 쉬워졌다.

검증:

- `npm --prefix server test` 통과
- `npm --prefix server run build` 통과

## 32. SSE immediate publish 회귀 테스트 추가

`SseJobEventPublisher`의 즉시 publish 경로를 테스트로 고정했다.

변경 파일:

- `server/src/events/SseJobEventPublisher.test.ts`
- `server/src/events/SseJobEventPublisher.ts`
- `MULTI_SESSION_IMPL.md`

적용 내용:

- connected SSE subscriber가 최초 `queued` 상태를 받은 뒤 `publishJob(running)`과 `publishJob(completed)`를 즉시 수신하는 테스트를 추가했다.
- terminal 상태(`completed`/`failed`) publish 시 subscriber와 polling interval을 함께 정리하도록 publisher 내부 subscriber 모델을 보강했다.
- 이 정리 덕분에 테스트가 긴 interval을 기다리지 않고 종료되며, 실제 서버에서도 terminal publish 이후 불필요한 interval이 남지 않는다.

검증:

- `npm --prefix server test` 통과
- `npm --prefix server run build` 통과

## 33. Route/runtime refactor final smoke

route/runtime 분리 후 compiled server 기준 최종 smoke를 수행했다.

검증 항목:

- `npm --prefix server test` 통과
- `npm --prefix server run build` 통과
- `node --check server/public/app.js` 통과
- `OPENCLAW_TRANSPORT=mock node dist/index.js`로 임시 포트/임시 state에서 서버 기동
- `/health` 확인
- `/` 정적 Web/PWA asset 응답 확인
- `POST /v1/conversations`로 conversation 생성
- `POST /v1/message`로 async message enqueue
- `GET /v1/jobs/:id?conversation_id=...` polling으로 `completed` 확인
- `GET /v1/jobs/:id/events?conversation_id=...` SSE에서 `event: job` 및 `state: completed` 확인
- `GET /v1/conversations/:id/history`에서 user/assistant history 저장 확인
- `/v1/media?path=...` authenticated media serving 확인

결과:

- 최종 smoke 통과

## 34. SSE token event publisher 골격 추가

실제 token-level streaming transport가 붙기 전에 SSE publisher가 token 이벤트를 보낼 수 있는 최소 골격을 추가했다.

변경 파일:

- `server/src/events/SseJobEventPublisher.ts`
- `server/src/events/SseJobEventPublisher.test.ts`
- `MULTI_SESSION_IMPL.md`

적용 내용:

- `JobTokenEventRecord` 타입을 추가했다.
- `SseJobEventPublisher.publishToken({ id, token })`를 추가했다.
- 내부 publish 공통 경로를 만들어 `job` 이벤트와 `token` 이벤트가 같은 subscriber map을 사용하게 했다.
- 기존 terminal `job` 이벤트는 그대로 SSE 연결을 닫고 interval/subscriber를 정리한다.
- 테스트에 `event: token` 수신 검증을 추가했다.

의미:

- 현재 OpenClaw `agent --json` transport는 결과를 완료 후 반환하므로 실제 token 이벤트는 아직 발생하지 않는다.
- 하지만 추후 streaming-capable runtime이 생기면 `MessageJobRunner`에서 token chunk를 받을 때 `publishToken()`만 호출하면 SSE 경로는 준비되어 있다.

## 35. ChatRuntime token callback 연결

SSE token event publisher 골격에 이어 runtime/job runner가 token callback을 전달할 수 있도록 타입 경계를 추가했다.

변경 파일:

- `server/src/runtime/ChatRuntime.ts`
- `server/src/http/messageHandler.ts`
- `server/src/runtime/MessageJobRunner.ts`
- `server/src/index.ts`
- `server/src/http/messageHandler.test.ts`
- `MULTI_SESSION_IMPL.md`

적용 내용:

- `ChatRuntimeCallbacks`와 `ChatRuntimeInput.callbacks.onToken(token)` 타입을 추가했다.
- `handlePostMessage()`가 optional `runtimeCallbacks`를 받아 `chatRuntime.sendMessage()` 입력으로 전달한다.
- `MessageJobRunner`가 job 실행 시 `onToken` callback을 만들고, token을 받으면 injected `publishToken(job, token)`을 호출한다.
- `index.ts`는 `publishToken()` 구현으로 `jobEventPublisher.publishToken({ id: job.id, token })`을 연결한다.
- `messageHandler.test.ts`에 runtime token callback 전달 테스트를 추가했다.

의미:

- 현재 기본 `AgentOpenClawClient`는 token을 발생시키지 않으므로 운영 동작은 변하지 않는다.
- 추후 streaming-capable runtime이 `callbacks.onToken()`을 호출하면 MessageJobRunner → SseJobEventPublisher → Web/PWA SSE 경로로 token이 흐를 수 있다.

## 36. Web/PWA token event 수신 준비

SSE `event: token`을 Web/PWA UI가 받을 수 있도록 클라이언트 경로를 연결했다.

변경 파일:

- `server/public/app.js`
- `server/public/sw.js`
- `MULTI_SESSION_IMPL.md`

적용 내용:

- history render 시 message DOM에 `data-message-id`를 붙여 job placeholder를 찾을 수 있게 했다.
- `waitForJobViaSse()`가 `event: token`을 파싱하면 `onToken(token)` callback을 호출한다.
- message submit flow에서 token callback을 넘겨 active conversation의 assistant placeholder에 streaming text를 누적 렌더링한다.
- placeholder가 아직 history refresh로 그려지기 전 token이 오면 임시 assistant pending node를 만든다.
- 최종 `completed` 이후에는 기존처럼 history refresh가 canonical 저장 결과로 UI를 다시 맞춘다.
- PWA cache를 `openclaw-web-channel-v78`로 올렸다.

의미:

- 현재 기본 OpenClaw agent transport는 token을 보내지 않으므로 운영 체감 변화는 없다.
- 나중에 runtime이 `callbacks.onToken()`을 호출하면 Web/PWA가 별도 구조 변경 없이 부분 응답을 표시할 수 있다.

## 37. Mock transport token emission 추가

서버 SSE token 경로를 end-to-end로 검증할 수 있도록 mock OpenClaw transport에 개발용 token emission을 추가했다.

변경 파일:

- `server/src/openclaw/OpenClawClient.ts`
- `server/src/openclaw/MockOpenClawClient.ts`
- `MULTI_SESSION_IMPL.md`

적용 내용:

- `OpenClawClientInput`/`OpenClawClientResult` 타입을 명시적으로 분리했다.
- `OpenClawClientInput.callbacks`에 `ChatRuntimeCallbacks`를 포함시켜 runtime callback 경계가 OpenClaw client 구현까지 이어지게 했다.
- `MOCK_OPENCLAW_STREAM_TOKENS=1`일 때 `MockOpenClawClient`가 최종 reply를 whitespace-preserving chunk로 나눠 `callbacks.onToken()`을 호출한다.
- 기본 mock 동작과 운영 `agent` transport 동작은 변하지 않는다.

의미:

- 실제 OpenClaw agent transport가 token stream을 제공하지 않아도, mock 환경에서 서버 SSE `event: token` 경로를 smoke test할 수 있다.

추가 검증 보조:

- `MOCK_OPENCLAW_TOKEN_DELAY_MS`를 추가해 mock token 사이에 지연을 줄 수 있게 했다.
- 이 값은 SSE client가 job 생성 직후 subscriber로 붙을 시간을 확보하기 위한 smoke test 전용 옵션이다.

검증:

- `npm --prefix server test` 통과
- `npm --prefix server run build` 통과
- compiled mock server smoke에서 `MOCK_OPENCLAW_STREAM_TOKENS=1`, `MOCK_OPENCLAW_TOKEN_DELAY_MS=80`으로 `/v1/jobs/:id/events`가 `event: token`, `event: job`, `state: completed`를 모두 내보내는 것을 확인했다.

## 38. Mock streaming token 회귀 테스트 추가

mock token emission 동작을 단위 테스트로 고정했다.

변경 파일:

- `server/src/openclaw/MockOpenClawClient.test.ts`
- `MULTI_SESSION_IMPL.md`

적용 내용:

- 기본 상태에서는 `MockOpenClawClient`가 token callback을 호출하지 않는지 검증한다.
- `MOCK_OPENCLAW_STREAM_TOKENS=1`일 때 whitespace-preserving token chunk를 순서대로 emit하고, token join 결과가 최종 reply와 동일한지 검증한다.

의미:

- 운영 agent transport에는 영향 없이 mock/dev streaming 경로만 회귀 테스트로 고정했다.

## 39. Streaming token UI refresh 충돌 방지

Web/PWA가 token stream을 표시하는 동안 주기적 job 상태 refresh가 partial text를 placeholder history로 덮어쓰지 않도록 보강했다.

변경 파일:

- `server/public/app.js`
- `MULTI_SESSION_IMPL.md`

적용 내용:

- message submit flow에서 `receivedStreamingToken` flag를 추가했다.
- token을 하나라도 받은 뒤에는 non-terminal job 상태 tick(`queued`/`running`)에서 `refreshHistoryIfChanged()`를 건너뛴다.
- `completed`/`failed` terminal job tick에서는 기존처럼 history refresh를 수행해 최종 저장 결과를 canonical UI로 맞춘다.

의미:

- 긴 token stream이 들어오는 future runtime에서 partial assistant text가 2초 polling fallback tick 또는 job 상태 tick에 의해 사라지는 현상을 예방한다.
- token이 없는 현재 agent transport에서는 기존 refresh 동작과 동일하다.

## 40. MessageJobRunner token publish 회귀 테스트 추가

runtime callback에서 발생한 token이 `MessageJobRunner`의 injected `publishToken(job, token)`까지 전달되는지 단위 테스트로 고정했다.

변경 파일:

- `server/src/runtime/MessageJobRunner.test.ts`
- `MULTI_SESSION_IMPL.md`

적용 내용:

- fake `ChatRuntime`이 `callbacks.onToken("hello")`, `callbacks.onToken(" world")`를 호출하도록 구성했다.
- `MessageJobRunner.enqueue()`를 통해 async job을 실행하고 `publishToken()`이 동일한 job id와 token 순서를 받는지 검증했다.
- job state가 `running → completed`로 변하고 legacy history placeholder가 최종 assistant reply로 교체되는지도 함께 검증했다.

의미:

- runtime → message handler → job runner → token publisher injection 연결부가 회귀 테스트로 고정됐다.

## 41. Token SSE smoke npm script 추가

mock token streaming SSE 경로를 반복 검증할 수 있도록 npm smoke script를 추가했다.

변경 파일:

- `server/scripts/smoke-token-sse.mjs`
- `server/package.json`
- `MULTI_SESSION_IMPL.md`

적용 내용:

- `npm run smoke:token-sse` script를 추가했다.
- script는 임시 state directory와 random local port로 compiled server(`dist/index.js`)를 실행한다.
- `OPENCLAW_TRANSPORT=mock`, `MOCK_OPENCLAW_STREAM_TOKENS=1`, `MOCK_OPENCLAW_TOKEN_DELAY_MS=80` 환경으로 conversation 생성 → message enqueue → `/v1/jobs/:id/events` 수신을 수행한다.
- SSE 응답에 `event: token`, `event: job`, `state: completed`가 모두 있는지 assert한다.
- 종료 시 child server와 임시 파일을 정리한다.

의미:

- streaming-ready 변경을 커밋하거나 배포하기 전 수동 curl 스크립트를 다시 작성하지 않고 동일 smoke를 반복 실행할 수 있다.

## 42. Gateway OpenAI-compatible streaming transport 후보 추가

운영 `agent` transport는 `openclaw agent --json` 완료 출력만 받기 때문에 token-level streaming을 만들 수 없다. OpenClaw Gateway dist에는 `/v1/chat/completions` OpenAI-compatible streaming handler가 존재하지만, 현재 gateway config에서는 `gateway.http.endpoints.chatCompletions.enabled`가 켜져 있지 않아 404가 반환된다.

변경 파일:

- `server/src/openclaw/GatewayOpenAiOpenClawClient.ts`
- `server/src/openclaw/GatewayOpenAiOpenClawClient.test.ts`
- `server/src/openclaw/createOpenClawClient.ts`
- `MULTI_SESSION_IMPL.md`

적용 내용:

- `OPENCLAW_TRANSPORT=gateway-openai` transport 후보를 추가했다.
- 기본 endpoint는 `OPENCLAW_GATEWAY_URL` 또는 `http://127.0.0.1:18789`의 `/v1/chat/completions`이다.
- `stream: true` 요청을 보내고 OpenAI-compatible SSE chunk의 `choices[].delta.content`를 `callbacks.onToken()`으로 전달한다.
- `x-openclaw-session-key`에 WebChat session id를 넣어 Gateway session continuity를 유지하도록 했다.
- `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_GATEWAY_MODEL`, `OPENCLAW_GATEWAY_TIMEOUT_MS` 환경 변수를 지원한다.
- unit test는 fake SSE server로 token chunk가 callback과 final reply로 누적되는지 검증한다.

현재 상태:

- 이 transport는 아직 운영 서비스에 적용하지 않았다.
- 실제 운영 token streaming은 Gateway OpenAI-compatible endpoint를 config에서 enable하고 gateway/service restart 후 smoke해야 한다.
- endpoint를 enable해도 실제 토큰 chunk가 발생할지는 OpenClaw 내부 `onAgentEvent(stream=assistant)` 발생 여부에 달려 있으며, chunk가 없으면 Gateway handler는 완료 시점에 최종 텍스트를 한 번 emit하는 fallback을 사용한다.

## 43. Gateway OpenAI transport 문서와 live smoke script 추가

`gateway-openai` transport 후보를 실제 Gateway endpoint enable 이후 바로 검증할 수 있도록 문서와 live smoke script를 추가했다.

변경 파일:

- `server/scripts/smoke-gateway-openai.mjs`
- `server/package.json`
- `server/README.md`
- `MULTI_SESSION_IMPL.md`

적용 내용:

- `npm run smoke:gateway-openai` script를 추가했다.
- script는 `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_GATEWAY_MODEL`, `OPENCLAW_GATEWAY_TIMEOUT_MS`를 사용해 `/v1/chat/completions`에 `stream: true` 요청을 보낸다.
- SSE `choices[].delta.content` chunk 개수와 preview를 출력하고, chunk가 2개 이상이면 `likelyTokenStreaming: true`로 표시한다.
- endpoint가 꺼져 있으면 `GATEWAY_OPENAI_SMOKE_ENDPOINT_DISABLED`와 함께 exit code 2를 반환한다.
- README에 현재 production `agent` transport는 token-level streaming이 아니라는 점, `gateway-openai` transport 사용법, mock/live smoke 실행법을 정리했다.

운영 적용 전 주의:

- 현재 Gateway config에서는 `/v1/chat/completions`가 404였으므로 실제 live smoke는 config enable과 Gateway restart 이후 실행해야 한다.
- Gateway restart는 사용자 확인이 필요하다.

## 44. 실제 Gateway streaming smoke 결과와 bridge E2E smoke 추가

사용자 승인 후 Gateway config에서 `gateway.http.endpoints.chatCompletions.enabled=true`를 추가하고 Gateway를 재시작했다. Gateway는 `127.0.0.1:18789`에서 정상 기동했고 connectivity probe도 OK였다.

검증 결과:

- `npm run smoke:gateway-openai`가 실제 `/v1/chat/completions` streaming endpoint에 성공했다.
- 결과에서 `contentChunkCount: 3`, `likelyTokenStreaming: true`가 확인됐다.
- 즉 OpenClaw Gateway OpenAI-compatible endpoint는 현재 환경에서 실제 assistant chunk를 emit한다.
- 이어서 브릿지 서버를 임시 포트/임시 DB로 띄우고 `OPENCLAW_TRANSPORT=gateway-openai`로 `/v1/message` → `/v1/jobs/:id/events`를 E2E 확인했다.
- one-off smoke에서 `event: token` 34개와 completed job event가 확인됐다.

추가 변경:

- `server/scripts/smoke-bridge-gateway-openai.mjs`
- `server/package.json`
- `server/README.md`

`npm run smoke:bridge-gateway-openai`는 compiled bridge server를 임시 포트로 띄운 뒤 실제 Gateway streaming transport를 통해 conversation 생성, message enqueue, token SSE 수신, completed event 수신까지 검증한다.

운영 적용 상태:

- Gateway endpoint는 켜졌다.
- WebChat production service는 아직 `OPENCLAW_TRANSPORT=agent` 상태이므로 production WebChat은 아직 token streaming transport를 사용하지 않는다.
- 다음 운영 적용은 `openclaw-custom-channel.service` 환경을 `OPENCLAW_TRANSPORT=gateway-openai`로 바꾸고 해당 서비스만 재시작한 뒤 smoke/브라우저 확인하는 단계다.

## 2026-05-01 multi-user 단위 재정렬 점검

- `multi-user` 브랜치를 `origin/multi-user` 기준으로 리셋한 뒤 시작한 변경 상태를 점검했다.
- 현재 미커밋 변경은 auth/session 기초, owner_id 기초, media/workspace guard 초안이 섞여 있으나 TypeScript 단계에서 깨지는 부분은 없다.
- 검증:
  - `git diff --check` 통과
  - `npm run typecheck` 통과
  - `npm test` 통과 (20/20)
  - `npm run build` 통과
- 판단: 즉시 리셋할 정도의 손상/꼬임은 없다. 다만 단위 커밋을 위해 이후 작업은 먼저 인증/세션 쿠키 단위를 완성하고, owner/media/workspace 변경은 별도 단위로 분리해 검증한다.

## 2026-05-01 multi-user 1단계 auth/login 보강

- 1단계 범위 안에서만 `id/password 로그인 + 서버 세션 쿠키 + logout + /v1/auth/login/logout/me + 프론트 로그인 화면`을 점검/보강했다.
- `AUTH_ADMIN_PASSWORD`가 설정되어 있으면 서버 startup에서 `AUTH_ADMIN_USERNAME`(기본 `admin`) 계정을 admin role로 생성/갱신하도록 했다. 비밀번호는 DB에 scrypt hash로만 저장한다.
- `/v1/auth/login`은 `username` 필드뿐 아니라 UI 용어에 맞춰 `id` 필드도 로그인 ID로 받을 수 있게 했다.
- `AuthStore` 단위 테스트를 추가해 user 생성, password verify, session 생성/폐기, `ensureUser` 갱신/재활성화를 검증한다.
- 프론트 로그인 화면 변경이 서비스워커 캐시에 묶이지 않도록 `server/public/sw.js` cache version을 `v140`으로 올렸다.
- 1단계 범위를 좁히기 위해 이전 초안에 섞였던 `owner_id` 기반 conversation 격리와 media/workspace guard 변경은 현재 작업 트리에서 분리해 제외했다. 다음 단계에서 별도 패치로 다시 다룬다.

## 2026-05-01 multi-user 2단계 owner 격리 초안

- conversation store에 `owner_id`를 추가하고 기존 DB에는 기본값 `admin`으로 migration되게 했다.
- 로그인 세션의 user id로 새 conversation owner를 저장하고, 일반 사용자는 자기 conversation만 list/read/update/delete/history/message/job 접근 가능하도록 route guard를 추가했다.
- API key fallback은 admin auth context로 유지해 기존 단일 관리자/레거시 흐름을 깨지 않게 했다.
- `SqliteChatStore` owner 필터 단위 테스트를 추가했다.

## 2026-05-02 multi-user 3단계 media attachment guard 초안

- `/v1/media`에서 cookie/API key auth context를 확인하고, 일반 사용자는 자신의 conversation attachment로 저장된 파일만 열 수 있게 했다.
- admin/API key fallback은 기존 allowed media root 접근을 유지한다.
- media path 검증은 `realpath` 기반으로 바꿔 symlink/상대경로 우회를 줄였다.
- `SqliteChatStore.isAttachmentPathVisibleToOwner()`와 단위 테스트를 추가했다.

## 2026-05-02 multi-user 4단계 workspace read guard 초안

- 일반 사용자의 `/v1/media` 접근에 workspace scope read guard를 추가했다.
- 기본 workspace scope는 `USER_WORKSPACE_ROOT`(기본 `server/state/workspaces`) 아래 사용자명 디렉터리와 `common` 디렉터리로 lazy 생성/저장된다.
- 일반 사용자는 자기 workspace 디렉터리와 common 디렉터리 파일만 읽을 수 있고, 다른 사용자 workspace 파일은 403 처리된다.
- scope 저장용 `user_workspace_scopes` 테이블과 `AuthStore` getter/upsert, `resolveAllowedWorkspacePath()` 유틸 및 테스트를 추가했다.

## 2026-05-02 runtime workspace scope draft

PLAN 13.13의 10번(OpenClaw runtime cwd/workspace 제한 가능성 검증 및 적용)을 확인했다.

구현 내용:
- `RuntimeWorkspaceScope`를 `OpenClawClientInput`/`ChatRuntimeInput`에 추가했다.
- cookie 로그인 일반 사용자(non-admin)의 queued message job에는 `workspaceScopeForAuth()` 결과를 붙인다.
- `MessageJobRunner` → `handlePostMessage` → `ChatRuntime` → `OpenClawClient`로 runtime workspace metadata를 전달한다.
- `AgentOpenClawClient`는 runtime workspace가 있으면 `execFile`의 `cwd`를 `userDir`로 지정하고, `OPENCLAW_RUNTIME_*` 환경변수를 함께 전달한다.
- `GatewayOpenAiOpenClawClient`는 runtime workspace metadata를 request header와 user content metadata로 전달한다.

중요한 한계:
- 현재 운영 transport인 `gateway-openai`의 OpenClaw Gateway `/v1/chat/completions` 구현은 `x-openclaw-session-key`/message channel/session routing은 처리하지만, per-request workspace/cwd를 강제하는 공식 입력은 확인되지 않았다.
- 따라서 `gateway-openai` 경로에서는 bridge가 metadata를 전달할 수는 있지만, OpenClaw runtime의 실제 tool cwd/root 격리를 강제했다고 보기는 어렵다.
- 강한 격리는 `agent` transport에서 `cwd=userDir` 실행 경로를 사용하거나, OpenClaw Gateway에 per-request workspace/cwd 지원이 추가되어야 완성된다.

검증:
- `git diff --check` 통과
- `node --check server/public/app.js` 통과
- `npm --prefix server run typecheck` 통과
- `npm --prefix server test` 통과: 28/28
