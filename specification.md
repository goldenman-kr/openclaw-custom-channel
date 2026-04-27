# Context-Aware Mobile Client + OpenClaw Bridge Spec

## Key Revision

Location must NOT be sent automatically.

Location is included only when the user explicitly enables it for the current message.

---

# 1. Mobile Client Requirements

## 1.1 Chat Input Area

The message input area must include:

- Text input
- Send button
- Checkbox or toggle:
  - Label: 현재위치전송
- Attachment option menu button (`+` or clip icon):
  - 사진 첨부
  - 파일 첨부

Example UI:

text [ + ] [ message input........... ] [Send] [✓ 현재위치전송] 

---

## 1.2 Location Sending Behavior

### Default behavior

If 현재위치전송 is unchecked:

text User message only 

Example:

text 판교역까지 얼마나 걸려? 

---

### If 현재위치전송 is checked

The app should fetch the current GPS coordinates and append them directly to the message text.

Example final message sent to server:

text 판교역까지 얼마나 걸려?  현재위치: 37.123456, 127.123456 

Do not send GPS as hidden metadata for MVP.

The location must be visible in the final message payload.

---

## 1.3 Message Payload

http POST /v1/message Authorization: Bearer <token> 

json {
  "message": "판교역까지 얼마나 걸려?\n\n현재위치: 37.123456, 127.123456",
  "attachments": [
    {
      "type": "image",
      "name": "photo.jpg",
      "mime_type": "image/jpeg",
      "content_base64": "<base64-data>"
    },
    {
      "type": "file",
      "name": "route.pdf",
      "mime_type": "application/pdf",
      "content_base64": "<base64-data>"
    }
  ]
}

Optional metadata may still be sent later, but MVP should rely on appended plain text.

All data for one chat send action must be delivered in a single request:

- Message text
- Optional location text (appended in `message`)
- Optional attachments (`attachments`)

Do not split one user send action into separate upload and message requests.

---

## 1.4 Location Permission

The app should request location permission only when needed.

Flow:

text User checks 현재위치전송 → If permission not granted, request permission → If granted, fetch current GPS → Append location to outgoing message → Send 

If location fetch fails:

text 현재위치전송을 체크했지만 위치를 가져오지 못했습니다. 위치 없이 전송할까요? 

For MVP, show an error and do not send automatically.

---

## 1.4.1 Attachment Sending Behavior

The chat input must support adding attachments through an option menu:

- 사진 첨부
- 파일 첨부

Rules:

- Users can attach image and general file data to a message.
- Attachments are part of the same message send action.
- The app must send message + attachments together in one `/v1/message` request.
- If attachment conversion/read fails, show error and stop send.
- If both location toggle and attachments are used, include both in the same request.

MVP guidance:

- Use base64 payload for attachments (`content_base64`) to keep single-request transport simple.
- Enforce a client-side size limit and show error when exceeded.

---

## 1.5 Settings Menu

The mobile app must provide a settings menu for server connection configuration.

Required fields:

- API URL (Bridge server base URL)
- API Key (or Bearer token for Authorization header)

### 1.5.1 Screen and Navigation

- Provide a `Settings` entry from the main chat screen (header action or menu).
- Show a dedicated settings form screen.
- Provide `Save` action (button) and return to chat after successful save.

### 1.5.2 Form Behavior

- Users can view and edit `API URL` and `API Key`.
- `API URL` should be trimmed before save.
- `API Key` should be trimmed before save.
- Save only when validation passes.

### 1.5.3 Validation Rules

- `API URL` is required.
- `API Key` is required.
- `API URL` must be a valid HTTP/HTTPS URL.
- If validation fails, show inline error under each invalid field and keep the user on settings screen.

Example validation messages:

- `API URL을 입력해주세요.`
- `올바른 API URL 형식이 아닙니다.`
- `API Key를 입력해주세요.`

### 1.5.4 Runtime Usage

- The app must use the latest saved `API URL` + `API Key` for `/v1/message` requests.
- `Authorization` header should use the saved key as Bearer token:

```text
Authorization: Bearer <saved_api_key>
```

- If required settings are missing at send time, block send and show a validation toast/dialog.

Example message:

```text
서버 연결 설정이 필요합니다. 설정에서 API URL과 API Key를 입력해주세요.
```

