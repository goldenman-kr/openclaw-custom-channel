import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { mainnet, arbitrum, base, polygon, bsc } from '@reown/appkit/networks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { getAccount, getChainId, reconnect, watchAccount, watchChainId } from '@wagmi/core';
import { ConnectionController, PublicStateController } from '@reown/appkit-controllers';

const APP_ORIGIN = import.meta.env.VITE_APP_ORIGIN || window.location.origin;
const PROJECT_ID = import.meta.env.VITE_REOWN_PROJECT_ID || '';
const SUPPORTED_NETWORKS = [mainnet, arbitrum, base, polygon, bsc];
const METADATA = {
  name: import.meta.env.VITE_APP_NAME || 'RODY Agent',
  description: import.meta.env.VITE_APP_DESCRIPTION || 'RODY Agent chat channel',
  url: `${APP_ORIGIN}/`,
  icons: [`${APP_ORIGIN}/assets/openclaw-app-icon-512.png`],
};

const queryClient = new QueryClient();
const wagmiAdapter = new WagmiAdapter({
  networks: SUPPORTED_NETWORKS,
  projectId: PROJECT_ID,
  ssr: false,
});

function redactAddress(value) {
  const address = String(value || '');
  return address.length > 14 ? `${address.slice(0, 8)}...${address.slice(-6)}` : address || '';
}

function reownDebug(event, details = {}) {
  console.debug('[spot-reown-wallet]', event, {
    ...details,
    projectIdConfigured: Boolean(PROJECT_ID),
    iosPwa: isIosPwa(),
  });
}

function isIosPwa() {
  if (typeof window === 'undefined') {
    return false;
  }
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches
    || window.navigator?.standalone === true;
  return Boolean(isIos && isStandalone);
}

function isMetaMaskWallet(wallet) {
  return /metamask/i.test(String(wallet?.name || wallet?.id || ''));
}

function buildMetaMaskUniversalLink(wcUri) {
  return `https://metamask.app.link/wc?uri=${encodeURIComponent(wcUri)}`;
}

function removeIosPwaWalletLink() {
  document.querySelector('[data-spot-ios-pwa-wallet-link]')?.remove();
}

function renderIosPwaWalletLink() {
  if (!isIosPwa()) {
    return;
  }
  if (!explicitWalletConnectInProgress || getConnectedAddress()) {
    reownDebug('ios wallet link hidden', {
      explicitWalletConnectInProgress,
      hasAddress: Boolean(getConnectedAddress()),
    });
    removeIosPwaWalletLink();
    return;
  }
  const wcUri = ConnectionController.state.wcUri;
  const wallet = PublicStateController.state.connectingWallet;
  if (!wcUri || !isMetaMaskWallet(wallet)) {
    reownDebug('ios wallet link waiting', {
      hasWcUri: Boolean(wcUri),
      wallet: wallet?.name || wallet?.id || '',
    });
    removeIosPwaWalletLink();
    return;
  }

  let node = document.querySelector('[data-spot-ios-pwa-wallet-link]');
  if (!node) {
    node = document.createElement('div');
    node.dataset.spotIosPwaWalletLink = 'true';
    node.style.cssText = [
      'position:fixed',
      'left:12px',
      'right:12px',
      'bottom:calc(12px + env(safe-area-inset-bottom, 0px))',
      'z-index:2147483647',
      'padding:12px',
      'border-radius:14px',
      'background:#111827',
      'color:#fff',
      'box-shadow:0 12px 32px rgba(0,0,0,.35)',
      'font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif',
    ].join(';');
    document.body.append(node);
  }

  const href = buildMetaMaskUniversalLink(wcUri);
  if (node.dataset.href === href) {
    return;
  }
  reownDebug('ios metamask universal link rendered', {
    wallet: wallet?.name || wallet?.id || '',
    wcUriLength: wcUri.length,
  });
  node.dataset.href = href;
  node.innerHTML = `
    <div style="font-size:13px;line-height:1.35;margin-bottom:8px;opacity:.92">
      iOS 웹앱에서 자동 실행이 막히면 아래 버튼을 직접 누르세요.
    </div>
    <a href="${href}" target="_self" rel="noreferrer" style="display:block;text-align:center;background:#f6851b;color:#111827;text-decoration:none;font-weight:700;border-radius:10px;padding:11px 12px">
      MetaMask 직접 열기
    </a>
    <button type="button" data-spot-ios-pwa-wallet-link-close style="margin-top:8px;width:100%;border:0;background:transparent;color:#d1d5db;padding:6px;font-size:12px">
      닫기
    </button>
  `;
  node.querySelector('[data-spot-ios-pwa-wallet-link-close]')?.addEventListener('click', removeIosPwaWalletLink, { once: true });
}

