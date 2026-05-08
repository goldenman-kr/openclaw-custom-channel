# PWA 단말 알림 기능 구현 임시 계획

> 목적: Android PWA에서 우선 테스트하고, iOS 홈 화면 PWA까지 동작 가능한 Web Push 기반 알림을 추가한다.  
> 상태: Phase 1 MVP 구현 완료(2026-05-08). Android/iOS 실기기 수신 검증과 Phase 2 UX 보강은 아직 남음.

## 0. 현재 구조 요약

- 프론트엔드: `server/public/`의 정적 PWA 앱
  - `index.html`, `app.js`, `modules/*`, `manifest.webmanifest`, `sw.js`
- 서버: Node.js HTTP 서버 + SQLite
  - 진입점: `server/src/index.ts`
  - DB: `better-sqlite3`, 기본 `server/state/chat.sqlite`
  - 대화/메시지 저장: `server/src/session/SqliteChatStore.ts`
  - 대화 이벤트 SSE: `server/src/events/ConversationEventPublisher.ts`
- 현재 알림 구현:
  - `server/public/modules/notifications.js`
  - 브라우저 탭이 살아 있을 때 `new Notification(...)`으로 응답 완료 알림만 표시
  - 진짜 Push API 구독/서버 푸시는 아직 없음
- 현재 서비스워커:
  - `server/public/sw.js`
  - 캐시/fetch 처리만 있음
  - `push`, `notificationclick` 이벤트 핸들러 없음

## 1. 플랫폼 제약 및 요구사항

### Android

- Chrome/Android PWA는 표준 Web Push 지원.
- HTTPS 또는 localhost 보안 컨텍스트 필요.
- Service Worker + Push API + Notification 권한 + VAPID 키 필요.
- 앱이 닫혀 있거나 백그라운드여도 Push Service를 통해 알림 표시 가능.

### iOS / iPadOS

- iOS 16.4+에서 Web Push 지원.
- Safari 탭 상태에서는 제한적이며, 일반적으로 **홈 화면에 설치된 PWA**에서만 안정적으로 동작.
- `manifest.webmanifest`와 `display: standalone` 조건이 중요함. 현재 manifest는 기본 조건을 대부분 만족.
- 권한 요청은 반드시 사용자 제스처 이후 실행해야 함.
- iOS는 알림 권한 UX가 Android보다 까다로워서 “홈 화면에 추가 후 알림 켜기” 안내 UI가 필요할 수 있음.

## 2. 전체 난이도 판단

### MVP 난이도: 중간

이유:

- 클라이언트 쪽 Push API/Service Worker 구현은 표준적임.
- 서버에 구독 저장소와 VAPID 전송 로직이 추가되어야 함.
- 현재 Node 서버/SQLite 구조에는 잘 맞음.
- 다만 iOS PWA 테스트와 권한 안내 UX가 까다롭고, 실제 알림 발화 지점을 신중히 잡아야 함.

### 서버 구조 영향도: 중간 이하

- 기존 메시지/대화 구조를 크게 바꿀 필요는 없음.
- 추가될 가능성이 높은 것:
  - `push_subscriptions` SQLite 테이블
  - `/v1/push/vapid-public-key`
  - `/v1/push/subscriptions` 등록/해제 API
  - 서버-side push sender 모듈
  - 메시지/이벤트 생성 시 알림 발송 hook
- 기존 SSE/폴링 구조는 유지 가능.
- 서비스워커는 캐시 기능에 push/click handler만 추가하면 됨.

## 3. Flutter Web 검토

### 결론: 지금은 Flutter로 갈 필요 없음

- 현재 PWA는 이미 정적 JS + Node 서버 구조로 작동 중이고, 알림 기능은 Web Push 표준 API로 해결 가능.
- Flutter Web로 바꾼다고 iOS PWA Push 제약이 사라지지 않음.
- Flutter Web도 결국 service worker/web push/FCM/VAPID를 다뤄야 하므로 복잡도만 증가할 가능성이 큼.
- Flutter가 필요한 경우는 “앱 전체 UI를 Flutter로 재작성”하거나 “네이티브 앱까지 같은 코드베이스로 확장”할 때임.

### 네이티브 앱 대안

- Android/iOS 네이티브 앱으로 가면 FCM/APNs를 직접 사용할 수 있어 알림 안정성은 올라감.
- 하지만 현재 목표가 PWA 알림이라면 과한 선택.
- 우선 Web Push로 구현하고, iOS 제약이 실제 사용성에 문제가 될 때 네이티브 래퍼/앱을 검토하는 편이 맞음.

## 4. 구현 단계 계획

## Phase 1 — Web Push 기반 MVP

목표: Android PWA에서 응답 도착/백그라운드 알림이 실제로 뜨게 한다.

