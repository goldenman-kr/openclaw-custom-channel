import { registerCodeBlockPlugin } from './plugin-registry.js';
import { openWalletNetworkSelector, requestWallet, requestWalletAccounts, switchWalletChain } from './wallet-provider.js';

function parsePayload(codeText) {
  try { return { data: JSON.parse(codeText), error: null }; } catch (error) { return { data: null, error }; }
}

function normalizeAddress(value) {
  const address = String(value || '').trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : '';
}

function compactAddress(value) {
  const address = String(value || '');
  return address.length > 14 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address || '-';
}

function bigintFromNumberish(value, fieldName = '값') {
  const text = String(value ?? '').trim();
  if (!text || text === '0x') return 0n;
  try { return BigInt(text); } catch { throw new Error(`${fieldName}을 정수로 변환할 수 없습니다: ${text}`); }
}

function uint256Hex(value) {
  return bigintFromNumberish(value, 'uint256 값').toString(16).padStart(64, '0');
}

function addressParam(address) {
  const normalized = normalizeAddress(address);
  if (!normalized) throw new Error(`잘못된 주소입니다: ${address}`);
  return normalized.slice(2).padStart(64, '0');
}

function encodeAllowanceCall(owner, spender) {
  return `0xdd62ed3e${addressParam(owner)}${addressParam(spender)}`;
}

