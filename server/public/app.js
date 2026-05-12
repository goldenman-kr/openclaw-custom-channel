import { bindAppEventListeners } from './modules/app-event-bindings.js';
import { clearAppCacheAndReload as clearAppCacheAndReloadWithDeps, downloadUrlThroughAndroidClient, resetLocalAppStateAndReload as resetLocalAppStateAndReloadWithDeps, runHealthCheckAndReport } from './modules/app-maintenance.js';
import { bootstrapInitialConversation } from './modules/app-startup.js';
import { addAttachmentFilesToSelection, attachmentSummary as summarizeAttachments, buildAttachmentPayload, filesFromDataTransfer, filesFromUnknownList, hasDraggedFiles, nextComposerDragDepth, updateComposerDragOver } from './modules/attachment-input.js';
import { createAttachmentPreview } from './modules/attachment-preview.js';
import { changePassword, fetchCurrentUser, loginUser, logoutUser } from './modules/auth-api.js';
import { renderAttachmentTray as renderAttachmentTrayView } from './modules/attachment-tray.js';
import { MAX_ATTACHMENTS, formatBytes } from './modules/attachments.js';
import { createConversation as createConversationFromApi, destroyConversation as destroyConversationFromApi, fetchConversations as fetchConversationsFromApi, patchConversation as patchConversationFromApi, updateConversationTitle as updateConversationTitleFromApi } from './modules/conversation-api.js';
import { createConversationListItem } from './modules/conversation-list-item.js';
import { conversationListEmptyMessage as getConversationListEmptyMessage, createConversationListEmptyState, updateArchiveToggleButton as updateArchiveToggleButtonView, updateSidebarSummary as updateSidebarSummaryView } from './modules/conversation-list-view.js';
import { baseVisibleConversations as filterBaseVisibleConversations, conversationMatchesTitle as matchesConversationTitle, isConversationArchived, normalizeConversationSearchQuery, sortConversations, visibleConversations as filterVisibleConversations } from './modules/conversation-list.js';
import { fetchConversationModelMenu as fetchConversationModelMenuFromApi, patchConversationModel as patchConversationModelFromApi, patchConversationThinking as patchConversationThinkingFromApi } from './modules/conversation-model-api.js';
import { searchConversationContent } from './modules/conversation-search.js';
import { applyComposerAvailability, composerAvailabilityState } from './modules/composer-availability.js';
import { clearComposerDraft as clearStoredComposerDraft, loadComposerDraft, saveComposerDraft as saveStoredComposerDraft } from './modules/composer-draft.js';
import { apiUrl as buildApiUrl, assertValidApiKey } from './modules/api-client.js';
import { copyTextToClipboard } from './modules/clipboard.js';
import { createPlainCodeBlock } from './modules/code-block.js';
import { autoResizeTextarea as resizeComposerTextarea, updateClearMessageInputButton as updateComposerClearButton } from './modules/composer-input.js';
import { openDeleteDialog as openDeleteDialogView, openRenameDialog as openRenameDialogView } from './modules/conversation-dialogs.js';
import { conversationTitle, formatConversationDate, formatMessageTimestamp } from './modules/conversation-format.js';
import { applyDisplaySettings as applyDisplaySettingsToElements, applyTheme, normalizeFontSize, syncNativeTheme } from './modules/display.js';
import { applyFloatingActionsExpanded } from './modules/floating-actions.js';
import { fetchConversationHistory as fetchConversationHistoryFromApi, fetchHistory as fetchHistoryFromApi, fetchHistoryMeta as fetchHistoryMetaFromApi } from './modules/history-api.js';
import { fetchChangedHistory as fetchChangedHistoryFromApi, reconcilePendingJobWithHistory as reconcilePendingJobWithHistoryFromHistory, shouldPollHistory as shouldPollHistoryFromState } from './modules/history-refresh.js';
import { buildNewSessionHandoffMessage } from './modules/history-handoff.js';
import { createHistoryLoadMoreControl, resetHistoryLoadMoreButton } from './modules/history-controls.js';
import { createHomeScreen } from './modules/home-screen.js';
import { isMobileLikeInput, slashCommandUsesCurrentLocation } from './modules/input-context.js';
import { hideLoginScreen as hideLoginScreenView, showLoginScreen as showLoginScreenView } from './modules/login-screen.js';
import { getCurrentLocationMetadata } from './modules/location.js';
import { messageTextWithoutAttachmentPreview, renderedHistorySignature } from './modules/history-render-signature.js';
import { sendMessage as sendMessageToApi } from './modules/message-api.js';
import { isPendingHistoryMessage, isPlaceholderPendingText, isRunningJobHistoryMessage, shouldRerenderHistory as shouldRerenderHistorySnapshot } from './modules/history-state.js';
import { cancelJobById, fetchJobById, isAlreadyFinishedJobError, isJobResolvedInHistory as isJobResolvedInHistoryFromApi, waitForJobPolling } from './modules/job-api.js';
import { waitForJobEventStream } from './modules/job-events.js';
import { delay, isTerminalJobState, parseSseBlock } from './modules/job-utils.js';
import { appendMarkdown as appendMarkdownView } from './modules/markdown-renderer.js';
import { canonicalMediaRefKey, extractMediaRefs, mediaRefsFromHistoryAttachments } from './modules/media.js';
import { createMediaViewerController } from './modules/media-viewer-controller.js';
import { appendMediaRef as appendMediaRefView } from './modules/media-ref-renderer.js';
import { collectBlobUrlsInUse, pruneMediaUrlCache as pruneMediaUrlCacheEntries, revokeCachedMediaUrl as revokeCachedMediaUrlEntry } from './modules/media-url-cache.js';
import { appendCancelJobAction as appendCancelJobActionView, appendCopyAction as appendCopyActionView, appendRetryAction as appendRetryActionView } from './modules/message-action-renderer.js';
import { appendAttachmentPreview as appendAttachmentPreviewView, createMessageNode } from './modules/message-dom.js';
import { mergeMediaRefs } from './modules/message-actions.js';
import { createModelPickerController } from './modules/model-picker-controller.js';
import { renderModelPicker as renderModelPickerView, updateModelPickerButtonState as updateModelPickerButtonStateView } from './modules/model-picker.js';
import { closeDrawer, drawerSwipeGesture, isDesktopLayout as isDesktopViewport, isDrawerOpen, openDrawer, shouldIgnoreDrawerSwipe as shouldIgnoreDrawerSwipeTarget, toggleDesktopSidebar } from './modules/mobile-drawer.js';
import { getPushNotificationSupportState, notificationsSupported, notifyReplyReady as notifyReplyReadyBrowser, requestNotificationPermission, subscribeToPushNotifications, unsubscribeFromPushNotifications, updateNotificationButton as updateNotificationButtonView } from './modules/notifications.js';
import { clearConversationEventRefreshTimer, closeConversationEventSource, conversationEventsSupported, createConversationEventSource } from './modules/conversation-events.js';
import { conversationIdFromPath, syncConversationUrl } from './modules/navigation.js';
import { startIntervalIfNeeded, stopIntervalIfNeeded, syncVisiblePagePolling } from './modules/page-lifecycle.js';
import { createPendingJobController } from './modules/pending-job-controller.js';
import { promptPasswordChange } from './modules/password-flow.js';
import { applySettingsToFormControls, readSettingsFromFormControls } from './modules/settings-form.js';
import { openSettingsPanel as openSettingsPanelView, closeSettingsPanel as closeSettingsPanelView } from './modules/settings-panel.js';
import { continueInNewSessionFlow } from './modules/session-handoff-controller.js';
import { loadSettings, normalizeHistoryPageSize, saveSettings } from './modules/settings.js';
import { isNearBottom as isMessagesNearBottom, hideMessagesScrollIndicator, hideScrollToLatestButton as hideScrollButton, preserveScrollAfterRender as preserveMessagesScrollAfterRender, scheduleScrollToBottom, showScrollToLatestButton as showScrollButton, updateMessagesScrollIndicator as updateMessagesScrollIndicatorUi } from './modules/scroll-ui.js';
import { createSidebarResizeController } from './modules/sidebar-resize-controller.js';
import { canResizeSidebar as canResizeSidebarView, sidebarResizeStateFromEvent, sidebarResizeWidth } from './modules/sidebar-resize.js';
import { applyStoredSidebarWidth, clampSidebarWidth, saveSidebarWidth, SIDEBAR_RESIZE_MEDIA } from './modules/sidebar-width.js';
import { matchingSlashCommands as findMatchingSlashCommands, renderSlashCommandPalette as renderSlashCommandPaletteView } from './modules/slash-commands.js';
import { createStreamingController } from './modules/streaming-controller.js';
import { handleSubmitFlow } from './modules/submit-controller.js';
import { notifyJobResult, outgoingMessageForSubmit, resetComposerAfterSubmit, restoreComposerAfterSubmitFailure, schedulePostSubmitRefresh, shouldIncludeLocationForMessage, submitValidationMessage } from './modules/submit-flow.js';
import { showToast } from './modules/toast.js';
import { currentUserDisplayName as getCurrentUserDisplayName, sharedUserId as getSharedUserId } from './modules/user-identity.js';
import { checkClientServerVersion as checkClientServerVersionWithDeps } from './modules/version-check.js';
import { renderCodeBlockPlugin } from './plugins/plugin-registry.js';
import './plugins/spot-order-card.js';
import './plugins/spot-wallet-intent.js';
import './plugins/spot-wallet-balance.js';
import './plugins/orbs-polygon-bridge-card.js';
import './plugins/wallet-transaction-card.js';

