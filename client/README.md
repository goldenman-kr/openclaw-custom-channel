# Client (Mobile App)

Flutter(Dart) 기반 채팅 중심 모바일 앱 구현 디렉토리입니다.

## 기술 스택

- Flutter stable via FVM (`.fvmrc`)
- Dart from the selected Flutter SDK
- Material 3
- `http` for Bridge API calls
- `shared_preferences` for local settings persistence
- `geolocator` for current GPS lookup
- `image_picker` / `file_picker` for attachments

## 핵심 기능 (MVP)

- 채팅 메시지 입력/전송
- `현재위치전송` 옵션 (체크 시에만 위치 append)
- 사진/파일 첨부 옵션 메뉴
- 슬래시 커맨드 입력 및 추천
- Settings:
  - API URL
  - API Key
  - Theme (Light/Dark)

## UI/아키텍처 원칙

- UI 레이어와 동작 엔진 레이어 분리
- 비즈니스 로직(전송, 위치, 첨부, 인증)은 엔진에 배치
- UI는 상태 렌더링과 사용자 인터랙션에 집중
- 테마 토큰 기반 렌더링으로 라이트/다크 공통 대응
- 요청/응답/에러 처리 규약은 `specification.md`의 `8.1.1 API Contract v1 (Locked for MVP)`에 맞춰 구현

## 현재 추가된 계약 코드

- `lib/models/api_contract_v1.dart`
  - 서버 계약 대응 DTO 모델
  - 요청 payload 빌더 (`buildMessageRequest`)
- `lib/models/slash_command.dart`
  - `/status`, `/new`, `/reset`, `/models` 추천 목록
- `lib/engine/chat_engine.dart`
  - Settings 기반 `apiUrl`/`apiKey`로 `/v1/message` 호출
  - `buildMessageRequest`를 사용한 payload 구성
  - 서버 표준 에러 응답을 `ChatEngineError`로 변환
- `lib/engine/location_service.dart`
  - 권한 요청 후 현재 GPS 좌표를 메시지 append용 문자열로 변환
- `lib/engine/attachment_service.dart`
  - 사진/파일 선택, MIME 검증, base64 payload 생성
- `lib/theme/app_theme.dart`
  - Light/Dark Material theme 기반
- `lib/settings/`
  - `shared_preferences` 기반 Settings 저장/복원
  - 앱 전역 Theme 반영용 Settings controller
- `lib/screens/`
  - `ChatScreen`, `SettingsScreen`
  - API URL/API Key/Theme 입력, 검증, 저장
  - 저장된 Settings 기반 메시지 전송 및 응답/오류 표시
  - `/` 입력 시 slash command suggestion 표시
  - 현재위치전송, 사진/파일 첨부 UI 및 전송 payload 연결

## 실행

```bash
fvm flutter pub get
fvm flutter run
```

## 검증

```bash
fvm dart format lib test
fvm flutter analyze
fvm flutter test
```

## 다음 작업 제안

- 실제 기기에서 위치 권한/사진/파일 선택 플로우 점검
- 서버 mock transport와 E2E 수동 테스트

