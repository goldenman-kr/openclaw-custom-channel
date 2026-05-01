# Multi-session Branch 작업 지시서

작성일: 2026-04-29  
브랜치: `multi-session`  
대상 프로젝트: `openclaw-custom-channel`

## 1. 목표

> 브랜치 정리: 예전 Flutter `client/` 디렉토리는 제거한다. 이 브랜치의 클라이언트 작업 대상은 `server/public` Web/PWA와 이를 감싸는 Android/iOS WebView이다.


현재 단일 웹챗/PWA 채널을 ChatGPT, Gemini, OpenWebUI처럼 여러 채팅 세션을 관리할 수 있는 구조로 확장한다.

핵심 요구사항:

- 왼쪽 채팅 목록을 제공해 여러 채팅을 만들고 오갈 수 있게 한다.
- 새 채팅을 만들더라도 기존 채팅 기록은 삭제하지 않는다.
- 모든 세션별 채팅 내용은 서로 구분되어 저장되어야 한다.
- 어떤 기기에서 접속해도 동일한 채팅 목록과 내용을 볼 수 있어야 한다.
- API Key는 사용자 구분이 아니라 관리자 1인 로그인/접근 제어 용도로 사용한다.
- 추후 멀티유저 확장 가능성은 열어두되, 현재 구현 목표는 관리자 1인 전용이다.
- 모바일에서는 플로팅 메뉴 버튼을 통해 채팅 목록과 설정 버튼을 표시한다.
- 응답 스트리밍 구조 적용 가능성을 검토하되, 초기 구현과 분리한다.

향후 확장 메모 — 멀티유저/권한 분리:

- 현재는 Eddy 1인 사용을 전제로 하므로 API key는 “사용자 계정”이 아니라 공용 관리자 접근 토큰으로 유지한다.
- API key를 단순히 여러 개 발급하는 것만으로는 사용자별 채팅그룹이 분리되지 않는다. 현재 구조에서는 유효한 key가 모두 같은 `conversations` DB를 본다.
- 다른 사용자를 고려하는 경우에는 단순 key 추가가 아니라 `users`/`owner_id` 기반의 멀티유저 설계가 필요하다.
- 가능성 차원에서는 오브스 가이드봇처럼 사용자별 설정을 둘 수 있다:
  - 사용자별 기본/허용 모델(`default_model`, `allowed_models`)
  - 사용자별 agent 또는 persona/system prompt
  - 사용자별 허용 기능/도구/명령(`/memory`, 파일 첨부, 이미지 생성, 삭제 등)
  - 사용자별 quota/rate limit/audit log
  - 사용자별 conversation/history/session 격리
- 멀티유저 구현 시 모든 conversation/history/message/job API는 인증된 사용자 identity를 기준으로 필터링해야 한다.
- 안정성/보안을 제대로 보려면 작은 SaaS 백엔드처럼 권한 모델, 감사로그, 삭제/초기화 제한, 세션/workspace 격리를 별도 설계한다.
- 따라서 현재 브랜치에서는 구현하지 않고, 향후 확장 요구가 명확해질 때 별도 계획으로 분리한다.

## 2. OpenClaw 기술 구조 검토

OpenClaw는 `openclaw agent --session-id <id>` 형태로 명시적 세션 ID를 받을 수 있다.

따라서 단일 custom web channel 안에서도 다음 구조로 다중 채팅 세션을 지원할 수 있다.

```text
conversation A -> openclawSessionId A -> openclaw agent --session-id A
conversation B -> openclawSessionId B -> openclaw agent --session-id B
conversation C -> openclawSessionId C -> openclaw agent --session-id C
```

정리:

- `conversationId`: 웹앱/브릿지 내부 채팅 ID
- `openclawSessionId`: OpenClaw에 전달할 실제 세션 ID
- `apiKey`: 관리자 인증 토큰

주의:

- Telegram/Signal 같은 일반 채널은 채널/상대방 기준으로 세션이 묶이지만, 이 custom web channel은 `--session-id`를 직접 지정하므로 브릿지 서버에서 세션 multiplexing이 가능하다.
- 멀티채팅 구조에서는 UI의 “새 대화 시작”을 `/new` 명령 전송으로 처리하기보다 서버가 새 `conversationId`와 새 `openclawSessionId`를 만드는 방식이 더 명확하다.
- 사용자가 직접 `/reset`을 입력하면 현재 선택된 conversation의 OpenClaw 세션만 초기화되도록 유지한다.

