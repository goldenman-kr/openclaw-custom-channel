import { conversationTitle } from './conversation-format.js';

export function isConversationArchived(conversation) {
  return Boolean(conversation?.archived_at);
}

export function normalizeConversationSearchQuery(query) {
  return String(query || '').trim().toLocaleLowerCase('ko-KR');
}

export function conversationMatchesTitle(conversation, query) {
  return !query || conversationTitle(conversation).toLocaleLowerCase('ko-KR').includes(query);
}

export function baseVisibleConversations(conversations, showingArchived) {
  return conversations.filter((conversation) => showingArchived ? isConversationArchived(conversation) : !isConversationArchived(conversation));
}

export function conversationMatchesSearch(conversation, query, contentMatches) {
  return !query || conversationMatchesTitle(conversation, query) || contentMatches.has(conversation.id);
}

export function visibleConversations(conversations, input) {
  const query = normalizeConversationSearchQuery(input.query);
  const contentMatches = input.contentMatches ?? new Set();
  return baseVisibleConversations(conversations, input.showingArchived).filter((conversation) => conversationMatchesSearch(conversation, query, contentMatches));
}

export function sortConversations(items) {
  return [...items].sort((first, second) => Number(Boolean(second.pinned)) - Number(Boolean(first.pinned)) || Date.parse(second.updated_at || second.created_at || '') - Date.parse(first.updated_at || first.created_at || ''));
}