### 1.5.5 Connection Test (MVP Recommended)

- Provide `연결 테스트` button in settings.
- Test request can call a lightweight endpoint (preferred) or `/v1/message` with a safe test payload.
- Show explicit success/failure result:
  - Success: `서버 연결에 성공했습니다.`
  - Failure: `서버 연결에 실패했습니다. URL/API Key를 확인해주세요.`
- `연결 테스트` is recommended but does not replace validation rules.

### 1.5.6 Persistence and Security

- Persist settings locally on device so they survive app restart.
- Do not hardcode API URL or API Key in source for production builds.
- Mask API Key input by default (password-style input), with optional show/hide toggle.

### 1.5.7 Theme Settings (Light/Dark)

- Settings must include `Theme` option with:
  - `Light`
  - `Dark`
- The selected theme must be applied app-wide immediately after save (or immediately on selection).
- Persist the selected theme locally and restore it on app launch.
- All core screens (`Chat`, `Settings`) must use the shared theme tokens (color, background, text, border).
- Do not hardcode per-screen colors that bypass theme tokens.

---

# 2. OpenClaw Command Support

The mobile client must support OpenClaw slash commands.

Examples:

text /status /new /reset /models 

These commands should be sent as raw messages to OpenClaw.

---

## 2.1 Command Input Behavior

If the user enters a message starting with /, treat it as an OpenClaw command.

Examples:

text /status /models /reset /new 

The app should not modify the command except trimming whitespace.

---

## 2.2 Location Toggle with Commands

For slash commands, location should normally be ignored.

Rule:

text If message starts with "/", do not append current location even if 현재위치전송 is checked. 

Reason:

OpenClaw commands should remain clean and compatible with existing Telegram-style command behavior.

Example:

text /status 

Not:

text /status  현재위치: 37.123456, 127.123456 

---

## 2.2.1 Attachments with Commands

Slash commands should remain clean command messages.

Rule:

```text
If message starts with "/", do not include attachments in the request.
```

Behavior:

- If attachments are selected and user enters slash command, block send and show guidance.

Example message:

```text
슬래시 명령어에는 사진/파일 첨부를 사용할 수 없습니다.
```

---

## 2.3 Command Suggestions

When the user types /, show command suggestions.

Initial supported commands:

text /status /new /reset /models 

Optional descriptions:

text /status  - Show OpenClaw gateway/session status /new     - Start a new conversation/session /reset   - Reset current session /models  - Show available models 

---

# 3. Bridge Server Requirements

## 3.1 Main Endpoint

http POST /v1/message Authorization: Bearer <token> 

Request:

json {   "message": "판교역까지 얼마나 걸려?\n\n현재위치: 37.123456, 127.123456" } 

---

## 3.2 Server Responsibility

The bridge server should not parse location for MVP.

It should forward the message and attachments to OpenClaw without rewriting user content semantics.

text Mobile App → Bridge Server → OpenClaw Gateway 

---

## 3.3 Command Forwarding

If the message starts with /, forward it as-is.

Examples:

text /status /new /reset /models 

The bridge server should not convert or reinterpret these commands.

---

## 3.4 Attachment Forwarding

For non-slash messages, the bridge server should accept and forward attachments in the same request context.

Rules:

- Handle `message` + `attachments` as one logical chat send unit.
- Do not require separate pre-upload API for MVP.
- Preserve attachment order from client payload.
- If forwarding fails, return a clear error response so the mobile app can show failure.

---

# 4. Session Handling

The app should still maintain a device/session identity.

text device_id → session_id 

Example:

text abc-123 → mobile-abc-123 

This is handled by the bridge server.

---

# 4.1 Mobile Architecture Principle (Engine/UI Separation)

To make future UI improvements easy, the mobile app should separate behavior engine and UI layer.

Client implementation stack:

- Flutter stable via FVM (`.fvmrc`)
- Dart from the selected Flutter SDK
- Material 3

Flutter should be the primary and only MVP mobile client implementation target.

Required structure:

- `Engine` layer:
  - Message send pipeline (normal/slash command routing)
  - Location permission + fetch logic
  - Attachment select/read/validate/encode logic
  - Payload construction rule (`message` text append)
  - API request/auth handling
  - Session/device state coordination
  - Settings state read/write interface
