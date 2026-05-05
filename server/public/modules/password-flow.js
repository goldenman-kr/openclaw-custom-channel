export function promptPasswordChange(prompt = window.prompt.bind(window)) {
  const currentPassword = prompt('현재 비밀번호를 입력하세요.');
  if (currentPassword === null) {
    return null;
  }
  const newPassword = prompt('새 비밀번호를 입력하세요. 8자 이상이어야 합니다.');
  if (newPassword === null) {
    return null;
  }
  const confirmPassword = prompt('새 비밀번호를 한 번 더 입력하세요.');
  if (confirmPassword === null) {
    return null;
  }
  if (newPassword !== confirmPassword) {
    return { error: '새 비밀번호가 서로 일치하지 않습니다.' };
  }
  return { currentPassword, newPassword };
}
