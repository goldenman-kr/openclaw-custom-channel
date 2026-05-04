# TODO

## Spot Wallet UI / 모바일 지갑 연동 검토

- 현재 구현 범위: PC 브라우저 지갑 provider(`window.ethereum`) 기반 지갑 연결/서명/제출만 지원.
- 모바일에서는 Spot 지갑 서명 플러그인 버튼을 비활성화하고, 별도 구현 전까지 단독 진행하지 않는다.
- 추후 검토 후보:
  - WalletConnect 연동
  - 지갑 앱 인앱 브라우저에서 PWA 열기
  - 모바일 브라우저 ↔ 지갑 앱 deep link / universal link 흐름
  - MetaMask Mobile 등에서 injected provider 제공 여부와 EIP-712 서명 안정성
- 검토 시 확인할 것:
  - `eth_signTypedData_v4` 지원 여부
  - 체인 전환/approve 트랜잭션 UX
  - 서명 결과를 채팅 입력창에 노출하지 않고 서버 API로 회수하는 흐름 유지 가능 여부
  - 실패/취소/앱 전환 후 복귀 시 재시도 UX
