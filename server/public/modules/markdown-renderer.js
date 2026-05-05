import { appendInlineMarkdown, countLeadingSpaces } from './markdown-inline.js';
import { isMarkdownTableRow, isMarkdownTableSeparator, splitMarkdownTableRow } from './markdown-table.js';
import { appendMarkdownTable } from './markdown-table-render.js';

export function appendMarkdown(parent, text, { appendCodeBlock }) {
  const appendBlockquote = (target, lines) => {
    const quote = document.createElement('blockquote');
    appendMarkdown(quote, lines.join('\n'), { appendCodeBlock });
    target.append(quote);
  };

  const lines = text.split('\n');
  let list = null;
  let inCodeBlock = false;
  let codeLanguage = '';
  let codeFenceIndent = 0;
  let codeLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const singleLineFence = line.match(/^( {0,3})```([^`\n]+)```\s*$/);
    if (singleLineFence) {
      list = null;
      appendCodeBlock(parent, singleLineFence[2], '', { showHeader: false, showCopyButton: false });
      continue;
    }
    const fence = line.match(/^( {0,3})```\s*([^`]*)\s*$/);
    if (fence) {
      list = null;
      if (inCodeBlock) {
        appendCodeBlock(parent, codeLines.join('\n'), codeLanguage);
        inCodeBlock = false;
        codeLanguage = '';
        codeFenceIndent = 0;
        codeLines = [];
      } else {
        inCodeBlock = true;
        codeLanguage = fence[2]?.trim() || '';
        codeFenceIndent = fence[1]?.length || 0;
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(codeFenceIndent > 0 && line.startsWith(' '.repeat(codeFenceIndent)) ? line.slice(codeFenceIndent) : line);
      continue;
    }

    if (isMarkdownTableRow(line) && isMarkdownTableSeparator(lines[index + 1] || '')) {
      list = null;
      const headerCells = splitMarkdownTableRow(line);
      const separatorLine = lines[index + 1];
      const bodyRows = [];
      index += 2;
      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        bodyRows.push(splitMarkdownTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      appendMarkdownTable(parent, headerCells, separatorLine, bodyRows);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    const quote = line.match(/^>\s?(.*)$/);
    const horizontalRule = line.match(/^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})\s*$/);

    if (horizontalRule) {
      list = null;
      parent.append(document.createElement('hr'));
      continue;
    }

    if (quote) {
      list = null;
      const quoteLines = [quote[1]];
      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1];
        if (!nextLine.trim()) {
          break;
        }
        const nextQuote = nextLine.match(/^>\s?(.*)$/);
        if (nextQuote) {
          quoteLines.push(nextQuote[1]);
          index += 1;
          continue;
        }
        if (/^ {0,3}```\s*([^`]*)\s*$/.test(nextLine) || /^(#{1,3})\s+(.+)$/.test(nextLine) || /^\s*[-*]\s+(.+)$/.test(nextLine) || /^\s*(\d+)[.)]\s+(.+)$/.test(nextLine) || (isMarkdownTableRow(nextLine) && isMarkdownTableSeparator(lines[index + 2] || ''))) {
          break;
        }
        quoteLines.push(nextLine);
        index += 1;
      }
      appendBlockquote(parent, quoteLines);
      continue;
    }

    if (heading) {
      list = null;
      const level = String(Math.min(3, heading[1].length + 2));
      const node = document.createElement(`h${level}`);
      appendInlineMarkdown(node, heading[2]);
      parent.append(node);
      continue;
    }

    if (bullet || numbered) {
      const listType = bullet ? 'ul' : 'ol';
      const explicitNumber = numbered ? Number(numbered[1]) : null;
      if (!list || list.tagName.toLowerCase() !== listType) {
        list = document.createElement(listType);
        if (listType === 'ol' && explicitNumber && explicitNumber > 1) {
          list.setAttribute('start', String(explicitNumber));
        }
        parent.append(list);
      }
      const item = document.createElement('li');
      if (listType === 'ol' && explicitNumber && list.children.length > 0) {
        item.value = explicitNumber;
      }
      appendInlineMarkdown(item, bullet?.[1] || numbered?.[2] || '');
      list.append(item);

      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1];
        if (!nextLine.trim()) {
          index += 1;
          continue;
        }

        const indent = countLeadingSpaces(nextLine);
        const nestedFence = indent >= 2 ? nextLine.match(/^\s*```\s*([^`]*)\s*$/) : null;
        if (nestedFence) {
          const codeIndent = indent;
          const codeLanguage = nestedFence[1]?.trim() || '';
          const nestedCodeLines = [];
          index += 1;
          while (index + 1 < lines.length) {
            const codeLine = lines[index + 1];
            if (!codeLine.trim()) {
              nestedCodeLines.push('');
              index += 1;
              continue;
            }
            const codeLineIndent = countLeadingSpaces(codeLine);
            if (codeLineIndent >= codeIndent && codeLine.slice(codeIndent).match(/^```\s*$/)) {
              index += 1;
              break;
            }
            nestedCodeLines.push(codeLineIndent >= codeIndent ? codeLine.slice(codeIndent) : codeLine);
            index += 1;
          }
          appendCodeBlock(item, nestedCodeLines.join('\n'), codeLanguage);
          continue;
        }

        break;
      }
      continue;
    }

    list = null;
    if (!line.trim()) {
      parent.append(document.createElement('br'));
      continue;
    }
    const paragraph = document.createElement('p');
    appendInlineMarkdown(paragraph, line);
    parent.append(paragraph);
  }

  if (inCodeBlock) {
    appendCodeBlock(parent, codeLines.join('\n'), codeLanguage);
  }
}
