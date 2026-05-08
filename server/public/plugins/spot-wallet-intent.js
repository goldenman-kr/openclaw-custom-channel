import { registerCodeBlockPlugin } from './plugin-registry.js';
import { getWalletMode, openWalletNetworkSelector, requestWallet, requestWalletAccounts, switchWalletChain } from './wallet-provider.js';

function parsePayload(codeText) {
  try {
    return { data: JSON.parse(codeText), error: null };
  } catch (error) {
    return { data: null, error };
  }
}

function normalizeAddress(value) {
  const address = String(value || '').trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : '';
}

function compactAddress(value) {
  const address = String(value || '');
  return address.length > 14 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address || '-';
}

function createButton(label, onClick, options = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `spot-plugin-button${options.secondary ? ' secondary' : ''}`;
  button.textContent = label;
  button.disabled = Boolean(options.disabled);
  button.addEventListener('click', onClick);
  return button;
}

function appendField(parent, label, value) {
  const row = document.createElement('div');
  row.className = 'spot-plugin-field';
  const labelNode = document.createElement('span');
  labelNode.className = 'spot-plugin-field-label';
  labelNode.textContent = label;
  const valueNode = document.createElement('code');
  valueNode.textContent = value;
  row.append(labelNode, valueNode);
  parent.append(row);
}

function setStatus(statusNode, message, kind = '') {
  statusNode.textContent = message;
  statusNode.dataset.kind = kind;
}

async function requestAccounts(chainId) {
  return requestWalletAccounts({ chainId });
}

async function switchChain(chainId) {
  return switchWalletChain(chainId);
}

function addressParam(address) {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    throw new Error(`잘못된 주소입니다: ${address}`);
  }
  return normalized.slice(2).padStart(64, '0');
}

function encodeBalanceOfCall(owner) {
  return `0x70a08231${addressParam(owner)}`;
}

function bigintFromRpcQuantity(value) {
  const text = String(value ?? '').trim();
  if (!text || text === '0x') {
    return 0n;
  }
  try {
    return BigInt(text);
  } catch {
    throw new Error(`RPC quantity를 정수로 변환할 수 없습니다: ${text}`);
  }
}

async function getErc20Balance({ token, owner }) {
  const result = await requestWallet('eth_call', [{ to: token, data: encodeBalanceOfCall(owner) }, 'latest']);
  return bigintFromRpcQuantity(result).toString();
}

