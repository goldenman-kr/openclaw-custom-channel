import { registerCodeBlockPlugin } from './plugin-registry.js';

function parsePayload(codeText) {
  try {
    return { data: JSON.parse(codeText), error: null };
  } catch (error) {
    return { data: null, error };
  }
}

function compactAddress(value) {
  const address = String(value || '');
  return address.length > 14 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address || '-';
}

function normalizeAddress(value) {
  const address = String(value || '').trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : '';
}

function isZeroAddress(value) {
  return normalizeAddress(value) === '0x0000000000000000000000000000000000000000';
}

function shouldValidateSwapper(value) {
  return Boolean(normalizeAddress(value)) && !isZeroAddress(value);
}

function swapperMatchesAccount(swapper, account) {
  if (!shouldValidateSwapper(swapper)) {
    return true;
  }
  return normalizeAddress(account) === normalizeAddress(swapper);
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

async function revokeWalletPermissionsIfSupported() {
  if (!window.ethereum?.request) {
    return false;
  }
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

function uint256Hex(value) {
  return BigInt(value).toString(16).padStart(64, '0');
}

function addressParam(address) {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    throw new Error(`잘못된 주소입니다: ${address}`);
  }
  return normalized.slice(2).padStart(64, '0');
}

function encodeAllowanceCall(owner, spender) {
  return `0xdd62ed3e${addressParam(owner)}${addressParam(spender)}`;
}

function encodeApproveCall(spender, amount) {
  return `0x095ea7b3${addressParam(spender)}${uint256Hex(amount)}`;
}

async function getAllowance({ token, owner, spender }) {
  const data = encodeAllowanceCall(owner, spender);
  const result = await window.ethereum.request({
    method: 'eth_call',
    params: [{ to: token, data }, 'latest'],
  });
  return BigInt(result || '0x0');
}

async function waitForTransactionReceipt(txHash, timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await window.ethereum.request({
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    });
    if (receipt) {
      if (receipt.status && String(receipt.status).toLowerCase() !== '0x1') {
        throw new Error(`Approve 트랜잭션이 실패했습니다: ${txHash}`);
      }
      return receipt;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
  }
  throw new Error(`Approve 트랜잭션 확인 시간이 초과되었습니다: ${txHash}`);
}

async function ensureExactApproval({ account, token, spender, amount, onStatus }) {
  const allowance = await getAllowance({ token, owner: account, spender });
  const required = BigInt(amount);
  if (allowance >= required) {
    onStatus?.('토큰 접근 권한 확인 완료. 추가 approve 없이 서명할 수 있습니다.', 'ok');
    return { approved: false, allowance: allowance.toString() };
  }

  onStatus?.('토큰 접근 권한이 부족합니다. exact approve 트랜잭션을 요청합니다…');
  const txHash = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{
      from: account,
      to: token,
      data: encodeApproveCall(spender, required),
    }],
  });
  onStatus?.(`Approve 전송됨. 확인 중입니다: ${txHash}`);
  await waitForTransactionReceipt(txHash);
  onStatus?.('Approve 확인 완료. 이제 서명합니다.', 'ok');
  return { approved: true, txHash };
}