구현 상태: 완료

작업:

1. VAPID 키 관리 추가
   - `web-push` 패키지 도입 검토
   - 환경변수 예시:
     - `WEB_PUSH_VAPID_PUBLIC_KEY`
     - `WEB_PUSH_VAPID_PRIVATE_KEY`
     - `WEB_PUSH_SUBJECT` 예: `mailto:...` 또는 서비스 URL
   - 키 생성 스크립트 또는 문서 추가

2. SQLite 구독 테이블 추가
   - 후보 테이블: `push_subscriptions`
   - 저장 필드 후보:
     - `id`
     - `owner_id`
     - `device_id`
     - `endpoint`
     - `p256dh`
     - `auth`
     - `user_agent`
     - `created_at`
     - `updated_at`
     - `last_seen_at`
     - `disabled_at`
   - `endpoint` unique 처리

3. 서버 API 추가
   - `GET /v1/push/vapid-public-key`
   - `POST /v1/push/subscriptions`
   - `DELETE /v1/push/subscriptions`
   - 인증은 현재 쿠키 로그인/API key 흐름을 재사용
   - 사용자별/기기별 구독만 저장되도록 owner scope 적용

4. 클라이언트 구독 로직 추가
   - `modules/notifications.js`를 Web Push 중심으로 확장하거나 별도 `push-notifications.js` 추가
   - 알림 버튼 클릭 시:
     1. Service Worker 준비 확인
     2. Notification 권한 요청
     3. VAPID public key 조회
     4. `registration.pushManager.subscribe(...)`
     5. 서버에 subscription 저장
   - 권한 상태별 버튼 문구 정리:
     - 미지원
     - 홈 화면 설치 필요 가능성
     - 알림 허용
     - 알림 켜짐
     - 알림 차단됨

5. Service Worker push handler 추가
   - `self.addEventListener('push', ...)`
   - `registration.showNotification(...)`
   - payload 후보:
     - `title`
     - `body`
     - `url`
     - `conversation_id`
     - `tag`
   - `notificationclick`에서 기존 PWA 창 focus 또는 `/chat/<conversation_id>` 열기

6. 서버 알림 발송 hook 추가
   - 우선 발화 지점 후보:
     - assistant 메시지가 DB에 저장된 직후
     - autonomous announcement가 대화에 추가된 직후
   - MVP에서는 “사용자가 보낸 메시지에 대한 assistant 응답 완료”만 대상으로 제한하는 것을 권장
   - 알림 내용은 민감정보 노출 방지를 위해 기본값을 보수적으로:
     - 제목: `OpenClaw 응답 도착`
     - 본문: `새 답변이 도착했습니다.`
     - 필요 시 대화 제목 정도만 포함

7. 실패한 구독 정리
   - Push 발송 결과가 `404`/`410`이면 해당 subscription 비활성화 또는 삭제
   - 기타 오류는 로그만 남기고 기존 응답 흐름을 막지 않음

검증:

- 완료: `npm run typecheck`
- 완료: `npm test`
- 완료: `npm run build`
- 완료: `node --check public/modules/notifications.js`
- 완료: `node --check public/sw.js`
- 완료: `git diff --check`
- 남음: Android Chrome PWA 설치 후:
  - 알림 권한 허용
  - 앱 백그라운드/종료 상태에서 메시지 전송 완료 알림 확인
  - 알림 클릭 시 해당 대화로 이동 확인

## Phase 2 — iOS PWA 대응 및 UX 보강

목표: iOS 홈 화면 PWA에서도 가능한 범위에서 안정적으로 알림을 켠다.

작업:

1. iOS PWA 감지 로직 추가
   - iOS 여부
   - standalone display mode 여부
   - Notification/PushManager 지원 여부

2. 설치 안내 UI 추가
   - iOS Safari 탭에서 알림을 켜려 할 때:
     - “홈 화면에 추가 후 앱 아이콘으로 실행해야 알림을 사용할 수 있습니다.” 안내
   - 이미 standalone이면 권한 요청 진행

3. manifest 보강 검토
   - 현재 `display: standalone`, icon, theme color는 있음
   - 필요 시 `id`, `categories`, `lang` 등 추가 검토
   - iOS 아이콘/색상은 기존 유지 가능

4. iOS 실제 테스트
   - iOS 16.4+ 기기
   - 홈 화면 설치
   - 앱 아이콘으로 실행
   - 알림 권한 요청/허용
   - 백그라운드 알림 수신
   - 알림 클릭 후 대화 이동

검증:

- iOS Safari 탭에서는 적절히 설치 안내가 뜨는지
- iOS 홈 화면 PWA에서는 권한 요청과 구독 등록이 되는지
- 실패 시 UI가 막히지 않고 “지원 안 됨/설치 필요/권한 차단” 상태를 명확히 보여주는지

