import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { clearBrowserGlobals, setBrowserGlobals, TestElement } from './test-dom.js';

// @ts-expect-error public browser module intentionally has no TypeScript declaration.
const markdownRenderer = await import('../public/modules/markdown-renderer.js');

afterEach(() => {
  clearBrowserGlobals();
});

test('markdown headings do not render a visible blank line from the following markdown separator', () => {
  setBrowserGlobals();
  const parent = new TestElement('div');

  markdownRenderer.appendMarkdown(parent, '# 제목\n\n본문', {
    appendCodeBlock: () => {},
  });

  assert.deepEqual(parent.children.map((child) => child.tagName), ['H3', 'P']);
  assert.equal(parent.children[0]?.text(), '제목');
  assert.equal(parent.children[1]?.text(), '본문');
});
