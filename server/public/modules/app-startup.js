export async function bootstrapInitialConversation({
  loadCurrentUser,
  settings,
  initialConversationId,
  refreshConversations,
  startNewConversation,
  activeConversationId,
  conversations,
  renderHome,
  renderConversationList,
  selectConversation,
  goHome,
}) {
  const user = await loadCurrentUser();
  if (!user && !settings.apiKey) {
    return;
  }
  await refreshConversations();
  if (user && !initialConversationId && !activeConversationId() && conversations().length === 0) {
    await startNewConversation();
    return;
  }
  if (!initialConversationId) {
    renderHome();
    renderConversationList();
    return;
  }
  const selected = await selectConversation(initialConversationId, { replaceUrl: true });
  if (!selected) {
    goHome({ replaceUrl: true });
  }
}