const PENDING_JOB_KEY = 'openclaw-web-channel-pending-job-v1';
const PUSH_DEVICE_ID_KEY = 'openclaw-web-channel-push-device-id-v1';
const CLIENT_ASSET_VERSION = 'pwa-client-2026-05-12-ios-keyboard-scroll-001';
const CLIENT_API_VERSION = 1;
const elements = {
  loginScreen: document.querySelector('#loginScreen'),
  loginForm: document.querySelector('#loginForm'),
  loginUsernameInput: document.querySelector('#loginUsernameInput'),
  loginPasswordInput: document.querySelector('#loginPasswordInput'),
  loginSubmitButton: document.querySelector('#loginSubmitButton'),
  loginStatusText: document.querySelector('#loginStatusText'),
  logoutButton: document.querySelector('#logoutButton'),
  settingsButton: document.querySelector('#settingsButton'),
  chatPanel: document.querySelector('.chat-panel'),
  floatingActionMenu: document.querySelector('#floatingActionMenu'),
  floatingActionPanel: document.querySelector('#floatingActionPanel'),
  floatingActionToggle: document.querySelector('#floatingActionToggle'),
  floatingSettingsButton: document.querySelector('#floatingSettingsButton'),
  floatingRefreshButton: document.querySelector('#floatingRefreshButton'),
  floatingScrollTopButton: document.querySelector('#floatingScrollTopButton'),
  floatingScrollBottomButton: document.querySelector('#floatingScrollBottomButton'),
  continueNewSessionButton: document.querySelector('#continueNewSessionButton'),
  scrollToLatestButton: document.querySelector('#scrollToLatestButton'),
  sidebarSettingsButton: document.querySelector('#sidebarSettingsButton'),
  archiveToggleButton: document.querySelector('#archiveToggleButton'),
  mobileMenuButton: document.querySelector('#mobileMenuButton'),
  sidebarMenuButton: document.querySelector('#sidebarMenuButton'),
  modelPickerButton: document.querySelector('#modelPickerButton'),
  modelPickerPanel: document.querySelector('#modelPickerPanel'),
  modelPickerStatus: document.querySelector('#modelPickerStatus'),
  modelPickerList: document.querySelector('#modelPickerList'),
  chatTitle: document.querySelector('#chatTitle'),
  mobileDrawerBackdrop: document.querySelector('#mobileDrawerBackdrop'),
  conversationSidebar: document.querySelector('#conversationSidebar'),
  sidebarResizeHandle: document.querySelector('#sidebarResizeHandle'),
  newConversationButton: document.querySelector('#newConversationButton'),
  sidebarOwnerTitle: document.querySelector('#sidebarOwnerTitle'),
  sidebarConversationCount: document.querySelector('#sidebarConversationCount'),
  conversationList: document.querySelector('#conversationList'),
  conversationSearchInput: document.querySelector('#conversationSearchInput'),
  clearConversationSearchButton: document.querySelector('#clearConversationSearchButton'),
  conversationRenameDialog: document.querySelector('#conversationRenameDialog'),
  conversationRenameInput: document.querySelector('#conversationRenameInput'),
  conversationRenameCancel: document.querySelector('#conversationRenameCancel'),
  conversationRenameConfirm: document.querySelector('#conversationRenameConfirm'),
  conversationDeleteDialog: document.querySelector('#conversationDeleteDialog'),
  conversationDeleteText: document.querySelector('#conversationDeleteText'),
  conversationDeleteCancel: document.querySelector('#conversationDeleteCancel'),
  conversationDeleteConfirm: document.querySelector('#conversationDeleteConfirm'),
  settingsPanel: document.querySelector('#settingsPanel'),
  apiUrlInput: document.querySelector('#apiUrlInput'),
  apiKeyInput: document.querySelector('#apiKeyInput'),
  deviceIdInput: document.querySelector('#deviceIdInput'),
  themeModeInput: document.querySelector('#themeModeInput'),
  autoLocationOnHereInput: document.querySelector('#autoLocationOnHereInput'),
  fontSizeInput: document.querySelector('#fontSizeInput'),
  fontSizeValue: document.querySelector('#fontSizeValue'),
  historyPageSizeInput: document.querySelector('#historyPageSizeInput'),
  saveSettingsButton: document.querySelector('#saveSettingsButton'),
  healthCheckButton: document.querySelector('#healthCheckButton'),
  resetPasswordButton: document.querySelector('#resetPasswordButton'),
  refreshAppButton: document.querySelector('#refreshAppButton'),
  clearCacheButton: document.querySelector('#clearCacheButton'),
  resetAppStateButton: document.querySelector('#resetAppStateButton'),
  notificationButton: document.querySelector('#notificationButton'),
  clearHistoryButton: document.querySelector('#clearHistoryButton'),
  messages: document.querySelector('#messages'),
  messagesScrollIndicator: document.querySelector('#messagesScrollIndicator'),
  messageForm: document.querySelector('#messageForm'),
  messageInput: document.querySelector('#messageInput'),
  clearMessageInputButton: document.querySelector('#clearMessageInputButton'),
  includeLocationInput: document.querySelector('#includeLocationInput'),
  attachmentInput: document.querySelector('#attachmentInput'),
  attachButton: document.querySelector('#attachButton'),
  attachmentTray: document.querySelector('#attachmentTray'),
  slashCommandPalette: document.querySelector('#slashCommandPalette'),
  mediaViewer: document.querySelector('#mediaViewer'),
  mediaViewerImage: document.querySelector('#mediaViewerImage'),
  mediaViewerDownload: document.querySelector('#mediaViewerDownload'),
  mediaViewerClose: document.querySelector('#mediaViewerClose'),
  sendButton: document.querySelector('#sendButton'),
  statusText: document.querySelector('#statusText'),
};

function isIosLikeBrowser() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isComposerInputFocused() {
  return document.activeElement === elements.messageInput || elements.messageForm?.contains(document.activeElement);
}

function syncViewportHeight() {
  const viewport = window.visualViewport;
  const height = viewport?.height || window.innerHeight;
  if (height > 0) {
    document.documentElement.style.setProperty('--app-viewport-height', `${height}px`);
  }
  const bottomBleed = window.matchMedia?.('(display-mode: standalone)')?.matches
    ? Math.max(0, Math.round((window.screen?.height || 0) - window.innerHeight))
    : 0;
  document.documentElement.style.setProperty('--app-bottom-bleed', `${Math.min(bottomBleed, 96)}px`);

  const keyboardOpen = isIosLikeBrowser() && isComposerInputFocused() && viewport && viewport.height < window.innerHeight - 80;
  document.body.classList.toggle('ios-keyboard-open', Boolean(keyboardOpen));
  if (keyboardOpen) {
    const composerHeight = Math.ceil(elements.messageForm?.getBoundingClientRect().height || 96);
    const keyboardBottom = Math.max(0, Math.round(window.innerHeight - (viewport.offsetTop + viewport.height)));
    document.documentElement.style.setProperty('--ios-keyboard-top', `${Math.max(0, Math.round(viewport.offsetTop + viewport.height))}px`);
    document.documentElement.style.setProperty('--ios-keyboard-bottom', `${keyboardBottom}px`);
    document.documentElement.style.setProperty('--composer-height', `${composerHeight}px`);
    window.scrollTo(0, 0);
    scrollToBottom({ force: true });
    window.setTimeout(() => scrollToBottom({ force: true }), 80);
    window.setTimeout(() => scrollToBottom({ force: true }), 240);
  } else {
    document.documentElement.style.setProperty('--ios-keyboard-top', `${height}px`);
    document.documentElement.style.setProperty('--ios-keyboard-bottom', '0px');
    if (!isComposerInputFocused()) {
      document.body.classList.remove('ios-composer-focus-pending');
      document.documentElement.style.removeProperty('--composer-height');
    }
  }
}

syncViewportHeight();
window.visualViewport?.addEventListener('resize', syncViewportHeight);
window.visualViewport?.addEventListener('scroll', syncViewportHeight);
window.addEventListener('resize', syncViewportHeight);

applyStoredSidebarWidth();

let settings = loadSettings();
let historyPollTimer = null;
let versionCheckTimer = null;
let conversationListPollTimer = null;
let conversationEventSource = null;
let conversationEventConversationId = '';
let conversationEventRefreshTimer = null;
let isSendingMessage = false;
let selectedAttachments = [];
let composerDragDepth = 0;
let lastHistoryVersion = null;
let activeHistoryLimit = normalizeHistoryPageSize(settings.historyPageSize);
let lastHistoryHasMore = false;
let loadingOlderHistory = false;
let activeConversation = null;
let openConversationMenuId = null;
let floatingActionsExpanded = false;
let conversations = [];
let showingArchived = false;
let messagesScrollIndicatorTimer = null;
let drawerSwipeStart = null;
const mediaUrlCache = new Map();
const MEDIA_URL_CACHE_LIMIT = 64;
let selectedSlashCommandIndex = 0;
let conversationSearchQuery = '';
let conversationContentMatches = new Set();
let conversationSearchTimer = null;
let conversationSearchRunId = 0;
const conversationSearchCache = new Map();
const unreadConversationIds = new Set();
let conversationUpdateVersions = new Map();
let conversationListObserved = false;
let settingsPanelHistoryActive = false;
let mobileDrawerHistoryActive = false;
let authUser = null;
const modelPicker = createModelPickerController({
  elements,
  hasConversation: () => Boolean(activeConversation?.id),
  fetchMenu: fetchConversationModelMenu,
  patchModel: patchConversationModel,
  patchThinking: patchConversationThinking,
  renderModelPicker: renderModelPickerView,
  updateModelPickerButtonState: updateModelPickerButtonStateView,
  showToast,
});
const sidebarResize = createSidebarResizeController({
  elements,
  canResizeSidebar,
  stateFromEvent: sidebarResizeStateFromEvent,
  widthFromState: sidebarResizeWidth,
  clampWidth: clampSidebarWidth,
  saveWidth: saveSidebarWidth,
  applyStoredWidth: applyStoredSidebarWidth,
});
const mediaViewer = createMediaViewerController({ elements });
const streaming = createStreamingController({
  messagesRoot: elements.messages,
  appendMessage,
  renderMessageNode,
  messageText: messageTextWithoutAttachmentPreview,
  isPlaceholderPendingText,
  isActiveConversation,
});
const pendingJobs = createPendingJobController({
  storage: localStorage,
  storageKey: PENDING_JOB_KEY,
  settings: () => settings,
  authUser: () => authUser,
  activeConversationId,
  isActiveConversation,
  messagesRoot: elements.messages,
  messageText: messageTextWithoutAttachmentPreview,
  renderMessageNode,
  updateComposerAvailability,
  fetchJob,
  isTerminalJobState,
  setSending,
  setStatus,
  cancelJob,
  refreshHistoryIfChanged,
  refreshConversations,
  showToast,
  appendMessage,
  isAlreadyFinishedJobError,
});

window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => {
  if (!['light', 'dark'].includes(settings.themeMode)) {
    syncNativeTheme(settings.themeMode || 'system');
  }
});

function applyDisplaySettings() {
  applyDisplaySettingsToElements(settings, elements);
}

function applySettingsToForm() {
  settings = applySettingsToFormControls(elements, settings, window.location.origin);
  updateNotificationButton();
  applyTheme(settings.themeMode || 'dark');
  applyDisplaySettings();
}

function updateNotificationButton() {
  updateNotificationButtonView(elements.notificationButton, settings.notificationsEnabled);
}

