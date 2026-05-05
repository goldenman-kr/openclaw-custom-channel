export function applyFloatingActionsExpanded(elements, expanded) {
  document.body.classList.toggle('floating-actions-open', expanded);
  elements.floatingActionPanel?.classList.toggle('hidden', !expanded);
  if (elements.floatingActionToggle) {
    elements.floatingActionToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    elements.floatingActionToggle.setAttribute('aria-label', expanded ? '빠른 작업 닫기' : '빠른 작업 열기');
    elements.floatingActionToggle.title = expanded ? '빠른 작업 닫기' : '빠른 작업';
  }
}
