export function createPlainCodeBlock(codeText, language = '', options = {}) {
  const { showHeader = true, showCopyButton = true, copyTextToClipboard } = options;
  const wrapper = document.createElement('div');
  wrapper.className = `code-block${showHeader ? '' : ' compact'}`;

  if (showHeader) {
    const header = document.createElement('div');
    header.className = 'code-block-header';
    const label = document.createElement('span');
    label.textContent = language || 'code';
    header.append(label);

    if (showCopyButton) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'code-copy-button';
      button.textContent = '복사';
      button.addEventListener('click', async () => {
        const originalText = button.textContent;
        try {
          await copyTextToClipboard(codeText);
          button.textContent = '복사됨';
          window.setTimeout(() => { button.textContent = originalText; }, 1200);
        } catch {
          button.textContent = '실패';
          window.setTimeout(() => { button.textContent = originalText; }, 1200);
        }
      });
      header.append(button);
    }

    wrapper.append(header);
  }

  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = codeText;
  pre.append(code);
  wrapper.append(pre);
  return wrapper;
}