async function enableNotifications() {
  if (settings.notificationsEnabled && notificationsSupported() && Notification.permission === 'granted') {
    try {
      await unsubscribeFromPushNotifications({
        apiFetch,
        apiHeaders,
        deviceId: getPushDeviceId(),
      });
      settings.notificationsEnabled = false;
      saveSettings(settings);
      updateNotificationButton();
      appendMessage('system', '푸시 알림을 껐습니다.', { persist: false });
    } catch (error) {
      appendMessage('system', `푸시 알림 해제 실패: ${error instanceof Error ? error.message : String(error)}`, { persist: false });
    }
    return;
  }
  if (!notificationsSupported()) {
    const support = getPushNotificationSupportState();
    appendMessage('system', support.message || '이 환경은 브라우저 알림을 지원하지 않습니다.', { persist: false });
    return;
  }
  try {
    const result = await subscribeToPushNotifications({
      apiFetch,
      apiHeaders,
      deviceId: getPushDeviceId(),
    });
    if (result.ok) {
      settings.notificationsEnabled = true;
      saveSettings(settings);
      updateNotificationButton();
      appendMessage('system', '응답 도착 푸시 알림을 켰습니다.', { persist: false });
      return;
    }
    if (result.reason === 'ios-install-required' || result.reason === 'push-unsupported') {
      settings.notificationsEnabled = false;
      saveSettings(settings);
      updateNotificationButton();
      appendMessage('system', result.message || '이 환경에서는 백그라운드 푸시 알림을 사용할 수 없습니다.', { persist: false });
      return;
    }
    const permission = result.reason === 'notification-unsupported' ? 'unsupported' : result.reason;
    settings.notificationsEnabled = permission === 'granted';
    saveSettings(settings);
    updateNotificationButton();
    appendMessage('system', permission === 'granted' ? '이 환경에서는 앱이 열려 있을 때의 탭 알림만 사용할 수 있습니다.' : '알림 권한이 허용되지 않았습니다.', { persist: false });
  } catch (error) {
    settings.notificationsEnabled = false;
    saveSettings(settings);
    updateNotificationButton();
    appendMessage('system', `푸시 알림 설정 실패: ${error instanceof Error ? error.message : String(error)}`, { persist: false });
  }
}

function getPushDeviceId() {
  const existing = localStorage.getItem(PUSH_DEVICE_ID_KEY);
  if (existing) {
    return existing;
  }
  const id = `pwa_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
  localStorage.setItem(PUSH_DEVICE_ID_KEY, id);
  return id;
}

function notifyReplyReady(title = 'OpenClaw 응답 도착', body = '새 답변이 도착했습니다.') {
  notifyReplyReadyBrowser({ enabled: settings.notificationsEnabled, title, body });
}

function renderAttachmentTray() {
  renderAttachmentTrayView(elements.attachmentTray, selectedAttachments, {
    formatBytes,
    onRemove: (index) => {
      selectedAttachments = selectedAttachments.filter((_, itemIndex) => itemIndex !== index);
      renderAttachmentTray();
    },
  });
}

function addAttachmentFiles(files) {
  selectedAttachments = addAttachmentFilesToSelection(selectedAttachments, files, { maxAttachments: MAX_ATTACHMENTS });
  renderAttachmentTray();
}

function addAttachmentFilesSafely(files, sourceLabel = '첨부') {
  const fileList = filesFromUnknownList(files);
  if (fileList.length === 0) {
    return false;
  }
  if (isSendingMessage) {
    appendMessage('system', '응답 전송 중에는 첨부 파일을 추가할 수 없습니다.', { persist: false });
    return true;
  }
  if (!activeConversation?.id) {
    appendMessage('system', '새 대화를 열거나 목록에서 대화를 선택한 뒤 파일을 첨부해주세요.', { persist: false });
    return true;
  }
  if (isConversationArchived(activeConversation)) {
    appendMessage('system', '보관된 대화에는 파일을 첨부할 수 없습니다. 대화를 이어가려면 아카이브를 해제하세요.', { persist: false });
    return true;
  }
  try {
    addAttachmentFiles(fileList);
    setStatus(`${sourceLabel}: ${fileList.length}개 파일을 첨부했습니다.`);
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  }
  return true;
}

function handleMessagePaste(event) {
  const files = filesFromDataTransfer(event.clipboardData);
  if (files.length === 0) {
    return;
  }
  event.preventDefault();
  addAttachmentFilesSafely(files, '붙여넣기');
}

function setComposerDragOver(active) {
  updateComposerDragOver(elements.messageForm, active);
}

function resetComposerDragState() {
  composerDragDepth = 0;
  setComposerDragOver(false);
}

function handleComposerDragEnter(event) {
  if (!hasDraggedFiles(event)) {
    return;
  }
  event.preventDefault();
  composerDragDepth = nextComposerDragDepth(composerDragDepth, event, 1);
  setComposerDragOver(true);
}

function handleComposerDragOver(event) {
  if (!hasDraggedFiles(event)) {
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
  setComposerDragOver(true);
}

function handleComposerDragLeave(event) {
  if (!hasDraggedFiles(event)) {
    return;
  }
  composerDragDepth = nextComposerDragDepth(composerDragDepth, event, -1);
  if (composerDragDepth === 0) {
    setComposerDragOver(false);
  }
}

function handleComposerDrop(event) {
  if (!hasDraggedFiles(event)) {
    return;
  }
  event.preventDefault();
  resetComposerDragState();
  addAttachmentFilesSafely(filesFromDataTransfer(event.dataTransfer), '드래그 앤 드롭');
}

async function buildAttachmentsPayload() {
  return Promise.all(selectedAttachments.map((file) => buildAttachmentPayload(file)));
}

function attachmentSummary(files = selectedAttachments) {
  return summarizeAttachments(files);
}

function readSettingsFromForm() {
  return readSettingsFromFormControls(elements, settings, window.location.origin);
}

function setStatus(message) {
  elements.statusText.textContent = message || '';
}

async function checkClientServerVersion() {
  await checkClientServerVersionWithDeps({
    apiUrl: settings.apiUrl,
    apiHeaders,
    clearAppCacheAndReload,
    clientApiVersion: CLIENT_API_VERSION,
    clientAssetVersion: CLIENT_ASSET_VERSION,
  });
}
function isNearBottom(threshold = 120) {
  return isMessagesNearBottom(elements.messages, threshold);
}

function showScrollToLatestButton() {
  showScrollButton(elements.scrollToLatestButton);
}

function hideScrollToLatestButton() {
  hideScrollButton(elements.scrollToLatestButton);
}

function updateMessagesScrollIndicator() {
  updateMessagesScrollIndicatorUi(elements.messages, elements.messagesScrollIndicator);
}

function hideMessagesScrollIndicatorSoon() {
  window.clearTimeout(messagesScrollIndicatorTimer);
  messagesScrollIndicatorTimer = window.setTimeout(() => {
    hideMessagesScrollIndicator(elements.messages, elements.messagesScrollIndicator);
  }, 800);
}

function scrollToBottom(options = {}) {
  scheduleScrollToBottom(elements.messages, {
    ...options,
    wasNearBottom: isNearBottom(),
    onBlocked: showScrollToLatestButton,
    onComplete: hideScrollToLatestButton,
  });
}
function preserveScrollAfterRender(previousBottomOffset) {
  preserveMessagesScrollAfterRender(elements.messages, previousBottomOffset);
}

function isDesktopLayout() {
  return isDesktopViewport();
}

function openMobileDrawer(options = {}) {
  if (isDesktopLayout()) {
    return;
  }
  const wasOpen = openDrawer(elements.mobileMenuButton);
  if (!wasOpen && options.pushHistory !== false && window.history?.pushState) {
    window.history.pushState({ ...(window.history.state || {}), mobileDrawerOpen: true }, '', window.location.href);
    mobileDrawerHistoryActive = true;
  }
}

function closeMobileDrawer(options = {}) {
  const wasOpen = closeDrawer(elements.mobileMenuButton);
  if (options.syncHistory && wasOpen && mobileDrawerHistoryActive && window.history?.back) {
    mobileDrawerHistoryActive = false;
    window.history.back();
    return;
  }
  if (wasOpen || options.syncHistory === false) {
    mobileDrawerHistoryActive = false;
  }
}

function toggleMobileDrawer() {
  if (isDesktopLayout()) {
    toggleDesktopSidebar(elements.mobileMenuButton);
    return;
  }
  if (isDrawerOpen()) {
    closeMobileDrawer({ syncHistory: true });
  } else {
    openMobileDrawer();
  }
}

function shouldIgnoreDrawerSwipe(target) {
  return shouldIgnoreDrawerSwipeTarget(target);
}

function handleDrawerSwipeStart(event) {
  if (!isMobileLikeInput() || isDrawerOpen() || !elements.mediaViewer.classList.contains('hidden')) {
    drawerSwipeStart = null;
    return;
  }
  const touch = event.touches?.[0];
  if (!touch || shouldIgnoreDrawerSwipe(event.target)) {
    drawerSwipeStart = null;
    return;
  }
  drawerSwipeStart = {
    x: touch.clientX,
    y: touch.clientY,
    time: Date.now(),
  };
}

function handleDrawerSwipeEnd(event) {
  if (!drawerSwipeStart) {
    return;
  }
  const touch = event.changedTouches?.[0];
  const start = drawerSwipeStart;
  drawerSwipeStart = null;
  if (!touch) {
    return;
  }
  const gesture = drawerSwipeGesture(start, touch);
  if (!gesture) {
    return;
  }
  event.preventDefault?.();
  if (gesture === 'open-menu') {
    elements.mobileMenuButton?.click();
  } else {
    openSettingsPanel();
  }
}

function persistMessage() {
  // Server-side history is authoritative. This hook is intentionally kept as a no-op.
}

function currentMediaUrlsInUse() {
  return collectBlobUrlsInUse({ mediaViewerUrl: mediaViewer.currentUrl(), messagesRoot: elements.messages });
}

function revokeCachedMediaUrl(ref, url) {
  revokeCachedMediaUrlEntry(mediaUrlCache, ref, url);
}

function pruneMediaUrlCache(options = {}) {
  const limit = Number.isFinite(options.limit) ? Number(options.limit) : MEDIA_URL_CACHE_LIMIT;
  pruneMediaUrlCacheEntries(mediaUrlCache, {
    limit,
    force: options.force,
    urlsInUse: currentMediaUrlsInUse(),
  });
}

function clearRenderedMessages() {
  elements.messages.replaceChildren();
  pruneMediaUrlCache();
}

async function sharedUserId() {
  return getSharedUserId({ apiKey: settings.apiKey, sessionNonce: settings.sessionNonce });
}

async function historyHeaders() {
  assertValidApiKey(settings.apiKey);
  return {
    ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}`, 'x-user-id': await sharedUserId() } : {}),
  };
}

function canUseApi() {
  return Boolean(settings.apiUrl && (authUser || settings.apiKey));
}

function apiUrl(path, params = {}) {
  return buildApiUrl(settings.apiUrl, path, params);
}

async function apiHeaders(extra = {}) {
  return {
    ...(await historyHeaders()),
    ...extra,
  };
}

async function apiFetch(path, options = {}) {
  const response = await fetch(apiUrl(path, options.params || {}), {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.headers || {}),
    },
  });
  if (response.status === 401) {
    authUser = null;
    showLoginScreen();
  }
  return response;
}

function showLoginScreen(message = '') {
  showLoginScreenView({
    screen: elements.loginScreen,
    statusText: elements.loginStatusText,
  }, message);
}

function hideLoginScreen() {
  hideLoginScreenView({
    screen: elements.loginScreen,
    passwordInput: elements.loginPasswordInput,
  });
}

async function loadCurrentUser() {
  authUser = await fetchCurrentUser(apiFetch);
  if (!authUser) {
    showLoginScreen();
    return null;
  }
  hideLoginScreen();
  startConversationListPolling();
  return authUser;
}