## Phase 3 — 알림 정책/설정 고도화

목표: 알림 남발을 막고 사용자가 제어할 수 있게 한다.

작업:

1. 알림 종류 설정
   - 응답 도착
   - 백그라운드 autonomous announce
   - 실패/오류
   - 멘션 또는 특정 대화만

2. 대화별 알림 mute
   - conversation 단위 설정 테이블 또는 user preference 추가

3. 민감정보 보호 옵션
   - 본문 숨김: “새 답변이 도착했습니다.”만 표시
   - 대화 제목 포함 여부
   - 메시지 일부 preview 포함 여부는 기본 비활성 권장

4. 중복/폭주 방지
   - 같은 conversation/tag는 replace
   - 짧은 시간 내 여러 알림 coalesce
   - 활성 화면/포커스 중이면 push 알림 생략 또는 in-app toast만 표시

## Phase 4 — 운영/관찰성

목표: 실제 운영에서 문제를 찾고 복구할 수 있게 한다.

작업:

1. 구독 관리/점검 로그
   - 구독 등록/삭제 로그
   - 발송 성공/실패 카운트
   - 만료 subscription 정리

2. 관리자용 점검 API 또는 스크립트
   - 내 기기에 테스트 알림 보내기
   - 구독 목록 확인
   - 죽은 구독 정리

3. 서비스 재시작/배포 고려
   - Service Worker cache version bump 필요
   - client asset version bump 필요
   - 기존 캐시가 오래 남지 않도록 `sw.js` 업데이트

## 5. 주요 설계 결정 후보

### 알림 발화 대상

권장 MVP:

- “사용자가 시작한 메시지 작업이 완료되었고, 해당 사용자의 기기에만 알림”

후속 확장:

- autonomous announcement
- 다른 대화 업데이트
- 시스템 알림

### 알림 내용

권장 기본값:

- 제목: `OpenClaw 응답 도착`
- 본문: `새 답변이 도착했습니다.`
- 데이터: `{ conversation_id, url }`

이유:

- 잠금화면에서 민감한 대화 내용 노출 방지
- Android/iOS 공통 안정성 우선

### Push Provider

권장: 표준 Web Push + VAPID 직접 구현

- 장점: 외부 벤더 의존 최소화, 현재 서버 구조에 자연스럽게 맞음
- 단점: 구독/발송/정리 로직을 직접 관리해야 함

대안: FCM/OneSignal

- 장점: 대시보드/세그먼트/운영 기능
- 단점: 외부 의존, iOS PWA에서는 여전히 Web Push 제약 존재, 현재 개인 PWA에는 과할 수 있음

## 6. 예상 변경 파일

클라이언트:

- `server/public/modules/notifications.js`
- `server/public/sw.js`
- `server/public/app.js`
- `server/public/index.html` 또는 설정 UI 관련 모듈
- `server/public/manifest.webmanifest` 선택적 보강

서버:

- `server/package.json`
- `server/src/index.ts`
- 신규 후보: `server/src/http/pushRoutes.ts`
- 신규 후보: `server/src/session/PushSubscriptionStore.ts`
- 신규 후보: `server/src/notifications/WebPushSender.ts`
- `server/src/session/SqliteChatStore.ts` 또는 별도 store migration

테스트:

- 신규 push route/store 단위 테스트
- service worker push handler 정적 테스트
- 기존 `npm run typecheck`, `npm test`

## 7. 리스크와 주의사항

- iOS는 “홈 화면 PWA” 조건 때문에 사용자가 Safari 탭에서 테스트하면 안 된다고 느낄 수 있음. 안내 UI가 중요함.
- 알림 권한은 한 번 차단되면 브라우저/OS 설정에서 풀어야 해서, 권한 요청 전 자체 설명 화면이 필요함.
- 서버에서 push 발송 실패가 채팅 응답 저장/표시에 영향을 주면 안 됨. 알림은 best-effort로 처리.
- 잠금화면에 민감한 답변 내용이 노출될 수 있으므로 본문 preview는 기본 비활성 권장.
- Service Worker 캐시 버전과 client asset version을 함께 올리지 않으면 오래된 클라이언트가 남을 수 있음.

## 8. 권장 시작 순서

1. `web-push` 도입 및 VAPID 키 환경변수 설계
2. `push_subscriptions` 저장소/마이그레이션 작성
3. push route 3개 작성: public key 조회, subscribe, unsubscribe
4. `sw.js`에 push/click handler 추가
5. 클라이언트 알림 버튼을 Push 구독 버튼으로 확장
6. assistant 응답 완료 지점에 best-effort push 발송 hook 연결
7. Android PWA에서 실제 수신 테스트
8. iOS 홈 화면 PWA 테스트 및 안내 UI 보강