## 3. 저장 구조 검토

### 3.1 권장안: SQLite + filesystem 첨부 저장

현재 파일 기반 history JSON은 단일 세션에는 단순하지만, 다중 채팅/기기 동기화/검색/마이그레이션에는 취약하다.

권장 구조는 SQLite를 서버 기준 저장소로 두고, 첨부 파일은 filesystem에 저장하는 방식이다.

장점:

- 서버 1대/관리자 1인 구조에 충분히 가볍다.
- JSON 파일보다 동시성, 정렬, 검색, 마이그레이션이 안전하다.
- 여러 기기에서 접속해도 서버 DB 기준으로 동일한 목록/내용을 보여줄 수 있다.
- 추후 멀티유저 확장 시 `users` 또는 `owner_id` 컬럼을 추가하기 쉽다.
- Postgres보다 운영 부담이 낮다.

### 3.2 대안

#### JSON 파일 유지

예:

```text
state/conversations/index.json
state/history/<conversationId>.json
```

장점:

- 구현이 가장 빠르다.
- 현재 `FileHistoryStore`와 유사하다.

단점:

- conversation 수가 늘면 목록 정렬/검색/동시 쓰기 관리가 번거롭다.
- 마이그레이션과 무결성 검증이 약하다.
- 추후 멀티유저 확장에 불리하다.

#### Postgres

장점:

- 확장성은 가장 좋다.

단점:

- 현재 관리자 1인/서버 1대 구조에는 과하다.
- 운영 의존성이 늘어난다.

결론: **SQLite 우선 도입**을 권장한다.

## 4. 권장 DB 스키마 초안

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  openclaw_session_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  pinned INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  text TEXT NOT NULL,
  job_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_conversation_created
  ON messages(conversation_id, created_at);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('image', 'file')),
  path TEXT NOT NULL,
  size INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed')),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

## 5. 서버측 작업 순서

### 5.1 저장소 계층 추가

1. SQLite 의존성 검토 및 선택
   - 후보: `better-sqlite3`, `sqlite3`
   - 서버가 단순 Node HTTP 구조이므로 동기 API인 `better-sqlite3`가 구현은 간단하지만, 빌드/배포 호환성 확인 필요.
2. `server/src/session/ConversationStore.ts` 추가
3. `server/src/session/MessageStore.ts` 또는 통합 `SqliteChatStore.ts` 추가
4. 기존 `FileHistoryStore`와 분리해 점진 교체 가능하게 구현

### 5.2 Conversation API 추가

추가할 API:

```text
GET    /v1/conversations
POST   /v1/conversations
GET    /v1/conversations/:id
PATCH  /v1/conversations/:id
DELETE /v1/conversations/:id
GET    /v1/conversations/:id/history
```

정책:

- `DELETE`는 초기에는 hard delete보다 archive 권장
- 실제 hard delete가 필요하면 별도 `?hard=1` 또는 추후 관리 기능으로 분리
- 목록은 `updated_at DESC` 기준

### 5.3 Message API 변경

현재:

```text
POST /v1/message
headers: x-user-id
body: { message, attachments, metadata }
```

변경:

```json
{
  "conversation_id": "conv_xxx",
  "message": "...",
  "attachments": [],
  "metadata": {}
}
```

처리:

1. API Key 인증
2. `conversation_id` 확인
3. conversation의 `openclaw_session_id` 조회
4. 해당 ID로 `openclaw agent --session-id` 호출
5. user/assistant/system message를 DB에 저장
6. job 상태도 conversation 단위로 저장

호환성:

- `conversation_id`가 없으면 기본 conversation을 자동 생성/선택하는 fallback을 둘 수 있다.
- 단, UI 전환 완료 후에는 필수값으로 바꾸는 것이 좋다.

### 5.4 기존 history 마이그레이션

현재 history 파일 위치 예:

```text
server/state/history/mobile-web-api-key-<hash>.json
```

마이그레이션 절차:

