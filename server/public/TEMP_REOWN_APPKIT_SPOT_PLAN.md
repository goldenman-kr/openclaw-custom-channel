# TEMP PLAN — Spot 플러그인 모바일 지갑 연결에 Reown AppKit 적용 검토

작성일: 2026-05-06
범위: 검토 문서만 작성. 코드 구현/패키지 설치/빌드 설정 변경은 하지 않음.

## 결론

모바일 Spot 플러그인 지갑 연결은 기존 `window.ethereum` 직접 접근 방식만으로는 한계가 있으므로, Reown AppKit(구 WalletConnect 계열)을 도입하는 방향이 적절해 보인다.

권장 방향은 **AppKit + Ethers Adapter** 또는 **AppKit + Wagmi Adapter** 중 하나를 붙여서 모바일에서는 AppKit provider를 사용하고, PC injected provider는 기존 흐름을 최대한 유지하는 하이브리드 방식이다.

현재 PWA 프론트엔드는 `server/public`의 브라우저 ESM 파일을 직접 로드하는 구조라서, AppKit 도입 시 패키지 번들링 전략이 먼저 필요하다.

## 현재 Spot 플러그인 상태

관련 파일:

- `server/public/plugins/spot-wallet-intent.js`
- `server/public/plugins/spot-order-card.js`
- `server/src/http/spotPluginRoutes.ts`

현재 동작:

- 모바일 감지 시 `isMobileWalletUnsupported()`로 지갑 버튼을 비활성화한다.
- 지갑 연결/체인 전환/잔액 조회/approve/signTypedData는 모두 `window.ethereum.request(...)` 기반이다.
- `spot-wallet-intent`는 주문 생성 전 `swapper` 주소와 잔액 확인에 사용된다.
- `spot-order-card`는 exact approve 후 `eth_signTypedData_v4`로 서명하고 서버 API로 바로 제출한다.

## Reown AppKit Actions에서 쓸 만한 기능

문서: https://docs.reown.com/appkit/javascript/core/actions

검토한 핵심 Action:

- `modal.open({ view: 'Connect', namespace: 'eip155' })`
  - 모바일에서 WalletConnect/AppKit 연결 UI를 열 때 사용.
- `modal.close()`
  - 연결/서명 이후 modal 정리.
- `modal.getAddress()`
  - 현재 연결 주소 확인.
- `modal.getChainId()`
  - 현재 연결 체인 확인.
- `modal.switchNetwork(network)`
  - Spot 주문 체인으로 전환.
- `modal.getIsConnected()`
  - 연결 상태 확인.
- `modal.getWalletProvider()` 또는 `modal.getProviders()['eip155']`
  - EIP-1193 provider를 얻어 기존 `eth_call`, `eth_sendTransaction`, `eth_signTypedData_v4` 흐름에 연결 가능.
- `modal.subscribeProvider(...)` / `modal.subscribeProviders(...)`
  - 계정/체인/provider 변경 감지.
- `modal.adapter?.connectionControllerClient?.disconnect()`
  - 연결 해제.

## 도입 방식 후보

### A. Ethers Adapter 사용

패키지:

```bash
npm install @reown/appkit @reown/appkit-adapter-ethers ethers
```

장점:

- 현재 코드는 wagmi를 쓰지 않으므로 개념적으로 단순하다.
- AppKit에서 provider를 얻고, 필요하면 `ethers.BrowserProvider`로 signer를 만들 수 있다.
- 기존 `window.ethereum.request` 형태의 함수를 `walletProvider.request`로 일반화하기 쉽다.

단점:

- 현재 서버 패키지는 브라우저 번들러가 없으므로, npm 설치만으로는 `server/public/*.js`에서 바로 쓰기 어렵다.
- 번들 산출물 또는 import map/CDN 전략이 필요하다.

### B. Wagmi Adapter 사용

패키지:

```bash
npm install @reown/appkit @reown/appkit-adapter-wagmi wagmi viem
```

장점:

- Reown 문서의 기본 예제가 가장 풍부하다.
- `getAccount`, `signTypedData`, `switchChain`, `sendTransaction` 같은 wagmi action으로 갈 수 있다.

단점:

- 현재 플러그인 구조에는 wagmi config/state가 없다.
- 기존 Spot 플러그인만을 위해 wagmi를 도입하면 의존성과 상태 관리가 과해질 수 있다.

### 추천

1차 구현 후보는 **Ethers Adapter + EIP-1193 provider 래핑**이 낫다.

이유:

- 기존 코드의 `request({ method, params })` 호출들을 거의 그대로 재사용할 수 있다.
- `spot-wallet-intent`와 `spot-order-card` 모두 공통 provider resolver만 바꾸면 된다.
- AppKit은 연결 UI와 WalletConnect 세션 관리를 맡고, Spot 로직은 현재처럼 직접 검증/approve/sign/submit을 유지할 수 있다.

## 필요한 사전 결정

1. Reown Project ID
   - Reown Dashboard에서 projectId 필요.
   - 서버/프론트 어디에 저장할지 결정 필요.
   - 공개 프론트 값으로 취급 가능하지만, 도메인 제한/프로젝트 설정은 해야 한다.

