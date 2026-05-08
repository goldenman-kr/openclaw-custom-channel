import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { TestElement, setBrowserGlobals } from './test-dom.js';

let renderCodeBlockPlugin: (parent: TestElement, codeText: string, language: string, context?: Record<string, unknown>) => boolean;

function bridgePayload(amount = '10') {
  return JSON.stringify({
    title: '10 ORBS Ethereum → Polygon',
    direction: 'ethereum-to-polygon',
    amount,
  });
}

function uint256Result(value: bigint) {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

before(async () => {
  setBrowserGlobals();
  const registryUrl = pathToFileURL(resolve('public/plugins/plugin-registry.js')).href;
  const bridgeCardUrl = pathToFileURL(resolve('public/plugins/orbs-polygon-bridge-card.js')).href;
  const registry = await import(registryUrl) as { renderCodeBlockPlugin: typeof renderCodeBlockPlugin };
  await import(bridgeCardUrl);
  renderCodeBlockPlugin = registry.renderCodeBlockPlugin;
});

beforeEach(() => {
  setBrowserGlobals();
});

test('renders ORBS Polygon bridge card with wallet actions', () => {
  const parent = new TestElement('div');

  assert.equal(renderCodeBlockPlugin(parent, bridgePayload(), 'orbs-polygon-bridge-card', {}), true);

  assert.match(parent.text(), /10 ORBS Ethereum → Polygon/);
  assert.match(parent.text(), /Ethereum → Polygon/);
  assert.match(parent.text(), /plugin: orbs-polygon-bridge-card/);
  const buttons = parent.all((element) => element.tagName === 'BUTTON');
  assert.ok(buttons.find((button) => button.textContent === '지갑 연결'));
  assert.ok(buttons.find((button) => button.textContent === '10 ORBS approve'));
  assert.ok(buttons.find((button) => button.textContent === 'Bridge depositFor 실행'));
});

test('bridge button sends depositFor transaction through connected Reown wallet when allowance is sufficient', async () => {
  const calls: Array<{ method: string; params?: Array<Record<string, unknown> | string> }> = [];
  setBrowserGlobals({
    reown: {
      connect: async () => ['0x2222222222222222222222222222222222222222'],
      provider: {
        request: async (payload: { method: string; params?: Array<Record<string, unknown> | string> }) => {
          calls.push(payload);
          if (payload.method === 'eth_accounts') return [];
          if (payload.method === 'eth_chainId') return '0x1';
          if (payload.method === 'eth_call') {
            const call = payload.params?.[0] as Record<string, string> | undefined;
            if (String(call?.data || '').startsWith('0x70a08231')) return uint256Result(20n * 10n ** 18n);
            if (String(call?.data || '').startsWith('0xdd62ed3e')) return uint256Result(10n * 10n ** 18n);
          }
          if (payload.method === 'eth_sendTransaction') return '0xbridge';
          return null;
        },
        on: () => {},
        removeListener: () => {},
      },
    },
  });
  const parent = new TestElement('div');

  renderCodeBlockPlugin(parent, bridgePayload(), 'orbs-polygon-bridge-card', {});
  const buttons = parent.all((element) => element.tagName === 'BUTTON');
  const connectButton = buttons.find((button) => button.textContent === '지갑 연결');
  assert.ok(connectButton);
  await connectButton.click();
  const bridgeButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === 'Bridge depositFor 실행');
  assert.ok(bridgeButton);
  assert.equal(bridgeButton.disabled, false);

  await bridgeButton.click();

  const txCall = calls.find((call) => call.method === 'eth_sendTransaction');
  assert.ok(txCall);
  const tx = txCall.params?.[0] as Record<string, string>;
  assert.equal(tx.from, '0x2222222222222222222222222222222222222222');
  assert.equal(tx.to, '0xa0c68c638235ee32657e8f720a23cec1bfc77c77');
  assert.match(tx.data, /^0xe3dec8fb/);
  assert.match(tx.data, /0000000000000000000000002222222222222222222222222222222222222222/);
  assert.match(tx.data, /000000000000000000000000ff56cc6b1e6ded347aa0b7676c85ab0b3d08b0fa/i);
  assert.match(tx.data, /0000000000000000000000000000000000000000000000008ac7230489e80000$/);
  assert.match(parent.text(), /브릿지 트랜잭션 전송됨: 0xbridge/);
});