1. SQLite DB 초기화 시 `app_meta`에서 migration marker 확인
2. 기존 history 파일이 있으면 `이전 대화` conversation 생성
3. 기존 messages를 해당 conversation으로 import
4. `openclawSessionId`는 기존 session id를 그대로 사용하거나, 새로 만들되 맥락 연속성이 필요한 경우 기존 ID 유지
5. migration marker 기록
6. 원본 파일은 삭제하지 말고 백업/보존

권장:

- 기존 단일 history는 `이전 대화`로 보존
- OpenClaw 세션 맥락도 유지하려면 기존 `mobile-web-api-key-...` session id를 `openclawSessionId`로 사용

### 5.5 API Key 역할 정리

현재 API Key 기반 `sharedUserId()`가 세션 식별에 사용된다.

변경 방향:

- API Key는 인증에만 사용
- `x-user-id`는 더 이상 세션 구분의 핵심으로 쓰지 않음
- conversationId가 모든 채팅 구분의 기준
- 관리자 1인 전용이므로 users table은 아직 만들지 않거나, 미래 확장을 위해 optional로만 설계

### 5.6 `/new`와 `/reset` 정책

- UI의 새 채팅 생성은 `/new` 전송이 아니라 새 conversation 생성으로 처리한다.
- 사용자가 직접 `/new`를 입력하면 OpenClaw로 전달하지 않고 차단한다.
- `/new` 차단 시 안내 문구 예: `이 웹챗에서는 /new 대신 “새 대화 시작” 버튼을 사용해주세요.`
- 새 conversation 생성은 버튼/메뉴 액션으로만 처리한다.
- 사용자가 직접 `/reset`을 입력하면 현재 conversation의 OpenClaw 세션에만 적용한다.
- `/reset`은 다른 conversation의 history나 `openclawSessionId`에 영향을 주면 안 된다.

### 5.7 Job/Polling 구조 수정

현재 job은 메모리 Map 기반이다.

문제:

- 서버 재시작 시 job 상태 유실
- conversation 전환 시 pending job 확인이 불안정할 수 있음

개선:

- jobs table에 상태 저장
- `GET /v1/jobs/:id`는 conversationId 검증 포함
- 클라이언트는 active conversation의 pending job만 resume

## 6. 웹클라이언트 작업 순서

### 6.1 클라이언트 상태 구조 변경

현재는 단일 history 중심이다.

변경 후 상태:

```js
let conversations = [];
let activeConversationId = null;
let activeMessages = [];
```

localStorage에는 최소 상태만 저장:

- API URL
- API Key
- theme/font settings
- lastActiveConversationId

대화 내용은 localStorage가 아니라 서버 DB 기준으로 조회한다.

### 6.2 데스크톱 UI 변경

구조:

```text
app-shell
├─ sidebar
│  ├─ 새 대화 시작
│  ├─ conversation list
│  └─ 설정
└─ chat-panel
   ├─ messages
   └─ composer
```

요구사항:

- 기존 우상단 설정 플로팅 버튼은 데스크톱에서 제거 또는 숨김
- 설정 메뉴 진입 버튼은 왼쪽 sidebar로 이동
- active conversation 강조 표시
- conversation title은 첫 사용자 메시지 기반으로 임시 생성하거나 서버에서 업데이트

### 6.3 모바일 UI 변경

구조:

- 기본 화면은 채팅 패널만 표시
- 플로팅 메뉴 버튼 제공
- 메뉴 클릭 시 drawer/overlay 표시
  - 새 대화 시작
  - 채팅 목록
  - 설정
- drawer 외부 클릭 시 닫힘
- ESC/뒤로가기 대응 검토

### 6.4 새 대화 시작 플로우

1. `POST /v1/conversations`
2. 응답으로 받은 conversation을 목록에 추가
3. `activeConversationId` 변경
4. 빈 messages 렌더링
5. 기존 conversation은 그대로 보존

### 6.5 기존 채팅 전환 플로우

1. 사용자가 sidebar/drawer에서 conversation 선택
2. `GET /v1/conversations/:id/history`
3. messages 렌더링
4. active pending job이 있으면 해당 conversation 기준으로 polling/resume

### 6.6 설정 메뉴