2. App metadata
   - `name`, `description`, `url`, `icons` 필요.
   - 문서상 metadata `url`은 실제 도메인/subdomain과 맞아야 한다.

3. 지원 네트워크 목록
   - Spot 주문에서 실제 사용하는 EVM chain만 `networks`에 넣는 것이 안전하다.
   - AppKit 내장 네트워크에 없는 체인이 있으면 custom network 정의 필요.

4. 번들링 방식
   - 현재 `server/public`은 정적 ESM 로딩 구조다.
   - 선택지:
     - Vite/Rollup/esbuild로 `plugins/spot-appkit-wallet.js` 번들 생성
     - CDN ESM import 사용(빠른 검토에는 가능하지만 운영 PWA에는 비추천)
     - 서버 빌드 단계에 프론트 번들 스크립트 추가

## 제안 아키텍처

### 1. provider access layer 추가

예상 파일:

- `server/public/plugins/spot-wallet-provider.js`

역할:

- 데스크톱 injected provider 우선 사용.
- 모바일 또는 injected provider 부재 시 Reown AppKit 초기화 후 provider 제공.
- 아래 인터페이스를 노출:

```js
getSpotWalletProvider({ chainId })
connectSpotWallet({ chainId })
disconnectSpotWallet()
subscribeSpotWalletState(handler)
```

반환 provider는 기존 코드와 호환되도록 EIP-1193 `request({ method, params })` 형태를 유지한다.

### 2. 기존 helper 함수 일반화

현재:

```js
window.ethereum.request(...)
```

변경 후보:

```js
provider.request(...)
```

대상 함수:

- `requestAccounts`
- `switchChain`
- `getAllowance`
- `waitForTransactionReceipt`
- `ensureExactApproval`
- `signTypedData`
- `getErc20Balance`

### 3. 모바일 비활성화 제거 대신 AppKit fallback

현재:

```js
const mobileUnsupported = isMobileWalletUnsupported();
```

변경 후보:

- 모바일이면 버튼 비활성화하지 않는다.
- 버튼 문구를 `지갑 연결` 또는 `WalletConnect 연결`로 유지.
- provider가 없으면 AppKit modal을 연다.
- 연결 실패/취소 시 상태 메시지만 표시한다.

### 4. Spot 플로우 유지

`spot-wallet-intent`:

- AppKit으로 연결된 주소를 `swapper` 후보로 사용.
- 필요 시 `eth_call`로 ERC-20 balance 조회.
- 기존처럼 채팅에 주문 생성 요청 메시지를 보낸다.

`spot-order-card`:

- 연결 주소와 `typedData.message.witness.swapper` 일치 검증 유지.
- chain 전환 → allowance 확인 → exact approve → `eth_signTypedData_v4` → 서버 submit 순서 유지.
- typedData freshness 검증 유지.

## UX 고려사항

- 모바일에서는 AppKit modal이 뜨고 지갑 앱으로 전환될 수 있으므로, 상태 문구를 명확히 해야 한다.
- 앱 전환 후 복귀 시 `subscribeProvider`로 계정/체인 상태를 다시 동기화해야 한다.
- 사용자가 연결 취소 시 기존 카드 상태가 깨지지 않게 재시도 가능해야 한다.
- 서명 후 바로 제출하는 현재 버튼은 모바일에서도 유지 가능하지만, 실패 시 재시도/새 주문 생성 안내가 필요하다.

## 보안/안전 체크

- `typedData`는 렌더 후 변경하지 않는다.
- 서명 계정과 `swapper` 주소 일치 검증은 유지한다.
- approval은 기존처럼 exact amount 기본값을 유지한다.
- AppKit provider에서 받은 chain/account 이벤트를 신뢰하되, 서명 직전 다시 계정/체인 확인을 한다.
- Reown projectId와 metadata URL은 운영 도메인과 맞춰야 한다.
- WalletConnect 세션이 남아 있을 수 있으므로 명시적 disconnect 버튼/동작이 필요하다.

## 미해결 질문

- Reown projectId를 어떤 config/환경변수에서 주입할지.
- 현재 PWA 도메인/아이콘 URL을 metadata에 무엇으로 넣을지.
- 지원해야 할 Spot 체인 목록과 custom network 필요 여부.
- 프론트 번들러를 도입할지, AppKit 전용 번들 파일만 별도 생성할지.
- 모바일 네이티브 WebView에서 AppKit deep link 복귀가 안정적인지 별도 실기기 테스트 필요.

## 구현 전 권장 순서

1. Reown projectId와 metadata 확정.
2. 프론트 번들링 방식 결정.
3. `spot-wallet-provider.js` 형태의 provider abstraction부터 작게 추가.
4. `spot-wallet-intent`에만 먼저 적용해 모바일 연결/주소/잔액 확인 테스트.
5. 이후 `spot-order-card`에 approve/sign/submit 적용.
6. Android/iOS PWA 및 네이티브 WebView에서 앱 전환 복귀 테스트.

## 이번 작업에서 하지 않은 것

- 패키지 설치 안 함.
- AppKit 초기화 코드 추가 안 함.
- 기존 Spot 플러그인 동작 변경 안 함.
- 서비스 워커/클라이언트 버전 변경 안 함.
