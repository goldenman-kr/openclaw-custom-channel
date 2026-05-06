import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { TestElement, setBrowserGlobals } from './test-dom.js';

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

function uint256Result(value: bigint) {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

test('sign button submits signed order through Reown fallback when allowance is sufficient', async () => {
  const providerCalls: Array<{ method: string; params?: unknown[] }> = [];
  const submitCalls: Array<{ path: string; options: Record<string, unknown> }> = [];
  setBrowserGlobals({
    reown: {
      connect: async () => ['0x2222222222222222222222222222222222222222'],
      provider: {
        request: async (payload: { method: string; params?: unknown[] }) => {
          providerCalls.push(payload);
          if (payload.method === 'eth_accounts') {
            return [];
          }
          if (payload.method === 'eth_chainId') {
            return '0x2105';
          }
          if (payload.method === 'eth_call') {
            return uint256Result(1_000_000n);
          }
          if (payload.method === 'eth_signTypedData_v4') {
            return '0xsigned';
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
    activeConversationId: () => 'conv-1',
    apiJson: async (path: string, options: Record<string, unknown>) => {
      submitCalls.push({ path, options });
      return { relay_order_hash: '0xrelay' };
    },
    refreshHistory: async () => {},
  };

  renderCodeBlockPlugin(parent, futureSpotOrderPayload(), 'spot-order-card', context);
  const signButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === '서명 후 바로 제출');
  assert.ok(signButton);

  await signButton.click();

  assert.equal(submitCalls.length, 1);
  assert.equal(submitCalls[0].path, '/v1/plugins/spot/orders/submit-signed');
  assert.equal((submitCalls[0].options.body as Record<string, unknown>).conversation_id, 'conv-1');
  assert.equal((submitCalls[0].options.body as Record<string, unknown>).signature, '0xsigned');
  assert.equal((submitCalls[0].options.body as Record<string, unknown>).signer, '0x2222222222222222222222222222222222222222');
  assert.ok(providerCalls.some((call) => call.method === 'eth_call'));
  assert.ok(providerCalls.some((call) => call.method === 'eth_signTypedData_v4'));
  assert.equal(providerCalls.some((call) => call.method === 'eth_sendTransaction'), false);
  assert.match(parent.text(), /제출 완료: 0xrelay/);
});

test('sign button sends exact approve before signing when allowance is insufficient', async () => {
  const providerCalls: Array<{ method: string; params?: Array<Record<string, unknown> | string> }> = [];
  setBrowserGlobals({
    reown: {
      connect: async () => ['0x2222222222222222222222222222222222222222'],
      provider: {
        request: async (payload: { method: string; params?: Array<Record<string, unknown> | string> }) => {
          providerCalls.push(payload);
          if (payload.method === 'eth_accounts') {
            return [];
          }
          if (payload.method === 'eth_chainId') {
            return '0x2105';
          }
          if (payload.method === 'eth_call') {
            return uint256Result(0n);
          }
          if (payload.method === 'eth_sendTransaction') {
            return '0xapprove';
          }
          if (payload.method === 'eth_getTransactionReceipt') {
            return { status: '0x1', transactionHash: '0xapprove' };
          }
          if (payload.method === 'eth_signTypedData_v4') {
            return '0xsigned';
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
    activeConversationId: () => 'conv-1',
    apiJson: async () => ({ relay_order_hash: '0xrelay' }),
    refreshHistory: async () => {},
  };

  renderCodeBlockPlugin(parent, futureSpotOrderPayload(), 'spot-order-card', context);
  const signButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === '서명 후 바로 제출');
  assert.ok(signButton);

  await signButton.click();

  const approveCall = providerCalls.find((call) => call.method === 'eth_sendTransaction');
  assert.ok(approveCall);
  assert.deepEqual(approveCall.params?.[0], {
    from: '0x2222222222222222222222222222222222222222',
    to: '0x1111111111111111111111111111111111111111',
    data: '0x095ea7b3000000000000000000000000000000000022d473030f116ddee9f6b43ac78ba300000000000000000000000000000000000000000000000000000000000f4240',
  });
  assert.ok(providerCalls.some((call) => call.method === 'eth_getTransactionReceipt'));
  assert.ok(providerCalls.some((call) => call.method === 'eth_signTypedData_v4'));
  assert.match(parent.text(), /제출 완료: 0xrelay/);
});
