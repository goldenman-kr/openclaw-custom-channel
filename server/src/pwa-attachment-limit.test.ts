import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-expect-error public browser module intentionally has no TypeScript declaration.
const attachments = await import("../public/modules/attachments.js");
// @ts-expect-error public browser module intentionally has no TypeScript declaration.
const attachmentInput = await import("../public/modules/attachment-input.js");

function file(index: number) {
  return {
    name: `notes-${index}.txt`,
    type: "text/plain",
    size: 5,
  };
}

test("PWA attachment selection accepts ten files", () => {
  const selected = attachmentInput.addAttachmentFilesToSelection(
    [],
    Array.from({ length: 10 }, (_, index) => file(index + 1)),
    { maxAttachments: attachments.MAX_ATTACHMENTS },
  );

  assert.equal(attachments.MAX_ATTACHMENTS, 10);
  assert.equal(selected.length, 10);
});

test("PWA attachment selection rejects an eleventh file", () => {
  const selected = Array.from({ length: 10 }, (_, index) => file(index + 1));

  assert.throws(
    () => attachmentInput.addAttachmentFilesToSelection(
      selected,
      [file(11)],
      { maxAttachments: attachments.MAX_ATTACHMENTS },
    ),
    /첨부 파일은 최대 10개까지 가능합니다/,
  );
});
