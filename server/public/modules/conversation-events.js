export function createConversationEventSource(eventsUrl, { onConversation }) {
  const source = new EventSource(eventsUrl, { withCredentials: true });
  source.addEventListener('conversation', onConversation);
  source.onerror = () => {
    // EventSource reconnects automatically. History polling remains the durable fallback.
  };
  return source;
}

export function clearConversationEventRefreshTimer(timer) {
  if (timer) {
    clearTimeout(timer);
  }
  return null;
}

export function closeConversationEventSource(source) {
  source?.close?.();
  return null;
}

export function conversationEventsSupported() {
  return typeof EventSource !== 'undefined';
}