- 설정 패널은 sidebar 내부 또는 modal로 표시
- 데스크톱: sidebar 하단 설정 버튼
- 모바일: drawer 안 설정 버튼
- 설정 외부 클릭 시 닫힘 유지

### 6.7 PWA 캐시/스토리지

- service worker cache version 증가
- localStorage key 변경 시 migration 고려
- 대화 내용은 localStorage에 저장하지 않도록 정리

## 7. 스트리밍 응답 구조 검토

### 7.1 현재 구조

현재는 비동기 job + polling 구조다.

```text
POST /v1/message -> 202 job_id
GET /v1/jobs/:id -> 상태 확인
GET /v1/history -> 결과 반영
```

장점:

- 단순하고 안정적
- 앱을 닫아도 서버 작업은 계속됨

단점:

- 토큰 단위 스트리밍 불가
- 응답 체감 속도 떨어짐

### 7.2 후보 1: SSE

```text
GET /v1/jobs/:id/events
```

장점:

- HTTP 기반이라 현재 구조에 덜 침습적
- 브라우저/PWA에서 구현 쉬움
- 서버에서 job 상태 이벤트를 흘리기 좋음

단점:

- 양방향 통신은 아님
- OpenClaw CLI가 실제 token stream을 제공하지 않으면 상태 스트리밍 정도만 가능

### 7.3 후보 2: WebSocket

장점:

- 양방향/실시간 구조에 좋음
- 향후 타이핑, 취소, 멀티 디바이스 실시간 동기화에 유리

단점:

- 현재 단순 Node HTTP 서버 구조에 변경량이 큼
- 인증/재연결/상태 복구 설계 필요

### 7.4 추천

- 1차: 현재 polling 유지
- 2차: SSE로 job 상태와 최종 응답 이벤트 제공
- 3차: OpenClaw에서 token stream 접근이 가능해질 때 token-level streaming 검토
- WebSocket은 멀티유저/협업/실시간 sync가 필요해질 때 재검토

### 7.5 향후 확장 메모 — 응답 생성 취소/중단

사용자가 질의를 보낸 뒤 모델이 답변을 생성 중일 때 “취소/중지”할 수 있는 기능은 향후 검토한다.

중요 원칙:

- 단순히 프론트엔드의 polling/SSE 표시만 멈추는 것은 의미가 부족하다.
- 실제 모델/OpenClaw 실행까지 중단되어야 같은 conversation에서 바로 다음 질의를 안정적으로 보낼 수 있다.
- 따라서 구현 시 `UI 중지 버튼 → bridge job cancel → OpenClaw/Gateway request abort → provider/model 실행 중단 시도` 흐름을 하나로 연결해야 한다.

요구사항 초안:

- 전송 후 send 버튼 또는 별도 버튼을 “중지” 상태로 전환한다.
- 사용자가 중지를 누르면 현재 active conversation의 active job만 취소한다.
- 서버는 job 상태를 `cancelled`로 저장하고, pending assistant placeholder를 “응답 취소됨” 또는 partial answer 상태로 마무리한다.
- `GatewayOpenAiOpenClawClient`의 timeout용 `AbortController`를 외부 cancel signal과 연결해 streaming fetch 자체를 abort할 수 있게 한다.
- CLI transport 경로를 쓸 경우 child process에 `SIGTERM`을 보내고, 필요 시 제한 시간 후 강제 종료하는 별도 취소 경로가 필요하다.
- provider/Gateway가 이미 받은 요청을 완전히 중단하지 못할 수도 있으므로, UX에는 “취소 요청됨/중단됨” 상태를 구분할 수 있게 한다.
- 취소 후 같은 conversation에서 다음 메시지를 보낼 수 있어야 하며, 이전 job의 늦은 결과가 history에 덮어쓰이지 않도록 job id 검증이 필요하다.

현재 브랜치에서는 구현하지 않고 plan에만 남긴다.

## 8. 검증 계획

### 8.1 서버 검증

- `npm --prefix server run build`
- 기존 테스트 유지/확장
- 추가 테스트:
  - conversation 생성
  - conversation 목록 정렬
  - conversation별 history 분리
  - message 전송 시 올바른 `openclawSessionId` 사용
  - 기존 history migration
  - archive/delete 동작