function conversationIdFromLocation() {
  const match = window.location.pathname.match(/^\/chat\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function submitSignedOrder(context, typedData, signature, signer) {
  const conversationId = context.activeConversationId?.() || conversationIdFromLocation();
  if (!conversationId) {
    throw new Error('활성 대화 ID를 찾지 못했습니다.');
  }
  return context.apiJson?.('/v1/plugins/spot/orders/submit-signed', {
    method: 'POST',
    body: { conversation_id: conversationId, typedData, signature, signer },
  });
}

async function signTypedData(account, typedData) {
  if (!window.ethereum?.request) {
    throw new Error('브라우저 지갑을 찾지 못했습니다.');
  }
  typedData.types.EIP712Domain = [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ];
  return window.ethereum.request({
    method: 'eth_signTypedData_v4',
    params: [account, JSON.stringify(typedData)],
  });
}

function isMobileWalletUnsupported() {
  return window.matchMedia?.('(pointer: coarse)')?.matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function renderSpotOrderCard({ parent, codeText, context, fallback }) {
  const { data, error } = parsePayload(codeText);
  if (error || !data || typeof data !== 'object' || !data.typedData) {
    fallback();
    return;
  }

  const typedData = data.typedData;
  const chainId = typedData?.domain?.chainId;
  const verifyingContract = typedData?.domain?.verifyingContract;
  const swapper = typedData?.message?.witness?.swapper || typedData?.message?.swapper;
  const inputToken = typedData?.message?.witness?.input?.token || typedData?.message?.permitted?.token;
  const inputMaxAmount = typedData?.message?.witness?.input?.maxAmount || typedData?.message?.permitted?.amount;

  const card = document.createElement('section');
  card.className = 'spot-plugin-card';
  const mobileUnsupported = isMobileWalletUnsupported();

  const header = document.createElement('div');
  header.className = 'spot-plugin-header';
  const title = document.createElement('strong');
  title.textContent = data.title || 'Spot 주문 서명';
  const badge = document.createElement('span');
  badge.className = 'spot-plugin-badge';
  badge.textContent = 'plugin: spot-order-card';
  header.append(title, badge);

  const body = document.createElement('div');
  body.className = 'spot-plugin-body';
  appendField(body, 'Chain', String(chainId || '-'));
  appendField(body, 'Swapper', compactAddress(swapper));
  appendField(body, 'Verifier', compactAddress(verifyingContract));
  appendField(body, 'Input token', compactAddress(inputToken));
  appendField(body, 'Max amount', String(inputMaxAmount || '-'));

  const status = document.createElement('p');
  status.className = 'spot-plugin-status';
  setStatus(status, mobileUnsupported
    ? '현재 Spot 지갑 서명 플러그인은 PC 브라우저에서만 사용할 수 있습니다. 모바일 지갑 연동은 추후 검토 예정입니다.'
    : '서명 전 요약을 확인한 뒤 서명하면 주문이 바로 제출됩니다.');

  const actions = document.createElement('div');
  actions.className = 'spot-plugin-actions';

  let connectedAccount = '';
  let connectButton;
  function updateConnectedAccount(account, options = {}) {
    connectedAccount = account || '';
    if (connectButton) {
      connectButton.textContent = connectedAccount ? '연결 끊기' : '지갑 연결';
      connectButton.setAttribute('aria-pressed', connectedAccount ? 'true' : 'false');
    }
    if (connectedAccount && !options.silent) {
      setStatus(status, `연결됨: ${connectedAccount}`, 'ok');
    }
  }
  async function hydrateConnectedAccount() {
    if (mobileUnsupported || !window.ethereum?.request) {
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      const account = accounts?.[0] || '';
      updateConnectedAccount(account, { silent: true });
    } catch {
      // Silent hydration only; explicit connect surfaces errors.
    }
  }
  connectButton = createButton('지갑 연결', async () => {
    try {
      if (connectedAccount) {
        const revoked = await revokeWalletPermissionsIfSupported();
        updateConnectedAccount('');
        setStatus(status, revoked ? '지갑 연결을 해제했습니다.' : '이 카드의 지갑 연결 상태를 해제했습니다.', 'ok');
        return;
      }
      const accounts = await requestAccounts();
      const account = accounts?.[0] || '';
      updateConnectedAccount(account);
      if (normalizeAddress(account) && !swapperMatchesAccount(swapper, account)) {
        setStatus(status, `연결됨. 단, 주문 swapper와 달라 서명은 중단됩니다. 연결=${account}, swapper=${swapper}`, 'warn');
        return;
      }
      if (!account) {
        setStatus(status, '연결된 계정이 없습니다.', 'warn');
      }
    } catch (connectError) {
      setStatus(status, connectError instanceof Error ? connectError.message : String(connectError), 'error');
    }
  }, { disabled: mobileUnsupported });
  window.ethereum?.on?.('accountsChanged', (accounts) => {
    const account = accounts?.[0] || '';
    updateConnectedAccount(account);
    if (normalizeAddress(account) && !swapperMatchesAccount(swapper, account)) {
      setStatus(status, `연결됨. 단, 주문 swapper와 달라 서명은 중단됩니다. 연결=${account}, swapper=${swapper}`, 'warn');
      return;
    }
    if (!account) {
      setStatus(status, '지갑 연결이 해제되었습니다.', 'warn');
    }
  });
  hydrateConnectedAccount();

  actions.append(
    connectButton,
    createButton('주소 복사', async () => {
      if (!connectedAccount) {
        setStatus(status, '먼저 지갑을 연결하세요.', 'warn');
        return;
      }
      await context.copyTextToClipboard?.(connectedAccount);
      setStatus(status, '연결된 주소를 복사했습니다.', 'ok');
    }, { secondary: true, disabled: mobileUnsupported }),
    createButton('서명 후 바로 제출', async () => {
      try {
        if (!connectedAccount) {
          const accounts = await requestAccounts();
          connectedAccount = accounts?.[0] || '';
        }
        if (!connectedAccount) {
          throw new Error('서명할 계정을 찾지 못했습니다.');
        }
        if (!swapperMatchesAccount(swapper, connectedAccount)) {
          throw new Error(`서명 지갑과 주문 swapper가 일치하지 않습니다. 연결=${connectedAccount}, swapper=${swapper}`);
        }
        if (!chainId || !inputToken || !inputMaxAmount || !verifyingContract) {
          throw new Error('approve/서명에 필요한 typedData 필드가 부족합니다.');
        }
        setStatus(status, '체인을 확인하는 중입니다…');
        await switchChain(chainId);
        await ensureExactApproval({
          account: connectedAccount,
          token: inputToken,
          spender: verifyingContract,
          amount: inputMaxAmount,
          onStatus: (message, kind) => setStatus(status, message, kind),
        });
        const signature = await signTypedData(connectedAccount, typedData);
        setStatus(status, '서명 완료. 주문을 제출하는 중입니다…');
        const result = await submitSignedOrder(context, typedData, signature, connectedAccount);
        setStatus(status, result?.relay_order_hash ? `제출 완료: ${result.relay_order_hash}` : '제출 완료. 대화 기록을 확인하세요.', 'ok');
        await context.refreshHistory?.();
      } catch (signError) {
        setStatus(status, signError instanceof Error ? signError.message : String(signError), 'error');
      }
    }, { disabled: mobileUnsupported }),
    createButton('TypedData 복사', async () => {
      try {
        await context.copyTextToClipboard?.(JSON.stringify(typedData, null, 2));
        setStatus(status, 'TypedData를 복사했습니다.', 'ok');
      } catch (copyError) {
        setStatus(status, copyError instanceof Error ? copyError.message : String(copyError), 'error');
      }
    }, { secondary: true }),
  );

  card.append(header, body, actions, status);
  parent.append(card);
}

registerCodeBlockPlugin({
  language: 'spot-order-card',
  render: renderSpotOrderCard,
});
