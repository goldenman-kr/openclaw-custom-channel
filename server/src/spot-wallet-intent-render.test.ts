import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { TestElement, setBrowserGlobals } from './test-dom.js';

type RenderCodeBlockPlugin = (parent: TestElement, codeText: string, language: string, context?: Record<string, unknown>) => boolean;

let renderCodeBlockPlugin: RenderCodeBlockPlugin;

function walletIntentPayload() {
  return JSON.stringify({
    title: 'Spot 주문 준비',
    chainId: 8453,
    input: {
      symbol: 'USDC',
      token: '0x1111111111111111111111111111111111111111',
      amount: 'all',
    },
    output: {
      symbol: 'ETH',
      token: '0x2222222222222222222222222222222222222222',
      minAmount: '0.0002',
    },
  });
}

before(async () => {
  setBrowserGlobals();
  const registryUrl = pathToFileURL(resolve('public/plugins/plugin-registry.js')).href;
  const intentUrl = pathToFileURL(resolve('public/plugins/spot-wallet-intent.js')).href;
  const registry = await import(registryUrl) as { renderCodeBlockPlugin: RenderCodeBlockPlugin };
  await import(intentUrl);
  renderCodeBlockPlugin = registry.renderCodeBlockPlugin;
});

beforeEach(() => {
  setBrowserGlobals();
});

test('renders Spot wallet intent card with Reown fallback enabled when no injected provider exists', () => {
  const parent = new TestElement('div');

  assert.equal(renderCodeBlockPlugin(parent, walletIntentPayload(), 'spot-wallet-intent', {}), true);
  const buttons = parent.all((element) => element.tagName === 'BUTTON');
  const connectButton = buttons.find((button) => button.textContent === '지갑 연결');
  const switchButton = buttons.find((button) => button.textContent === '체인 전환');
  const networkSelectorButton = buttons.find((button) => button.textContent === '네트워크 선택 열기');
  const continueButton = buttons.find((button) => button.textContent === '잔액 확인 후 주문 생성');

  assert.ok(connectButton);
  assert.ok(switchButton);
  assert.ok(networkSelectorButton);
  assert.ok(continueButton);
  assert.equal(connectButton.disabled, false);
  assert.equal(switchButton.disabled, false);
  assert.equal(networkSelectorButton.disabled, false);
  assert.equal(continueButton.disabled, false);
  assert.match(parent.text(), /Reown AppKit으로 모바일 지갑을 연결/);
  assert.doesNotMatch(parent.text(), /PC 브라우저에서만 사용할 수 있습니다/);
});

test('connects intent card through Reown fallback provider', async () => {
  const connectCalls: unknown[] = [];
  setBrowserGlobals({
    reown: {
      connect: async (options: unknown) => {
        connectCalls.push(options);
        return ['0x3333333333333333333333333333333333333333'];
      },
      provider: {
        request: async ({ method }: { method: string }) => method === 'eth_accounts' ? [] : null,
        on: () => {},
        removeListener: () => {},
      },
    },
  });
  const parent = new TestElement('div');

  renderCodeBlockPlugin(parent, walletIntentPayload(), 'spot-wallet-intent', {});
  const connectButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === '지갑 연결');
  assert.ok(connectButton);

  await connectButton.click();

  assert.deepEqual(connectCalls, [{ chainId: 8453 }]);
  assert.equal(connectButton.textContent, '연결 끊기');
  assert.match(parent.text(), /연결됨: 0x3333333333333333333333333333333333333333/);
});

test('continue button treats empty RPC quantity 0x as zero balance', async () => {
  const pluginMessages: string[] = [];
  setBrowserGlobals({
    reown: {
      connect: async () => ['0x3333333333333333333333333333333333333333'],
      provider: {
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_call') {
            return '0x';
          }
          if (method === 'eth_accounts') {
            return [];
          }
          return null;
        },
        on: () => {},
        removeListener: () => {},
      },
    },
  });
  const parent = new TestElement('div');
  const context = {
    sendPluginMessage: async (message: string) => {
      pluginMessages.push(message);
    },
  };

  renderCodeBlockPlugin(parent, walletIntentPayload(), 'spot-wallet-intent', context);
  const continueButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === '잔액 확인 후 주문 생성');
  assert.ok(continueButton);

  await continueButton.click();

  assert.equal(pluginMessages.length, 1);
  assert.match(pluginMessages[0], /input.amount: 0/);
  assert.match(parent.text(), /잔액 확인 완료. 주문 생성을 요청했습니다/);
  assert.doesNotMatch(parent.text(), /Cannot convert 0x to a BigInt/);
});

test('continue button sends connected wallet and balance as plugin message for typedData generation', async () => {
  const pluginMessages: string[] = [];
  setBrowserGlobals({
    reown: {
      connect: async () => ['0x3333333333333333333333333333333333333333'],
      provider: {
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_call') {
            return '0x' + 12345n.toString(16).padStart(64, '0');
          }
          if (method === 'eth_accounts') {
            return [];
          }
          return null;
        },
        on: () => {},
        removeListener: () => {},
      },
    },
  });
  const parent = new TestElement('div');
  const context = {
    sendPluginMessage: async (message: string) => {
      pluginMessages.push(message);
    },
  };

  renderCodeBlockPlugin(parent, walletIntentPayload(), 'spot-wallet-intent', context);
  const continueButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === '잔액 확인 후 주문 생성');
  assert.ok(continueButton);

  await continueButton.click();

  assert.equal(pluginMessages.length, 1);
  assert.match(pluginMessages[0], /swapper: 0x3333333333333333333333333333333333333333/);
  assert.match(pluginMessages[0], /input.amount: 12345/);
  assert.match(pluginMessages[0], /input.maxAmount: 12345/);
  assert.match(parent.text(), /잔액 확인 완료. 주문 생성을 요청했습니다/);
});
