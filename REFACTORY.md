# PWA 서비스 코드품질 감사 메모

- 감사 일시: 2026-05-05 KST
- 대상 리포지토리: `openclaw-custom-channel`
- 기준 브랜치/HEAD: `main` / `865eb39`
- 원칙: **코드 수정 없이 검토만 수행**

## 검토 범위

- 프론트엔드 PWA: `server/public/app.js`, `styles.css`, `sw.js`, plugins
- 서버 런타임: `server/src/index.ts`, `server/src/runtime/MessageJobRunner.ts`, OpenClaw 연동부
- 점검 항목: 가비지 코드, 비효율 코드, 메모리 누수 가능성, 구조적 리팩터링 우선순위

## 총평

현재 서비스는 기능은 빠르게 확장되었지만, **프론트엔드 단일 파일 집중**, **장기 실행 시 메모리 누수 가능성**, **변경 감지/검색 경로의 과도한 재계산**이 누적되고 있습니다.

즉시 장애로 보이는 치명적 오류보다, **사용 시간이 길어질수록 메모리/성능이 악화될 수 있는 구조적 문제**가 더 큽니다.

---

## 우선순위 높은 발견사항

### 1. 브라우저 Blob URL 캐시가 해제되지 않음 — 프론트 메모리 누수 위험

**근거**
- `server/public/app.js:3010-3026`
- `getAuthorizedMediaUrl()`가 `URL.createObjectURL(blob)`를 만든 뒤 `mediaUrlCache`에 영구 저장합니다.
- `URL.revokeObjectURL(...)` 호출이나 캐시 eviction 로직이 없습니다.

**영향**
- 이미지/파일을 많이 열수록 탭 메모리가 계속 증가할 수 있습니다.
- 긴 대화, 첨부가 많은 사용 패턴에서 모바일 브라우저가 특히 취약합니다.

**권장 방향**
- 대화 전환/로그아웃/캐시 초기화 시 revoke
- LRU 또는 conversation-scope 캐시로 축소
- 미리보기용 URL과 다운로드 URL의 수명 분리

### 2. 취소된 job id 누적 — 서버 메모리 누수

**근거**
- `server/src/runtime/MessageJobRunner.ts:29-30`
- `cancelledJobIds`가 `Set`으로 유지됩니다.
- `server/src/runtime/MessageJobRunner.ts:67-70`에서 추가만 하고,
- `server/src/runtime/MessageJobRunner.ts:249-250`에서 계속 조회하지만 제거 코드가 없습니다.

**영향**
- 취소 요청이 누적될수록 프로세스 메모리에 영구 잔류합니다.
- 장기 운영 시 누적형 메모리 문제로 이어질 수 있습니다.

**권장 방향**
- terminal 상태 전환 시 삭제
- 또는 TTL/LRU cleanup 추가

### 3. in-memory jobs Map이 terminal 후에도 축적됨 — 서버 메모리 누수/중복 상태 보관

**근거**
- `server/src/index.ts:81` `const jobs = new Map<string, MessageJob>()`
- `server/src/index.ts:422-432` `updateJob()`가 상태 갱신 때마다 `jobs.set(job.id, job)` 수행
- completed/failed/cancelled 후 `jobs.delete(job.id)` 되는 일반 cleanup 경로가 없습니다.

**영향**
- 장기적으로 모든 작업 메타데이터가 메모리에 남습니다.
- 이미 SQLite에 저장된 job을 메모리에도 무기한 중복 보관하는 구조입니다.

**권장 방향**
- terminal 상태에서 즉시 제거하거나
- 최근 N개만 메모리에 유지하는 bounded cache로 전환

### 4. 히스토리 변경 감지가 전체 fetch + 전체 rerender 중심 — 비효율 큼

