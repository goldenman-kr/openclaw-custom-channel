import assert from "node:assert/strict";
import test from "node:test";
import { formatSpotDisplayStatus, shouldPublishPartialChunkUpdate } from "./spotPluginRoutes.js";

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


test("shouldPublishPartialChunkUpdate reports newly settled chunks while order is pending", () => {
  const previous = { orders: [{ metadata: { status: "pending", chunks: [] } }] };
  const current = { orders: [{ metadata: { status: "pending", chunks: [{ index: 1, status: "success", settled: true }] } }] };
  assert.equal(shouldPublishPartialChunkUpdate(previous, current), true);
});

test("shouldPublishPartialChunkUpdate does not duplicate the same settled chunk", () => {
  const previous = { orders: [{ metadata: { chunks: [{ index: 1, status: "success", settled: true }] } }] };
  const current = { orders: [{ metadata: { chunks: [{ index: 1, status: "success", settled: true }] } }] };
  assert.equal(shouldPublishPartialChunkUpdate(previous, current), false);
});


test("formatSpotDisplayStatus maps PARTIALLY_COMPLETED to partial emoji", () => {
  assert.equal(formatSpotDisplayStatus("PARTIALLY_COMPLETED"), "🟡 PARTIALLY_COMPLETED");
});
