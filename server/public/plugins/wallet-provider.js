const REOWN_BUNDLE_URL = '/assets/spot-reown-wallet.js';

let reownLoadPromise = null;
let preferredProvider = null;

function walletDebug(event, details = {}) {
  console.debug('[spot-wallet-provider]', event, details);
}

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
    walletDebug('reown already loaded', {
      projectIdConfigured: Boolean(window.SpotReownWallet.projectId),
      networks: window.SpotReownWallet.networks?.map?.((network) => network.id) || [],
    });
    return window.SpotReownWallet;
  }
  if (!reownLoadPromise) {
    walletDebug('reown bundle import start', { url: REOWN_BUNDLE_URL });
    reownLoadPromise = import(REOWN_BUNDLE_URL)
      .then(() => {
        if (!window.SpotReownWallet?.provider?.request) {
          throw new Error('Reown AppKit 번들이 로드되었지만 provider가 초기화되지 않았습니다.');
        }
        walletDebug('reown bundle import complete', {
          projectIdConfigured: Boolean(window.SpotReownWallet.projectId),
          networks: window.SpotReownWallet.networks?.map?.((network) => network.id) || [],
        });
        return window.SpotReownWallet;
      })
      .catch((error) => {
        reownLoadPromise = null;
        walletDebug('reown bundle import failed', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      });
  }
  return reownLoadPromise;
}

export async function getWalletProvider() {
  if (hasInjectedProvider()) {
    walletDebug('selected injected provider');
    preferredProvider = window.ethereum;
    return preferredProvider;
  }
  walletDebug('selected reown provider');
  const reown = await loadReownBundle();
  preferredProvider = reown.provider;
  return preferredProvider;
}

export async function requestWalletAccounts(options = {}) {
  if (hasInjectedProvider()) {
    walletDebug('request accounts through injected provider', { requestedChainId: options.chainId || '' });
    preferredProvider = window.ethereum;
    return window.ethereum.request({ method: 'eth_requestAccounts' });
  }
  walletDebug('request accounts through reown', { requestedChainId: options.chainId || '' });
  const reown = await loadReownBundle();
  preferredProvider = reown.provider;
  return reown.connect({ chainId: options.chainId });
}

export async function getWalletAccounts() {
  if (hasInjectedProvider()) {
    walletDebug('get accounts through injected provider');
    return window.ethereum.request({ method: 'eth_accounts' });
  }
  const address = window.SpotReownWallet?.getAddress?.();
  walletDebug('get accounts from reown cache', { hasAddress: Boolean(address) });
  return address ? [address] : [];
}

export async function revokeWalletPermissionsIfSupported() {
  if (hasInjectedProvider()) {
    try {
      walletDebug('revoke injected wallet permissions');
      await window.ethereum.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      });
      return true;
    } catch (error) {
      walletDebug('revoke injected wallet permissions failed', { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }
  if (window.SpotReownWallet?.disconnect) {
    walletDebug('disconnect reown wallet');
    await window.SpotReownWallet.disconnect();
    return true;
  }
  walletDebug('no wallet permissions to revoke');
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
  walletDebug('open reown network selector');
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
  walletDebug('request wallet method', {
    method,
    paramsCount: Array.isArray(params) ? params.length : 0,
    mode: getWalletMode(),
  });
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
    walletDebug('switch chain invalid id', { chainId });
    throw new Error(`체인 ID를 확인할 수 없습니다: ${chainId}`);
  }
  const provider = await getWalletProvider();
  const targetChainId = `0x${BigInt(numericChainId).toString(16)}`;
  const currentChainId = await provider.request({ method: 'eth_chainId' });
  walletDebug('switch chain check', { currentChainId, targetChainId, mode: getWalletMode() });
  if (String(currentChainId).toLowerCase() === targetChainId.toLowerCase()) {
    walletDebug('switch chain already on target', { targetChainId });
    return;
  }
  await provider.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: targetChainId }],
  });
  walletDebug('switch chain request sent', { targetChainId });
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
