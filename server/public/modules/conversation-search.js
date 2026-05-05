export async function fetchConversationHistoryMessages(conversationId, deps) {
  const response = await deps.apiFetch('/v1/history', {
    params: { conversation_id: conversationId },
    headers: await deps.historyHeaders(),
  });
  if (!response.ok) {
    return [];
  }
  const body = await response.json().catch(() => null);
  return Array.isArray(body?.messages) ? body.messages : [];
}

export async function searchConversationContentOnServer(query, deps) {
  const response = await deps.apiFetch('/v1/conversations/search', {
    params: {
      query,
      ...(deps.showingArchived ? { include_archived: '1' } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Conversation search failed: ${response.status}`);
  }
  const body = await response.json().catch(() => null);
  return new Set(Array.isArray(body?.conversation_ids) ? body.conversation_ids : []);
}

export async function searchConversationContentInBrowser(runId, query, deps) {
  const candidates = deps.baseVisibleConversations().filter((conversation) => !deps.conversationMatchesTitle(conversation, query));
  const nextMatches = new Set();
  let index = 0;
  const worker = async () => {
    while (index < candidates.length && runId === deps.currentRunId()) {
      const conversation = candidates[index++];
      const cacheKey = `${conversation.id}:${query}`;
      let matched = deps.cache.get(cacheKey);
      if (matched === undefined) {
        const messages = await fetchConversationHistoryMessages(conversation.id, deps);
        const haystack = messages.map((message) => typeof message?.text === 'string' ? message.text : '').join('\n').toLocaleLowerCase('ko-KR');
        matched = haystack.includes(query);
        deps.cache.set(cacheKey, matched);
      }
      if (matched) {
        nextMatches.add(conversation.id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, worker));
  return nextMatches;
}

export async function searchConversationContent(runId, query, deps) {
  try {
    return await searchConversationContentOnServer(query, deps);
  } catch {
    return searchConversationContentInBrowser(runId, query, deps);
  }
}