function installIosPwaWalletLinkFallback() {
  if (!isIosPwa()) {
    return;
  }
  ConnectionController.subscribeKey('wcUri', renderIosPwaWalletLink);
  PublicStateController.subscribe(renderIosPwaWalletLink);
  window.addEventListener('focus', removeIosPwaWalletLink);
  window.addEventListener('pageshow', removeIosPwaWalletLink);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !explicitWalletConnectInProgress) {
      removeIosPwaWalletLink();
    }
  });
  renderIosPwaWalletLink();
}

const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks: SUPPORTED_NETWORKS,
  projectId: PROJECT_ID,
  metadata: METADATA,
  features: {
    analytics: false,
  },
  // iOS 홈 화면 PWA에서는 custom-scheme deeplink(metamask://...)가
  // standalone WebKit 컨텍스트에서 무시되는 경우가 있어 universal link를 우선 사용한다.
  experimental_preferUniversalLinks: isIosPwa(),
});

const wagmiConfig = wagmiAdapter.wagmiConfig;
const subscribers = new Set();
let currentChainId = '';
let reconnectPromise = null;
let explicitWalletConnectInProgress = false;

function toHexChainId(chainId) {
  const numericChainId = parseChainId(chainId);
  if (!numericChainId) {
    return '';
  }
  return `0x${BigInt(numericChainId).toString(16)}`;
}

function parseChainId(chainId) {
  if (typeof chainId === 'number') {
    return chainId;
  }
  if (typeof chainId === 'bigint') {
    return Number(chainId);
  }
  const value = String(chainId || '').trim();
  if (!value || value === '0x') {
    return 0;
  }
  return Number(value.startsWith('0x') ? BigInt(value) : BigInt(value));
}

function getConnectedAddress() {
  const account = getAccount(wagmiConfig);
  return account?.address || appKit.getAddress?.('eip155') || '';
}

function emit(event, payload) {
  for (const subscriber of subscribers) {
    try {
      subscriber(event, payload);
    } catch (error) {
      console.warn('[spot-reown-wallet] subscriber failed', error);
    }
  }
}

function ensureReconnect() {
  if (!reconnectPromise) {
    reownDebug('reconnect start');
    reconnectPromise = reconnect(wagmiConfig)
      .then((result) => {
        reownDebug('reconnect complete', { hasAddress: Boolean(getConnectedAddress()), resultType: typeof result });
        return result;
      })
      .catch((error) => {
        reownDebug('reconnect failed', { error: error instanceof Error ? error.message : String(error) });
        return null;
      });
  }
  return reconnectPromise;
}

function waitForAccount(timeoutMs = 120_000) {
  const existing = getConnectedAddress();
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const unwatch = watchAccount(wagmiConfig, {
      onChange(account) {
        reownDebug('waitForAccount account change', {
          address: redactAddress(account?.address),
          status: account?.status,
        });
        const address = account?.address || '';
        if (address && !settled) {
          settled = true;
          window.clearTimeout(timer);
          unwatch?.();
          resolve(address);
        }
      },
    });
    const timer = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      unwatch?.();
      reownDebug('waitForAccount timeout', { timeoutMs });
      reject(new Error('지갑 연결 시간이 초과되었습니다. 다시 시도해주세요.'));
    }, timeoutMs);
  });
}

function getWalletProvider() {
  return appKit.getWalletProvider?.();
}

function requireWalletProvider() {
  const provider = getWalletProvider();
  if (!provider?.request) {
    throw new Error('Reown 지갑 provider를 찾지 못했습니다. 먼저 지갑을 연결해주세요.');
  }
  return provider;
}

