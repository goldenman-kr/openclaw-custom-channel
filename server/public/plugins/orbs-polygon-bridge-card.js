import { registerCodeBlockPlugin } from './plugin-registry.js';
import { getWalletAccounts, getWalletMode, requestWallet, requestWalletAccounts, revokeWalletPermissionsIfSupported, subscribeWalletAccounts, switchWalletChain } from './wallet-provider.js';

const ETH_CHAIN_ID = 1;
const POLYGON_CHAIN_ID = 137;
const ETH_CONTRACT_ORBS = '0xff56Cc6b1E6dEd347aA0B7676C85AB0B3D08B0FA';
const POLYGON_CONTRACT_ORBS = '0x614389eaae0a6821dc49062d56bda3d9d45fa2ff';
const ETH_CONTRACT_BRIDGE = '0xa0c68c638235ee32657e8f720a23cec1bfc77c77';
const ETH_CONTRACT_BRIDGE_ERC20 = '0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf';
const ORBS_DECIMALS = 18;
const WITHDRAW_TRANSFER_EVENT_SIGNATURE = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

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

function strip0x(value) {
  return String(value || '').startsWith('0x') ? String(value).slice(2) : String(value || '');
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

function bytesEncoding(hexBytes) {
  const clean = strip0x(hexBytes);
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('bytes hex 값이 올바르지 않습니다.');
  }
  const paddedLength = Math.ceil(clean.length / 64) * 64;
  return `${uint256Hex(clean.length / 2)}${clean.padEnd(paddedLength, '0')}`;
}

function parseUnits(value, decimals = ORBS_DECIMALS) {
  const text = String(value || '').trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) {
    throw new Error(`잘못된 ORBS 수량입니다: ${value}`);
  }
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) {
    throw new Error(`${decimals}자리보다 많은 소수점은 지원하지 않습니다.`);
  }
  const parsed = BigInt(whole) * 10n ** BigInt(decimals)
    + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals));
  if (parsed <= 0n) {
    throw new Error('브릿지 수량은 0보다 커야 합니다.');
  }
  return parsed;
}

