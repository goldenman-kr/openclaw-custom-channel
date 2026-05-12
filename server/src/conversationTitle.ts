export function titleFromMessage(message: string): string {
  const normalized = message
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, 40) : "새 대화";
}
