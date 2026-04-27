# OpenClaw Custom Channel Monorepo

이 저장소는 OpenClaw 커스텀 채널 개발을 위한 모노레포입니다.
서버 브릿지와 모바일 클라이언트를 하나의 리포에서 함께 관리합니다.

## 디렉토리 구조

```text
.
├── specification.md
├── server/
│   └── README.md
└── client/
    └── README.md
```

## 구성 원칙

- `server/`: Mobile App 요청을 받아 OpenClaw로 전달하는 Bridge 서버
- `client/`: Flutter(Dart) 기반 채팅 UI 중심 모바일 클라이언트
- API 계약은 `specification.md`를 기준으로 유지
- 고정 계약은 `specification.md`의 `8.1.1 API Contract v1 (Locked for MVP)`를 기준으로 구현
- Flutter/Dart 버전은 루트 `.fvmrc`의 FVM stable 설정을 기준으로 사용

## 시작 순서 (권장)

1. `server/` MVP 구현 및 배포 URL 확보
2. `client/`에서 Settings(API URL/API Key) 연동
3. 위치/첨부/슬래시 커맨드 통합 테스트

## 빠른 로컬 검증

서버:

```bash
cd server
npm install
OPENCLAW_TRANSPORT=mock npm run dev
```

클라이언트:

```bash
cd client
fvm flutter pub get
fvm flutter run
```

클라이언트 Settings에는 다음 값을 입력합니다.

- API URL: `http://localhost:3000`
- API Key: `dev-api-key`

Android emulator에서 로컬 서버에 접근할 때는 API URL에 `http://10.0.2.2:3000`을 사용합니다.