### 8.2 클라이언트 검증

- 데스크톱:
  - 새 대화 생성
  - 기존 대화 전환
  - 설정 진입
  - 새로고침 후 active conversation 복원
- 모바일:
  - 플로팅 메뉴 열기/닫기
  - drawer 외부 클릭 닫기
  - 채팅 전환
  - PWA 캐시 갱신

### 8.3 통합 검증

- PC에서 새 채팅 생성 후 모바일에서 같은 목록 표시
- 모바일에서 보낸 메시지가 PC에서 history polling으로 반영
- conversation A/B 간 OpenClaw 맥락이 섞이지 않는지 확인
- `/reset`이 현재 conversation에만 적용되는지 확인

## 9. 권장 구현 단계

1. SQLite store 및 migration 기반 추가
2. Conversation API 추가
3. 기존 `/v1/history`를 conversation 기반으로 내부 연결
4. `/v1/message`에 `conversation_id` 지원
5. 기존 단일 UI에서 active conversation만 먼저 붙이기
6. 데스크톱 sidebar 추가
7. 모바일 drawer/menu 추가
8. 새 대화 시작을 conversation 생성 방식으로 변경
9. legacy history/localStorage 의존 제거
10. SSE streaming PoC 검토

## 10. 리스크와 주의사항

- API Key를 user/session identity로 쓰던 기존 구조를 제거할 때 history 경로가 바뀌므로 migration이 중요하다.
- 기존 PWA 캐시가 오래 남을 수 있으므로 cache version을 반드시 올린다.
- job 상태가 메모리에만 있으면 conversation 전환/서버 재시작 시 UX가 깨질 수 있다.
- OpenClaw `/new`와 브릿지 conversation 생성은 개념적으로 다르므로 혼동하지 않는다.
- 구현 중에는 기존 단일 채팅 기능이 깨지지 않도록 compatibility layer를 둔다.

## 11. 운영 원칙

- Qwen은 구조 검토/아이디어 제안용으로만 활용한다.
- 실제 코드 변경, 리뷰, 적용, 검증은 GPT-5.5가 주도한다.
- 큰 변경은 작은 커밋 단위로 나눈다.
- 각 단계마다 build/test를 통과한 뒤 다음 단계로 진행한다.
## 12. 채널/Transport 인터페이스 모듈화 원칙

장기적으로 Telegram, Web/PWA, Discord/Slack류, OpenClaw Gateway 직접 연동 등 다양한 채널을 효율적으로 지원할 수 있도록 서버 내부 인터페이스 레이어를 명확히 분리한다.

### 12.1 분리할 책임

- `AuthProvider`: API Key, future user auth, channel auth를 검증한다.
- `ConversationStore`: conversation 목록, title, archive, `openclawSessionId`를 관리한다.
- `MessageStore`: 메시지, 첨부, job 상태를 저장한다.
- `ChatRuntime` 또는 `AgentRuntime`: OpenClaw에 메시지를 전달하고 응답/job/stream event를 반환한다.
- `ChannelAdapter`: Web/PWA, Telegram, Discord 등 채널별 입출력 포맷과 UX 차이를 흡수한다.
- `EventPublisher`: polling, SSE, WebSocket 등 클라이언트 전달 방식을 추상화한다.

### 12.2 권장 방향

초기 구현은 Web/PWA만 대상으로 하되, 코드 구조는 아래 의존 방향을 유지한다.

```text
HTTP/Web/PWA route
  -> ChannelAdapter
  -> ConversationService
  -> MessageStore / ConversationStore
  -> AgentRuntime(OpenClaw)
  -> EventPublisher
```

주의사항:

- Web/PWA 전용 상태를 `AgentRuntime`이나 store에 섞지 않는다.
- OpenClaw CLI 세부 인자는 `AgentRuntime` 내부에 가둔다.
- SSE/WebSocket/polling 차이는 `EventPublisher`에서 흡수한다.
- 추후 Telegram/Discord 채널을 붙이더라도 conversation/message 저장 모델은 재사용 가능해야 한다.
- API Key는 현재 Web/PWA 관리자 인증용이지만, 나중에 channel별 auth로 확장 가능하게 둔다.

