import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

function readPrecacheAssets(swSource: string) {
  const match = swSource.match(/const ASSETS = \[([\s\S]*?)\];/);
  assert.ok(match, 'service worker ASSETS list should exist');
  return [...match[1].matchAll(/'([^']+)'/g)].map((asset) => asset[1]);
}

test('service worker does not precache the large Reown AppKit bundle', async () => {
  const swSource = await readFile('public/sw.js', 'utf8');
  const assets = readPrecacheAssets(swSource);

  assert.ok(assets.includes('/plugins/spot-wallet-provider.js'));
  assert.ok(assets.includes('/plugins/spot-order-card.js'));
  assert.ok(assets.includes('/plugins/spot-wallet-intent.js'));
  assert.equal(assets.includes('/assets/spot-reown-wallet.js'), false);
  assert.match(swSource, /'\/assets\/spot-reown-wallet\.js'/, 'Reown bundle should still be network-first when requested');
});