test('approve button sends exact ORBS approval to Polygon ERC20 predicate', async () => {
  const calls: Array<{ method: string; params?: Array<Record<string, unknown> | string> }> = [];
  setBrowserGlobals({
    reown: {
      connect: async () => ['0x2222222222222222222222222222222222222222'],
      provider: {
        request: async (payload: { method: string; params?: Array<Record<string, unknown> | string> }) => {
          calls.push(payload);
          if (payload.method === 'eth_accounts') return [];
          if (payload.method === 'eth_chainId') return '0x1';
          if (payload.method === 'eth_call') {
            const call = payload.params?.[0] as Record<string, string> | undefined;
            if (String(call?.data || '').startsWith('0x70a08231')) return uint256Result(20n * 10n ** 18n);
            if (String(call?.data || '').startsWith('0xdd62ed3e')) return uint256Result(0n);
          }
          if (payload.method === 'eth_sendTransaction') return '0xapprove';
          if (payload.method === 'eth_getTransactionReceipt') return { status: '0x1', transactionHash: '0xapprove' };
          return null;
        },
        on: () => {},
        removeListener: () => {},
      },
    },
  });
  const parent = new TestElement('div');

  renderCodeBlockPlugin(parent, bridgePayload(), 'orbs-polygon-bridge-card', {});
  const connectButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === '지갑 연결');
  assert.ok(connectButton);
  await connectButton.click();
  const approveButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === '10 ORBS approve');
  assert.ok(approveButton);
  assert.equal(approveButton.disabled, false);

  await approveButton.click();

  const txCall = calls.find((call) => call.method === 'eth_sendTransaction');
  assert.ok(txCall);
  assert.deepEqual(txCall.params?.[0], {
    from: '0x2222222222222222222222222222222222222222',
    to: '0xff56Cc6b1E6dEd347aA0B7676C85AB0B3D08B0FA',
    data: '0x095ea7b300000000000000000000000040ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf0000000000000000000000000000000000000000000000008ac7230489e80000',
    value: '0x0',
  });
  assert.ok(calls.some((call) => call.method === 'eth_getTransactionReceipt'));
  assert.match(parent.text(), /exact approve|Approve/);
});

test('Polygon to Ethereum card withdraws ORBS on Polygon', async () => {
  const calls: Array<{ method: string; params?: Array<Record<string, unknown> | string> }> = [];
  setBrowserGlobals({
    reown: {
      connect: async () => ['0x2222222222222222222222222222222222222222'],
      provider: {
        request: async (payload: { method: string; params?: Array<Record<string, unknown> | string> }) => {
          calls.push(payload);
          if (payload.method === 'eth_accounts') return [];
          if (payload.method === 'eth_chainId') return '0x89';
          if (payload.method === 'eth_call') return uint256Result(100n * 10n ** 18n);
          if (payload.method === 'eth_sendTransaction') return '0xwithdraw';
          if (payload.method === 'eth_getTransactionReceipt') return { status: '0x1', transactionHash: '0xwithdraw', blockNumber: '0x7b' };
          return null;
        },
        on: () => {},
        removeListener: () => {},
      },
    },
  });
  const parent = new TestElement('div');

  renderCodeBlockPlugin(parent, bridgePayload('50').replace('ethereum-to-polygon', 'polygon-to-ethereum'), 'orbs-polygon-bridge-card', {});
  const connectButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === '지갑 연결');
  assert.ok(connectButton);
  await connectButton.click();
  const withdrawButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === 'Polygon withdraw 실행');
  assert.ok(withdrawButton);
  assert.equal(withdrawButton.disabled, false);

  await withdrawButton.click();

  const txCall = calls.find((call) => call.method === 'eth_sendTransaction');
  assert.ok(txCall);
  assert.deepEqual(txCall.params?.[0], {
    from: '0x2222222222222222222222222222222222222222',
    to: '0x614389eaae0a6821dc49062d56bda3d9d45fa2ff',
    data: '0x2e1a7d4d000000000000000000000000000000000000000000000002b5e3af16b1880000',
    value: '0x0',
  });
  assert.match(parent.text(), /withdraw 확인 완료: 0xwithdraw/);
});

