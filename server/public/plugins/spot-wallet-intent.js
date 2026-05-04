import { registerCodeBlockPlugin } from './plugin-registry.js';

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

function isMobileWalletUnsupported() {
  return window.matchMedia?.('(pointer: coarse)')?.matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
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

async function requestAccounts() {
  if (!window.ethereum?.request) {
    throw new Error('브라우저 지갑을 찾지 못했습니다. MetaMask가 필요합니다.');
  }
  return window.ethereum.request({ method: 'eth_requestAccounts' });
}

async function switchChain(chainId) {
  if (!window.ethereum?.request) {
    throw new Error('브라우저 지갑을 찾지 못했습니다.');
  }
  const targetChainId = `0x${BigInt(chainId).toString(16)}`;
  const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
  if (String(currentChainId).toLowerCase() === targetChainId.toLowerCase()) {
    return;
  }
  await window.ethereum.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: targetChainId }],
  });
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

async function getErc20Balance({ token, owner }) {
  const result = await window.ethereum.request({
    method: 'eth_call',
    params: [{ to: token, data: encodeBalanceOfCall(owner) }, 'latest'],
  });
  return BigInt(result || '0x0').toString();
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
  const mobileUnsupported = isMobileWalletUnsupported();

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
  setStatus(status, mobileUnsupported
    ? '현재 지갑 기반 주문 준비는 PC 브라우저에서만 사용할 수 있습니다.'
    : '지갑을 연결하면 swapper와 잔액을 확인해 주문 생성을 이어갑니다.');

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
      const accounts = await requestAccounts();
      connectedAccount = accounts?.[0] || '';
      updateButton();
      setStatus(status, connectedAccount ? `연결됨: ${connectedAccount}` : '연결된 계정이 없습니다.', connectedAccount ? 'ok' : 'warn');
    } catch (connectError) {
      setStatus(status, connectError instanceof Error ? connectError.message : String(connectError), 'error');
    }
  }, { disabled: mobileUnsupported });

  const continueButton = createButton('잔액 확인 후 주문 생성', async () => {
    try {
      if (!connectedAccount) {
        const accounts = await requestAccounts();
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
  }, { disabled: mobileUnsupported });

  const actions = document.createElement('div');
  actions.className = 'spot-plugin-actions';
  actions.append(connectButton, continueButton);

  card.append(header, body, actions, status);
  parent.append(card);
}

registerCodeBlockPlugin({
  language: 'spot-wallet-intent',
  render: renderSpotWalletIntent,
});