### 12.3 구현 순서 반영

SQLite/Conversation API를 만들 때부터 store와 runtime 인터페이스를 분리한다.
단, 과도한 추상화는 피하고 실제 두 번째 채널이 필요해질 때 adapter를 확장한다.
현재 단계의 목표는 “Web/PWA 구현을 방해하지 않는 얇은 인터페이스 경계”를 만드는 것이다.

## 13. 구현 계획 — 다중 유저 지원

현재 `multi-user` 브랜치의 목표는 기존 관리자 1인용 Web/PWA 다중 대화 구조를 **소규모 다중 유저 구조**로 확장하는 것이다. 다중 유저는 단순 API Key 추가가 아니라 인증, 데이터 owner 검증, 파일 접근 sandbox를 포함하는 보안 경계로 구현한다.

### 13.1 확정 설계 결정

- 인증 방식은 **id/password 로그인 + 서버 세션 쿠키**로 한다.
- 공개 가입 기능은 만들지 않는다. 사용자는 관리자가 수동 생성한다.
- 기존 API Key는 일반 사용자 인증 수단에서 제외한다.
  - 필요 시 bootstrap/admin CLI/smoke test용 내부 토큰으로만 제한적으로 유지한다.
- DB는 1차에서 **단일 SQLite + `owner_id` 기반 격리**를 사용한다.
- URL에는 `userId`를 넣지 않는다.
  - 현재 구조인 `/chat/:conversationId`를 유지한다.
  - 로그인된 사용자 세션에서 `user_id`를 확인하고 conversation owner를 서버에서 검증한다.
- 로그아웃 기능은 필수로 구현한다.
- 파일/워크스페이스 접근 제어는 MD 정책만으로 처리하지 않고 **코드 레벨에서 강제**한다.

### 13.2 인증/세션 설계

#### 사용자 테이블

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  disabled_at TEXT
);
```

- password는 원문 저장 금지.
- 가능하면 `argon2id` 사용을 우선 검토하고, 배포 호환성이 애매하면 `bcrypt`를 사용한다.
- `role`은 1차에서 `admin`/`user` 정도만 둔다.

#### 세션 테이블

```sql
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

- 브라우저에는 세션 토큰을 `HttpOnly`, `Secure`, `SameSite=Lax` 쿠키로 저장한다.
- 서버 DB에는 token hash만 저장한다.
- 로그아웃 시 세션 revoke + 쿠키 만료.
- 인증 만료 시 API는 401을 반환하고 UI는 로그인 화면으로 전환한다.

#### 인증 API

```text
POST /v1/auth/login
POST /v1/auth/logout
GET  /v1/auth/me
```

- `login`: username/password 검증 후 세션 쿠키 발급.
- `logout`: 현재 세션 revoke.
- `me`: 현재 로그인 사용자와 권한/설정 요약 반환.

### 13.3 사용자 수동 관리

공개 가입은 만들지 않는다. 초기 구현은 CLI/script 기반으로 충분하다.

예상 명령:

```bash
npm run user:create -- <username> --display-name <name>
npm run user:reset-password -- <username>
npm run user:disable -- <username>
npm run user:list
```

관리 UI는 2차로 미룬다. 1차 목표는 안전한 수동 생성/비활성화/비밀번호 재설정이다.

### 13.4 데이터 owner 격리

기존 주요 테이블에 owner를 추가한다.

```sql
ALTER TABLE conversations ADD COLUMN owner_id TEXT;
```

원칙:

- `conversations.owner_id`가 데이터 격리의 기준이다.
- `messages`, `attachments`, `jobs`는 직접 owner 컬럼을 두거나 conversation join으로 owner를 검증한다.
- 모든 read/write API는 인증된 `user_id` 기준으로 필터링한다.

API별 원칙:

- `GET /v1/conversations`: 내 conversation만 반환.
- `POST /v1/conversations`: 생성 owner는 현재 user.
- `GET /v1/history?conversation_id=...`: conversation owner가 현재 user일 때만 허용.
- `POST /v1/message`: 현재 user 소유 conversation만 허용.
- `PATCH/DELETE /v1/conversations/:id`: 현재 user 소유 또는 admin 권한일 때만 허용.
- 권한 없는 conversation 접근은 가능하면 `404`로 응답해 존재 여부를 숨긴다.

