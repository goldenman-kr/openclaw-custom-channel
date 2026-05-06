import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('default server build also rebuilds the Spot Reown PWA bundle', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { scripts?: Record<string, string> };

  assert.equal(pkg.scripts?.['build:ts'], 'tsc -p tsconfig.json');
  assert.equal(pkg.scripts?.['build:pwa:spot'], 'vite build --config vite.spot.config.mjs');
  assert.match(pkg.scripts?.build || '', /npm run build:ts/);
  assert.match(pkg.scripts?.build || '', /npm run build:pwa:spot/);
});
