export function conversationFinalNotificationVersion(conversation) {
  return String(conversation?.final_response_at || '');
}
