import assert from "node:assert/strict";
import test from "node:test";
import { formatSpotDisplayStatus } from "./spotPluginRoutes.js";

test("formatSpotDisplayStatus prefixes SUCCEEDED with success emoji", () => {
  assert.equal(formatSpotDisplayStatus("SUCCEEDED"), "✅ SUCCEEDED");
});

test("formatSpotDisplayStatus does not duplicate existing emoji", () => {
  assert.equal(formatSpotDisplayStatus("✅ SUCCEEDED"), "✅ SUCCEEDED");
});

test("formatSpotDisplayStatus maps representative terminal and active statuses", () => {
  assert.equal(formatSpotDisplayStatus("FAILED"), "⚠️ FAILED");
  assert.equal(formatSpotDisplayStatus("EXPIRED"), "⏰ EXPIRED");
  assert.equal(formatSpotDisplayStatus("PENDING"), "⏳ PENDING");
  assert.equal(formatSpotDisplayStatus("OPEN"), "🟢 OPEN");
  assert.equal(formatSpotDisplayStatus("PARTIALLY_FILLED"), "🟡 PARTIALLY_FILLED");
  assert.equal(formatSpotDisplayStatus("CANCELLED"), "🚫 CANCELLED");
  assert.equal(formatSpotDisplayStatus("SOMETHING_NEW"), "❔ SOMETHING_NEW");
});