async function readProviderChainId(provider = getWalletProvider()) {
  if (!provider?.request) {
    reownDebug('readProviderChainId missing provider');
    return '';
  }
  try {
    return toHexChainId(await provider.request({ method: 'eth_chainId' }));
  } catch (error) {
    reownDebug('readProviderChainId failed', { error: error instanceof Error ? error.message : String(error) });
    return '';
  }
}

async function waitForProviderChain(targetChainId, timeoutMs = 15_000) {
  const target = toHexChainId(targetChainId).toLowerCase();
  const startedAt = Date.now();
  let actual = '';
  while (Date.now() - startedAt < timeoutMs) {
    actual = await readProviderChainId();
    if (actual.toLowerCase() === target) {
      currentChainId = actual;
      emit('chainChanged', currentChainId);
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new Error(`지갑 네트워크 전환이 확인되지 않았습니다. 목표=${target}, 현재=${actual || '확인 불가'}. 지갑에서 BNB Chain으로 전환한 뒤 다시 시도해주세요.`);
}

async function switchToChain(chainId) {
  const numericChainId = parseChainId(chainId);
  if (!numericChainId) {
    reownDebug('switchToChain skipped invalid chain', { chainId });
    return;
  }
  const network = SUPPORTED_NETWORKS.find((item) => Number(item.id) === numericChainId);
  if (!network) {
    reownDebug('switchToChain unsupported network', { numericChainId });
    throw new Error(`지원하지 않는 EVM 네트워크입니다: ${numericChainId}`);
  }
  const targetChainId = toHexChainId(numericChainId);
  const provider = requireWalletProvider();
  reownDebug('switchToChain start', { numericChainId, targetChainId });

  if ((await readProviderChainId(provider)).toLowerCase() === targetChainId.toLowerCase()) {
    currentChainId = targetChainId;
    emit('chainChanged', currentChainId);
    reownDebug('switchToChain already on target', { targetChainId });
    return;
  }

  // MetaMask 모바일/WalletConnect에서는 요청이 성공처럼 반환되어도 실제 지갑 네트워크가
  // 그대로인 경우가 있다. 그래서 직접 switch → 확인, AppKit switch → 확인 순서로 검증한다.
  let providerError = null;
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: targetChainId }],
    });
    await waitForProviderChain(targetChainId);
    reownDebug('switchToChain provider switch confirmed', { targetChainId });
    return;
  } catch (error) {
    providerError = error;
    reownDebug('switchToChain provider switch failed', { error: error instanceof Error ? error.message : String(error) });
  }

  try {
    await appKit.switchNetwork?.(network, { throwOnFailure: true });
    await waitForProviderChain(targetChainId);
    reownDebug('switchToChain appkit switch confirmed', { targetChainId });
    return;
  } catch (appKitError) {
    reownDebug('switchToChain appkit switch failed', { error: appKitError instanceof Error ? appKitError.message : String(appKitError) });
    throw providerError || appKitError;
  }
}

async function connect(options = {}) {
  reownDebug('connect start', { requestedChainId: options.chainId || '' });
  await ensureReconnect();
  let address = getConnectedAddress();
  let provider = getWalletProvider();
  reownDebug('connect after reconnect', {
    address: redactAddress(address),
    hasProvider: Boolean(provider?.request),
  });
  if (!address || !provider?.request) {
    explicitWalletConnectInProgress = true;
    try {
      reownDebug('appkit open connect');
      await appKit.open({ view: 'Connect', namespace: 'eip155' });
      renderIosPwaWalletLink();
      address = await waitForAccount();
      reownDebug('account connected', { address: redactAddress(address) });
      await appKit.close?.();
      provider = getWalletProvider();
      if (!provider?.request) {
        reownDebug('connect missing provider after account');
        throw new Error('지갑 provider를 찾지 못했습니다. 지갑 연결을 다시 승인해주세요.');
      }
    } finally {
      explicitWalletConnectInProgress = false;
      removeIosPwaWalletLink();
    }
  }
  if (options.chainId) {
    await switchToChain(options.chainId);
  }
  reownDebug('connect complete', { address: redactAddress(address), chainId: currentChainId || toHexChainId(getChainId(wagmiConfig)) });
  return [address];
}