function encodeApproveCall(spender, amount) {
  return `0x095ea7b3${addressParam(spender)}${uint256Hex(amount)}`;
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

async function waitForWalletChain(expectedChainId, timeoutMs = 10_000) {
  const expected = `0x${BigInt(expectedChainId).toString(16)}`.toLowerCase();
  const startedAt = Date.now();
  let actual = '';
  while (Date.now() - startedAt < timeoutMs) {
    actual = String(await requestWallet('eth_chainId')).toLowerCase();
    if (actual === expected) return;
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new Error(`지갑 네트워크가 요청 체인과 일치하지 않습니다. 요청=${expected}, 현재=${actual || '확인 불가'}. 체인 전환을 승인한 뒤 다시 시도해주세요.`);
}

async function prepareAccount(chainId, expectedAccount, onStatus) {
  onStatus?.('지갑 연결을 요청합니다…');
  const accounts = await requestWalletAccounts({ chainId });
  const account = normalizeAddress(accounts?.[0]);
  if (!account) throw new Error('연결된 지갑 주소를 확인하지 못했습니다.');
  if (expectedAccount && normalizeAddress(expectedAccount) && account !== normalizeAddress(expectedAccount)) {
    throw new Error(`연결된 지갑이 다릅니다. 요청=${expectedAccount}, 현재=${account}`);
  }
  onStatus?.('체인을 확인/전환합니다…');
  await switchWalletChain(chainId);
  await waitForWalletChain(chainId);
  return account;
}

async function getAllowance(token, owner, spender) {
  const result = await requestWallet('eth_call', [{ to: token, data: encodeAllowanceCall(owner, spender) }, 'latest']);
  return bigintFromNumberish(result, 'allowance');
}

async function waitForTransactionReceipt(txHash, timeoutMs = 90_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await requestWallet('eth_getTransactionReceipt', [txHash]);
    if (receipt) {
      if (receipt.status && String(receipt.status).toLowerCase() !== '0x1') throw new Error(`트랜잭션이 실패했습니다: ${txHash}`);
      return receipt;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
  }
  throw new Error(`트랜잭션 확인 시간이 초과되었습니다: ${txHash}`);
}

async function ensureApproval({ account, approval, status }) {
  if (!approval?.token || !approval?.spender || !approval?.amount) return null;
  const required = bigintFromNumberish(approval.amount, 'approve 수량');
  const allowance = await getAllowance(approval.token, account, approval.spender);
  if (allowance >= required) {
    setStatus(status, 'Approve가 이미 충분합니다.', 'ok');
    return { approved: false, allowance: allowance.toString() };
  }
  setStatus(status, 'USDC approve를 요청합니다…');
  const txHash = await requestWallet('eth_sendTransaction', [{ from: account, to: approval.token, data: encodeApproveCall(approval.spender, required) }]);
  setStatus(status, `Approve 전송됨. 확인 중입니다: ${txHash}`);
  await waitForTransactionReceipt(txHash);
  setStatus(status, 'Approve 확인 완료.', 'ok');
  return { approved: true, txHash };
}

function renderWalletTransactionCard({ parent, codeText, fallback }) {
  const { data, error } = parsePayload(codeText);
  if (error || !data || typeof data !== 'object' || !data.transaction || !data.chainId) { fallback(); return; }

  const card = document.createElement('section');
  card.className = 'spot-plugin-card';
  const header = document.createElement('div');
  header.className = 'spot-plugin-header';
  const title = document.createElement('strong');
  title.textContent = data.title || '지갑 트랜잭션';
  const badge = document.createElement('span');
  badge.className = 'spot-plugin-badge';
  badge.textContent = 'plugin: wallet-transaction-card';
  header.append(title, badge);

  const body = document.createElement('div');
  body.className = 'spot-plugin-body';
  const status = document.createElement('div');
  status.className = 'spot-plugin-status';
  setStatus(status, data.description || '내용을 확인한 뒤 버튼을 눌러 지갑에서 승인해주세요.');
  body.append(status);
  appendField(body, '체인', `${data.chainName || 'Chain'} (${data.chainId})`);
  appendField(body, '보내는 주소', data.fromAddress || '-');
  appendField(body, '예상 결과', data.expectedOutput || '-');
  appendField(body, '실행 대상', data.transaction.to || '-');

  const actions = document.createElement('div');
  actions.className = 'spot-plugin-actions';

  const connectButton = createButton('지갑 연결', async () => {
    try {
      const account = await prepareAccount(data.chainId, data.fromAddress, (message, kind) => setStatus(status, message, kind));
      setStatus(status, `연결됨: ${compactAddress(account)}`, 'ok');
    } catch (error) { setStatus(status, error?.message || String(error), 'error'); }
  }, { secondary: true });

  const switchButton = createButton('체인 전환', async () => {
    try { await switchWalletChain(data.chainId); await waitForWalletChain(data.chainId); setStatus(status, '체인 전환 완료.', 'ok'); }
    catch (error) { setStatus(status, error?.message || String(error), 'error'); }
  }, { secondary: true });

  const networkButton = createButton('네트워크 선택 열기', async () => {
    try { await openWalletNetworkSelector(data.chainId); setStatus(status, '네트워크 선택 창을 열었습니다. Polygon을 선택해주세요.'); }
    catch (error) { setStatus(status, error?.message || String(error), 'error'); }
  }, { secondary: true });

  const needsApproval = Boolean(data.approval?.token && data.approval?.spender && data.approval?.amount);
  const approveButton = needsApproval ? createButton('Approve', async () => {
    approveButton.disabled = true;
    try {
      const account = await prepareAccount(data.chainId, data.fromAddress, (message, kind) => setStatus(status, message, kind));
      await ensureApproval({ account, approval: data.approval, status });
    } catch (error) { setStatus(status, error?.message || String(error), 'error'); }
    finally { approveButton.disabled = false; }
  }) : null;

  const executeButton = createButton(data.executeLabel || '스왑 실행', async () => {
    executeButton.disabled = true;
    try {
      const account = await prepareAccount(data.chainId, data.fromAddress, (message, kind) => setStatus(status, message, kind));
      await ensureApproval({ account, approval: data.approval, status });
      setStatus(status, '스왑 트랜잭션을 지갑에 요청합니다…');
      const tx = { from: account, to: data.transaction.to, data: data.transaction.data || '0x', value: data.transaction.value || '0x0' };
      const txHash = await requestWallet('eth_sendTransaction', [tx]);
      setStatus(status, `스왑 전송됨: ${txHash}`, 'ok');
    } catch (error) { setStatus(status, error?.message || String(error), 'error'); }
    finally { executeButton.disabled = false; }
  });

  actions.append(connectButton, switchButton, networkButton);
  if (approveButton) actions.append(approveButton);
  actions.append(executeButton);
  body.append(actions);
  card.append(header, body);
  parent.append(card);
}

registerCodeBlockPlugin({ language: 'wallet-transaction-card', render: renderWalletTransactionCard });