test('Polygon to Ethereum card can resume from payload pending tx on another device', async () => {
  setBrowserGlobals({
    reown: {
      connect: async () => ['0x2222222222222222222222222222222222222222'],
      provider: {
        request: async (payload: { method: string; params?: Array<Record<string, unknown> | string> }) => {
          if (payload.method === 'eth_accounts') return [];
          if (payload.method === 'eth_chainId') return '0x89';
          if (payload.method === 'eth_call') return uint256Result(100n * 10n ** 18n);
          return null;
        },
        on: () => {},
        removeListener: () => {},
      },
    },
  });
  const parent = new TestElement('div');
  const payload = JSON.stringify({
    title: '50 ORBS Polygon → Ethereum 이어하기',
    direction: 'polygon-to-ethereum',
    amount: '50',
    PENDING_TXID: '0xabc123',
    BLOCKHEIGHT_WITHDRAW_TARGET: '123',
    RETURN_PAYLOAD: '0x1234',
    state: 'checkpoint-ready',
  });

  renderCodeBlockPlugin(parent, payload, 'orbs-polygon-bridge-card', {});
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(parent.text(), /0xabc123/);
  assert.match(parent.text(), /exit payload 준비됨/);
  const connectButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === '지갑 연결');
  assert.ok(connectButton);
  await connectButton.click();
  const withdrawButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === 'Polygon withdraw 실행');
  const exitButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === 'Ethereum exit 실행');
  assert.ok(withdrawButton);
  assert.ok(exitButton);
  assert.equal(withdrawButton.disabled, true);
  assert.equal(exitButton.disabled, false);
});

test('Polygon to Ethereum refresh re-reads server records and clears completed local pending tx', async () => {
  const storage = new Map<string, string>();
  const { windowMock } = setBrowserGlobals({
    reown: {
      connect: async () => ['0x2222222222222222222222222222222222222222'],
      provider: {
        request: async (payload: { method: string; params?: Array<Record<string, unknown> | string> }) => {
          if (payload.method === 'eth_accounts') return [];
          if (payload.method === 'eth_chainId') return '0x89';
          if (payload.method === 'eth_call') return uint256Result(100n * 10n ** 18n);
          return null;
        },
        on: () => {},
        removeListener: () => {},
      },
    },
  });
  windowMock.localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  storage.set('orbs-polygon-bridge:polygon-to-ethereum:0x2222222222222222222222222222222222222222', JSON.stringify({
    txHash: '0xabc123',
    blockNumber: '123',
    state: 'source-confirmed',
  }));
  const apiUrls: string[] = [];
  const parent = new TestElement('div');

  renderCodeBlockPlugin(parent, bridgePayload('50').replace('ethereum-to-polygon', 'polygon-to-ethereum'), 'orbs-polygon-bridge-card', {
    apiJson: async (url: string) => {
      apiUrls.push(url);
      return {
        records: [{
          direction: 'polygon-to-ethereum',
          source_tx_hash: '0xabc123',
          source_block_number: '123',
          amount: '50000000000000000000',
          state: 'completed',
        }],
      };
    },
  });
  const connectButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === '지갑 연결');
  assert.ok(connectButton);
  await connectButton.click();

  assert.ok(apiUrls.some((url) => url.includes('/v1/plugins/orbs-bridge/records?account=')));
  assert.ok(apiUrls.some((url) => url.includes('active=0')));
  assert.equal(storage.has('orbs-polygon-bridge:polygon-to-ethereum:0x2222222222222222222222222222222222222222'), false);
  assert.doesNotMatch(parent.text(), /0xabc123/);
  const withdrawButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === 'Polygon withdraw 실행');
  assert.ok(withdrawButton);
  assert.equal(withdrawButton.disabled, false);
});