async function disconnect() {
  try {
    reownDebug('disconnect start');
    await appKit.disconnect?.('eip155');
  } catch (error) {
    reownDebug('disconnect appkit failed', { error: error instanceof Error ? error.message : String(error) });
    // Fall back to wagmi state reset when the AppKit disconnect path is unavailable.
  }
  currentChainId = '';
  emit('accountsChanged', []);
  reownDebug('disconnect complete');
}

async function reconnectChain(chainId) {
  await disconnect();
  await new Promise((resolve) => window.setTimeout(resolve, 500));
  return connect({ chainId });
}

async function openNetworks() {
  await ensureReconnect();
  await appKit.open({ view: 'Networks', namespace: 'eip155' });
}

async function request({ method, params = [] }) {
  reownDebug('provider request', { method, paramsCount: Array.isArray(params) ? params.length : 0 });
  switch (method) {
    case 'eth_requestAccounts': {
      const requestedChainId = params?.[0]?.chainId;
      return connect({ chainId: requestedChainId });
    }
    case 'eth_accounts': {
      const address = getConnectedAddress();
      return address ? [address] : [];
    }
    case 'eth_chainId': {
      return currentChainId || toHexChainId(getChainId(wagmiConfig));
    }
    case 'wallet_switchEthereumChain': {
      await ensureReconnect();
      await switchToChain(params?.[0]?.chainId);
      return null;
    }
    default: {
      await ensureReconnect();
      let provider = getWalletProvider();
      if (!provider?.request) {
        reownDebug('provider request needs connect', { method });
        await connect();
        provider = requireWalletProvider();
      }
      return provider.request({ method, params });
    }
  }
}

function on(event, handler) {
  if (typeof handler !== 'function') {
    return;
  }
  const subscriber = (nextEvent, payload) => {
    if (nextEvent === event) {
      handler(payload);
    }
  };
  subscribers.add(subscriber);
  handler.__spotReownSubscriber = subscriber;
}

function off(event, handler) {
  if (handler?.__spotReownSubscriber) {
    subscribers.delete(handler.__spotReownSubscriber);
  }
}

watchAccount(wagmiConfig, {
  onChange(account) {
    reownDebug('watchAccount change', {
      address: redactAddress(account?.address),
      status: account?.status,
    });
    if (account?.address) {
      removeIosPwaWalletLink();
    }
    emit('accountsChanged', account?.address ? [account.address] : []);
  },
});

watchChainId(wagmiConfig, {
  onChange(chainId) {
    currentChainId = toHexChainId(chainId);
    reownDebug('watchChainId change', { chainId: currentChainId });
    emit('chainChanged', currentChainId);
  },
});

function SpotReownBridgeRoot() {
  useEffect(() => {
    installIosPwaWalletLinkFallback();
    reownDebug('bridge root ready', {
      networks: SUPPORTED_NETWORKS.map((network) => network.id),
      metadataName: METADATA.name,
      appOrigin: APP_ORIGIN,
    });
    window.dispatchEvent(new CustomEvent('spot-reown-ready'));
  }, []);
  return null;
}

function mountBridgeRoot() {
  if (document.querySelector('[data-spot-reown-root]')) {
    return;
  }
  const rootNode = document.createElement('div');
  rootNode.dataset.spotReownRoot = 'true';
  rootNode.hidden = true;
  document.body.append(rootNode);
  createRoot(rootNode).render(
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SpotReownBridgeRoot />
      </QueryClientProvider>
    </WagmiProvider>,
  );
}

window.SpotReownWallet = {
  projectId: PROJECT_ID,
  networks: SUPPORTED_NETWORKS.map((network) => ({ id: network.id, name: network.name })),
  provider: { request, on, removeListener: off, disconnect },
  connect,
  disconnect,
  reconnectChain,
  openNetworks,
  getAddress: getConnectedAddress,
  getWalletProvider,
  open: (options) => appKit.open(options),
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountBridgeRoot, { once: true });
} else {
  mountBridgeRoot();
}