**근거**
- `server/public/app.js:2609-2637`
- `refreshHistoryIfChanged()`가 메타 조회 후 버전 변경이면 히스토리를 다시 가져오고,
- `historySignature(...) !== currentRenderedHistorySignature()`이면 기존 DOM을 전부 지우고 다시 렌더링합니다.
- `server/public/app.js:2678-2682`에서 이 로직이 5초 간격 poll로 반복됩니다.
- 동시에 `server/public/app.js:2697-2734` EventSource 기반 refresh도 병행됩니다.

**영향**
- 메시지가 길거나 첨부가 많을수록 스크롤 중 reflow/repaint 비용이 커집니다.
- 모바일에서 배터리/체감 성능 저하 가능성이 큽니다.
- SSE와 polling이 함께 있는 구조라 변경 시점마다 중복 비용이 생깁니다.

**권장 방향**
- append/patch 중심 incremental render
- message/version cursor 기반 diff
- hidden/idle 탭에서 poll 간격 완화 또는 pause

### 5. 대화 내용 검색이 conversation별 history API fan-out 구조 — 검색 확장성 취약

**근거**
- `server/public/app.js:1131-1140` 각 대화에 대해 `/v1/history` 호출
- `server/public/app.js:1143-1173` 검색어 입력 시 title 미매칭 대화를 순회하며 본문 검색
- worker 4개 병렬로 API fan-out 수행

**영향**
- 대화 수가 많아질수록 검색 한 번에 다수의 API 요청이 발생합니다.
- 서버/브라우저 모두 불필요한 JSON 파싱과 문자열 결합 비용을 부담합니다.
- 현재 cache는 query 기반 임시 캐시라, 검색어가 바뀌면 다시 비용이 발생합니다.

**권장 방향**
- 서버측 검색 endpoint 도입
- SQLite FTS 사용 검토
- 프론트 fan-out 검색 제거

### 6. `openclawSessionId` 역조회가 최근 500개 대화 선형탐색에 의존 — 성능/정확성 리스크

**근거**
- `server/src/index.ts:464-472`
- `chatStore.listConversations({ includeArchived: true, limit: 500 })` 후 `.find(...)`

**영향**
- 대화 수가 500개를 넘으면 오래된 대화는 lookup 실패 가능성이 있습니다.
- 알림/announcement 라우팅이 대화 수 증가에 따라 불안정해질 수 있습니다.

**권장 방향**
- `openclawSessionId` 전용 indexed lookup 추가
- 최소한 limit 의존 제거

---

## 중간 우선순위 발견사항

### 7. 프론트엔드 단일 파일 집중이 심함

**근거**
- `server/public/app.js` 약 **4691 lines**
- 장문 함수 예시
  - `renderConversationList` 110 lines
  - `appendMarkdown` 165 lines
  - `appendMediaRef` 132 lines
  - `handleSubmit` 122 lines

**영향**
- 변경 영향 범위 예측이 어렵고 회귀 위험이 큽니다.
- 동일 파일 안에서 상태관리, 네트워크, 마크다운, 미디어, 검색, 스트리밍, 뷰어, 설정 UI가 혼재합니다.

**권장 방향**
- 최소 단위 분리 우선순위:
  1. history/rendering
  2. media handling
  3. composer/slash commands
  4. conversation list/search
  5. settings/state persistence

### 8. Polling/interval이 페이지 생명주기 최적화 없이 유지됨

**근거**
- `server/public/app.js:4290-4291` 버전 체크 interval 상시 유지
- `server/public/app.js:2678-2682` history polling interval 상시 유지
- 일부 로직은 `document.hidden` 체크가 있으나 interval 자체는 계속 살아 있습니다.

**영향**
- hidden tab에서 쓸데없는 wake-up이 생깁니다.
- 모바일 브라우저에서 전력 효율이 떨어질 수 있습니다.

**권장 방향**
- `visibilitychange` 기반 pause/resume
- active conversation 없을 때 interval 중단

---

## 가비지 코드 / 구조 냄새 관점 메모

