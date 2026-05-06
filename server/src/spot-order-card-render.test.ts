import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

type Listener = (event?: unknown) => unknown;

class TestElement {
  tagName: string;
  type = '';
  className = '';
  textContent = '';
  disabled = false;
  hidden = false;
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: TestElement[] = [];
  listeners = new Map<string, Listener[]>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  append(...nodes: Array<TestElement | string | undefined | null>) {
    for (const node of nodes) {
      if (node === undefined || node === null) {
        continue;
      }
      if (typeof node === 'string') {
        const textNode = new TestElement('#text');
        textNode.textContent = node;
        this.children.push(textNode);
        continue;
      }
      this.children.push(node);
    }
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }

  getAttribute(name: string) {
    return this.attributes[name];
  }

  addEventListener(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) || [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  async click() {
    for (const listener of this.listeners.get('click') || []) {
      await listener({ currentTarget: this });
    }
  }

  all(predicate: (element: TestElement) => boolean): TestElement[] {
    const self: TestElement = this;
    const matches: TestElement[] = predicate(self) ? [self] : [];
    for (const child of this.children) {
      matches.push(...child.all(predicate));
    }
    return matches;
  }

  text(): string {
    return `${this.textContent}${this.children.map((child) => child.text()).join('')}`;
  }
}

function setBrowserGlobals({ ethereum, reown, userAgent = 'Mozilla/5.0', coarsePointer = false }: {
  ethereum?: unknown;
  reown?: unknown;
  userAgent?: string;
  coarsePointer?: boolean;
} = {}) {
  const windowListeners = new Map<string, Set<Listener>>();
  const documentMock = {
    createElement: (tagName: string) => new TestElement(tagName),
    querySelector: () => null,
    body: new TestElement('body'),
    readyState: 'complete',
    addEventListener: () => {},
  };
  const windowMock: Record<string, unknown> = {
    ethereum,
    SpotReownWallet: reown,
    location: { pathname: '/chat/test-conversation' },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    matchMedia: (query: string) => ({ matches: query === '(pointer: coarse)' ? coarsePointer : false }),
    addEventListener: (event: string, handler: Listener) => {
      const handlers = windowListeners.get(event) || new Set<Listener>();
      handlers.add(handler);
      windowListeners.set(event, handlers);
    },
    removeEventListener: (event: string, handler: Listener) => {
      windowListeners.get(event)?.delete(handler);
    },
    dispatchEvent: (event: Event) => {
      for (const handler of windowListeners.get(event.type) || []) {
        handler(event);
      }
      return true;
    },
  };
  Object.defineProperty(globalThis, 'document', { value: documentMock, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: windowMock, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true });
  return { windowMock, documentMock };
}

function futureSpotOrderPayload() {
  const now = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    title: 'Spot 주문 서명',
    typedData: {
      domain: {
        name: 'Permit2',
        version: '1',
        chainId: 8453,
        verifyingContract: '0x000000000022d473030f116ddee9f6b43ac78ba3',
      },
      types: {},
      primaryType: 'RePermitWitnessTransferFrom',
      message: {
        permitted: {
          token: '0x1111111111111111111111111111111111111111',
          amount: '1000000',
        },
        witness: {
          swapper: '0x2222222222222222222222222222222222222222',
          nonce: now,
          deadline: now + 600,
          input: {
            token: '0x1111111111111111111111111111111111111111',
            maxAmount: '1000000',
          },
        },
      },
    },
  });
}

let renderCodeBlockPlugin: (parent: TestElement, codeText: string, language: string, context?: Record<string, unknown>) => boolean;

before(async () => {
  setBrowserGlobals();
  const registryUrl = pathToFileURL(resolve('public/plugins/plugin-registry.js')).href;
  const orderCardUrl = pathToFileURL(resolve('public/plugins/spot-order-card.js')).href;
  const registry = await import(registryUrl) as { renderCodeBlockPlugin: typeof renderCodeBlockPlugin };
  await import(orderCardUrl);
  renderCodeBlockPlugin = registry.renderCodeBlockPlugin;
});

beforeEach(() => {
  setBrowserGlobals();
});

test('renders Spot order card without disabling wallet buttons when no injected provider exists', () => {
  setBrowserGlobals();
  const parent = new TestElement('div');

  assert.equal(renderCodeBlockPlugin(parent, futureSpotOrderPayload(), 'spot-order-card', {}), true);
  const buttons = parent.all((element) => element.tagName === 'BUTTON');
  const connectButton = buttons.find((button) => button.textContent === '지갑 연결');
  const signButton = buttons.find((button) => button.textContent === '서명 후 바로 제출');

  assert.ok(connectButton);
  assert.ok(signButton);
  assert.equal(connectButton.disabled, false);
  assert.equal(signButton.disabled, false);
  assert.match(parent.text(), /Reown AppKit으로 모바일 지갑을 연결/);
});

test('keeps injected-provider flow even on mobile-like browser layout', () => {
  setBrowserGlobals({
    ethereum: { request: async () => [] },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    coarsePointer: true,
  });
  const parent = new TestElement('div');

  assert.equal(renderCodeBlockPlugin(parent, futureSpotOrderPayload(), 'spot-order-card', {}), true);

  assert.match(parent.text(), /서명 전 요약을 확인한 뒤 서명하면 주문이 바로 제출됩니다/);
  assert.doesNotMatch(parent.text(), /PC 브라우저에서만 사용할 수 있습니다/);
});

test('connect button can connect through Reown fallback provider', async () => {
  const connectCalls: unknown[] = [];
  setBrowserGlobals({
    reown: {
      connect: async (options: unknown) => {
        connectCalls.push(options);
        return ['0x2222222222222222222222222222222222222222'];
      },
      provider: {
        request: async ({ method }: { method: string }) => method === 'eth_accounts' ? [] : null,
        on: () => {},
        removeListener: () => {},
      },
    },
  });
  const parent = new TestElement('div');

  renderCodeBlockPlugin(parent, futureSpotOrderPayload(), 'spot-order-card', {});
  const connectButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === '지갑 연결');
  assert.ok(connectButton);

  await connectButton.click();

  assert.deepEqual(connectCalls, [{ chainId: 8453 }]);
  assert.equal(connectButton.textContent, '연결 끊기');
  assert.match(parent.text(), /연결됨: 0x2222222222222222222222222222222222222222/);
});