async function login(username, password) {
  authUser = await loginUser(apiFetch, username, password);
  resetConversationNotificationState();
  hideLoginScreen();
  startConversationListPolling();
  return authUser;
}

async function logout() {
  await logoutUser(apiFetch);
  authUser = null;
  conversations = [];
  activeConversation = null;
  resetConversationNotificationState();
  stopConversationListPolling();
  clearPendingJob();
  closeMediaViewer({ syncHistory: false });
  renderHome();
  pruneMediaUrlCache({ force: true, limit: 0 });
  renderConversationList();
  showLoginScreen('로그아웃되었습니다.');
}

function activeConversationId() {
  return activeConversation?.id || '';
}

function saveComposerDraft(conversationId = activeConversationId()) {
  saveStoredComposerDraft(conversationId, elements.messageInput.value);
}

function clearComposerDraft(conversationId = activeConversationId()) {
  clearStoredComposerDraft(conversationId);
}

function restoreComposerDraft(conversationId = activeConversationId()) {
  elements.messageInput.value = loadComposerDraft(conversationId);
  autoResizeTextarea();
  selectedSlashCommandIndex = 0;
  renderSlashCommandPalette();
}

function updateChatTitle() {
  if (!elements.chatTitle) {
    return;
  }
  elements.chatTitle.textContent = activeConversation?.id ? conversationTitle(activeConversation) : 'OpenClaw';
  updateModelPickerButtonState();
}

function normalizedConversationSearchQuery() {
  return normalizeConversationSearchQuery(conversationSearchQuery);
}

function updateConversationSearchClearButton() {
  elements.clearConversationSearchButton?.classList.toggle('hidden', !conversationSearchQuery);
}

function conversationMatchesTitle(conversation, query = normalizedConversationSearchQuery()) {
  return matchesConversationTitle(conversation, query);
}

function baseVisibleConversations() {
  return filterBaseVisibleConversations(conversations, showingArchived);
}

async function runConversationContentSearch(runId, query) {
  if (!query || !canUseApi()) {
    conversationContentMatches = new Set();
    renderConversationList();
    return;
  }
  const nextMatches = await searchConversationContent(runId, query, {
    apiFetch,
    historyHeaders,
    showingArchived,
    baseVisibleConversations,
    conversationMatchesTitle,
    cache: conversationSearchCache,
    currentRunId: () => conversationSearchRunId,
  });
  if (runId !== conversationSearchRunId) {
    return;
  }
  const titleMatches = new Set(baseVisibleConversations().filter((conversation) => conversationMatchesTitle(conversation, query)).map((conversation) => conversation.id));
  conversationContentMatches = new Set([...nextMatches].filter((id) => !titleMatches.has(id)));
  renderConversationList();
}

function scheduleConversationSearch() {
  const query = normalizedConversationSearchQuery();
  conversationSearchRunId += 1;
  const runId = conversationSearchRunId;
  if (conversationSearchTimer) {
    window.clearTimeout(conversationSearchTimer);
  }
  conversationSearchTimer = window.setTimeout(() => {
    runConversationContentSearch(runId, query).catch(() => {});
  }, query ? 260 : 0);
}

function visibleConversations() {
  return filterVisibleConversations(conversations, {
    query: conversationSearchQuery,
    showingArchived,
    contentMatches: conversationContentMatches,
  });
}

function currentUserDisplayName() {
  return getCurrentUserDisplayName(authUser);
}

function updateSidebarSummary() {
  updateSidebarSummaryView({
    ownerTitle: elements.sidebarOwnerTitle,
    countNode: elements.sidebarConversationCount,
    canUseApi: canUseApi(),
    ownerName: currentUserDisplayName(),
    count: baseVisibleConversations().length,
    showingArchived,
  });
}

function updateArchiveToggleButton() {
  updateArchiveToggleButtonView(elements.archiveToggleButton, showingArchived);
}

function updateComposerAvailability() {
  applyComposerAvailability(elements, composerAvailabilityState({
    archived: isConversationArchived(activeConversation),
    hasConversation: Boolean(activeConversation?.id),
    isSendingMessage,
  }));
  updateModelPickerButtonState();
}

function renderHome() {
  clearRenderedMessages();
  elements.messages.append(createHomeScreen({
    canUseApi: canUseApi(),
    showingArchived,
    onOpenSettings: openSettingsPanel,
    onStartNewConversation: () => startNewConversation().catch((error) => appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false })),
  }));
  lastHistoryVersion = null;
  lastHistoryHasMore = false;
  activeHistoryLimit = normalizeHistoryPageSize(settings.historyPageSize);
  updateComposerAvailability();
}

function goHome(options = {}) {
  saveComposerDraft();
  modelPicker.reset();
  activeConversation = null;
  settings.lastActiveConversationId = '';
  saveSettings(settings);
  clearPendingJob('');
  selectedAttachments = [];
  renderAttachmentTray();
  elements.messageInput.value = '';
  autoResizeTextarea();
  renderConversationList();
  stopConversationEvents();
  syncHistoryPolling();
  renderHome();
  updateChatTitle();
  syncConversationUrl('', { replace: options.replaceUrl === true });
}

function renderConversationListEmptyState(message) {
  elements.conversationList.append(createConversationListEmptyState(message));
}

function conversationListEmptyMessage(query) {
  return getConversationListEmptyMessage({ query, showingArchived });
}

function resetConversationNotificationState() {
  unreadConversationIds.clear();
  conversationUpdateVersions = new Map();
  conversationListObserved = false;
  document.querySelectorAll('.new-message-alert').forEach((node) => node.remove());
}

function conversationUpdateVersion(conversation) {
  return String(conversation?.updated_at || conversation?.created_at || '');
}

function updateConversationNotifications(nextConversations) {
  const activeId = activeConversationId();
  const nextVersions = new Map();
  for (const conversation of nextConversations) {
    const version = conversationUpdateVersion(conversation);
    nextVersions.set(conversation.id, version);
    if (conversation.id === activeId) {
      clearUnreadConversation(conversation.id);
      continue;
    }
    const previousVersion = conversationUpdateVersions.get(conversation.id);
    if (conversationListObserved && previousVersion && previousVersion !== version && !isConversationArchived(conversation)) {
      markUnreadConversation(conversation);
    }
  }
  conversationUpdateVersions = nextVersions;
  conversationListObserved = true;
}

function markUnreadConversation(conversation) {
  if (!conversation?.id || conversation.id === activeConversationId()) {
    return;
  }
  const wasUnread = unreadConversationIds.has(conversation.id);
  unreadConversationIds.add(conversation.id);
  if (!wasUnread) {
    showNewMessageAlert(conversation);
  }
}

function clearUnreadConversation(conversationId) {
  if (!conversationId) {
    return;
  }
  unreadConversationIds.delete(conversationId);
  document.querySelectorAll('.new-message-alert').forEach((node) => {
    if (node.dataset.conversationId === conversationId) {
      node.remove();
    }
  });
}

function showNewMessageAlert(conversation) {
  if (!conversation?.id || conversation.id === activeConversationId() || document.querySelector('.new-message-alert')) {
    return;
  }
  const alert = document.createElement('section');
  alert.className = 'version-alert new-message-alert';
  alert.dataset.conversationId = conversation.id;
  alert.setAttribute('role', 'alert');

  const text = document.createElement('div');
  text.className = 'version-alert__text';
  const title = document.createElement('strong');
  title.textContent = '다른 대화에 새 응답이 도착했습니다.';
  const detail = document.createElement('span');
  detail.textContent = conversationTitle(conversation);
  text.append(title, detail);

  const actions = document.createElement('div');
  actions.className = 'version-alert__actions';
  const dismiss = document.createElement('button');
  dismiss.className = 'ghost-button version-alert__dismiss';
  dismiss.type = 'button';
  dismiss.textContent = '나중에';
  dismiss.addEventListener('click', () => alert.remove());
  const open = document.createElement('button');
  open.className = 'version-alert__refresh';
  open.type = 'button';
  open.textContent = '바로가기';
  open.addEventListener('click', () => {
    alert.remove();
    selectConversation(conversation.id).catch((error) => showToast(error instanceof Error ? error.message : String(error), { kind: 'error', durationMs: 3200 }));
  });
  actions.append(dismiss, open);
  alert.append(text, actions);
  document.body.append(alert);
}

function renderConversationList() {
  updateSidebarSummary();
  if (!elements.conversationList) {
    return;
  }
  elements.conversationList.replaceChildren();
  if (!canUseApi()) {
    renderConversationListEmptyState('로그인하면 대화 목록이 표시됩니다.');
    return;
  }
  updateArchiveToggleButton();
  const list = visibleConversations();
  const query = normalizedConversationSearchQuery();
  if (list.length === 0) {
    renderConversationListEmptyState(conversationListEmptyMessage(query));
    return;
  }
  const activeId = activeConversationId();
  for (const conversation of list) {
    elements.conversationList.append(createConversationListItem(conversation, {
      activeId,
      openMenuId: openConversationMenuId,
      conversationTitle,
      formatConversationDate,
      isArchived: isConversationArchived,
      isUnread: (conversationId) => unreadConversationIds.has(conversationId),
      onSelect: selectConversation,
      onToggleMenu: (conversationId) => {
        openConversationMenuId = openConversationMenuId === conversationId ? null : conversationId;
        renderConversationList();
      },
      onTogglePinned: async (conversationId) => {
        openConversationMenuId = null;
        renderConversationList();
        await toggleConversationPinned(conversationId);
      },
      onToggleArchived: async (conversationId) => {
        openConversationMenuId = null;
        renderConversationList();
        await toggleConversationArchived(conversationId);
      },
      onRename: async (conversationId) => {
        openConversationMenuId = null;
        renderConversationList();
        await renameConversation(conversationId);
      },
      onDelete: async (conversationId) => {
        openConversationMenuId = null;
        renderConversationList();
        await deleteConversation(conversationId);
      },
    }));
  }
}

function syncActiveConversationFromList() {
  const conversationId = activeConversationId();
  if (!conversationId) {
    return null;
  }
  const latest = conversations.find((conversation) => conversation.id === conversationId) || null;
  if (!latest) {
    return null;
  }
  activeConversation = latest;
  updateChatTitle();
  updateComposerAvailability();
  return latest;
}

async function refreshConversations() {
  if (!canUseApi()) {
    conversations = [];
    resetConversationNotificationState();
    renderConversationList();
    return conversations;
  }
  const nextConversations = sortConversations(await fetchConversations());
  updateConversationNotifications(nextConversations);
  conversations = nextConversations;
  syncActiveConversationFromList();
  await pruneStoredPendingJobs(conversations).catch(() => {});
  conversationSearchCache.clear();
  renderConversationList();
  scheduleConversationSearch();
  return conversations;
}