function renderSpotWalletIntent({ parent, codeText, context, fallback }) {
  const { data, error } = parsePayload(codeText);
  if (error || !data || typeof data !== 'object') {
    fallback();
    return;
  }

  const chainId = data.chainId;
  const input = data.input || {};
  const output = data.output || {};
  const inputToken = input.token;

  const card = document.createElement('section');
  card.className = 'spot-plugin-card';

  const header = document.createElement('div');
  header.className = 'spot-plugin-header';
  const title = document.createElement('strong');
  title.textContent = data.title || 'Spot 주문 준비';
  const badge = document.createElement('span');
  badge.className = 'spot-plugin-badge';
  badge.textContent = 'plugin: spot-wallet-intent';
  header.append(title, badge);

  const body = document.createElement('div');
  body.className = 'spot-plugin-body';
  appendField(body, 'Chain', String(chainId || '-'));
  appendField(body, 'Input', `${input.symbol || '-'} ${compactAddress(inputToken)}`);
  appendField(body, 'Output', `${output.symbol || '-'} ${compactAddress(output.token)}`);
  appendField(body, 'Order type', data.orderType || 'market');
  appendField(body, 'Amount', input.amount || 'all');

  const status = document.createElement('p');
  status.className = 'spot-plugin-status';
  setStatus(status, getWalletMode() === 'injected'
    ? '지갑을 연결하면 swapper와 잔액을 확인해 주문 생성을 이어갑니다.'
    : '지갑을 연결하면 Reown AppKit으로 모바일 지갑을 연결하고 주문 생성을 이어갑니다.');

  let connectedAccount = '';
  let connectButton;
  function updateButton() {
    if (connectButton) {
      connectButton.textContent = connectedAccount ? '연결 끊기' : '지갑 연결';
      connectButton.setAttribute('aria-pressed', connectedAccount ? 'true' : 'false');
    }
  }

  connectButton = createButton('지갑 연결', async () => {
    try {
      if (connectedAccount) {
        connectedAccount = '';
        updateButton();
        setStatus(status, '이 카드의 지갑 연결 상태를 해제했습니다.', 'ok');
        return;
      }
      const accounts = await requestAccounts(chainId);
      connectedAccount = accounts?.[0] || '';
      updateButton();
      setStatus(status, connectedAccount ? `연결됨: ${connectedAccount}` : '연결된 계정이 없습니다.', connectedAccount ? 'ok' : 'warn');
    } catch (connectError) {
      setStatus(status, connectError instanceof Error ? connectError.message : String(connectError), 'error');
    }
  });

  const continueButton = createButton('잔액 확인 후 주문 생성', async () => {
    try {
      if (!connectedAccount) {
        const accounts = await requestAccounts(chainId);
        connectedAccount = accounts?.[0] || '';
        updateButton();
      }
      if (!normalizeAddress(connectedAccount)) {
        throw new Error('연결된 지갑 주소를 찾지 못했습니다.');
      }
      if (!chainId || !normalizeAddress(inputToken)) {
        throw new Error('잔액 확인에 필요한 체인 또는 입력 토큰 정보가 부족합니다.');
      }
      setStatus(status, '체인을 확인하는 중입니다…');
      await switchChain(chainId);
      setStatus(status, `${input.symbol || '입력 토큰'} 잔액을 확인하는 중입니다…`);
      const balance = input.amount === 'all'
        ? await getErc20Balance({ token: inputToken, owner: connectedAccount })
        : '';
      const message = [
        'Spot 주문 준비가 완료되었습니다. 아래 값으로 typedData를 생성해주세요.',
        '',
        `- chainId: ${chainId}`,
        `- swapper: ${connectedAccount}`,
        `- orderType: ${data.orderType || 'market'}`,
        `- input.symbol: ${input.symbol || ''}`,
        `- input.token: ${inputToken}`,
        `- input.decimals: ${input.decimals ?? ''}`,
        `- input.amount: ${input.amount === 'all' ? balance : input.amount}`,
        `- input.maxAmount: ${input.amount === 'all' ? balance : (input.maxAmount || input.amount || '')}`,
        `- output.symbol: ${output.symbol || ''}`,
        `- output.token: ${output.token || ''}`,
        `- output.decimals: ${output.decimals ?? ''}`,
        `- output.recipient: ${connectedAccount}`,
        '',
        '시장가 주문이면 output.limit=0으로 설정하고, 생성 전 요약 후 spot-order-card를 렌더링해주세요.',
      ].join('\n');
      await context.sendPluginMessage?.(message);
      setStatus(status, '잔액 확인 완료. 주문 생성을 요청했습니다.', 'ok');
    } catch (continueError) {
      setStatus(status, continueError instanceof Error ? continueError.message : String(continueError), 'error');
    }
  });

  const switchButton = createButton('체인 전환', async () => {
    try {
      if (!chainId) {
        throw new Error('전환할 chainId를 확인할 수 없습니다.');
      }
      setStatus(status, `주문 체인(${chainId})으로 전환을 요청합니다…`);
      await switchChain(chainId);
      setStatus(status, `주문 체인(${chainId}) 전환 확인 완료.`, 'ok');
    } catch (switchError) {
      setStatus(status, switchError instanceof Error ? switchError.message : String(switchError), 'error');
    }
  }, { secondary: true });

  const networkSelectorButton = createButton('네트워크 선택 열기', async () => {
    try {
      setStatus(status, 'Reown 네트워크 선택 화면을 여는 중입니다…');
      await openWalletNetworkSelector();
      setStatus(status, `네트워크 선택 화면에서 주문 체인(${chainId})을 선택한 뒤 이 카드로 돌아와주세요.`, 'ok');
    } catch (networkError) {
      setStatus(status, networkError instanceof Error ? networkError.message : String(networkError), 'error');
    }
  }, { secondary: true });

  const actions = document.createElement('div');
  actions.className = 'spot-plugin-actions';
  actions.append(connectButton, switchButton, networkSelectorButton, continueButton);

  card.append(header, body, actions, status);
  parent.append(card);
}

registerCodeBlockPlugin({
  language: 'spot-wallet-intent',
  render: renderSpotWalletIntent,
});
