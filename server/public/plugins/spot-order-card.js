import { registerCodeBlockPlugin } from './plugin-registry.js';
import { getWalletAccounts, getWalletMode, openWalletNetworkSelector, requestWallet, requestWalletAccounts, revokeWalletPermissionsIfSupported as revokeSharedWalletPermissionsIfSupported, subscribeWalletAccounts, switchWalletChain } from './wallet-provider.js';

const MIN_DEADLINE_REMAINING_SECONDS = 60;
const MAX_NONCE_OR_START_AGE_SECONDS = 15 * 60;

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

function readInteger(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatEpoch(epochSeconds) {
  try {
    return `${epochSeconds} (${new Date(epochSeconds * 1000).toISOString()})`;
  } catch {
    return String(epochSeconds);
  }
}

function validateTypedDataFreshness(typedData, nowSeconds = Math.floor(Date.now() / 1000)) {
  const message = typedData?.message || {};
  const witness = message?.witness || {};
  const deadline = readInteger(witness.deadline ?? message.deadline);
  if (!deadline) {
    return 'typedData.deadline을 확인할 수 없어 서명을 차단했습니다.';
  }
  if (deadline - nowSeconds < MIN_DEADLINE_REMAINING_SECONDS) {
    return `typedData deadline이 이미 만료되었거나 너무 임박했습니다. deadline=${formatEpoch(deadline)}, 현재=${formatEpoch(nowSeconds)}`;
  }

  const oldestAllowed = nowSeconds - MAX_NONCE_OR_START_AGE_SECONDS;
  const nonce = readInteger(witness.nonce ?? message.nonce);
  const start = readInteger(witness.start);
  if (nonce && nonce < oldestAllowed) {
    return `typedData nonce가 너무 오래되었습니다. nonce=${formatEpoch(nonce)}, 현재=${formatEpoch(nowSeconds)}`;
  }
  if (start && start < oldestAllowed) {
    return `typedData start가 너무 오래되었습니다. start=${formatEpoch(start)}, 현재=${formatEpoch(nowSeconds)}`;
  }
  return '';
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

async function revokeWalletPermissionsIfSupported() {
  return revokeSharedWalletPermissionsIfSupported();
}

async function waitForWalletChain(expectedChainId, timeoutMs = 10_000) {
  const expected = `0x${BigInt(expectedChainId).toString(16)}`.toLowerCase();
  const startedAt = Date.now();
  let actual = '';
  while (Date.now() - startedAt < timeoutMs) {
    actual = String(await requestWallet('eth_chainId')).toLowerCase();
    if (actual === expected) {
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new Error(`지갑 네트워크가 주문 체인과 일치하지 않습니다. 주문=${expected}, 현재=${actual || '확인 불가'}. 체인 전환을 승인한 뒤 다시 시도해주세요.`);
}

async function switchChain(chainId) {
  await switchWalletChain(chainId);
  await waitForWalletChain(chainId);
}

function bigintFromNumberish(value, fieldName = '값') {
  const text = String(value ?? '').trim();
  if (!text || text === '0x') {
    return 0n;
  }
  try {
    return BigInt(text);
  } catch {
    throw new Error(`${fieldName}을 정수로 변환할 수 없습니다: ${text}`);
  }
}

function uint256Hex(value) {
  return bigintFromNumberish(value, 'uint256 값').toString(16).padStart(64, '0');
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

function bigintFromRpcQuantity(value) {
  return bigintFromNumberish(value, 'RPC quantity');
}

async function getAllowance({ token, owner, spender }) {
  const data = encodeAllowanceCall(owner, spender);
  const result = await requestWallet('eth_call', [{ to: token, data }, 'latest']);
  return bigintFromRpcQuantity(result);
}

async function waitForTransactionReceipt(txHash, timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await requestWallet('eth_getTransactionReceipt', [txHash]);
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
  const required = bigintFromNumberish(amount, 'approve 수량');
  if (allowance >= required) {
    onStatus?.('토큰 접근 권한 확인 완료. 추가 approve 없이 서명할 수 있습니다.', 'ok');
    return { approved: false, allowance: allowance.toString() };
  }

  onStatus?.('토큰 접근 권한이 부족합니다. exact approve 트랜잭션을 요청합니다…');
  const txHash = await requestWallet('eth_sendTransaction', [{
    from: account,
    to: token,
    data: encodeApproveCall(spender, required),
  }]);
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
  typedData.types.EIP712Domain = [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ];
  return requestWallet('eth_signTypedData_v4', [account, JSON.stringify(typedData)]);
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
  const freshnessError = validateTypedDataFreshness(typedData);

  const card = document.createElement('section');
  card.className = 'spot-plugin-card';

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
  setStatus(status, freshnessError
    ? `서명 차단: ${freshnessError} 새 주문 카드를 다시 생성하세요.`
    : getWalletMode() === 'injected'
      ? '서명 전 요약을 확인한 뒤 서명하면 주문이 바로 제출됩니다.'
      : '서명 전 요약을 확인한 뒤 Reown AppKit으로 모바일 지갑을 연결하고 서명하면 주문이 바로 제출됩니다.', freshnessError ? 'error' : '');

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
      setStatus(status, freshnessError ? `연결됨: ${connectedAccount}. 단, 서명 차단: ${freshnessError} 새 주문 카드를 다시 생성하세요.` : `연결됨: ${connectedAccount}`, freshnessError ? 'error' : 'ok');
    }
  }
  async function hydrateConnectedAccount() {
    try {
      const accounts = await getWalletAccounts();
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
      const accounts = await requestAccounts(chainId);
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
  });
  subscribeWalletAccounts((accounts) => {
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

  async function prepareConnectedAccount() {
    if (!connectedAccount) {
      const accounts = await requestAccounts(chainId);
      connectedAccount = accounts?.[0] || '';
    }
    if (!connectedAccount) {
      throw new Error('서명할 계정을 찾지 못했습니다.');
    }
    if (!swapperMatchesAccount(swapper, connectedAccount)) {
      throw new Error(`서명 지갑과 주문 swapper가 일치하지 않습니다. 연결=${connectedAccount}, swapper=${swapper}`);
    }
    const currentFreshnessError = validateTypedDataFreshness(typedData);
    if (currentFreshnessError) {
      throw new Error(`서명 차단: ${currentFreshnessError} 새 주문 카드를 다시 생성하세요.`);
    }
    if (!chainId || !inputToken || !inputMaxAmount || !verifyingContract) {
      throw new Error('approve/서명에 필요한 typedData 필드가 부족합니다.');
    }
    setStatus(status, '체인을 확인하는 중입니다…');
    await switchChain(chainId);
    return connectedAccount;
  }

  async function approveOnly() {
    const account = await prepareConnectedAccount();
    await ensureExactApproval({
      account,
      token: inputToken,
      spender: verifyingContract,
      amount: inputMaxAmount,
      onStatus: (message, kind) => setStatus(status, message, kind),
    });
    setStatus(status, 'Approve 확인 완료. 이제 서명 후 제출할 수 있습니다.', 'ok');
  }

  async function prepareSignature() {
    const account = await prepareConnectedAccount();
    await ensureExactApproval({
      account,
      token: inputToken,
      spender: verifyingContract,
      amount: inputMaxAmount,
      onStatus: (message, kind) => setStatus(status, message, kind),
    });
    return signTypedData(account, typedData);
  }

  actions.append(
    connectButton,
    createButton('체인 전환', async () => {
      try {
        if (!chainId) {
          throw new Error('주문 chainId를 확인할 수 없습니다.');
        }
        setStatus(status, `주문 체인(${chainId})으로 전환을 요청합니다…`);
        await switchChain(chainId);
        setStatus(status, `주문 체인(${chainId}) 전환 확인 완료.`, 'ok');
      } catch (switchError) {
        setStatus(status, switchError instanceof Error ? switchError.message : String(switchError), 'error');
      }
    }, { disabled: Boolean(freshnessError), secondary: true }),
    createButton('네트워크 선택 열기', async () => {
      try {
        setStatus(status, 'Reown 네트워크 선택 화면을 여는 중입니다…');
        await openWalletNetworkSelector();
        setStatus(status, `네트워크 선택 화면에서 Ethereum을 선택한 뒤 이 카드로 돌아와주세요. 주문 체인=${chainId}`, 'ok');
      } catch (networkError) {
        setStatus(status, networkError instanceof Error ? networkError.message : String(networkError), 'error');
      }
    }, { disabled: Boolean(freshnessError), secondary: true }),
    createButton('주소 복사', async () => {
      if (!connectedAccount) {
        setStatus(status, '먼저 지갑을 연결하세요.', 'warn');
        return;
      }
      await context.copyTextToClipboard?.(connectedAccount);
      setStatus(status, '연결된 주소를 복사했습니다.', 'ok');
    }, { secondary: true }),
    createButton('Approve', async () => {
      try {
        await approveOnly();
      } catch (approveError) {
        setStatus(status, approveError instanceof Error ? approveError.message : String(approveError), 'error');
      }
    }, { disabled: Boolean(freshnessError), secondary: true }),
    createButton('서명 후 바로 제출', async () => {
      try {
        const signature = await prepareSignature();
        setStatus(status, '서명 완료. 주문을 제출하는 중입니다…');
        const result = await submitSignedOrder(context, typedData, signature, connectedAccount);
        setStatus(status, result?.relay_order_hash ? `제출 완료: ${result.relay_order_hash}` : '제출 완료. 대화 기록을 확인하세요.', 'ok');
        await context.refreshHistory?.();
      } catch (signError) {
        setStatus(status, signError instanceof Error ? signError.message : String(signError), 'error');
      }
    }, { disabled: Boolean(freshnessError) }),
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
