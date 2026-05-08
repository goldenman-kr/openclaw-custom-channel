import { registerCodeBlockPlugin } from './plugin-registry.js';
import { getWalletMode, requestWallet, requestWalletAccounts, switchWalletChain } from './wallet-provider.js';

const CHAINS = {
  1: {
    name: 'Ethereum',
    native: { symbol: 'ETH', decimals: 18 },
    tokens: [
      { symbol: 'ORBS', name: 'Orbs', address: '0xff56cc6b1e6ded347aa0b7676c85ab0b3d08b0fa', decimals: 18 },
      { symbol: 'USDC', name: 'USD Coin', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6 },
      { symbol: 'USDT', name: 'Tether USD', address: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6 },
      { symbol: 'WETH', name: 'Wrapped Ether', address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', decimals: 18 },
      { symbol: 'WBTC', name: 'Wrapped Bitcoin', address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', decimals: 8 },
      { symbol: 'DAI', name: 'Dai Stablecoin', address: '0x6b175474e89094c44da98b954eedeac495271d0f', decimals: 18 },
    ],
  },
  42161: {
    name: 'Arbitrum',
    native: { symbol: 'ETH', decimals: 18 },
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', decimals: 6 },
      { symbol: 'USDT', name: 'Tether USD', address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', decimals: 6 },
      { symbol: 'WETH', name: 'Wrapped Ether', address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', decimals: 18 },
      { symbol: 'WBTC', name: 'Wrapped Bitcoin', address: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', decimals: 8 },
    ],
  },
  8453: {
    name: 'Base',
    native: { symbol: 'ETH', decimals: 18 },
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bdA02913', decimals: 6 },
      { symbol: 'WETH', name: 'Wrapped Ether', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
      { symbol: 'cbBTC', name: 'Coinbase Wrapped BTC', address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', decimals: 8 },
    ],
  },
  137: {
    name: 'Polygon',
    native: { symbol: 'POL', decimals: 18 },
    tokens: [
      { symbol: 'ORBS', name: 'Orbs', address: '0x614389eaae0a6821dc49062d56bda3d9d45fa2ff', decimals: 18 },
      { symbol: 'USDC', name: 'USD Coin', address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', decimals: 6 },
      { symbol: 'USDT', name: 'Tether USD', address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', decimals: 6 },
      { symbol: 'WETH', name: 'Wrapped Ether', address: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', decimals: 18 },
      { symbol: 'WBTC', name: 'Wrapped Bitcoin', address: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', decimals: 8 },
    ],
  },
  56: {
    name: 'BNB Chain',
    native: { symbol: 'BNB', decimals: 18 },
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18 },
      { symbol: 'USDT', name: 'Tether USD', address: '0x55d398326f99059ff775485246999027b3197955', decimals: 18 },
      { symbol: 'WBNB', name: 'Wrapped BNB', address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', decimals: 18 },
      { symbol: 'BTCB', name: 'Bitcoin BEP2', address: '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c', decimals: 18 },
    ],
  },
};

function parsePayload(codeText) {
  try {
    const data = JSON.parse(codeText || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
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

function compactAddress(value) {
  const address = String(value || '');
  return address.length > 14 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address || '-';
}

function normalizeAddress(value) {
  const address = String(value || '').trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : '';
}

function setStatus(statusNode, message, kind = '') {
  statusNode.textContent = message;
  statusNode.dataset.kind = kind;
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

function formatUnits(value, decimals) {
  const raw = bigintFromRpcQuantity(value);
  const scale = 10n ** BigInt(decimals || 18);
  const whole = raw / scale;
  const fraction = raw % scale;
  if (fraction === 0n) return whole.toString();
  const padded = fraction.toString().padStart(Number(decimals || 18), '0').replace(/0+$/, '');
  const trimmed = padded.slice(0, 8).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

async function getNativeBalance(owner) {
  const result = await requestWallet('eth_getBalance', [owner, 'latest']);
  return bigintFromRpcQuantity(result);
}

async function getErc20Balance({ token, owner }) {
  const result = await requestWallet('eth_call', [{ to: token, data: encodeBalanceOfCall(owner) }, 'latest']);
  return bigintFromRpcQuantity(result);
}

function renderResultTable(parent, rows) {
  parent.replaceChildren();
  const table = document.createElement('table');
  table.className = 'spot-plugin-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>코인</th><th>잔액</th><th>컨트랙트</th></tr>';
  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    const symbol = document.createElement('td');
    symbol.textContent = row.symbol;
    const amount = document.createElement('td');
    amount.textContent = row.amount;
    const address = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = row.address ? compactAddress(row.address) : 'native';
    address.append(code);
    tr.append(symbol, amount, address);
    tbody.append(tr);
  }
  table.append(thead, tbody);
  parent.append(table);
}

function renderSpotWalletBalance({ parent, codeText, fallback }) {
  const data = parsePayload(codeText);
  const initialChainId = Number(data.chainId || 1);

  const card = document.createElement('section');
  card.className = 'spot-plugin-card';

  const header = document.createElement('div');
  header.className = 'spot-plugin-header';
  const title = document.createElement('strong');
  title.textContent = data.title || '지갑 잔액 조회';
  const badge = document.createElement('span');
  badge.className = 'spot-plugin-badge';
  badge.textContent = 'plugin: spot-wallet-balance';
  header.append(title, badge);

  const body = document.createElement('div');
  body.className = 'spot-plugin-body';
  const info = document.createElement('p');
  info.textContent = getWalletMode() === 'injected'
    ? 'MetaMask 지갑을 연결해 선택한 체인의 네이티브 코인과 주요 토큰 잔액을 조회합니다.'
    : 'Reown AppKit으로 지갑을 연결해 선택한 체인의 네이티브 코인과 주요 토큰 잔액을 조회합니다.';

  const chainLabel = document.createElement('label');
  chainLabel.className = 'spot-plugin-field';
  const chainText = document.createElement('span');
  chainText.className = 'spot-plugin-field-label';
  chainText.textContent = 'Chain';
  const select = document.createElement('select');
  select.className = 'spot-plugin-select';
  for (const [chainId, chain] of Object.entries(CHAINS)) {
    const option = document.createElement('option');
    option.value = chainId;
    option.textContent = `${chain.name} (${chainId})`;
    option.selected = Number(chainId) === initialChainId;
    select.append(option);
  }
  chainLabel.append(chainText, select);

  const accountRow = document.createElement('div');
  accountRow.className = 'spot-plugin-field';
  const accountLabel = document.createElement('span');
  accountLabel.className = 'spot-plugin-field-label';
  accountLabel.textContent = 'Wallet';
  const accountCode = document.createElement('code');
  accountCode.textContent = '-';
  accountRow.append(accountLabel, accountCode);

  const result = document.createElement('div');
  result.className = 'spot-plugin-results';

  body.append(info, chainLabel, accountRow, result);

  const status = document.createElement('p');
  status.className = 'spot-plugin-status';
  setStatus(status, '지갑 연결 후 잔액 조회를 누르세요.');

  let connectedAccount = '';
  const connectButton = createButton('지갑 연결', async () => {
    try {
      const accounts = await requestWalletAccounts({ chainId: Number(select.value) });
      connectedAccount = accounts?.[0] || '';
      accountCode.textContent = connectedAccount || '-';
      setStatus(status, connectedAccount ? `연결됨: ${connectedAccount}` : '연결된 계정이 없습니다.', connectedAccount ? 'ok' : 'warn');
    } catch (error) {
      setStatus(status, error instanceof Error ? error.message : String(error), 'error');
    }
  });

  const queryButton = createButton('토큰 포함 잔액 조회', async () => {
    try {
      if (!connectedAccount) {
        const accounts = await requestWalletAccounts({ chainId: Number(select.value) });
        connectedAccount = accounts?.[0] || '';
        accountCode.textContent = connectedAccount || '-';
      }
      if (!normalizeAddress(connectedAccount)) {
        throw new Error('연결된 지갑 주소를 찾지 못했습니다.');
      }
      const chainId = Number(select.value);
      const chain = CHAINS[chainId];
      if (!chain) {
        throw new Error('지원하지 않는 체인입니다.');
      }
      setStatus(status, `${chain.name} 체인으로 전환하는 중입니다…`);
      await switchWalletChain(chainId);
      setStatus(status, '잔액을 조회하는 중입니다…');
      const rows = [];
      const nativeBalance = await getNativeBalance(connectedAccount);
      rows.push({ symbol: chain.native.symbol, amount: formatUnits(nativeBalance, chain.native.decimals), address: '' });
      for (const token of chain.tokens) {
        try {
          const balance = await getErc20Balance({ token: token.address, owner: connectedAccount });
          if (balance > 0n || data.showZeroBalances) {
            rows.push({ symbol: token.symbol, amount: formatUnits(balance, token.decimals), address: token.address });
          }
        } catch {
          // Skip tokens that fail on the selected RPC/provider.
        }
      }
      renderResultTable(result, rows);
      setStatus(status, `조회 완료: ${rows.length}개 항목`, 'ok');
    } catch (error) {
      setStatus(status, error instanceof Error ? error.message : String(error), 'error');
    }
  });

  const actions = document.createElement('div');
  actions.className = 'spot-plugin-actions';
  actions.append(connectButton, queryButton);

  card.append(header, body, actions, status);
  parent.append(card);
}

registerCodeBlockPlugin({
  language: 'spot-wallet-balance',
  render: renderSpotWalletBalance,
});