function formatUnits(value, decimals = ORBS_DECIMALS) {
  const raw = bigintFromNumberish(value, '토큰 수량');
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const fraction = raw % scale;
  if (fraction === 0n) return whole.toString();
  const padded = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  const trimmed = padded.slice(0, 8).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

function encodeBalanceOfCall(owner) {
  return `0x70a08231${addressParam(owner)}`;
}

function encodeAllowanceCall(owner, spender) {
  return `0xdd62ed3e${addressParam(owner)}${addressParam(spender)}`;
}

function encodeApproveCall(spender, amount) {
  return `0x095ea7b3${addressParam(spender)}${uint256Hex(amount)}`;
}

function encodeDepositForCall(user, amount) {
  return `0xe3dec8fb${addressParam(user)}${addressParam(ETH_CONTRACT_ORBS)}${uint256Hex(96n)}${uint256Hex(32n)}${uint256Hex(amount)}`;
}

function encodeWithdrawCall(amount) {
  return `0x2e1a7d4d${uint256Hex(amount)}`;
}

function encodeExitCall(payload) {
  return `0x3805550f${uint256Hex(32n)}${bytesEncoding(payload)}`;
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
  return valueNode;
}

function setStatus(statusNode, message, kind = '') {
  statusNode.textContent = message;
  statusNode.dataset.kind = kind;
}

function pendingStorageKey(account, direction) {
  return `orbs-polygon-bridge:${direction}:${normalizeAddress(account)}`;
}

function isTerminalBridgeState(value) {
  const state = String(value?.state || '').toLowerCase();
  return state === 'completed' || state === 'failed';
}

function normalizeTxHash(value) {
  const txHash = String(value || '').trim().toLowerCase();
  return /^0x[0-9a-f]+$/.test(txHash) ? txHash : '';
}

function readPending(account, direction) {
  const key = pendingStorageKey(account, direction);
  try {
    const value = JSON.parse(window.localStorage?.getItem(key) || 'null');
    if (isTerminalBridgeState(value)) {
      window.localStorage?.removeItem(key);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function normalizeRemoteRecord(record) {
  if (!record || typeof record !== 'object') return null;
  return {
    id: record.id || '',
    txHash: record.source_tx_hash || '',
    blockNumber: record.source_block_number || '',
    amount: record.amount || '',
    exitPayload: record.exit_payload || '',
    exitTxHash: record.exit_tx_hash || '',
    state: record.state || '',
    updatedAt: record.updated_at || '',
  };
}

function readStringField(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizePayloadPending(data, direction) {
  if (direction !== 'polygon-to-ethereum' || !data || typeof data !== 'object') return null;
  const nested = data.pendingWithdraw && typeof data.pendingWithdraw === 'object' ? data.pendingWithdraw : {};
  const txHash = readStringField(data, ['PENDING_TXID', 'sourceTxHash', 'source_tx_hash', 'withdrawTxHash', 'withdraw_tx_hash', 'txHash', 'tx_hash'])
    || readStringField(nested, ['PENDING_TXID', 'sourceTxHash', 'source_tx_hash', 'withdrawTxHash', 'withdraw_tx_hash', 'txHash', 'tx_hash']);
  const blockNumber = readStringField(data, ['BLOCKHEIGHT_WITHDRAW_TARGET', 'sourceBlockNumber', 'source_block_number', 'blockNumber', 'block_number'])
    || readStringField(nested, ['BLOCKHEIGHT_WITHDRAW_TARGET', 'sourceBlockNumber', 'source_block_number', 'blockNumber', 'block_number']);
  const exitPayload = readStringField(data, ['RETURN_PAYLOAD', 'exitPayload', 'exit_payload'])
    || readStringField(nested, ['RETURN_PAYLOAD', 'exitPayload', 'exit_payload']);
  const exitTxHash = readStringField(data, ['exitTxHash', 'exit_tx_hash'])
    || readStringField(nested, ['exitTxHash', 'exit_tx_hash']);
  const state = readStringField(data, ['state']) || readStringField(nested, ['state']);
  if (!/^0x[0-9a-fA-F]+$/.test(txHash)) return null;
  const pending = { txHash, createdAt: Date.now() };
  if (/^(?:0|[1-9]\d*)$/.test(blockNumber)) pending.blockNumber = blockNumber;
  if (/^0x[0-9a-fA-F]+$/.test(exitPayload)) pending.exitPayload = exitPayload;
  if (/^0x[0-9a-fA-F]+$/.test(exitTxHash)) pending.exitTxHash = exitTxHash;
  if (state) pending.state = state;
  return pending;
}

function pendingToApiBody(pending, { conversationId, account, direction, amount, sourceChainId, state }) {
  return {
    ...(conversationId ? { conversation_id: conversationId } : {}),
    account,
    direction,
    amount: amount.toString(),
    source_chain_id: sourceChainId,
    source_tx_hash: pending.txHash,
    source_block_number: pending.blockNumber,
    ...(pending.exitPayload ? { exit_payload: pending.exitPayload } : {}),
    ...(pending.exitTxHash ? { exit_tx_hash: pending.exitTxHash } : {}),
    state: state || pending.state || (pending.exitPayload ? 'checkpoint-ready' : 'source-confirmed'),
  };
}

function writePending(account, direction, value) {
  try {
    window.localStorage?.setItem(pendingStorageKey(account, direction), JSON.stringify(value));
  } catch {
    // Persistence is best-effort only.
  }
}

function bigintFromRpcQuantity(value) {
  return bigintFromNumberish(value, 'RPC quantity');
}

async function getErc20Balance({ token, owner }) {
  const result = await requestWallet('eth_call', [{ to: token, data: encodeBalanceOfCall(owner) }, 'latest']);
  return bigintFromRpcQuantity(result);
}

async function getAllowance({ owner, spender }) {
  const result = await requestWallet('eth_call', [{ to: ETH_CONTRACT_ORBS, data: encodeAllowanceCall(owner, spender) }, 'latest']);
  return bigintFromRpcQuantity(result);
}

async function waitForTransactionReceipt(txHash, timeoutMs = 180_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await requestWallet('eth_getTransactionReceipt', [txHash]);
    if (receipt) {
      if (receipt.status && String(receipt.status).toLowerCase() !== '0x1') {
        throw new Error(`트랜잭션이 실패했습니다: ${txHash}`);
      }
      return receipt;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 3_000));
  }
  throw new Error(`트랜잭션 확인 시간이 초과되었습니다: ${txHash}`);
}

async function fetchCheckpointStatus(blockNumber) {
  const response = await fetch(`https://proof-generator.polygon.technology/api/v1/matic/block-included/${blockNumber}`);
  if (!response.ok) {
    throw new Error(`체크포인트 확인 실패: HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchExitPayload(txHash) {
  const response = await fetch(`https://proof-generator.polygon.technology/api/v1/matic/exit-payload/${txHash}?eventSignature=${WITHDRAW_TRANSFER_EVENT_SIGNATURE}`);
  if (!response.ok) {
    throw new Error(`exit payload 조회 실패: HTTP ${response.status}`);
  }
  const json = await response.json();
  const payload = typeof json?.result === 'string' && json.result.startsWith('0x')
    ? json.result
    : typeof json?.message === 'string' && json.message.startsWith('0x')
      ? json.message
      : '';
  if (!payload) {
    throw new Error('exit payload 응답이 올바르지 않습니다.');
  }
  return payload;
}

function normalizeDirection(direction) {
  const value = String(direction || 'ethereum-to-polygon').toLowerCase();
  if (['ethereum-to-polygon', 'eth-to-pol', 'eth-to-polygon'].includes(value)) return 'ethereum-to-polygon';
  if (['polygon-to-ethereum', 'pol-to-eth', 'polygon-to-eth'].includes(value)) return 'polygon-to-ethereum';
  return '';
}

function renderOrbsPolygonBridgeCard({ parent, codeText, context = {}, fallback }) {
  const { data, error } = parsePayload(codeText);
  if (error || !data || typeof data !== 'object') {
    fallback();
    return;
  }
  const direction = normalizeDirection(data.direction);
  if (!direction) {
    fallback();
    return;
  }

  let amount;
  try {
    amount = parseUnits(data.amount || '10');
  } catch (parseError) {
    const card = document.createElement('section');
    card.className = 'spot-plugin-card';
    const status = document.createElement('p');
    status.className = 'spot-plugin-status';
    setStatus(status, parseError instanceof Error ? parseError.message : String(parseError), 'error');
    card.append(status);
    parent.append(card);
    return;
  }

  const isEthToPolygon = direction === 'ethereum-to-polygon';
  const sourceChainId = isEthToPolygon ? ETH_CHAIN_ID : POLYGON_CHAIN_ID;
  const sourceToken = isEthToPolygon ? ETH_CONTRACT_ORBS : POLYGON_CONTRACT_ORBS;
  const directionLabel = isEthToPolygon ? 'Ethereum → Polygon' : 'Polygon → Ethereum';
  const forceNewBridge = data.forceNew === true || data.ignorePending === true || data.mode === 'new';
  const payloadPendingWithdraw = forceNewBridge ? null : normalizePayloadPending(data, direction);

  const card = document.createElement('section');
  card.className = 'spot-plugin-card';

  const header = document.createElement('div');
  header.className = 'spot-plugin-header';
  const title = document.createElement('strong');
  title.textContent = data.title || 'ORBS Polygon 브릿지';
  const badge = document.createElement('span');
  badge.className = 'spot-plugin-badge';
  badge.textContent = 'plugin: orbs-polygon-bridge-card';
  header.append(title, badge);

  const body = document.createElement('div');
  body.className = 'spot-plugin-body';
  appendField(body, 'Direction', directionLabel);
  appendField(body, 'Amount', `${formatUnits(amount)} ORBS`);
  appendField(body, 'Source token', compactAddress(sourceToken));
  appendField(body, 'Destination token', compactAddress(isEthToPolygon ? POLYGON_CONTRACT_ORBS : ETH_CONTRACT_ORBS));
  if (isEthToPolygon) {
    appendField(body, 'Bridge', compactAddress(ETH_CONTRACT_BRIDGE));
    appendField(body, 'Approve spender', compactAddress(ETH_CONTRACT_BRIDGE_ERC20));
  } else {
    appendField(body, 'Withdraw contract', compactAddress(POLYGON_CONTRACT_ORBS));
    appendField(body, 'Exit contract', compactAddress(ETH_CONTRACT_BRIDGE));
  }
  const accountField = appendField(body, 'Wallet', '-');
  const balanceField = appendField(body, `${isEthToPolygon ? 'ETH' : 'Polygon'} ORBS balance`, '-');
  const allowanceField = isEthToPolygon ? appendField(body, 'Allowance', '-') : null;
  const pendingField = isEthToPolygon ? null : appendField(body, 'Pending withdraw', '-');

  const status = document.createElement('p');
  status.className = 'spot-plugin-status';
  setStatus(status, getWalletMode() === 'injected'
    ? '지갑을 연결한 뒤 잔고를 확인하세요. 모든 전송은 연결된 지갑에서 직접 서명합니다.'
    : 'Reown AppKit으로 모바일 지갑을 연결한 뒤 잔고를 확인하세요. 모든 전송은 연결된 지갑에서 직접 서명합니다.');

  let connectedAccount = '';
  let balance = 0n;
  let allowance = 0n;
  let pendingWithdraw = null;
  let connectButton;
  let approveButton;
  let bridgeButton;
  let checkpointButton;
  let exitButton;

  function activeConversationId() {
    return context.activeConversationId?.() || '';
  }

  async function loadRemotePending() {
    if (isEthToPolygon || !context.apiJson || !normalizeAddress(connectedAccount)) return null;
    const query = new URLSearchParams({ account: normalizeAddress(connectedAccount), active: '0' });
    const result = await context.apiJson(`/v1/plugins/orbs-bridge/records?${query.toString()}`);
    const records = Array.isArray(result?.records) ? result.records : [];
    const localTxHash = normalizeTxHash(pendingWithdraw?.txHash);
    if (localTxHash) {
      const currentRecord = records.find((record) => record.direction === direction && normalizeTxHash(record.source_tx_hash) === localTxHash);
      if (isTerminalBridgeState(currentRecord)) {
        try {
          window.localStorage?.removeItem(pendingStorageKey(connectedAccount, direction));
        } catch {
          // best-effort only
        }
        pendingWithdraw = null;
        return null;
      }
    }
    const match = records.find((record) => record.direction === direction && record.source_tx_hash && !isTerminalBridgeState(record));
    return normalizeRemoteRecord(match);
  }

  async function saveRemotePending(state) {
    if (isEthToPolygon || !context.apiJson || !normalizeAddress(connectedAccount) || !pendingWithdraw?.txHash) return null;
    const result = await context.apiJson('/v1/plugins/orbs-bridge/records', {
      method: 'POST',
      body: pendingToApiBody(pendingWithdraw, {
        conversationId: activeConversationId(),
        account: connectedAccount,
        direction,
        amount,
        sourceChainId,
        state,
      }),
    });
    const remote = normalizeRemoteRecord(result?.record);
    if (remote?.id) {
      pendingWithdraw = { ...pendingWithdraw, ...remote };
      writePending(connectedAccount, direction, pendingWithdraw);
      renderPending();
      updateButtons();
    }
    return remote;
  }

  function renderPending() {
    if (!pendingField) return;
    if (!pendingWithdraw?.txHash) {
      pendingField.textContent = '-';
      return;
    }
    const checkpointText = pendingWithdraw.exitPayload ? 'exit payload 준비됨' : pendingWithdraw.blockNumber ? `block ${pendingWithdraw.blockNumber}` : 'block 확인 필요';
    pendingField.textContent = `${compactAddress(pendingWithdraw.txHash)} / ${checkpointText}`;
  }

  function updateButtons() {
    if (connectButton) {
      connectButton.textContent = connectedAccount ? '연결 끊기' : '지갑 연결';
      connectButton.setAttribute('aria-pressed', connectedAccount ? 'true' : 'false');
    }
    if (approveButton) {
      approveButton.disabled = !(connectedAccount && balance >= amount && allowance < amount);
    }
    if (bridgeButton) {
      bridgeButton.disabled = isEthToPolygon
        ? !(connectedAccount && balance >= amount && allowance >= amount)
        : !(connectedAccount && balance >= amount && !pendingWithdraw?.txHash);
    }
    if (checkpointButton) {
      checkpointButton.disabled = !pendingWithdraw?.txHash || !pendingWithdraw?.blockNumber;
    }
    if (exitButton) {
      const hasExitStarted = Boolean(pendingWithdraw?.exitTxHash) || pendingWithdraw?.state === 'exit-submitted' || pendingWithdraw?.state === 'completed';
      exitButton.disabled = !(connectedAccount && pendingWithdraw?.exitPayload) || hasExitStarted;
    }
  }

  async function refreshState(options = {}) {
    if (!connectedAccount) {
      const accounts = await getWalletAccounts();
      connectedAccount = accounts?.[0] || '';
      accountField.textContent = connectedAccount || '-';
    }
    if (!normalizeAddress(connectedAccount)) {
      updateButtons();
      if (!options.silent) setStatus(status, '먼저 지갑을 연결하세요.', 'warn');
      return;
    }
    accountField.textContent = connectedAccount;
    if (!isEthToPolygon) {
      if (forceNewBridge) {
        pendingWithdraw = null;
        try {
          window.localStorage?.removeItem(pendingStorageKey(connectedAccount, direction));
        } catch {
          // best-effort only
        }
      } else {
        pendingWithdraw = { ...(payloadPendingWithdraw || {}), ...(readPending(connectedAccount, direction) || {}) };
        const remotePending = await loadRemotePending().catch(() => null);
        if (remotePending?.txHash) {
          pendingWithdraw = { ...(pendingWithdraw || {}), ...remotePending };
          writePending(connectedAccount, direction, pendingWithdraw);
        }
      }
    }
    renderPending();
    await switchWalletChain(sourceChainId);
    balance = await getErc20Balance({ token: sourceToken, owner: connectedAccount });
    balanceField.textContent = `${formatUnits(balance)} ORBS`;
    if (isEthToPolygon) {
      allowance = await getAllowance({ owner: connectedAccount, spender: ETH_CONTRACT_BRIDGE_ERC20 });
      allowanceField.textContent = `${formatUnits(allowance)} ORBS`;
    }
    updateButtons();
    if (balance < amount) {
      setStatus(status, `${isEthToPolygon ? 'Ethereum' : 'Polygon'} ORBS 잔고가 부족합니다. 필요: ${formatUnits(amount)} ORBS, 현재: ${formatUnits(balance)} ORBS`, 'error');
    } else if (isEthToPolygon && allowance < amount) {
      setStatus(status, `${formatUnits(amount)} ORBS 브릿지를 위해 exact approve가 필요합니다. Spender: ${ETH_CONTRACT_BRIDGE_ERC20}`, 'warn');
    } else if (!isEthToPolygon && pendingWithdraw?.state === 'completed') {
      setStatus(status, '브릿지가 완료된 기록입니다. 새 브릿지는 새 카드에서 시작하세요.', 'ok');
    } else if (!isEthToPolygon && pendingWithdraw?.exitTxHash) {
      setStatus(status, `exit 트랜잭션이 이미 전송되었습니다: ${pendingWithdraw.exitTxHash}`, 'warn');
    } else if (!isEthToPolygon && pendingWithdraw?.exitPayload) {
      setStatus(status, 'exit payload가 준비되었습니다. Ethereum으로 전환해 exit 트랜잭션을 실행할 수 있습니다.', 'ok');
    } else if (!isEthToPolygon && pendingWithdraw?.txHash) {
      setStatus(status, 'withdraw 트랜잭션이 저장되어 있습니다. 체크포인트 준비 여부를 확인하세요.', 'warn');
    } else {
      setStatus(status, isEthToPolygon
        ? '브릿지 실행 준비가 되었습니다. depositFor 트랜잭션은 지갑에서 최종 확인해야 합니다.'
        : 'withdraw 실행 준비가 되었습니다. Polygon withdraw 후 체크포인트 완료 시 Ethereum exit이 필요합니다.', 'ok');
    }
  }

  async function connectWallet() {
    if (connectedAccount) {
      const revoked = await revokeWalletPermissionsIfSupported();
      connectedAccount = '';
      balance = 0n;
      allowance = 0n;
      pendingWithdraw = null;
      accountField.textContent = '-';
      balanceField.textContent = '-';
      if (allowanceField) allowanceField.textContent = '-';
      renderPending();
      updateButtons();
      setStatus(status, revoked ? '지갑 연결을 해제했습니다.' : '이 카드의 지갑 연결 상태를 해제했습니다.', 'ok');
      return;
    }
    const accounts = await requestWalletAccounts({ chainId: sourceChainId });
    connectedAccount = accounts?.[0] || '';
    accountField.textContent = connectedAccount || '-';
    if (!connectedAccount) {
      setStatus(status, '연결된 계정이 없습니다.', 'warn');
      updateButtons();
      return;
    }
    await refreshState();
  }

  async function approveExactAmount() {
    if (!connectedAccount) {
      await connectWallet();
    }
    if (!normalizeAddress(connectedAccount)) {
      throw new Error('연결된 지갑 주소를 찾지 못했습니다.');
    }
    await switchWalletChain(ETH_CHAIN_ID);
    setStatus(status, `ORBS ${formatUnits(amount)}개 exact approve를 지갑에 요청합니다…`);
    const txHash = await requestWallet('eth_sendTransaction', [{
      from: connectedAccount,
      to: ETH_CONTRACT_ORBS,
      data: encodeApproveCall(ETH_CONTRACT_BRIDGE_ERC20, amount),
      value: '0x0',
    }]);
    setStatus(status, `Approve 전송됨. 확인 중입니다: ${txHash}`);
    await waitForTransactionReceipt(txHash);
    setStatus(status, `Approve 확인 완료: ${txHash}`, 'ok');
    await refreshState({ silent: true });
  }

  async function bridgeDepositFor() {
    if (!connectedAccount) {
      await connectWallet();
    }
    await refreshState({ silent: true });
    if (balance < amount) {
      throw new Error(`잔고가 부족합니다. 현재 ${formatUnits(balance)} ORBS`);
    }
    if (allowance < amount) {
      throw new Error('allowance가 부족합니다. 먼저 exact approve를 완료하세요.');
    }
    await switchWalletChain(ETH_CHAIN_ID);
    const dataHex = encodeDepositForCall(connectedAccount, amount);
    setStatus(status, 'Polygon PoS bridge depositFor 트랜잭션을 지갑에 요청합니다…');
    const txHash = await requestWallet('eth_sendTransaction', [{
      from: connectedAccount,
      to: ETH_CONTRACT_BRIDGE,
      data: dataHex,
      value: '0x0',
    }]);
    setStatus(status, `브릿지 트랜잭션 전송됨: ${txHash}\nEthereum 확정 후 보통 약 30분 내 Polygon ORBS 잔고에 반영됩니다.`, 'ok');
  }

  async function withdrawOnPolygon() {
    if (!connectedAccount) {
      await connectWallet();
    }
    await refreshState({ silent: true });
    if (balance < amount) {
      throw new Error(`잔고가 부족합니다. 현재 ${formatUnits(balance)} ORBS`);
    }
    await switchWalletChain(POLYGON_CHAIN_ID);
    setStatus(status, 'Polygon ORBS withdraw 트랜잭션을 지갑에 요청합니다…');
    const txHash = await requestWallet('eth_sendTransaction', [{
      from: connectedAccount,
      to: POLYGON_CONTRACT_ORBS,
      data: encodeWithdrawCall(amount),
      value: '0x0',
    }]);
    setStatus(status, `withdraw 전송됨. Polygon 확정을 기다립니다: ${txHash}`);
    const receipt = await waitForTransactionReceipt(txHash);
    pendingWithdraw = {
      txHash,
      blockNumber: Number(bigintFromRpcQuantity(receipt.blockNumber || '0x0')).toString(),
      amount: amount.toString(),
      createdAt: Date.now(),
    };
    writePending(connectedAccount, direction, pendingWithdraw);
    await saveRemotePending('source-confirmed').catch(() => null);
    renderPending();
    updateButtons();
    setStatus(status, `withdraw 확인 완료: ${txHash}\n체크포인트 준비까지 보통 30분~수 시간이 걸릴 수 있습니다.`, 'ok');
  }

  async function checkCheckpointAndPayload() {
    if (!pendingWithdraw?.txHash || !pendingWithdraw?.blockNumber) {
      throw new Error('확인할 withdraw tx hash/block number가 없습니다.');
    }
    setStatus(status, `Polygon 체크포인트를 확인합니다: block ${pendingWithdraw.blockNumber}`);
    const checkpoint = await fetchCheckpointStatus(pendingWithdraw.blockNumber);
    if (checkpoint?.message !== 'success') {
      setStatus(status, `아직 체크포인트가 준비되지 않았습니다. 응답: ${checkpoint?.message || 'unknown'}`, 'warn');
      return;
    }
    setStatus(status, '체크포인트 확인 완료. exit payload를 가져옵니다…');
    const exitPayload = await fetchExitPayload(pendingWithdraw.txHash);
    pendingWithdraw = { ...pendingWithdraw, exitPayload, checkpointReadyAt: Date.now() };
    writePending(connectedAccount, direction, pendingWithdraw);
    await saveRemotePending('checkpoint-ready').catch(() => null);
    renderPending();
    updateButtons();
    setStatus(status, 'exit payload 준비 완료. Ethereum exit 트랜잭션을 실행할 수 있습니다.', 'ok');
  }

  async function exitOnEthereum() {
    if (!pendingWithdraw?.exitPayload) {
      throw new Error('exit payload가 아직 준비되지 않았습니다.');
    }
    await switchWalletChain(ETH_CHAIN_ID);
    setStatus(status, 'Ethereum RootChainManager exit 트랜잭션을 지갑에 요청합니다…');
    const txHash = await requestWallet('eth_sendTransaction', [{
      from: connectedAccount,
      to: ETH_CONTRACT_BRIDGE,
      data: encodeExitCall(pendingWithdraw.exitPayload),
      value: '0x0',
    }]);
    pendingWithdraw = { ...pendingWithdraw, exitTxHash: txHash, state: 'exit-submitted' };
    writePending(connectedAccount, direction, pendingWithdraw);
    await saveRemotePending('exit-submitted').catch(() => null);
    updateButtons();
    setStatus(status, `exit 트랜잭션 전송됨. Ethereum 확정을 확인 중입니다: ${txHash}`);
    try {
      await waitForTransactionReceipt(txHash, 600_000);
      pendingWithdraw = { ...pendingWithdraw, exitTxHash: txHash, state: 'completed', completedAt: Date.now() };
      writePending(connectedAccount, direction, pendingWithdraw);
      await saveRemotePending('completed').catch(() => null);
      updateButtons();
      setStatus(status, `exit 트랜잭션 확인 완료: ${txHash}\nEthereum ORBS 입금이 완료되었습니다.`, 'ok');
    } catch (confirmError) {
      setStatus(status, `exit 트랜잭션은 전송됐지만 앱에서 확정 확인을 완료하지 못했습니다: ${txHash}\n나중에 진행상태 확인을 누르면 다시 확인할 수 있습니다.`, 'warn');
    }
  }

  connectButton = createButton('지갑 연결', async () => {
    try {
      await connectWallet();
    } catch (connectError) {
      setStatus(status, connectError instanceof Error ? connectError.message : String(connectError), 'error');
    }
  });
  const refreshButton = createButton(isEthToPolygon ? '잔고/allowance 확인' : '잔고/진행상태 확인', async () => {
    try {
      await refreshState();
    } catch (refreshError) {
      setStatus(status, refreshError instanceof Error ? refreshError.message : String(refreshError), 'error');
    }
  }, { secondary: true });

  const actions = document.createElement('div');
  actions.className = 'spot-plugin-actions';

  if (isEthToPolygon) {
    approveButton = createButton(`${formatUnits(amount)} ORBS approve`, async () => {
      try {
        await approveExactAmount();
      } catch (approveError) {
        setStatus(status, approveError instanceof Error ? approveError.message : String(approveError), 'error');
      }
    }, { disabled: true });
    bridgeButton = createButton('Bridge depositFor 실행', async () => {
      try {
        await bridgeDepositFor();
      } catch (bridgeError) {
        setStatus(status, bridgeError instanceof Error ? bridgeError.message : String(bridgeError), 'error');
      }
    }, { disabled: true });
    const copyCalldataButton = createButton('depositFor calldata 복사', async () => {
      try {
        if (!normalizeAddress(connectedAccount)) {
          setStatus(status, 'calldata 생성을 위해 먼저 지갑을 연결하세요.', 'warn');
          return;
        }
        await navigator.clipboard?.writeText?.(encodeDepositForCall(connectedAccount, amount));
        setStatus(status, 'depositFor calldata를 복사했습니다.', 'ok');
      } catch (copyError) {
        setStatus(status, copyError instanceof Error ? copyError.message : String(copyError), 'error');
      }
    }, { secondary: true });
    actions.append(connectButton, refreshButton, approveButton, bridgeButton, copyCalldataButton);
  } else {
    bridgeButton = createButton('Polygon withdraw 실행', async () => {
      try {
        await withdrawOnPolygon();
      } catch (withdrawError) {
        setStatus(status, withdrawError instanceof Error ? withdrawError.message : String(withdrawError), 'error');
      }
    }, { disabled: true });
    checkpointButton = createButton('체크포인트/exit payload 확인', async () => {
      try {
        await checkCheckpointAndPayload();
      } catch (checkpointError) {
        setStatus(status, checkpointError instanceof Error ? checkpointError.message : String(checkpointError), 'error');
      }
    }, { disabled: true, secondary: true });
    exitButton = createButton('Ethereum exit 실행', async () => {
      try {
        await exitOnEthereum();
      } catch (exitError) {
        setStatus(status, exitError instanceof Error ? exitError.message : String(exitError), 'error');
      }
    }, { disabled: true });
    actions.append(connectButton, refreshButton, bridgeButton, checkpointButton, exitButton);
  }

  subscribeWalletAccounts((accounts) => {
    connectedAccount = accounts?.[0] || '';
    accountField.textContent = connectedAccount || '-';
    updateButtons();
    if (!connectedAccount) {
      setStatus(status, '지갑 연결이 해제되었습니다.', 'warn');
    } else {
      refreshState().catch((refreshError) => {
        setStatus(status, refreshError instanceof Error ? refreshError.message : String(refreshError), 'error');
      });
    }
  });

  getWalletAccounts()
    .then((accounts) => {
      connectedAccount = accounts?.[0] || '';
      accountField.textContent = connectedAccount || '-';
      if (connectedAccount && !isEthToPolygon) {
        if (forceNewBridge) {
          pendingWithdraw = null;
          try {
            window.localStorage?.removeItem(pendingStorageKey(connectedAccount, direction));
          } catch {
            // best-effort only
          }
          renderPending();
        } else {
          pendingWithdraw = { ...(payloadPendingWithdraw || {}), ...(readPending(connectedAccount, direction) || {}) };
          loadRemotePending().then((remotePending) => {
            if (remotePending?.txHash) {
              pendingWithdraw = { ...(pendingWithdraw || {}), ...remotePending };
              writePending(connectedAccount, direction, pendingWithdraw);
              renderPending();
              updateButtons();
            }
          }).catch(() => {});
          renderPending();
        }
      } else if (!connectedAccount && payloadPendingWithdraw?.txHash) {
        pendingWithdraw = payloadPendingWithdraw;
        renderPending();
      }
      updateButtons();
    })
    .catch(() => {});

  updateButtons();
  card.append(header, body, actions, status);
  parent.append(card);
}

registerCodeBlockPlugin({
  language: 'orbs-polygon-bridge-card',
  render: renderOrbsPolygonBridgeCard,
});
