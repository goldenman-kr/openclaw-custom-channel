import assert from "node:assert/strict";
import test from "node:test";
import { validateMessageRequestDto } from "./apiContractV1.js";

function xmlAttachment(name: string, mimeType: string) {
  return {
    type: "file" as const,
    name,
    mime_type: mimeType,
    content_base64: Buffer.from("<root />").toString("base64"),
  };
}

test("API contract accepts XML attachments by MIME type or .xml extension", () => {
  for (const attachment of [
    xmlAttachment("document.xml", "application/xml"),
    xmlAttachment("legacy.xml", "text/xml"),
    xmlAttachment("detected-by-extension.xml", "application/octet-stream"),
  ]) {
    assert.equal(
      validateMessageRequestDto({ message: "XML을 분석해주세요.", attachments: [attachment] }),
      null,
    );
  }
});