- `UI` layer:
  - Screen layout and components (`Chat`, `Settings`)
  - User interaction handling (input, click, toggle, suggestions)
  - Rendering state from Engine outputs
  - Theme token application (Light/Dark)

Rules:

- UI must not directly contain network/location business logic.
- Engine must be testable independently of UI widgets/framework details.
- UI changes (layout/style) should not require core send pipeline changes.
- Attachment UI changes must not require transport/business-rule rewrites.

---

# 5. MVP Scope

## Mobile

- Flutter(Dart) mobile app
- Chat UI
- Message input
- Send button
- 현재위치전송 checkbox
- Attachment option menu (사진 첨부 / 파일 첨부)
- GPS append only when checked
- Message + attachments single-request sending
- Slash command input support
- Slash command suggestions
- Settings menu for API URL and API Key input
- Theme setting (Light/Dark) and app-wide theme apply
- Engine/UI separated structure for maintainability

## Server

- Device registration
- Token authentication
- /v1/message
- Forward messages to OpenClaw
- Preserve slash commands exactly

---

# 6. Success Criteria

## Normal message without location

Input:

text 판교역까지 얼마나 걸려? 

Sent:

text 판교역까지 얼마나 걸려? 

---

## Message with location checked

Input:

text 판교역까지 얼마나 걸려? 

Checkbox:

text 현재위치전송 = checked 

Sent:

text 판교역까지 얼마나 걸려?  현재위치: 37.123456, 127.123456 

---

## Slash command

Input:

text /status 

Sent:

text /status 

Even if location checkbox is checked, do not append GPS to slash commands.

Also, do not include attachments for slash commands.

---

## Message with attachment(s)

Input:

```text
오늘 회의 내용 정리했어. 확인해줘.
+ 파일 첨부: notes.pdf
+ 사진 첨부: whiteboard.jpg
```

Sent:

```text
Single `/v1/message` request containing:
- message text
- attachments array (notes.pdf, whiteboard.jpg)
```

---

## Mixed send (location + attachments)

Input:

```text
여기 위치 기준으로 문서 참고해줘.
현재위치전송 = checked
파일 첨부: guide.pdf
```

Sent:

```text
Single `/v1/message` request containing:
- message with appended location text
- attachments array (guide.pdf)
```

---

## Theme apply and persistence

Action:

```text
Settings > Theme = Dark
```

Expected:

```text
Chat and Settings are rendered in Dark theme immediately (or after save), and Dark theme remains after app restart.
```

---

## Engine/UI separation impact safety

Change:

```text
Modify chat input layout/style only
```

Expected:

```text
Message sending behavior (location append rule, slash command passthrough, auth header usage) remains unchanged.
```

---

# 7. OpenClaw Bridge Integration Spec (MVP)

## 7.1 Overview

The Bridge -> OpenClaw Gateway contract is not fully fixed yet in earlier sections.

For MVP, the bridge server should use an internal abstraction layer so it is not tightly coupled to one OpenClaw transport implementation.

---

## 7.2 OpenClawClient Interface

The bridge server must define an interface for OpenClaw integration:

```ts
interface OpenClawClient {
  sendMessage(input: {
    sessionId: string;
    message: string;
    userId?: string;
    attachments?: any[];
  }): Promise<{
    reply: string;
    raw?: unknown;
  }>;
}
```

Bridge API handlers should depend on this interface only.

---

## 7.3 System Structure

```text
Mobile App
-> Bridge API (/v1/message)
-> OpenClawClient (interface)
-> OpenClaw (CLI / Gateway / Plugin)
```

The mobile app must not depend on OpenClaw internal details.

---

## 7.4 MVP Integration Method (Phase 1)

Initial implementation should use OpenClaw CLI transport.

CLI example:

```bash
openclaw message send --channel mobile --session mobile-abc123 "message"
```

Because actual CLI options may vary by environment, verify via:

```bash
openclaw message --help
openclaw message send --help
openclaw status
```

---

## 7.5 Alternative Transport (Future)

Later, OpenClaw Gateway HTTP or WebSocket transport may replace CLI.

Items to define at that point:

- Gateway base URL
- Authentication method (token, etc.)
- Message send endpoint or event format
- Reply receive model
- Session handling model

---

## 7.6 Bridge API Contract (Stable)

Mobile app should use only this API.

Request:

```text
POST /v1/message
Authorization: Bearer <token>
```

```json
{
  "message": "판교역까지 얼마나 걸려?\n\n현재위치: 37.123456, 127.123456"
}
```

Response:

```json
{
  "reply": "현재 위치 기준 자동차로 약 18분 정도입니다."
}
```

The `/v1/message` contract should remain stable while internal OpenClaw transport evolves.

---

## 7.7 Message Rules

- Bridge must not rewrite user message semantics.
- Do not parse location text in MVP.
- Forward message content as-is to OpenClaw client layer.

---

## 7.8 Slash Command Rules

Supported pass-through commands:

```text
/status
/new
/reset
/models
```

Rules:

- If message starts with `/`, treat as command.
- Never transform command content.
- Do not append location to slash commands.

---

## 7.9 Session Rules

```text
device_id -> session_id
```

Example:

```text
abc-123 -> mobile-abc-123
```

Bridge server manages this mapping.

---

## 7.10 Future Architecture Change Strategy

Current:

```text
Bridge -> OpenClaw CLI
```

Future:

```text
Bridge -> OpenClaw Plugin Channel
or
Bridge -> OpenClaw Gateway API
```

This change should only require replacing OpenClawClient implementation.
Mobile app should not require changes.

---

## 7.11 Core Design Principles

- Keep `/v1/message` API stable.
- Encapsulate OpenClaw integration details behind OpenClawClient.
- Mobile app should not know OpenClaw internals.
- Bridge acts as forwarding and mediation layer.

---

## 8. Implementation Plan (Optimized Order)

This plan prioritizes:

- minimizing rework
- validating high-risk integration early
- enabling parallel execution between server and client workstreams

---

## 8.1 Phase 0 - Contract Lock (Half day)

Goal:

- Freeze API contract details required by both server and client before implementation expands.

Tasks:

- Confirm `/v1/message` request and response schema.
- Confirm auth header format (`Authorization: Bearer <token>`).
- Confirm attachment rules (max count, max size, allowed types).
- Confirm standard error response format and codes.

Deliverable:

- `API Contract v1` documented in this spec.

---

## 8.1.1 API Contract v1 (Locked for MVP)

This section defines the fixed external contract between mobile client and bridge server for MVP.

### Endpoint

```text
POST /v1/message
Authorization: Bearer <token>
Content-Type: application/json
```

### Request Schema

```json
{
  "message": "string (required, min 1 non-whitespace char)",
  "attachments": [
    {
      "type": "image | file",
      "name": "string (required)",
      "mime_type": "string (required)",
      "content_base64": "string (required)"
    }
  ]
}
```

Request rules:

- `message` is required.
- `attachments` is optional.
- Send message text and attachments in one request (single logical send unit).
- For slash commands (`message` starts with `/`), `attachments` must be empty/omitted.

### Attachment Limits (MVP Fixed)

- Maximum attachments per request: `3`
- Maximum per attachment (decoded binary size): `5 MB`
- Maximum total attachment size per request (decoded): `10 MB`
- Allowed image MIME types:
  - `image/jpeg`
  - `image/png`
  - `image/webp`
- Allowed file MIME types:
  - `application/pdf`
  - `text/plain`
  - `application/zip`

If any attachment violates constraints, the server returns validation error and does not partially process the request.

### Success Response

Status: `200 OK`

```json
{
  "reply": "string",
  "request_id": "string",
  "session_id": "string"
}
```

Response rules:

- `reply` is required.
- `request_id` is required for client-side troubleshooting/log correlation.
- `session_id` is required to confirm bridge session mapping result.

### Error Response (Standard)

