const REOWN_BUNDLE_URL = '/assets/spot-reown-wallet.js';

let reownLoadPromise = null;
let preferredProvider = null;

function hasRequestProvider(provider) {
  return Boolean(provider?.request);
}

export function hasInjectedProvider() {
  return hasRequestProvider(window.ethereum);
}

export function isMobileLikeDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
}

export function getWalletMode() {
  if (hasInjectedProvider()) {
    return 'injected';
  }
  return 'reown';
}

async function loadReownBundle() {
  if (window.SpotReownWallet?.provider?.request) {
    return window.SpotReownWallet;
  }
  if (!reownLoadPromise) {
    reownLoadPromise = import(REOWN_BUNDLE_URL)
      .then(() => {
        if (!window.SpotReownWallet?.provider?.request) {
          throw new Error('Reown AppKit 번들이 로드되었지만 provider가 초기화되지 않았습니다.');
        }
        return window.SpotReownWallet;
      })
      .catch((error) => {
        reownLoadPromise = null;
        throw error;
      });
  }
  return reownLoadPromise;
}

export async function getWalletProvider() {
  if (hasInjectedProvider()) {
    preferredProvider = window.ethereum;
    return preferredProvider;
  }
  const reown = await loadReownBundle();
  preferredProvider = reown.provider;
  return preferredProvider;
}

export async function requestWalletAccounts(options = {}) {
  if (hasInjectedProvider()) {
    preferredProvider = window.ethereum;
    return window.ethereum.request({ method: 'eth_requestAccounts' });
  }
  const reown = await loadReownBundle();
  preferredProvider = reown.provider;
  return reown.connect({ chainId: options.chainId });
}

export async function getWalletAccounts() {
  if (hasInjectedProvider()) {
    return window.ethereum.request({ method: 'eth_accounts' });
  }
  const address = window.SpotReownWallet?.getAddress?.();
  return address ? [address] : [];
}

export async function revokeWalletPermissionsIfSupported() {
  if (hasInjectedProvider()) {
    try {
      await window.ethereum.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      });
      return true;
    } catch {
      return false;
    }
  }
  if (window.SpotReownWallet?.disconnect) {
    await window.SpotReownWallet.disconnect();
    return true;
  }
  return false;
}

export async function openWalletNetworkSelector() {
  if (hasInjectedProvider()) {
    throw new Error('Injected 지갑에서는 주문 카드의 체인 전환 버튼을 사용해주세요.');
  }
  const reown = await loadReownBundle();
  if (!reown.openNetworks) {
    throw new Error('Reown 네트워크 선택 화면을 열 수 없습니다.');
  }
  await reown.openNetworks();
}


export function subscribeWalletAccounts(handler) {
  if (typeof handler !== 'function') {
    return () => {};
  }
  const providers = [window.ethereum, window.SpotReownWallet?.provider].filter(Boolean);
  for (const provider of providers) {
    provider?.on?.('accountsChanged', handler);
  }
  const reownReadyHandler = () => {
    window.SpotReownWallet?.provider?.on?.('accountsChanged', handler);
  };
  window.addEventListener('spot-reown-ready', reownReadyHandler);
  return () => {
    window.removeEventListener('spot-reown-ready', reownReadyHandler);
    for (const provider of providers) {
      provider?.removeListener?.('accountsChanged', handler);
    }
    window.SpotReownWallet?.provider?.removeListener?.('accountsChanged', handler);
  };
}

export async function requestWallet(method, params = []) {
  const provider = await getWalletProvider();
  return provider.request({ method, params });
}

function parseChainId(chainId) {
  if (typeof chainId === 'number') return chainId;
  if (typeof chainId === 'bigint') return Number(chainId);
  const value = String(chainId ?? '').trim();
  if (!value || value === '0x') return 0;
  return Number(value.startsWith('0x') ? BigInt(value) : BigInt(value));
}

export async function switchWalletChain(chainId) {
  const numericChainId = parseChainId(chainId);
  if (!numericChainId) {
    throw new Error(`체인 ID를 확인할 수 없습니다: ${chainId}`);
  }
  const provider = await getWalletProvider();
  const targetChainId = `0x${BigInt(numericChainId).toString(16)}`;
  const currentChainId = await provider.request({ method: 'eth_chainId' });
  if (String(currentChainId).toLowerCase() === targetChainId.toLowerCase()) {
    return;
  }
  await provider.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: targetChainId }],
  });
}


export const getSpotWalletMode = getWalletMode;
export const getSpotWalletProvider = getWalletProvider;
export const requestSpotWalletAccounts = requestWalletAccounts;
export const getSpotWalletAccounts = getWalletAccounts;
export const revokeSpotWalletPermissionsIfSupported = revokeWalletPermissionsIfSupported;
export const openSpotWalletNetworkSelector = openWalletNetworkSelector;
export const subscribeSpotWalletAccounts = subscribeWalletAccounts;
export const requestSpotWallet = requestWallet;
export const switchSpotWalletChain = switchWalletChain;