- 현재 `app.js`는 기능 추가 속도는 빠르지만, 모듈 경계가 거의 없습니다.
- 화면 렌더링 함수가 네트워크 호출, 상태 변경, DOM 조작을 동시에 수행하는 경우가 많습니다.
- "임시 완충" 성격의 캐시/Map/Timer가 여러 개 존재하지만, lifecycle cleanup 규칙이 일관되지 않습니다.
- 서비스 워커 버전/캐시 관리가 수동 버전 bump에 크게 의존합니다. 운영 discipline이 없으면 재발하기 쉬운 유형입니다.

---

## 중요도 감별 및 최종 우선순위

평가 기준은 아래 4가지로 두었습니다.

- **운영위험도**: 장기 운영 시 장애/메모리/성능 악화 가능성
- **기능 영향도**: 기능 동작을 건드리지 않고 분리 가능한지
- **적용 난이도**: 작은 PR로 나눌 수 있는지
- **선행성**: 뒤 단계 리팩터링의 기반이 되는지

| 우선순위 | 항목 | 중요도 | 이유 |
|---|---|---:|---|
| P0 | `mediaUrlCache`, `cancelledJobIds`, `jobs` 누수 차단 | 최고 | 기능 영향 거의 없이 장기 메모리 리스크를 바로 줄일 수 있음 |
| P1 | history refresh 비용 절감 구조 | 높음 | 현재 체감 성능과 배터리/렌더링 비용의 핵심 병목 |
| P2 | conversation search 서버화 | 높음 | 대화 수 증가 시 API fan-out이 빠르게 비싸짐 |
| P3 | `openclawSessionId` lookup 정규화 | 중상 | 규모 커질수록 정확성/성능 문제로 이어짐 |
| P4 | `app.js` 모듈 분리 | 중상 | 직접 성능 이득보다 유지보수성과 회귀 억제 효과가 큼 |
| P5 | interval/page lifecycle 최적화 | 중간 | 비교적 안전하지만 P0~P2보다 긴급도는 낮음 |

## 기능 영향 없는 순차 리팩터링 적용 계획

아래 계획은 **동작을 바꾸지 않고 내부 구조만 정리하는 순서**를 전제로 합니다.

### Phase 0 — 안전장치 먼저

**목표**
- 리팩터링 도중 기능 회귀를 막기 위한 관측 지점 확보

**변경 원칙**
- 사용자 UI/응답 포맷 변경 금지
- route/schema/storage format 변경 금지
- 한 PR당 한 주제만 다룸

**사전 체크리스트**
- `npm test`
- `npm run build`
- 가능하면 대상 영역별 smoke check
- diff 범위를 작은 단위로 유지

### Phase 1 — 메모리 누수 차단 (가장 먼저)

**대상**
1. `server/public/app.js`의 `mediaUrlCache`
2. `server/src/runtime/MessageJobRunner.ts`의 `cancelledJobIds`
3. `server/src/index.ts`의 `jobs`

**적용 방식**
- 외부 API/화면 동작은 그대로 둔 채 cleanup 경로만 추가
- 캐시 자료구조의 수명 관리만 넣고, 조회 방식은 최대한 유지
- terminal 상태 cleanup / revoke / bounded cache 같은 내부 로직만 손봄

**왜 1순위인가**
- 기능 영향이 가장 작고, 운영 리스크 절감 효과가 가장 큼

### Phase 2 — history refresh 내부 구조 분리

**대상**
- `refreshHistoryIfChanged()`
- history signature 비교
- full rerender 경로
- polling + EventSource 협력 구조

**적용 방식**
- 먼저 함수 분리만 수행
  - `fetch history meta`
  - `should rerender`
  - `render patch`
  - `scroll restore`
- 첫 단계에서는 여전히 기존 렌더 결과가 같도록 유지
- incremental patch는 **2단계 이후**에 도입하고, 초반에는 구조 분리/테스트 보강만 진행

**왜 이 순서인가**
- 바로 diff 렌더로 뛰어들면 회귀 위험이 큼
- 먼저 구조를 쪼개야 안전하게 최적화 가능

### Phase 3 — 검색 경로 서버화 준비

**대상**
- `fetchConversationHistoryMessages()`
- `runConversationContentSearch()`