All non-2xx errors must follow this format:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": {}
  },
  "request_id": "string"
}
```

`details` may be omitted when no extra context is needed.

### Error Code Table (MVP Fixed)

- `AUTH_INVALID_TOKEN` -> `401`
- `AUTH_MISSING_TOKEN` -> `401`
- `VALIDATION_MESSAGE_REQUIRED` -> `400`
- `VALIDATION_SLASH_WITH_ATTACHMENTS` -> `400`
- `VALIDATION_ATTACHMENT_TYPE_NOT_ALLOWED` -> `400`
- `VALIDATION_ATTACHMENT_TOO_LARGE` -> `400`
- `VALIDATION_ATTACHMENT_TOTAL_TOO_LARGE` -> `400`
- `VALIDATION_ATTACHMENT_COUNT_EXCEEDED` -> `400`
- `UPSTREAM_OPENCLAW_UNAVAILABLE` -> `502`
- `UPSTREAM_OPENCLAW_TIMEOUT` -> `504`
- `INTERNAL_SERVER_ERROR` -> `500`

### Client Handling Guidance (Normative)

- On `401`: prompt user to re-check API Key in Settings.
- On validation errors (`400`): show actionable field-level or toast message.
- On upstream/unavailable errors (`502/504`): show retry guidance.
- On `500`: show generic failure message and allow retry.

### Example Request (Message + Location + Attachments)

```json
{
  "message": "여기 위치 기준으로 확인해줘.\n\n현재위치: 37.123456, 127.123456",
  "attachments": [
    {
      "type": "file",
      "name": "guide.pdf",
      "mime_type": "application/pdf",
      "content_base64": "<base64-data>"
    }
  ]
}
```

### Example Request (Slash Command)

```json
{
  "message": "/status"
}
```

---

## 8.2 Phase 1 - Bridge Server MVP First (1-2 days)

Goal:

- Deliver a working bridge endpoint for early end-to-end validation.

Tasks:

- Implement `POST /v1/message`.
- Implement bearer token validation.
- Implement `device_id -> session_id` mapping.
- Implement OpenClawClient interface and CLI-based adapter.
- Support message + attachments in single request context.
- Preserve slash command passthrough behavior.

Deliverable:

- Working server endpoint with test API URL and API key.

---

## 8.3 Phase 2 - Server Validation and Hardening (Half day to 1 day)

Goal:

- Make server behavior deterministic for client integration.

Tasks:

- Add test coverage for:
  - normal message
  - location-appended message
  - slash command passthrough
  - attachment send
  - auth failure
  - validation failure (size/type)
- Standardize failure payload for client UI handling.
- Add basic structured logging for request/response outcome tracking.

Deliverable:

- Stable integration-ready server behavior.

---

## 8.4 Phase 3 - Client Foundation (1 day, parallel-capable)

Goal:

- Build client skeleton while server is stabilizing.

Tasks:

- Use Flutter(Dart) as the client implementation stack.
- Create screen structure: `Chat`, `Settings`.
- Implement Settings storage: API URL, API Key, Theme (Light/Dark).
- Apply theme tokens app-wide.
- Set up Engine/UI separation baseline modules.

Deliverable:

- Runnable Flutter client shell with saved settings and theme persistence.

---

## 8.5 Phase 4 - Client Send Engine Integration (1-2 days)

Goal:

- Connect client behavior engine to bridge API.

Tasks:

- Implement send pipeline:
  - normal message
  - location toggle flow
  - attachment flow (image/file)
  - slash command rule handling
- Build single-request payload (`message` + `attachments`).
- Wire auth/API URL from settings into runtime requests.

Deliverable:

- End-to-end message exchange with server.

---

## 8.6 Phase 5 - UX Completion and Reliability (1 day)

Goal:

- Improve usability and reduce user-facing failure ambiguity.

Tasks:

- Finalize command suggestion UX.
- Finalize attachment preview/error UX.
- Finalize permission and network failure messaging.
- Verify theme consistency across all core views.

Deliverable:

- MVP release candidate quality UX.

---

## 8.7 Phase 6 - Integration QA and Release Readiness (Half day to 1 day)

Goal:

- Validate complete MVP against success criteria.

Tasks:

- Run full scenario checklist from section 6.
- Verify no regression in slash command passthrough.
- Verify mixed send cases (message + location + attachments).
- Update root/server/client README with run/test instructions.

Deliverable:

- Deployable MVP baseline.

---

## 8.8 Parallel Execution Guidance

- Server track: Phase 1 -> 2
- Client track: Phase 3 (in parallel with server track)
- Convergence point: start Phase 4 once test API URL/key are ready

---

## 8.9 First-Week Suggested Schedule

- Day 1: Contract lock + server scaffold
- Day 2: `/v1/message` + auth + OpenClaw CLI adapter
- Day 3: server tests/error contract + client Chat/Settings skeleton
- Day 4: client send engine integration (location/attachments/slash)
- Day 5: E2E QA + UX polish + docs update

---

# End