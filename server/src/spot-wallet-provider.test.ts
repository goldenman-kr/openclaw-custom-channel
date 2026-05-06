import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

type SpotWalletProviderModule = {
  hasInjectedProvider: () => boolean;
  isMobileLikeDevice: () => boolean;
  getSpotWalletMode: () => 'injected' | 'reown';
  requestSpotWalletAccounts: (options?: { chainId?: number }) => Promise<string[]>;
  getSpotWalletAccounts: () => Promise<string[]>;
  switchSpotWalletChain: (chainId: number) => Promise<void>;
};

let providerModule: SpotWalletProviderModule;

function setBrowserGlobals({ ethereum, reown, userAgent = 'Mozilla/5.0', coarsePointer = false }: {
  ethereum?: unknown;
  reown?: unknown;
  userAgent?: string;
  coarsePointer?: boolean;
} = {}) {
  const listeners = new Map<string, Set<EventListener>>();
  const windowMock: Record<string, unknown> = {
    ethereum,
    SpotReownWallet: reown,
    matchMedia: (query: string) => ({ matches: query === '(pointer: coarse)' ? coarsePointer : false }),
    addEventListener: (event: string, handler: EventListener) => {
      const handlers = listeners.get(event) || new Set<EventListener>();
      handlers.add(handler);
      listeners.set(event, handlers);
    },
    removeEventListener: (event: string, handler: EventListener) => {
      listeners.get(event)?.delete(handler);
    },
    dispatchEvent: (event: Event) => {
      for (const handler of listeners.get(event.type) || []) {
        handler(event);
      }
      return true;
    },
  };
  Object.defineProperty(globalThis, 'window', { value: windowMock, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true });
  return windowMock;
}

before(async () => {
  setBrowserGlobals();
  const moduleUrl = pathToFileURL(resolve('public/plugins/spot-wallet-provider.js')).href;
  providerModule = await import(moduleUrl) as SpotWalletProviderModule;
});

beforeEach(() => {
  setBrowserGlobals();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).navigator;
});

test('uses injected provider first even on mobile-like devices', async () => {
  const calls: Array<{ method: string; params?: unknown[] }> = [];
  const injectedProvider = {
    request: async (payload: { method: string; params?: unknown[] }) => {
      calls.push(payload);
      if (payload.method === 'eth_requestAccounts') {
        return ['0x1111111111111111111111111111111111111111'];
      }
      return null;
    },
  };
  const reownBridge = {
    connect: async () => ['0x2222222222222222222222222222222222222222'],
    provider: { request: async () => [] },
  };
  setBrowserGlobals({
    ethereum: injectedProvider,
    reown: reownBridge,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    coarsePointer: true,
  });

  assert.equal(providerModule.isMobileLikeDevice(), true);
  assert.equal(providerModule.hasInjectedProvider(), true);
  assert.equal(providerModule.getSpotWalletMode(), 'injected');
  assert.deepEqual(await providerModule.requestSpotWalletAccounts({ chainId: 1 }), ['0x1111111111111111111111111111111111111111']);
  assert.deepEqual(calls, [{ method: 'eth_requestAccounts' }]);
});

test('uses Reown bridge when injected provider is missing', async () => {
  const connectCalls: unknown[] = [];
  const reownBridge = {
    connect: async (options: unknown) => {
      connectCalls.push(options);
      return ['0x2222222222222222222222222222222222222222'];
    },
    provider: {
      request: async ({ method }: { method: string }) => method === 'eth_accounts'
        ? ['0x2222222222222222222222222222222222222222']
        : null,
    },
  };
  setBrowserGlobals({ reown: reownBridge });

  assert.equal(providerModule.hasInjectedProvider(), false);
  assert.equal(providerModule.getSpotWalletMode(), 'reown');
  assert.deepEqual(await providerModule.requestSpotWalletAccounts({ chainId: 8453 }), ['0x2222222222222222222222222222222222222222']);
  assert.deepEqual(connectCalls, [{ chainId: 8453 }]);
  assert.deepEqual(await providerModule.getSpotWalletAccounts(), ['0x2222222222222222222222222222222222222222']);
});

test('does not lazy-load Reown while silently hydrating accounts', async () => {
  setBrowserGlobals();

  assert.equal(providerModule.getSpotWalletMode(), 'reown');
  assert.deepEqual(await providerModule.getSpotWalletAccounts(), []);
  assert.equal((globalThis as any).window.SpotReownWallet, undefined);
});

test('switches chain through the selected provider only when needed', async () => {
  const calls: Array<{ method: string; params?: unknown[] }> = [];
  const injectedProvider = {
    request: async (payload: { method: string; params?: unknown[] }) => {
      calls.push(payload);
      if (payload.method === 'eth_chainId') {
        return '0x1';
      }
      return null;
    },
  };
  setBrowserGlobals({ ethereum: injectedProvider });

  await providerModule.switchSpotWalletChain(1);
  await providerModule.switchSpotWalletChain(137);

  assert.deepEqual(calls, [
    { method: 'eth_chainId' },
    { method: 'eth_chainId' },
    { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x89' }] },
  ]);
});