### 13.5 URL 설계

현재 URL 구조를 유지한다.

```text
/chat/:conversationId
```

URL에 `userId`를 넣지 않는다.

이유:

- user identity는 로그인 세션으로 이미 알 수 있다.
- URL에 userId를 넣어도 owner 검증은 어차피 서버에서 해야 한다.
- userId 노출은 정보 노출만 늘리고 보안 이득이 없다.

권한 확인 흐름:

```text
GET /chat/conv_xxx
→ SPA index.html 반환
→ 클라이언트가 /v1/history?conversation_id=conv_xxx 호출
→ 서버가 쿠키 세션에서 user_id 확인
→ conv_xxx.owner_id === user_id 검증
→ 성공 시 반환, 실패 시 404/401
```

### 13.6 워크스페이스/파일 접근 정책

다중 유저에서 파일 접근은 정책 문서만으로 충분하지 않다. 반드시 코드에서 강제한다.

관리자는 전체 workspace root 아래에서 사용자별 접근 범위를 지정한다.

권장 구조:

```text
<workspace-root>/
├─ common/
│  └─ 공유 자료
├─ users/
│  ├─ <user-a>/
│  │  └─ 개인 작업공간
│  └─ <user-b>/
│     └─ 개인 작업공간
└─ system/
   └─ 관리자 전용
```

유저가 접근 가능한 경로:

- `<workspace-root>/common/`
- `<workspace-root>/users/<own-user-id-or-slug>/`

유저가 접근하면 안 되는 경로:

- 다른 사용자의 `users/<other-user>/`
- `system/`
- workspace root 상위 경로
- symlink/`..`/absolute path를 통한 우회 경로

#### common 권한

1차 구현에서는 common을 **read-only**로 둔다.

- user private dir: read/write 허용
- common dir: read 허용, write 금지
- common write가 필요하면 `common:write` 권한을 가진 사용자/관리자만 허용하는 2차 기능으로 분리한다.

#### DB 설계 후보

```sql
CREATE TABLE user_workspace_scopes (
  user_id TEXT PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  user_dir TEXT NOT NULL,
  common_dir TEXT NOT NULL,
  common_writable INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

또는 users 테이블에 최소 컬럼을 직접 둘 수 있다. 단, 향후 복수 scope가 필요해질 가능성을 고려하면 별도 테이블이 낫다.

#### 코드 강제 규칙

모든 파일 경로는 다음 절차를 거친다.

1. 사용자 입력 경로를 absolute path로 변환.
2. `realpath`로 symlink 해석.
3. 허용 root도 `realpath`로 정규화.
4. 요청 path가 허용 root 하위인지 검사.
5. read/write 권한을 분리 검사.

개념 코드:

```ts
const allowedReadRoots = [commonDir, userDir].map(realpath);
const allowedWriteRoots = [userDir, ...(commonWritable ? [commonDir] : [])].map(realpath);
const resolved = await realpath(requestedPath);

