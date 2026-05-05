export function isMarkdownTableRow(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.slice(1, -1).includes('|');
}

export function splitMarkdownTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

export function isMarkdownTableSeparator(line) {
  if (!isMarkdownTableRow(line)) {
    return false;
  }
  return splitMarkdownTableRow(line).every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

export function tableAlignments(separatorLine) {
  return splitMarkdownTableRow(separatorLine).map((cell) => {
    const trimmed = cell.trim();
    if (trimmed.startsWith(':') && trimmed.endsWith(':')) {
      return 'center';
    }
    if (trimmed.endsWith(':')) {
      return 'right';
    }
    return '';
  });
}
