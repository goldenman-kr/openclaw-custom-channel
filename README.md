# OpenClaw Custom Channel Monorepo

이 저장소는 OpenClaw 커스텀 채널 개발을 위한 모노레포입니다.
서버 Bridge/Web/PWA와 Android/iOS WebView 래퍼를 하나의 리포에서 함께 관리합니다.

## 디렉토리 구조

```text
.
├── specification.md
├── server/
│   └── README.md
├── android-webview/
└── ios-webview/
```

## 구성 원칙

- `server/`: Web/PWA UI와 OpenClaw Bridge API를 함께 제공
- `android-webview/`, `ios-webview/`: 서버 Web/PWA를 감싸는 네이티브 WebView 클라이언트
- API 계약은 `specification.md`를 기준으로 유지
- 고정 계약은 `specification.md`의 `8.1.1 API Contract v1 (Locked for MVP)`를 기준으로 구현
- 예전 Flutter `client/` 구현은 `multi-session` 브랜치에서 제거하고 Web/PWA 중심으로 정리

## 시작 순서 (권장)

1. `server/` Web/PWA 및 Bridge API 구현
2. Web/PWA Settings(API URL/API Key) 연동
3. Android/iOS WebView에서 서버 Web/PWA 로딩 확인
4. 위치/첨부/슬래시 커맨드 통합 테스트

## 빠른 로컬 검증

서버:

```bash
cd server
npm install
OPENCLAW_TRANSPORT=mock npm run dev
```

서버 기본 바인딩은 `0.0.0.0:29999`입니다. 외부 공개 시에는 `CORS_ALLOW_ORIGIN`, `BRIDGE_API_KEYS`, `AUTH_*` 값을 환경변수로 명시하고, 필요하면 방화벽/리버스 프록시에서 노출 범위를 제한하세요.

Web/PWA:

```bash
open http://localhost:29999/
```

Web/PWA Settings에는 다음 값을 입력합니다.

- API URL: `http://localhost:29999`
- API Key: 개발/테스트 기본값은 `dev-api-key`입니다. 운영에서는 반드시 `BRIDGE_API_KEYS`로 긴 랜덤 값을 지정하세요.

Android/iOS 앱은 별도 Flutter 클라이언트가 아니라 서버 Web/PWA를 감싸는 WebView 방식으로 유지합니다.

공유용 아카이브는 반드시 git 기준으로 생성하세요. `server/state/`, 빌드 산출물, 내부 임시 문서는 공유 대상에서 제외됩니다.

```bash
./scripts/export-shareable.sh
```

