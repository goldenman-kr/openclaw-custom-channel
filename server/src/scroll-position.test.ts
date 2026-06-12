import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { test } from 'node:test';

const moduleUrl = pathToFileURL(resolve('public/modules/scroll-position.js')).href;
const { captureScrollPosition, restoreScrollPosition } = await import(moduleUrl) as {
  captureScrollPosition: (element: { scrollLeft: number; scrollTop: number } | null) => { left: number; top: number } | null;
  restoreScrollPosition: (element: { scrollLeft: number; scrollTop: number } | null, position: { left: number; top: number } | null) => void;
};

test('captures and restores an element scroll position after rerender', () => {
  const list = { scrollLeft: 4, scrollTop: 380 };
  const position = captureScrollPosition(list);

  list.scrollLeft = 0;
  list.scrollTop = 0;
  restoreScrollPosition(list, position);

  assert.deepEqual(list, { scrollLeft: 4, scrollTop: 380 });
});

test('ignores missing elements and missing positions', () => {
  assert.equal(captureScrollPosition(null), null);

  const list = { scrollLeft: 2, scrollTop: 120 };
  restoreScrollPosition(list, null);

  assert.deepEqual(list, { scrollLeft: 2, scrollTop: 120 });
});
