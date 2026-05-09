export function bindAppEventListeners({ elements, actions, state, windowRef = window, documentRef = document }) {
  elements.settingsButton?.addEventListener('click', actions.toggleSettingsPanel);
  elements.sidebarSettingsButton?.addEventListener('click', () => {
    actions.toggleSettingsPanel();
    actions.closeMobileDrawer();
  });
  elements.mobileMenuButton?.addEventListener('click', actions.toggleMobileDrawer);
  elements.sidebarMenuButton?.addEventListener('click', actions.toggleMobileDrawer);
  elements.modelPickerButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    actions.toggleModelPicker();
  });
  elements.mobileDrawerBackdrop?.addEventListener('click', () => actions.closeMobileDrawer({ syncHistory: true }));
  elements.chatPanel?.addEventListener('touchstart', actions.handleDrawerSwipeStart, { passive: true });
  elements.chatPanel?.addEventListener('touchend', actions.handleDrawerSwipeEnd, { passive: false });

  documentRef.addEventListener('click', (event) => {
    const target = event.target;
    if (state.openConversationMenuId() && !target?.closest?.('.conversation-menu-wrap')) {
      state.setOpenConversationMenuId(null);
      actions.renderConversationList();
    }
    if (state.floatingActionsExpanded() && !target?.closest?.('#floatingActionMenu')) {
      actions.setFloatingActionsExpanded(false);
    }
    if (state.modelPickerExpanded() && !target?.closest?.('.chat-titlebar-actions')) {
      actions.setModelPickerExpanded(false);
    }
    if (elements.settingsPanel.classList.contains('hidden')) {
      return;
    }
    if (
      elements.settingsPanel.contains(target)
      || elements.settingsButton?.contains(target)
      || elements.sidebarSettingsButton?.contains(target)
      || elements.floatingSettingsButton?.contains(target)
    ) {
      return;
    }
    actions.closeSettingsPanel({ syncHistory: true });
  });

  elements.loginForm?.addEventListener('submit', actions.handleLoginSubmit);
  elements.logoutButton?.addEventListener('click', actions.logout);
  elements.saveSettingsButton?.addEventListener('click', actions.saveSettings);
  elements.themeModeInput.addEventListener('change', () => actions.applyTheme(elements.themeModeInput.value));
  elements.autoLocationOnHereInput?.addEventListener('change', () => actions.setAutoLocationOnHere(elements.autoLocationOnHereInput.checked));
  elements.fontSizeInput.addEventListener('input', () => actions.setFontSize(elements.fontSizeInput.value));
  elements.historyPageSizeInput?.addEventListener('change', actions.changeHistoryPageSize);
  elements.newConversationButton?.addEventListener('click', actions.newConversation);
  elements.archiveToggleButton?.addEventListener('click', actions.toggleArchiveView);
  elements.conversationSearchInput?.addEventListener('input', () => actions.conversationSearchInput(elements.conversationSearchInput.value));
  elements.clearConversationSearchButton?.addEventListener('click', actions.clearConversationSearch);
  elements.clearHistoryButton?.addEventListener('click', actions.clearHistory);
  elements.healthCheckButton?.addEventListener('click', actions.healthCheck);
  elements.refreshAppButton.addEventListener('click', () => windowRef.location.reload());
  elements.floatingActionToggle?.addEventListener('click', actions.toggleFloatingActions);
  elements.floatingSettingsButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    actions.setFloatingActionsExpanded(false);
    actions.openSettingsPanel();
  });
  elements.floatingRefreshButton?.addEventListener('click', () => windowRef.location.reload());
  elements.floatingScrollTopButton?.addEventListener('click', () => {
    actions.setFloatingActionsExpanded(false);
    elements.messages.scrollTo({ top: 0, behavior: 'smooth' });
  });
  elements.floatingScrollBottomButton?.addEventListener('click', () => {
    actions.setFloatingActionsExpanded(false);
    actions.scrollToBottom({ force: true, smooth: true });
  });
  elements.continueNewSessionButton?.addEventListener('click', actions.continueInNewSession);
  elements.scrollToLatestButton?.addEventListener('click', () => actions.scrollToBottom({ force: true }));
  elements.messages.addEventListener('scroll', actions.messagesScroll);
  elements.clearCacheButton.addEventListener('click', actions.clearAppCacheAndReload);
  elements.resetAppStateButton?.addEventListener('click', actions.resetLocalAppStateAndReload);
  elements.resetPasswordButton?.addEventListener('click', actions.resetPassword);
  elements.notificationButton.addEventListener('click', actions.enableNotifications);
  elements.mediaViewerDownload.addEventListener('click', actions.downloadCurrentMedia);
  elements.mediaViewerClose.addEventListener('click', actions.closeMediaViewer);
  elements.mediaViewerImage.addEventListener('pointerdown', actions.handleMediaViewerPointerDown);
  elements.mediaViewerImage.addEventListener('pointermove', actions.handleMediaViewerPointerMove);
  elements.mediaViewerImage.addEventListener('pointerup', actions.handleMediaViewerPointerEnd);
  elements.mediaViewerImage.addEventListener('pointercancel', actions.handleMediaViewerPointerEnd);
  elements.mediaViewerImage.addEventListener('wheel', actions.handleMediaViewerWheel, { passive: false });
  elements.mediaViewerImage.addEventListener('dblclick', actions.toggleMediaViewerZoom);
  elements.mediaViewer.addEventListener('click', actions.mediaViewerBackdropClick);
  windowRef.addEventListener('popstate', actions.popState);
  documentRef.addEventListener('keydown', actions.documentKeydown);

  elements.attachButton.addEventListener('click', () => elements.attachmentInput.click());
  elements.clearMessageInputButton?.addEventListener('click', actions.clearMessageInput);
  elements.attachmentInput.addEventListener('change', actions.attachmentInputChange);
  elements.messageInput.addEventListener('paste', actions.handleMessagePaste);
  elements.messageForm.addEventListener('dragenter', actions.handleComposerDragEnter);
  elements.messageForm.addEventListener('dragover', actions.handleComposerDragOver);
  elements.messageForm.addEventListener('dragleave', actions.handleComposerDragLeave);
  elements.messageForm.addEventListener('drop', actions.handleComposerDrop);
  elements.messageForm.addEventListener('submit', actions.handleSubmit);
  elements.messageInput.addEventListener('input', actions.messageInputChanged);
  elements.messageInput.addEventListener('blur', () => windowRef.setTimeout(actions.hideSlashCommandPalette, 160));
  elements.sidebarResizeHandle?.addEventListener('pointerdown', actions.startSidebarResize);
  windowRef.addEventListener('pointermove', actions.moveSidebarResize);
  windowRef.addEventListener('pointerup', actions.finishSidebarResize);
  windowRef.addEventListener('pointercancel', actions.cancelSidebarResize);
  windowRef.addEventListener('resize', actions.syncSidebarWidthToViewport);
  elements.messageInput.addEventListener('keydown', actions.messageInputKeydown);
}