if (!isWithinAny(resolved, allowedReadRoots)) throw forbidden();
if (isWrite && !isWithinAny(resolved, allowedWriteRoots)) throw forbidden();
```

주의:

- `startsWith`만 쓰지 말고 path separator를 고려한 `isWithinDir()` 헬퍼를 사용한다.
- symlink가 허용 root 밖을 가리키면 차단한다.
- 업로드/첨부 저장 경로도 user별 디렉토리 하위로 제한한다.

### 13.7 미디어/첨부 접근 제어

`/v1/media` 같은 파일 반환 API도 같은 workspace scope와 owner 검증을 적용한다.

원칙:

- 첨부파일은 owner conversation/message를 통해 현재 user가 볼 수 있는지 검증한다.
- 임의 path 기반 미디어 조회는 허용 root 검사 통과 시에만 허용한다.
- 가능하면 장기적으로 path 직접 노출보다 media id 기반 조회로 바꾼다.
- 외부로 공유 가능한 URL이 필요하면 서명된 단기 URL을 별도 설계한다.

### 13.8 OpenClaw 실행 workspace 제한

가장 중요한 보안 경계다.

현재 bridge가 OpenClaw를 넓은 workspace에서 실행하면, UI/API에서 owner 검증을 해도 agent/tool이 다른 사용자 파일을 읽을 위험이 있다.

구현 전 확인할 것:

- `openclaw agent` 실행 시 cwd/workspace를 사용자별 디렉토리로 제한할 수 있는지.
- tool/file 접근 root allowlist를 전달할 수 있는지.
- 불가능하다면 최소한 bridge에서 노출하는 file/media API는 제한하되, OpenClaw 자체 tool 접근 위험을 별도 리스크로 문서화하고 해결책을 찾는다.

권장 실행 원칙:

```text
user request
→ auth user_id
→ resolve user workspace scope
→ OpenClaw runtime cwd = user_dir 또는 scoped workspace
→ common은 read-only reference로 제공
```

common을 agent가 읽어야 하는 경우:

- user_dir 안에 read-only symlink를 두는 방식은 symlink 우회 위험을 검토해야 한다.
- 더 안전한 방식은 agent/tool layer에서 allowed read roots로 `common`과 `user_dir`을 명시하는 것이다.

### 13.9 사용자별 설정 후보

- 기본 모델 / 허용 모델 목록
- 기본 agent 또는 persona/system prompt
- 파일 첨부 허용 여부와 용량 제한
- 이미지 생성, memory, task, route/weather 등 기능별 권한
- common write 허용 여부
- 일/월별 메시지 수, 토큰, 비용 quota
- 감사로그/audit log

1차에서는 인증/owner 격리/workspace scope를 우선하고, 사용자별 모델/권한은 schema만 열어두고 구현은 2차로 미룬다.

### 13.10 마이그레이션 원칙

- 기존 1인 데이터는 기본 admin 사용자에게 귀속한다.
- 기존 conversation에는 `owner_id = <admin user id>`를 채운다.
- 기존 API Key는 초기 admin bootstrap 또는 내부 토큰으로만 남기고, 일반 사용자 인증은 세션 쿠키로 전환한다.
- 기존 첨부파일은 admin user scope로 귀속하거나 migration mapping을 기록한다.
- migration 전후로 기존 conversation/history/job 데이터가 유실되지 않아야 한다.

### 13.11 UX 원칙

- 로그인 전에는 로그인 화면만 보여준다.
- 로그인 후에는 해당 사용자 대화 목록만 표시한다.
- 로그아웃 버튼을 제공한다.
- 인증 만료 시 로그인 화면으로 이동한다.
- 권한 없는 conversation URL 접근 시 첫 화면 또는 404 안내로 보낸다.
- 관리자는 CLI/script로 사용자 생성/비활성화/비밀번호 재설정을 수행한다.

### 13.12 보안 주의사항

- API Key 여러 개를 추가하는 것만으로는 다중 유저가 아니다. 반드시 `user_id`/`owner_id` 기반 데이터 격리가 필요하다.
- 모든 read/write API에서 owner 검증을 누락하면 다른 사용자의 대화가 노출될 수 있다.
- 첨부파일/미디어 URL도 owner 검증 또는 workspace scope 검증이 필요하다.
- 파일 접근은 MD 정책만으로 충분하지 않으며 코드 레벨 sandbox가 필수다.
- common은 기본 read-only로 시작한다.
- 감사로그에는 민감한 메시지 원문을 남기지 않는 방향을 우선 검토한다.

### 13.13 구현 순서

1. Auth/session schema 추가 및 migration 작성.
2. admin user bootstrap 스크립트 작성.
3. login/logout/me API 추가.
4. 프론트 로그인 화면과 로그아웃 버튼 추가.
5. `conversations.owner_id` 추가 및 기존 데이터 admin 귀속 migration.
6. 모든 conversation/history/message/job API에 owner 검증 추가.
7. workspace scope schema 추가.
8. path normalize/realpath/isWithinDir 기반 workspace guard 구현.
9. 첨부 저장과 `/v1/media`에 owner/scope 검증 적용.
10. OpenClaw runtime의 cwd/workspace 제한 가능성 검증 및 적용.
11. 테스트 추가: 인증, owner 격리, media 접근 차단, path traversal/symlink 차단.
12. PWA cache version 갱신 및 통합 검증.