async function selectConversation(conversationId, options = {}) {
  if (!conversationId) {
    return false;
  }
  if (conversationId === activeConversationId()) {
    clearUnreadConversation(conversationId);
    syncConversationUrl(conversationId, { replace: options.replaceUrl === true });
    renderConversationList();
    return true;
  }
  saveComposerDraft();
  const conversation = conversations.find((item) => item.id === conversationId) || null;
  if (!conversation) {
    return false;
  }
  modelPicker.reset();
  clearUnreadConversation(conversationId);
  activeConversation = conversation;
  updateChatTitle();
  settings.lastActiveConversationId = conversation.id;
  saveSettings(settings);
  syncConversationUrl(conversation.id, { replace: options.replaceUrl === true });
  lastHistoryVersion = null;
  lastHistoryHasMore = false;
  activeHistoryLimit = normalizeHistoryPageSize(settings.historyPageSize);
  clearPendingJob();
  renderConversationList();
  restoreComposerDraft(conversation.id);
  updateComposerAvailability();
  closeMobileDrawer();
  await renderHistory({ scrollToLatest: true });
  startConversationEvents(conversation.id);
  syncHistoryPolling();
  await resumePendingJobIfNeeded();
  return true;
}

async function fetchConversations() {
  return fetchConversationsFromApi({ apiFetch, historyHeaders });
}

async function createConversation(title = '새 대화') {
  return createConversationFromApi({ apiFetch, apiHeaders, title });
}

async function patchConversation(conversationId, patch) {
  return patchConversationFromApi({ apiFetch, apiHeaders, conversationId, patch });
}

async function updateConversationTitle(conversationId, title) {
  return updateConversationTitleFromApi({ apiFetch, apiHeaders, conversationId, title });
}

async function destroyConversation(conversationId) {
  return destroyConversationFromApi({ apiFetch, apiHeaders, conversationId });
}

function openRenameDialog(currentTitle) {
  return openRenameDialogView(elements, currentTitle);
}

function openDeleteDialog(title) {
  return openDeleteDialogView(elements, title);
}
async function toggleConversationPinned(conversationId) {
  const conversation = conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    return;
  }
  try {
    const updated = await patchConversation(conversation.id, { pinned: !conversation.pinned });
    conversations = sortConversations(conversations.map((item) => item.id === updated.id ? updated : item));
    if (activeConversation?.id === updated.id) {
      activeConversation = updated;
      updateChatTitle();
    }
    renderConversationList();
    appendMessage('system', updated.pinned ? '대화를 상단에 고정했습니다.' : '대화 상단고정을 해제했습니다.', { persist: false });
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  }
}

async function toggleConversationArchived(conversationId) {
  const conversation = conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    return;
  }
  const shouldArchive = !isConversationArchived(conversation);
  try {
    const updated = await patchConversation(conversation.id, { archived: shouldArchive });
    conversations = sortConversations(conversations.map((item) => item.id === updated.id ? updated : item));
    if (activeConversation?.id === updated.id) {
      activeConversation = updated;
      goHome();
      return;
    }
    renderConversationList();
    appendMessage('system', shouldArchive ? '대화를 보관함으로 이동했습니다.' : '대화 아카이브를 해제했습니다.', { persist: false });
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  }
}

async function renameConversation(conversationId) {
  const conversation = conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    return;
  }
  const nextTitle = await openRenameDialog(conversationTitle(conversation));
  if (!nextTitle || nextTitle === conversationTitle(conversation)) {
    return;
  }
  try {
    const updated = await updateConversationTitle(conversation.id, nextTitle);
    conversations = conversations.map((item) => item.id === updated.id ? updated : item);
    if (activeConversation?.id === updated.id) {
      activeConversation = updated;
      updateChatTitle();
    }
    renderConversationList();
    appendMessage('system', '대화 이름을 변경했습니다.', { persist: false });
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  }
}

async function deleteConversation(conversationId) {
  const conversation = conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    return;
  }
  const confirmed = await openDeleteDialog(conversationTitle(conversation));
  if (!confirmed) {
    return;
  }
  try {
    await destroyConversation(conversation.id);
    clearComposerDraft(conversation.id);
    conversations = conversations.filter((item) => item.id !== conversation.id);
    if (activeConversation?.id === conversation.id) {
      goHome();
      showToast('대화를 삭제했습니다.', { kind: 'success' });
      return;
    }
    renderConversationList();
    showToast('대화를 삭제했습니다.', { kind: 'success' });
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  }
}

async function ensureActiveConversation() {
  if (activeConversation?.id) {
    return activeConversation;
  }
  conversations = sortConversations(await fetchConversations());
  activeConversation = await createConversation('새 대화');
  updateChatTitle();
  settings.lastActiveConversationId = activeConversation.id;
  syncConversationUrl(activeConversation.id);
  if (!conversations.some((conversation) => conversation.id === activeConversation.id)) {
    conversations = [activeConversation, ...conversations];
  }
  saveSettings(settings);
  renderConversationList();
  restoreComposerDraft(activeConversation.id);
  return activeConversation;
}

async function startNewConversation() {
  saveComposerDraft();
  showingArchived = false;
  updateArchiveToggleButton();
  modelPicker.reset();
  activeConversation = await createConversation('새 대화');
  updateChatTitle();
  settings.lastActiveConversationId = activeConversation.id;
  syncConversationUrl(activeConversation.id);
  conversations = [activeConversation, ...conversations.filter((conversation) => conversation.id !== activeConversation.id)];
  saveSettings(settings);
  lastHistoryVersion = null;
  lastHistoryHasMore = false;
  activeHistoryLimit = normalizeHistoryPageSize(settings.historyPageSize);
  clearPendingJob();
  clearRenderedMessages();
  renderConversationList();
  restoreComposerDraft(activeConversation.id);
  updateComposerAvailability();
  await renderHistory({ scrollToLatest: true });
  closeMobileDrawer();
  return activeConversation;
}

function setFloatingActionsExpanded(expanded) {
  floatingActionsExpanded = expanded;
  applyFloatingActionsExpanded(elements, expanded);
}

function toggleFloatingActions() {
  setFloatingActionsExpanded(!floatingActionsExpanded);
}

function updateModelPickerButtonState() {
  modelPicker.updateButtonState();
}

function renderModelPicker() {
  modelPicker.render();
}

function setModelPickerExpanded(expanded) {
  modelPicker.setExpanded(expanded);
}

async function fetchConversationModelMenu(conversationId) {
  return fetchConversationModelMenuFromApi({ apiFetch, apiHeaders, conversationId });
}

async function patchConversationModel(conversationId, model) {
  return patchConversationModelFromApi({ apiFetch, apiHeaders, conversationId, model });
}

async function patchConversationThinking(conversationId, thinking) {
  return patchConversationThinkingFromApi({ apiFetch, apiHeaders, conversationId, thinking });
}

async function openModelPicker() {
  return modelPicker.open(activeConversation?.id);
}

async function applyConversationModel(modelRef) {
  return modelPicker.apply(activeConversation?.id, modelRef);
}

async function applyConversationThinking(thinkingRef) {
  return modelPicker.applyThinking(activeConversation?.id, thinkingRef);
}

async function toggleModelPicker() {
  return modelPicker.toggle(activeConversation?.id);
}

async function continueInNewSession() {
  return continueInNewSessionFlow({
    setFloatingActionsExpanded,
    isSendingMessage: () => isSendingMessage,
    canUseApi,
    appendMessage,
    openSettingsPanel,
    ensureActiveConversation,
    saveComposerDraft,
    setSending,
    setStatus,
    fetchConversationHistory,
    buildNewSessionHandoffMessage,
    conversationTitle,
    createConversation,
    activateConversation: (conversation) => {
      activeConversation = conversation;
      settings.lastActiveConversationId = conversation.id;
      conversations = [conversation, ...conversations.filter((item) => item.id !== conversation.id)];
      saveSettings(settings);
    },
    resetAfterConversationSwitch: () => {
      lastHistoryVersion = null;
      clearPendingJob();
      clearRenderedMessages();
    },
    renderConversationList,
    restoreComposerDraft,
    closeMobileDrawer,
    sendMessage,
    savePendingJob,
    refreshHistoryIfChanged: async () => {
      lastHistoryVersion = null;
      return refreshHistoryIfChanged();
    },
    ensurePendingJobBubble,
    waitForJob,
    isActiveConversation,
    isTerminalJobState,
    applyStreamingToken,
    renderHistory,
    refreshConversations,
    isMobileLikeInput,
    focusMessageInput: () => elements.messageInput.focus(),
  });
}

async function fetchHistory() {
  const body = await fetchHistoryFromApi({
    apiFetch,
    historyHeaders,
    ensureActiveConversation,
    limit: activeHistoryLimit,
  });
  lastHistoryVersion = body.version || lastHistoryVersion;
  lastHistoryHasMore = body.hasMore;
  return body.messages;
}

async function fetchHistoryMeta() {
  return fetchHistoryMetaFromApi({
    apiFetch,
    historyHeaders,
    ensureActiveConversation,
    limit: activeHistoryLimit,
  });
}

function renderHistoryLoadMoreControl() {
  if (!lastHistoryHasMore) {
    return;
  }
  elements.messages.append(createHistoryLoadMoreControl({
    loading: loadingOlderHistory,
    onClick: () => loadOlderHistory().catch((error) => appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false })),
  }));
}

async function loadOlderHistory() {
  if (loadingOlderHistory || !lastHistoryHasMore) {
    return;
  }
  loadingOlderHistory = true;
  activeHistoryLimit += normalizeHistoryPageSize(settings.historyPageSize);
  try {
    await renderHistory({ preservePosition: true });
  } finally {
    loadingOlderHistory = false;
    resetHistoryLoadMoreButton(elements.messages);
  }
}

async function renderHistory(options = {}) {
  if (!activeConversation?.id) {
    renderHome();
    return;
  }
  updateComposerAvailability();
  const { scrollToLatest = false, preservePosition = false } = options;
  const hadRenderedMessages = elements.messages.children.length > 0;
  const shouldFollow = isNearBottom();
  const previousBottomOffset = elements.messages.scrollHeight - elements.messages.scrollTop;
  clearRenderedMessages();
  if (!canUseApi()) {
    appendMessage('system', '로그인하면 대화를 시작할 수 있습니다.', { persist: false });
    return;
  }

  try {
    const history = await fetchHistory();
    if (history.length === 0) {
      appendMessage('system', '📌 TIP: 설정에서 자동 위치 첨부가 켜져 있으면 채팅에 "여기"가 포함될 때 현재 위치가 함께 전달됩니다. 핀 버튼으로도 이번 메시지에만 위치를 첨부할 수 있습니다.', { persist: false });
      return;
    }

    renderHistoryLoadMoreControl();
    for (const item of history) {
      renderHistoryItem(item);
    }
    if (scrollToLatest || shouldFollow) {
      scrollToBottom({ force: true });
      if (scrollToLatest) {
        window.setTimeout(() => scrollToBottom({ force: true }), 250);
      }
    } else if (hadRenderedMessages || preservePosition) {
      preserveScrollAfterRender(previousBottomOffset);
      if (history.some((item) => typeof item?.role === 'string' && item.role !== 'user' && !isPendingHistoryMessage(item))) {
        showScrollToLatestButton();
      }
    }
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  }
}

