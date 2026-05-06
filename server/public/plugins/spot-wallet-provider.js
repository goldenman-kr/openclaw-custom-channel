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

export function getSpotWalletMode() {
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

export async function getSpotWalletProvider() {
  if (hasInjectedProvider()) {
    preferredProvider = window.ethereum;
    return preferredProvider;
  }
  const reown = await loadReownBundle();
  preferredProvider = reown.provider;
  return preferredProvider;
}

export async function requestSpotWalletAccounts(options = {}) {
  if (hasInjectedProvider()) {
    preferredProvider = window.ethereum;
    return window.ethereum.request({ method: 'eth_requestAccounts' });
  }
  const reown = await loadReownBundle();
  preferredProvider = reown.provider;
  return reown.connect({ chainId: options.chainId });
}

export async function getSpotWalletAccounts() {
  if (hasInjectedProvider()) {
    return window.ethereum.request({ method: 'eth_accounts' });
  }
  const provider = window.SpotReownWallet?.provider;
  return provider?.request ? provider.request({ method: 'eth_accounts' }) : [];
}

export async function revokeSpotWalletPermissionsIfSupported() {
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

export function subscribeSpotWalletAccounts(handler) {
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

export async function requestSpotWallet(method, params = []) {
  const provider = await getSpotWalletProvider();
  return provider.request({ method, params });
}

export async function switchSpotWalletChain(chainId) {
  const provider = await getSpotWalletProvider();
  const targetChainId = `0x${BigInt(chainId).toString(16)}`;
  const currentChainId = await provider.request({ method: 'eth_chainId' });
  if (String(currentChainId).toLowerCase() === targetChainId.toLowerCase()) {
    return;
  }
  await provider.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: targetChainId }],
  });
}
