export function createHistoryLoadMoreControl({ loading, onClick }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'history-load-more';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ghost-button history-load-more-button';
  button.textContent = loading ? '이전 대화 불러오는 중…' : '이전 대화 더보기';
  button.disabled = loading;
  button.addEventListener('click', onClick);

  wrapper.append(button);
  return wrapper;
}

export function resetHistoryLoadMoreButton(root) {
  const button = root.querySelector('.history-load-more-button');
  if (!button) {
    return;
  }
  button.disabled = false;
  button.textContent = '이전 대화 더보기';
}
