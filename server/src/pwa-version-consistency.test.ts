import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const VERSION_PATTERN = /pwa-client-[^'"\s)]+/g;

test('PWA asset version is consistent across HTML, app runtime, service worker registration, and server version endpoint', async () => {
  const [indexHtml, appJs, clientVersionRaw] = await Promise.all([
    readFile('public/index.html', 'utf8'),
    readFile('public/app.js', 'utf8'),
    readFile('public/client-version.json', 'utf8'),
  ]);
  const clientVersion = JSON.parse(clientVersionRaw) as { client_asset_version: string };
  const versions = new Set([
    ...indexHtml.matchAll(VERSION_PATTERN),
    ...appJs.matchAll(VERSION_PATTERN),
  ].map((match) => match[0]));

  assert.deepEqual([...versions].sort(), [clientVersion.client_asset_version]);
});
