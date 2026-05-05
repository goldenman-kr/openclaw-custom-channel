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