function insertIntoComposer(text) {
  const value = String(text || '');
  if (!value || !elements.messageInput) {
    return;
  }
  const current = elements.messageInput.value;
  const separator = current && !current.endsWith('\n') ? '\n' : '';
  elements.messageInput.value = `${current}${separator}${value}`;
  elements.messageInput.dispatchEvent(new Event('input', { bubbles: true }));
  elements.messageInput.focus();
  saveComposerDraft();
}

async function apiJson(path, options = {}) {
  const response = await apiFetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(await historyHeaders()),
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || `HTTP ${response.status}`);
  }
  return body;
}

function codeBlockPluginContext() {
  return {
    activeConversationId,
    apiJson,
    copyTextToClipboard,
    insertIntoComposer,
    refreshHistory: () => renderHistory({ scrollToLatest: true }),
    sendPluginMessage: async (message) => {
      const response = await sendMessage(message, [], { source: 'plugin', hiddenFromHistory: true });
      if (response.job_id) {
        const conversationId = response.conversation_id || activeConversationId();
        savePendingJob({ job_id: response.job_id, startedAt: Date.now() }, conversationId);
        ensurePendingJobBubble(response.job_id, conversationId);
        await refreshHistoryIfChanged();
      }
      return response;
    },
    renderFallbackCodeBlock: appendPlainCodeBlock,
  };
}

function appendCodeBlock(parent, codeText, language = '', options = {}) {
  if (!options.skipPlugins && renderCodeBlockPlugin(parent, codeText, language, codeBlockPluginContext())) {
    return;
  }
  appendPlainCodeBlock(parent, codeText, language, options);
}

function appendPlainCodeBlock(parent, codeText, language = '', options = {}) {
  parent.append(createPlainCodeBlock(codeText, language, {
    ...options,
    copyTextToClipboard,
  }));
}

function appendMarkdown(parent, text) {
  appendMarkdownView(parent, text, { appendCodeBlock });
}

function renderHistoryItem(item) {
  if (typeof item?.role !== 'string' || typeof item?.text !== 'string') {
    return;
  }

  if (isRunningJobHistoryMessage(item) && !isPlaceholderPendingText(item.text)) {
    appendMessage('assistant', item.text, {
      id: `${item.id}:partial`,
      savedAt: item.savedAt,
      persist: false,
      autoScroll: false,
      suppressScrollButton: true,
      mediaRefs: mediaRefsFromHistoryAttachments(item.attachments),
    });
    appendMessage('assistant', '응답을 처리 중입니다…', {
      id: item.id,
      savedAt: item.savedAt,
      persist: false,
      autoScroll: false,
      suppressScrollButton: true,
      pending: true,
    });
    return;
  }

  appendMessage(item.role, item.text, {
    id: item.id,
    savedAt: item.savedAt,
    completedAt: item.completedAt,
    persist: false,
    autoScroll: false,
    suppressScrollButton: true,
    mediaRefs: mediaRefsFromHistoryAttachments(item.attachments),
    pending: isPendingHistoryMessage(item),
  });
}

function currentRenderedHistorySignature() {
  return renderedHistorySignature(elements.messages);
}

function shouldRerenderHistory(history) {
  return shouldRerenderHistorySnapshot(history, currentRenderedHistorySignature());
}

function renderHistorySnapshot(history) {
  const shouldFollow = isNearBottom();
  const previousBottomOffset = elements.messages.scrollHeight - elements.messages.scrollTop;
  clearRenderedMessages();
  renderHistoryLoadMoreControl();
  for (const item of history) {
    renderHistoryItem(item);
  }
  if (shouldFollow) {
    scrollToBottom({ force: true });
    return;
  }
  preserveScrollAfterRender(previousBottomOffset);
  if (history.some((item) => typeof item?.role === 'string' && item.role !== 'user' && !isPendingHistoryMessage(item))) {
    showScrollToLatestButton();
  }
}

async function fetchChangedHistory() {
  return fetchChangedHistoryFromApi({
    fetchHistoryMeta,
    fetchHistory,
    lastHistoryVersion: () => lastHistoryVersion,
    setLastHistoryVersion: (version) => {
      lastHistoryVersion = version;
    },
  });
}

async function refreshHistoryIfChanged() {
  if (!canUseApi() || document.hidden || !activeConversation?.id) {
    return;
  }

  try {
    const history = await fetchChangedHistory();
    if (!history) {
      return;
    }
    reconcilePendingJobWithHistory(history);
    if (shouldRerenderHistory(history)) {
      renderHistorySnapshot(history);
    }
  } catch {
    // Polling is best-effort; explicit sends/connection tests surface errors.
  }
}


function reconcilePendingJobWithHistory(history, conversationId = activeConversationId()) {
  reconcilePendingJobWithHistoryFromHistory({
    history,
    conversationId,
    loadPendingJob,
    clearPendingJob,
    isActiveConversation,
    isRunningJobHistoryMessage,
    setStatus,
    setSending,
    messagesRoot: elements.messages,
  });
}

function shouldPollHistory() {
  return shouldPollHistoryFromState({ canUseApi, documentHidden: document.hidden, activeConversationId });
}

function startHistoryPolling() {
  historyPollTimer = startIntervalIfNeeded(historyPollTimer, refreshHistoryIfChanged, 5000, shouldPollHistory());
}

function stopHistoryPolling() {
  historyPollTimer = stopIntervalIfNeeded(historyPollTimer);
}

function syncHistoryPolling() {
  if (shouldPollHistory()) {
    startHistoryPolling();
    return;
  }
  stopHistoryPolling();
}

function shouldPollConversationList() {
  return canUseApi() && !document.hidden;
}

function startConversationListPolling() {
  conversationListPollTimer = startIntervalIfNeeded(conversationListPollTimer, () => refreshConversations().catch(() => {}), 20 * 1000, shouldPollConversationList());
}

function stopConversationListPolling() {
  conversationListPollTimer = stopIntervalIfNeeded(conversationListPollTimer);
}

function syncConversationListPolling() {
  if (shouldPollConversationList()) {
    startConversationListPolling();
    return;
  }
  stopConversationListPolling();
}

function stopConversationEvents() {
  conversationEventRefreshTimer = clearConversationEventRefreshTimer(conversationEventRefreshTimer);
  conversationEventSource = closeConversationEventSource(conversationEventSource);
  conversationEventConversationId = '';
}

function startConversationEvents(conversationId = activeConversationId()) {
  if (!canUseApi() || !conversationId || !conversationEventsSupported()) {
    stopConversationEvents();
    return;
  }
  if (conversationEventSource && conversationEventConversationId === conversationId) {
    return;
  }
  stopConversationEvents();
  conversationEventConversationId = conversationId;
  const eventsUrl = apiUrl(`/v1/conversations/${encodeURIComponent(conversationId)}/events`);
  conversationEventSource = createConversationEventSource(eventsUrl, {
    onConversation: () => {
      if (conversationEventConversationId !== conversationId) {
        return;
      }
      scheduleConversationEventRefresh(conversationId);
    },
  });
}

function scheduleConversationEventRefresh(conversationId = activeConversationId()) {
  if (!conversationId) {
    return;
  }
  conversationEventRefreshTimer = clearConversationEventRefreshTimer(conversationEventRefreshTimer);
  conversationEventRefreshTimer = window.setTimeout(async () => {
    conversationEventRefreshTimer = null;
    await refreshConversations().catch(() => {});
    if (conversationId === activeConversationId()) {
      await refreshHistoryIfChanged();
    }
  }, 150);
}

function applyMediaViewerTransform() {
  mediaViewer.applyTransform();
}

function resetMediaViewerZoom() {
  mediaViewer.resetZoom();
}

function beginMediaViewerGesture() {
  mediaViewer.beginGesture();
}

function updateMediaViewerGesture() {
  mediaViewer.updateGesture();
}

function handleMediaViewerPointerDown(event) {
  mediaViewer.handlePointerDown(event);
}

function handleMediaViewerPointerMove(event) {
  mediaViewer.handlePointerMove(event);
}

function handleMediaViewerPointerEnd(event) {
  mediaViewer.handlePointerEnd(event);
}

function handleMediaViewerWheel(event) {
  mediaViewer.handleWheel(event);
}

function toggleMediaViewerZoom() {
  mediaViewer.toggleZoom();
}

function openMediaViewer(url, fileName = 'openclaw-image.png') {
  mediaViewer.open(url, fileName);
}

function closeMediaViewer(options = {}) {
  mediaViewer.close(options);
}

async function downloadUrlThroughClient(url, fileName, trigger, event) {
  if (!url || !window.OpenClawAndroid?.downloadBlob) {
    return false;
  }
  event?.preventDefault();
  const originalText = trigger?.textContent;
  if (trigger) {
    trigger.textContent = '저장 중…';
  }
  try {
    return await downloadUrlThroughAndroidClient(url, fileName);
  } catch (error) {
    appendMessage('system', `다운로드 실패: ${error instanceof Error ? error.message : String(error)}`, { persist: false });
    return false;
  } finally {
    if (trigger && originalText) {
      trigger.textContent = originalText;
    }
  }
}

async function downloadCurrentMedia(event) {
  if (!mediaViewer.currentUrl()) {
    return;
  }
  await downloadUrlThroughClient(mediaViewer.currentUrl(), mediaViewer.currentName(), elements.mediaViewerDownload, event);
}