test('Polygon to Ethereum card fetches exit payload and sends Ethereum exit', async () => {
  const calls: Array<{ method: string; params?: Array<Record<string, unknown> | string> }> = [];
  const fetchCalls: string[] = [];
  (globalThis as Record<string, unknown>).fetch = async (url: string) => {
    fetchCalls.push(String(url));
    if (String(url).includes('/block-included/123')) {
      return { ok: true, json: async () => ({ message: 'success' }) };
    }
    if (String(url).includes('/exit-payload/0xwithdraw')) {
      return { ok: true, json: async () => ({ message: '0x1234' }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  setBrowserGlobals({
    reown: {
      connect: async () => ['0x2222222222222222222222222222222222222222'],
      provider: {
        request: async (payload: { method: string; params?: Array<Record<string, unknown> | string> }) => {
          calls.push(payload);
          if (payload.method === 'eth_accounts') return [];
          if (payload.method === 'eth_chainId') return '0x89';
          if (payload.method === 'wallet_switchEthereumChain') return null;
          if (payload.method === 'eth_call') return uint256Result(100n * 10n ** 18n);
          if (payload.method === 'eth_sendTransaction') {
            const tx = payload.params?.[0] as Record<string, string> | undefined;
            return tx?.to === '0x614389eaae0a6821dc49062d56bda3d9d45fa2ff' ? '0xwithdraw' : '0xexit';
          }
          if (payload.method === 'eth_getTransactionReceipt') return { status: '0x1', transactionHash: '0xwithdraw', blockNumber: '0x7b' };
          return null;
        },
        on: () => {},
        removeListener: () => {},
      },
    },
  });
  const parent = new TestElement('div');

  renderCodeBlockPlugin(parent, bridgePayload('50').replace('ethereum-to-polygon', 'polygon-to-ethereum'), 'orbs-polygon-bridge-card', {});
  const connectButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === '지갑 연결');
  assert.ok(connectButton);
  await connectButton.click();
  const withdrawButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === 'Polygon withdraw 실행');
  assert.ok(withdrawButton);
  await withdrawButton.click();
  const checkpointButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === '체크포인트/exit payload 확인');
  assert.ok(checkpointButton);
  await checkpointButton.click();
  const exitButton = parent.all((element) => element.tagName === 'BUTTON').find((button) => button.textContent === 'Ethereum exit 실행');
  assert.ok(exitButton);
  assert.equal(exitButton.disabled, false);

  await exitButton.click();

  assert.equal(exitButton.disabled, true);
  assert.ok(fetchCalls.some((url) => url.includes('/block-included/123')));
  assert.ok(fetchCalls.some((url) => url.includes('/exit-payload/0xwithdraw')));
  const txCalls = calls.filter((call) => call.method === 'eth_sendTransaction');
  assert.equal(txCalls.length, 2);
  const exitTx = txCalls[1].params?.[0] as Record<string, string>;
  assert.equal(exitTx.to, '0xa0c68c638235ee32657e8f720a23cec1bfc77c77');
  assert.match(exitTx.data, /^0x3805550f/);
  assert.match(parent.text(), /exit 트랜잭션 확인 완료: 0xexit/);
  delete (globalThis as Record<string, unknown>).fetch;
});
