import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, formatBytes, inferAttachmentMimeType } from './attachments.js';
import { blobToBase64 } from './blob-utils.js';

export function validateAttachmentFile(file) {
  const mimeType = inferAttachmentMimeType(file.name, file.type);
  if (!ALLOWED_ATTACHMENT_TYPES.has(mimeType)) {
    throw new Error(`${file.name}: 지원하지 않는 파일 형식입니다.`);
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name}: 파일은 ${formatBytes(MAX_ATTACHMENT_BYTES)} 이하만 첨부할 수 있습니다.`);
  }
}

export function filesFromDataTransfer(dataTransfer) {
  if (!dataTransfer) {
    return [];
  }
  const itemFiles = Array.from(dataTransfer.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (itemFiles.length > 0) {
    return itemFiles;
  }
  return Array.from(dataTransfer.files || []);
}

export function hasDraggedFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

export async function buildAttachmentPayload(file) {
  const mimeType = inferAttachmentMimeType(file.name, file.type);
  return {
    type: mimeType.startsWith('image/') ? 'image' : 'file',
    name: file.name,
    mime_type: mimeType,
    content_base64: await blobToBase64(file),
  };
}

export function attachmentSummary(files) {
  if (!files?.length) {
    return '';
  }
  return `\n\n첨부 파일:\n${files.map((file) => `- ${file.name} (${inferAttachmentMimeType(file.name, file.type) || 'unknown'}, ${formatBytes(file.size)})`).join('\n')}`;
}

export function addAttachmentFilesToSelection(currentFiles, files, { maxAttachments = Infinity, validateFile = validateAttachmentFile } = {}) {
  const nextFiles = [...currentFiles];
  for (const file of files) {
    validateFile(file);
    if (nextFiles.length >= maxAttachments) {
      throw new Error(`첨부 파일은 최대 ${maxAttachments}개까지 가능합니다.`);
    }
    nextFiles.push(file);
  }
  return nextFiles;
}

export function filesFromUnknownList(files) {
  return Array.from(files || []).filter(Boolean);
}

export function updateComposerDragOver(messageForm, active) {
  messageForm.classList.toggle('drag-over', active);
}

export function nextComposerDragDepth(currentDepth, event, delta) {
  if (!hasDraggedFiles(event)) {
    return currentDepth;
  }
  return Math.max(0, currentDepth + delta);
}