async function getAuthorizedMediaUrl(ref) {
  if (mediaUrlCache.has(ref)) {
    const cached = mediaUrlCache.get(ref);
    mediaUrlCache.delete(ref);
    mediaUrlCache.set(ref, cached);
    return cached;
  }

  const response = await fetch(`${settings.apiUrl}/v1/media?path=${encodeURIComponent(ref)}`, {
    credentials: 'include',
    headers: await historyHeaders(),
    cache: 'force-cache',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  mediaUrlCache.set(ref, url);
  pruneMediaUrlCache();
  return url;
}

function appendMediaRef(parent, rawRef) {
  appendMediaRefView(parent, rawRef, {
    getCachedMediaUrl: (ref) => mediaUrlCache.get(ref) || '',
    getAuthorizedMediaUrl,
    openMediaViewer,
    downloadUrlThroughClient,
  });
}

function appendCopyAction(node, role, text, options = {}) {
  appendCopyActionView(node, role, text, options, copyTextToClipboard);
}

function appendRetryAction(node, role, text) {
  appendRetryActionView(node, role, text, {
    messageTextWithoutAttachmentPreview,
    messageInput: elements.messageInput,
    saveComposerDraft,
    autoResizeTextarea,
  });
}

function appendCancelJobAction(node, role, text, options = {}) {
  appendCancelJobActionView(node, role, text, options, {
    activeConversationId,
    cancelJob,
    clearPendingJob,
    refreshHistoryIfChanged,
    refreshConversations,
    showToast,
    setStatus,
    appendMessage,
    isAlreadyFinishedJobError,
  });
}

function renderMessageNode(node, role, text, options = {}) {
  const wasNearBottom = isNearBottom();
  const media = extractMediaRefs(text);
  node.className = `message ${role}${options.pending ? ' pending' : ''}`;
  node.replaceChildren();
  appendMarkdown(node, media.text);
  const mediaRefs = mergeMediaRefs(media.refs, node._mediaRefs || [], canonicalMediaRefKey);
  for (const ref of mediaRefs) {
    appendMediaRef(node, ref);
  }
  appendCopyAction(node, role, text, options);
  appendRetryAction(node, role, text);
  appendCancelJobAction(node, role, text, options);
  if (options.autoScroll === false) {
    if (!wasNearBottom && !options.pending && !options.suppressScrollButton) {
      showScrollToLatestButton();
    }
    return;
  }
  scrollToBottom({ ...options, autoScroll: options.force || wasNearBottom });
}

function appendAttachmentPreview(parent, files) {
  appendAttachmentPreviewView(parent, files, createAttachmentPreview, formatBytes);
}

function appendMessage(role, text, options = {}) {
  const node = createMessageNode({
    role,
    text,
    options: { ...options, formatTimestamp: formatMessageTimestamp },
    renderMessageNode,
    appendAttachmentPreview,
    persistMessage,
    appendTo: elements.messages,
  });
  if (options.autoScroll === false) {
    if (!isNearBottom() && !options.pending && !options.suppressScrollButton) {
      showScrollToLatestButton();
    }
  } else {
    scrollToBottom(options);
  }
  return node;
}

function setSending(isSending) {
  isSendingMessage = isSending;
  updateComposerAvailability();
  if (elements.continueNewSessionButton) {
    elements.continueNewSessionButton.disabled = isSending;
  }
  updateComposerAvailability();
}

function isActiveConversation(conversationId) {
  return conversationId && conversationId === activeConversationId();
}

function canResizeSidebar() {
  return canResizeSidebarView({ mediaQuery: SIDEBAR_RESIZE_MEDIA });
}

function startSidebarResize(event) {
  sidebarResize.start(event);
}

function moveSidebarResize(event) {
  sidebarResize.move(event);
}

function finishSidebarResize(event) {
  sidebarResize.finish(event);
}

function cancelSidebarResize() {
  sidebarResize.cancel();
}

function syncSidebarWidthToViewport() {
  sidebarResize.syncToViewport();
}

async function sendMessage(message, attachments = [], metadata = undefined) {
  const conversation = await ensureActiveConversation();
  return sendMessageToApi({ apiFetch, historyHeaders, conversationId: conversation.id, message, attachments, metadata });
}

function savePendingJob(job, conversationId = activeConversationId()) {
  pendingJobs.save(job, conversationId);
}

function ensurePendingJobBubble(jobId, conversationId = activeConversationId()) {
  return pendingJobs.ensureBubble(jobId, conversationId);
}

function loadPendingJob(conversationId = activeConversationId()) {
  return pendingJobs.load(conversationId);
}

function clearPendingJob(conversationId = activeConversationId()) {
  pendingJobs.clear(conversationId);
}

async function pruneStoredPendingJobs(conversationList = conversations) {
  await pendingJobs.prune(conversationList);
}

async function fetchConversationHistory(conversationId) {
  return fetchConversationHistoryFromApi({ apiFetch, historyHeaders, conversationId });
}

async function fetchJob(jobId, conversationId = activeConversationId()) {
  return fetchJobById({ apiFetch, historyHeaders, jobId, conversationId });
}

async function cancelJob(jobId, conversationId = activeConversationId()) {
  return cancelJobById({ apiFetch, historyHeaders, jobId, conversationId });
}

async function cancelActiveJob() {
  return pendingJobs.cancelActive();
}


function applyStreamingToken(jobId, token, conversationId = activeConversationId()) {
  streaming.applyToken(jobId, token, conversationId);
}

function clearStreamingState(jobId) {
  streaming.clear(jobId);
}

function flushStreamingCheckpointNow(jobId, conversationId = activeConversationId()) {
  streaming.flushCheckpointNow(jobId, conversationId);
}

function scheduleStreamingIdleCheckpoint(jobId, conversationId = activeConversationId()) {
  streaming.scheduleIdleCheckpoint(jobId, conversationId);
}

async function waitForJobViaSse(jobId, onTick = () => {}, conversationId = activeConversationId(), onToken = () => {}) {
  return waitForJobEventStream({
    jobId,
    conversationId,
    apiFetch,
    historyHeaders,
    parseSseBlock,
    isTerminalJobState,
    onTick,
    onToken,
    onExpired: () => {
      clearStreamingState(jobId);
      clearPendingJob(conversationId);
    },
    onToolStart: () => flushStreamingCheckpointNow(jobId, conversationId),
    onTerminal: () => {
      clearStreamingState(jobId);
      clearPendingJob(conversationId);
    },
  });
}

async function isJobResolvedInHistory(jobId, conversationId = activeConversationId()) {
  return isJobResolvedInHistoryFromApi({
    jobId,
    conversationId,
    isActiveConversation,
    fetchHistory,
    fetchConversationHistory,
    isPendingHistoryMessage,
  });
}

async function waitForJob(jobId, onTick = () => {}, conversationId = activeConversationId(), onToken = () => {}) {
  ensurePendingJobBubble(jobId, conversationId);
  try {
    return await waitForJobViaSse(jobId, (job) => {
      if (!isTerminalJobState(job.state)) {
        ensurePendingJobBubble(jobId, conversationId);
      }
      onTick(job);
    }, conversationId, onToken);
  } catch (error) {
    console.warn('SSE job events unavailable; falling back to polling.', error);
  }

  return waitForJobPolling({
    jobId,
    conversationId,
    fetchJob,
    delay,
    isTerminalJobState,
    isJobResolvedInHistory,
    ensurePendingJobBubble,
    clearStreamingState,
    clearPendingJob,
    onTick,
  });
}

async function resumePendingJobIfNeeded() {
  const pendingJob = loadPendingJob();
  if (!pendingJob || !canUseApi()) {
    return;
  }

  setStatus('이전 응답 작업을 확인하는 중입니다...');
  await refreshHistoryIfChanged();

  try {
    const job = await waitForJob(pendingJob.job_id, undefined, activeConversationId());
    await renderHistory();
    if (job.state === 'failed') {
      notifyReplyReady('OpenClaw 응답 실패', job.error || '응답 작업이 실패했습니다.');
    } else if (job.state === 'completed') {
      notifyReplyReady();
    }
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  } finally {
    setStatus('');
  }
}

async function handleSubmit(event) {
  return handleSubmitFlow(event, {
    elements,
    selectedAttachments: () => selectedAttachments,
    setSelectedAttachments: (value) => { selectedAttachments = value; },
    canUseApi,
    activeConversation: () => activeConversation,
    isConversationArchived,
    submitValidationMessage,
    appendMessage,
    openSettingsPanel,
    updateComposerAvailability,
    setSending,
    setStatus,
    ensureActiveConversation,
    outgoingMessageForSubmit,
    shouldIncludeLocationForMessage,
    settings: () => settings,
    slashCommandUsesCurrentLocation,
    getCurrentLocationMetadata,
    buildAttachmentsPayload,
    attachmentSummary,
    resetComposerAfterSubmit,
    clearComposerDraft,
    autoResizeTextarea,
    renderAttachmentTray,
    sendMessage,
    refreshConversations,
    savePendingJob,
    isActiveConversation,
    resetLastHistoryVersion: () => { lastHistoryVersion = null; },
    refreshHistoryIfChanged,
    ensurePendingJobBubble,
    waitForJob,
    isTerminalJobState,
    applyStreamingToken,
    renderHistory,
    notifyJobResult,
    notifyReplyReady,
    schedulePostSubmitRefresh,
    isJobResolvedInHistory,
    clearPendingJob,
    restoreComposerAfterSubmitFailure,
    saveComposerDraft,
    isMobileLikeInput,
  });
}

async function clearAppCacheAndReload() {
  try {
    await clearAppCacheAndReloadWithDeps({ setStatus, pruneMediaUrlCache });
  } catch (error) {
    appendMessage('system', `캐시 삭제 실패: ${error instanceof Error ? error.message : String(error)}`, { persist: false });
    window.location.reload();
  }
}

async function resetLocalAppStateAndReload() {
  if (!window.confirm('이 기기의 앱 설정, 초안, 대기 중 응답 표시, 로컬 캐시를 초기화하고 다시 불러옵니다. 서버에 저장된 대화는 삭제되지 않습니다. 계속할까요?')) {
    return;
  }
  try {
    await resetLocalAppStateAndReloadWithDeps({ setStatus, pruneMediaUrlCache });
  } catch (error) {
    appendMessage('system', `앱 초기화 실패: ${error instanceof Error ? error.message : String(error)}`, { persist: false });
    window.location.reload();
  }
}

async function resetPassword() {
  const input = promptPasswordChange();
  if (!input) {
    return;
  }
  if (input.error) {
    appendMessage('system', input.error, { persist: false });
    return;
  }
  try {
    await changePassword(apiFetch, input.currentPassword, input.newPassword);
    showToast('비밀번호를 변경했습니다.', { kind: 'success' });
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  }
}

async function healthCheck() {
  settings = await runHealthCheckAndReport({ settings, readSettingsFromForm, sharedUserId, apiFetch, assertValidApiKey, appendMessage });
}

function updateClearMessageInputButton() {
  updateComposerClearButton(elements.clearMessageInputButton, elements.messageInput.value);
}

function autoResizeTextarea() {
  resizeComposerTextarea(elements.messageInput);
  updateClearMessageInputButton();
}

function matchingSlashCommands() {
  const value = elements.messageInput.value;
  return findMatchingSlashCommands(value, elements.messageInput.selectionStart ?? value.length);
}

function applySlashCommand(command) {
  elements.messageInput.value = command;
  saveComposerDraft();
  hideSlashCommandPalette();
  autoResizeTextarea();
  elements.messageInput.focus();
  elements.messageInput.setSelectionRange(command.length, command.length);
}

function hideSlashCommandPalette() {
  elements.slashCommandPalette.classList.add('hidden');
  elements.slashCommandPalette.replaceChildren();
}

function renderSlashCommandPalette() {
  selectedSlashCommandIndex = renderSlashCommandPaletteView(
    elements.slashCommandPalette,
    matchingSlashCommands(),
    selectedSlashCommandIndex,
    applySlashCommand,
  );
}

function acceptSelectedSlashCommand() {
  const matches = matchingSlashCommands();
  if (matches.length === 0) {
    return false;
  }
  applySlashCommand(matches[selectedSlashCommandIndex].command);
  return true;
}

applySettingsToForm();
renderHome();
updateChatTitle();
updateConversationSearchClearButton();
function startClientServerVersionPolling() {
  versionCheckTimer = startIntervalIfNeeded(versionCheckTimer, checkClientServerVersion, 10 * 60 * 1000, !document.hidden);
}

function stopClientServerVersionPolling() {
  versionCheckTimer = stopIntervalIfNeeded(versionCheckTimer);
}

function syncPageLifecyclePolling() {
  syncVisiblePagePolling({
    syncHistoryPolling,
    stopVersionPolling: stopClientServerVersionPolling,
    startVersionPolling: startClientServerVersionPolling,
    checkVersion: checkClientServerVersion,
    refreshHistory: refreshHistoryIfChanged,
  });
  syncConversationListPolling();
  if (!document.hidden) {
    refreshConversations().catch(() => {});
  }
}

document.addEventListener('visibilitychange', syncPageLifecyclePolling);
checkClientServerVersion();
startClientServerVersionPolling();
startConversationListPolling();
const initialConversationId = conversationIdFromPath();
bootstrapInitialConversation({
  loadCurrentUser,
  settings,
  initialConversationId,
  refreshConversations,
  startNewConversation,
  activeConversationId,
  conversations: () => conversations,
  renderHome,
  renderConversationList,
  selectConversation,
  goHome,
}).catch((error) => appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false }));
startHistoryPolling();

