export function appendInlineMarkdown(parent, text) {
  const pattern = /(?<strong>(?<![\p{L}\p{N}_*])\*\*(?<strongText>[^*\n]+)\*\*(?!\*))|(?<starEm>(?<![\p{L}\p{N}_*])\*(?<starEmText>[^*\n]+)\*(?![\p{L}\p{N}_*]))|(?<underscoreEm>(?<![\p{L}\p{N}_])_(?<underscoreEmText>[^_\n]+)_(?![\p{L}\p{N}_]))|(?<code>`(?<codeText>[^`\n]+)`)|(?<link>\[(?<linkLabel>[^\]\n]+)\]\((?<linkUrl>https?:\/\/[^\s)]+)\))|(?<url>https?:\/\/[^\s<)]+)/gu;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parent.append(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    if (match.groups.strongText) {
      const strong = document.createElement('strong');
      strong.textContent = match.groups.strongText;
      parent.append(strong);
    } else if (match.groups.starEmText || match.groups.underscoreEmText) {
      const emphasis = document.createElement('em');
      emphasis.textContent = match.groups.starEmText || match.groups.underscoreEmText;
      parent.append(emphasis);
    } else if (match.groups.codeText) {
      const code = document.createElement('code');
      code.textContent = match.groups.codeText;
      parent.append(code);
    } else {
      const label = match.groups.linkLabel || match.groups.url;
      const url = match.groups.linkUrl || match.groups.url;
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.textContent = label;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      parent.append(anchor);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parent.append(document.createTextNode(text.slice(lastIndex)));
  }
}

export function countLeadingSpaces(text) {
  const match = String(text || '').match(/^\s*/);
  return match ? match[0].length : 0;
}
