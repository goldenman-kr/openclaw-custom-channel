export function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function isTerminalJobState(state) {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

export function parseSseBlock(block) {
  let event = 'message';
  const dataLines = [];
  for (const rawLine of String(block || '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim() || 'message';
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }
  if (!dataLines.length) {
    return { event, data: null };
  }
  const rawData = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(rawData) };
  } catch {
    return { event, data: rawData };
  }
}
