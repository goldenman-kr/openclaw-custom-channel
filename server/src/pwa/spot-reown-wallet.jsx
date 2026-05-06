import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { mainnet, arbitrum, base, polygon, bsc } from '@reown/appkit/networks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { getAccount, getChainId, reconnect, watchAccount, watchChainId } from '@wagmi/core';

const PROJECT_ID = '120c9576f09c8e51fd55eec984c877e8';
const SUPPORTED_NETWORKS = [mainnet, arbitrum, base, polygon, bsc];
const METADATA = {
  name: 'RODY',
  description: 'RODY AI Assistant',
  url: 'https://ai.kryp.xyz/',
  icons: ['https://ai.kryp.xyz/assets/openclaw-app-icon-512.png'],
};

const queryClient = new QueryClient();
const wagmiAdapter = new WagmiAdapter({
  networks: SUPPORTED_NETWORKS,
  projectId: PROJECT_ID,
  ssr: false,
});

const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks: SUPPORTED_NETWORKS,
  projectId: PROJECT_ID,
  metadata: METADATA,
  features: {
    analytics: false,
  },
});

const wagmiConfig = wagmiAdapter.wagmiConfig;
const subscribers = new Set();
let currentChainId = '';
let reconnectStarted = false;

function toHexChainId(chainId) {
  if (chainId === undefined || chainId === null || chainId === '') {
    return '';
  }
  return `0x${BigInt(chainId).toString(16)}`;
}

function parseChainId(chainId) {
  if (typeof chainId === 'number') {
    return chainId;
  }
  if (typeof chainId === 'bigint') {
    return Number(chainId);
  }
  const value = String(chainId || '').trim();
  if (!value) {
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
  if (reconnectStarted) {
    return;
  }
  reconnectStarted = true;
  reconnect(wagmiConfig).catch(() => {});
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

async function switchToChain(chainId) {
  const numericChainId = parseChainId(chainId);
  if (!numericChainId) {
    return;
  }
  const network = SUPPORTED_NETWORKS.find((item) => Number(item.id) === numericChainId);
  if (!network) {
    throw new Error(`지원하지 않는 EVM 네트워크입니다: ${numericChainId}`);
  }
  try {
    await appKit.switchNetwork?.(network, { throwOnFailure: true });
    return;
  } catch (error) {
    const provider = requireWalletProvider();
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: toHexChainId(numericChainId) }],
    });
  }
}

async function connect(options = {}) {
  ensureReconnect();
  let address = getConnectedAddress();
  if (!address) {
    await appKit.open({ view: 'Connect', namespace: 'eip155' });
    address = await waitForAccount();
  }
  if (options.chainId) {
    await switchToChain(options.chainId);
  }
  return [address];
}

async function disconnect() {
  try {
    await appKit.disconnect?.('eip155');
  } catch {
    // Fall back to wagmi state reset when the AppKit disconnect path is unavailable.
  }
  emit('accountsChanged', []);
}

async function request({ method, params = [] }) {
  ensureReconnect();
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
      await switchToChain(params?.[0]?.chainId);
      return null;
    }
    default: {
      const provider = requireWalletProvider();
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
    emit('accountsChanged', account?.address ? [account.address] : []);
  },
});

watchChainId(wagmiConfig, {
  onChange(chainId) {
    currentChainId = toHexChainId(chainId);
    emit('chainChanged', currentChainId);
  },
});

function SpotReownBridgeRoot() {
  useEffect(() => {
    ensureReconnect();
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
  getAddress: getConnectedAddress,
  getWalletProvider,
  open: (options) => appKit.open(options),
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountBridgeRoot, { once: true });
} else {
  mountBridgeRoot();
}