**적용 방식**
- 1차: 프론트 검색 로직을 adapter 형태로 분리
- 2차: 서버 검색 endpoint/DB query를 추가하되, 기존 결과와 동일한 응답 계약 유지
- 3차: 프론트 fan-out 제거

**주의점**
- 검색 결과 정렬/포함 기준이 바뀌면 체감상 기능 변경으로 보일 수 있으므로, 결과 동등성 검증이 필요

### Phase 4 — session/conversation lookup 정규화

**대상**
- `conversationForOpenClawSessionId()`

**적용 방식**
- 기존 호출부는 유지
- 내부 구현만 `indexed lookup` 또는 dedicated store method로 교체
- limit 500 제거

**왜 이 단계인가**
- 기능 영향은 작지만 호출 경로가 상대적으로 좁아, memory/perf 핵심 경로보다 뒤에 둬도 됨

### Phase 5 — `app.js` 모듈 분리

**권장 분해 순서**
1. `media-*`
2. `history-*`
3. `conversation-list-*`
4. `composer-*`
5. `settings-*`
6. `markdown-*`

**적용 방식**
- 번들러 도입 없이도 가능한 범위부터 시작
- 처음에는 파일 분리 + export/import 정리만 수행
- DOM structure / CSS class / API shape는 그대로 유지

**왜 마지막인가**
- 구조 분해는 중요하지만, 앞선 P0~P3보다 즉시 운영리스크 감소 효과는 낮음
- 먼저 hot path와 leak를 줄여놓고 들어가는 편이 안전함

### Phase 6 — page lifecycle / polling 최적화

**대상**
- history polling
- version check interval
- hidden tab 동작

**적용 방식**
- `visibilitychange`, active conversation 여부, online/offline 상태를 반영
- polling interval 자체를 stop/resume 하되, UX 변화가 없도록 fallback 유지

**왜 마지막인가**
- 비교적 안전하지만 미묘한 타이밍 회귀 가능성이 있어, 구조 정리 후 적용하는 편이 낫습니다.

## 권장 리팩터링 순서

1. **Phase 1 / 메모리 누수 차단**
2. **Phase 2 / history refresh 구조 분리**
3. **Phase 3 / 검색 서버화 준비 및 전환**
4. **Phase 4 / session lookup 정규화**
5. **Phase 5 / app.js 모듈 분리**
6. **Phase 6 / lifecycle polling 최적화**

## 작업 분할 원칙

- 한 번에 큰 리팩터링 1개를 하지 말고, **작은 무기능변경 PR**로 나눌 것
- 각 단계는 가능하면 아래 순서를 지킬 것
  1. 분리 대상 함수 추출
  2. 동작 동일성 테스트 추가
  3. 내부 구현 교체
  4. build/test/smoke 검증
- UI 문구, API contract, DB schema는 별도 명시 없이는 건드리지 말 것
- 성능 개선이 목적이어도 **겉보기 동작이 달라지면 그건 리팩터링이 아니라 기능 변경**으로 취급할 것

---

## 이번 감사에서 의도적으로 하지 않은 것

- 서비스 코드 수정
- 리팩터링 직접 반영
- 동작 변경을 수반하는 패치

이번 문서는 **검토 기록**이며, 실제 수정은 별도 작업으로 분리하는 것이 안전합니다.

---

## 2026-05-06 종료 기록

- 현재 코드 리팩터링은 Eddy 지시에 따라 **종료 처리**한다.
- 남아 있는 미완성 항목은 실수나 누락이 아니라 **의도적으로 남긴 보류 항목**이다.
- 추후 필요할 때만 수동으로 재개한다.
- 따라서 이 문서의 남은 계획/권장 단계는 자동 진행 대상이 아니라, 재개 시 참고할 백로그로만 취급한다.
- 마지막으로 확인된 상태: 기존 리팩터링은 대략 98–99% 수준까지 진행되었고, `app.js` 모듈 분리 등 일부 구조 정리는 의도적으로 남겨 두었다.
