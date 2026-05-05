import { appendInlineMarkdown } from './markdown-inline.js';
import { tableAlignments } from './markdown-table.js';

export function appendMarkdownTable(parent, headerCells, separatorLine, bodyRows) {
  const wrapper = document.createElement('div');
  wrapper.className = 'markdown-table-wrapper';
  const table = document.createElement('table');
  const alignments = tableAlignments(separatorLine);

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const [index, cell] of headerCells.entries()) {
    const th = document.createElement('th');
    if (alignments[index]) {
      th.style.textAlign = alignments[index];
    }
    appendInlineMarkdown(th, cell);
    headerRow.append(th);
  }
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const rowCells of bodyRows) {
    const tr = document.createElement('tr');
    for (let index = 0; index < headerCells.length; index += 1) {
      const td = document.createElement('td');
      if (alignments[index]) {
        td.style.textAlign = alignments[index];
      }
      appendInlineMarkdown(td, rowCells[index] || '');
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  wrapper.append(table);
  parent.append(wrapper);
}