function persistSettingsFromForm(options = {}) {
  const previousApiKey = settings.apiKey;
  try {
    settings = readSettingsFromForm();
    assertValidApiKey(settings.apiKey);
  } catch (error) {
    if (!options.silent) {
      appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
    }
    return false;
  }
  saveSettings(settings);
  applySettingsToForm();
  if (previousApiKey !== settings.apiKey) {
    conversations = [];
    lastHistoryVersion = null;
    resetConversationNotificationState();
    syncConversationListPolling();
    refreshConversations().catch(() => {});
    if (activeConversation) {
      refreshHistory({ force: true, preserveScroll: true }).catch(() => {});
    }
  }
  return true;
}

function openSettingsPanel(options = {}) {
  if (!openSettingsPanelView(elements.settingsPanel)) {
    return;
  }
  if (options.pushHistory === false || settingsPanelHistoryActive || !window.history?.pushState) {
    return;
  }
  window.history.pushState({ ...(window.history.state || {}), settingsPanelOpen: true }, '', window.location.href);
  settingsPanelHistoryActive = true;
}

function closeSettingsPanel(options = {}) {
  if (!elements.settingsPanel || elements.settingsPanel.classList.contains('hidden')) {
    settingsPanelHistoryActive = false;
    closeSettingsPanelView(elements.settingsPanel);
    return;
  }
  persistSettingsFromForm({ silent: true });
  closeSettingsPanelView(elements.settingsPanel);
  if (options.syncHistory && settingsPanelHistoryActive && window.history?.back) {
    settingsPanelHistoryActive = false;
    window.history.back();
    return;
  }
  settingsPanelHistoryActive = false;
}

function toggleSettingsPanel() {
  if (elements.settingsPanel.classList.contains('hidden')) {
    openSettingsPanel();
  } else {
    closeSettingsPanel({ syncHistory: true });
  }
}

bindAppEventListeners({
  elements,
  state: {
    openConversationMenuId: () => openConversationMenuId,
    setOpenConversationMenuId: (value) => { openConversationMenuId = value; },
    floatingActionsExpanded: () => floatingActionsExpanded,
    modelPickerExpanded: () => modelPicker.isExpanded(),
  },
  actions: {
    toggleSettingsPanel,
    closeMobileDrawer,
    toggleMobileDrawer,
    toggleModelPicker,
    handleDrawerSwipeStart,
    handleDrawerSwipeEnd,
    renderConversationList,
    setFloatingActionsExpanded,
    setModelPickerExpanded,
    closeSettingsPanel,
    handleLoginSubmit: async (event) => {
      event.preventDefault();
      const username = elements.loginUsernameInput?.value.trim() || '';
      const password = elements.loginPasswordInput?.value || '';
      if (elements.loginSubmitButton) {
        elements.loginSubmitButton.disabled = true;
      }
      if (elements.loginStatusText) {
        elements.loginStatusText.textContent = '로그인 중입니다…';
      }
      try {
        await login(username, password);
        await refreshConversations();
        if (!initialConversationId && !activeConversation?.id && conversations.length === 0) {
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
      } catch (error) {
        showLoginScreen(error instanceof Error ? error.message : String(error));
      } finally {
        if (elements.loginSubmitButton) {
          elements.loginSubmitButton.disabled = false;
        }
      }
    },
    logout,
    saveSettings: () => {
      if (persistSettingsFromForm()) {
        showToast('설정을 저장했습니다.', { kind: 'success' });
        closeSettingsPanel({ syncHistory: true });
      }
    },
    applyTheme,
    setAutoLocationOnHere: (enabled) => {
      settings = { ...settings, autoLocationOnHere: enabled };
      saveSettings(settings);
    },
    setFontSize: (fontSize) => {
      settings = { ...settings, fontSize: normalizeFontSize(fontSize) };
      applyDisplaySettings();
      saveSettings(settings);
    },
    changeHistoryPageSize: () => {
      settings = { ...settings, historyPageSize: normalizeHistoryPageSize(elements.historyPageSizeInput.value) };
      elements.historyPageSizeInput.value = String(settings.historyPageSize);
      activeHistoryLimit = normalizeHistoryPageSize(settings.historyPageSize);
      lastHistoryVersion = null;
      saveSettings(settings);
      if (activeConversation?.id) {
        renderHistory({ scrollToLatest: true }).catch((error) => appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false }));
      }
    },
    newConversation: async () => {
      try {
        await startNewConversation();
      } catch (error) {
        appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
      }
    },
    toggleArchiveView: () => {
      showingArchived = !showingArchived;
      openConversationMenuId = null;
      goHome();
    },
    conversationSearchInput: (value) => {
      conversationSearchQuery = value;
      updateConversationSearchClearButton();
      conversationContentMatches = new Set();
      renderConversationList();
      scheduleConversationSearch();
    },
    clearConversationSearch: () => {
      conversationSearchQuery = '';
      if (elements.conversationSearchInput) {
        elements.conversationSearchInput.value = '';
        elements.conversationSearchInput.focus();
      }
      updateConversationSearchClearButton();
      conversationContentMatches = new Set();
      renderConversationList();
      scheduleConversationSearch();
    },
    clearHistory: async () => {
      if (!window.confirm('새 대화를 시작합니다. 기존 대화는 서버에 보존됩니다.')) {
        return;
      }
      try {
        await startNewConversation();
        appendMessage('system', '새 대화를 시작했습니다. 기존 대화는 보존됩니다.', { persist: false });
      } catch (error) {
        appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
      }
    },
    healthCheck,
    toggleFloatingActions,
    openSettingsPanel,
    scrollToBottom,
    continueInNewSession,
    messagesScroll: () => {
      elements.messages.classList.add('is-scrolling');
      updateMessagesScrollIndicator();
      hideMessagesScrollIndicatorSoon();
      if (isNearBottom(80)) {
        hideScrollToLatestButton();
      }
    },
    clearAppCacheAndReload,
    resetLocalAppStateAndReload,
    resetPassword,
    enableNotifications,
    downloadCurrentMedia,
    closeMediaViewer,
    handleMediaViewerPointerDown,
    handleMediaViewerPointerMove,
    handleMediaViewerPointerEnd,
    handleMediaViewerWheel,
    toggleMediaViewerZoom,
    mediaViewerBackdropClick: (event) => {
      if (event.target?.hasAttribute?.('data-media-viewer-close')) {
        closeMediaViewer();
      }
    },
    popState: () => {
      if (document.body.classList.contains('drawer-open')) {
        closeMobileDrawer({ syncHistory: false });
        return;
      }
      if (!elements.settingsPanel.classList.contains('hidden')) {
        closeSettingsPanel({ syncHistory: false });
        return;
      }
      if (mediaViewer.isHistoryActive() && !mediaViewer.isHidden()) {
        closeMediaViewer({ syncHistory: false });
        return;
      }
      const conversationId = conversationIdFromPath();
      if (conversationId) {
        selectConversation(conversationId, { replaceUrl: true }).then((selected) => {
          if (!selected) {
            goHome({ replaceUrl: true });
          }
        }).catch(() => goHome({ replaceUrl: true }));
        return;
      }
      goHome({ replaceUrl: true });
    },
    documentKeydown: (event) => {
      if (event.key === 'Escape' && !elements.mediaViewer.classList.contains('hidden')) {
        closeMediaViewer();
        return;
      }
      if (event.key === 'Escape' && floatingActionsExpanded) {
        setFloatingActionsExpanded(false);
        return;
      }
      if (event.key === 'Escape' && modelPicker.isExpanded()) {
        setModelPickerExpanded(false);
        return;
      }
      if (event.key === 'Escape' && document.body.classList.contains('drawer-open')) {
        closeMobileDrawer({ syncHistory: true });
      }
    },
    clearMessageInput: () => {
      elements.messageInput.focus();
      document.execCommand('selectAll');
      document.execCommand('delete');
      elements.messageInput.dispatchEvent(new Event('input', { bubbles: true }));
    },
    attachmentInputChange: () => {
      try {
        addAttachmentFilesSafely(elements.attachmentInput.files || [], '파일 선택');
      } finally {
        elements.attachmentInput.value = '';
      }
    },
    handleMessagePaste,
    handleComposerDragEnter,
    handleComposerDragOver,
    handleComposerDragLeave,
    handleComposerDrop,
    handleSubmit,
    messageInputFocus: () => {
      if (isIosLikeBrowser()) {
        document.body.classList.add('ios-composer-focus-pending');
      }
      syncViewportHeight();
      window.setTimeout(syncViewportHeight, 0);
      window.setTimeout(syncViewportHeight, 80);
      window.setTimeout(syncViewportHeight, 220);
      window.setTimeout(syncViewportHeight, 420);
    },
    messageInputBlur: () => {
      document.body.classList.remove('ios-composer-focus-pending');
      window.setTimeout(syncViewportHeight, 0);
    },
    messageInputChanged: () => {
      saveComposerDraft();
      autoResizeTextarea();
      selectedSlashCommandIndex = 0;
      renderSlashCommandPalette();
      syncViewportHeight();
    },
    hideSlashCommandPalette,
    startSidebarResize,
    moveSidebarResize,
    finishSidebarResize,
    cancelSidebarResize,
    syncSidebarWidthToViewport,
    messageInputKeydown: (event) => {
      const hasSlashPalette = !elements.slashCommandPalette.classList.contains('hidden');
      if (hasSlashPalette && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(event.key)) {
        const matches = matchingSlashCommands();
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          selectedSlashCommandIndex = (selectedSlashCommandIndex + 1) % matches.length;
          renderSlashCommandPalette();
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          selectedSlashCommandIndex = (selectedSlashCommandIndex - 1 + matches.length) % matches.length;
          renderSlashCommandPalette();
          return;
        }
        if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
          event.preventDefault();
          acceptSelectedSlashCommand();
          return;
        }
      }
      if (isMobileLikeInput()) {
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        elements.messageForm.requestSubmit();
      }
    },
  },
});
renderModelPicker();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js?v=pwa-client-2026-05-12-ios-keyboard-scroll-001').catch(() => {});
  });
}
