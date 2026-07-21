import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error public browser module intentionally has no TypeScript declaration.
const { createModelPickerController } = await import("../public/modules/model-picker-controller.js");
// @ts-expect-error public browser module intentionally has no TypeScript declaration.
const { renderModelPicker, updateModelPickerButtonState } = await import("../public/modules/model-picker.js");

class FakeClassList {
  values = new Set<string>();

  toggle(name: string, force?: boolean) {
    const enabled = force ?? !this.values.has(name);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
  }
}

class FakeElement {
  type = "";
  className = "";
  textContent = "";
  title = "";
  disabled = false;
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: FakeElement[] = [];
  classList = new FakeClassList();

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }

  addEventListener() {}

  append(...children: FakeElement[]) {
    this.children.push(...children);
  }

  replaceChildren() {
    this.children = [];
  }
}

function menu(model = "openai/gpt-5.6-sol") {
  const speedSupported = model.startsWith("openai/") || model.startsWith("openai-codex/");
  return {
    currentModel: model,
    currentThinking: "medium",
    currentSpeed: "standard",
    speedSupported,
    canChange: true,
    models: [
      { ref: "openai/gpt-5.6-sol", label: "gpt-5.6-sol", selected: model === "openai/gpt-5.6-sol" },
      { ref: "llamacpp/Qwen3.6-27B-MTP", label: "Qwen3.6-27B-MTP", selected: model === "llamacpp/Qwen3.6-27B-MTP" },
    ],
    thinkingLevels: [{ ref: "medium", label: "medium", selected: true }],
    speedModes: [
      { ref: "standard", label: "Standard", selected: true },
      { ref: "fast", label: "Fast", selected: false },
    ],
  };
}

test("PWA model button shows lightning only for active OpenAI Fast mode", async () => {
  let renderedState: Record<string, unknown> | null = null;
  let buttonSummary = "";
  let speedPatchCount = 0;
  const controller = createModelPickerController({
    elements: { modelPickerButton: {} },
    hasConversation: () => true,
    fetchMenu: async () => menu(),
    patchModel: async (_conversationId: string, modelRef: string) => ({ current_model: modelRef }),
    patchThinking: async (_conversationId: string, thinkingRef: string) => ({ current_thinking: thinkingRef }),
    patchSpeed: async (_conversationId: string, speedRef: string) => {
      speedPatchCount += 1;
      return { current_speed: speedRef, speed_supported: true };
    },
    renderModelPicker: (_elements: unknown, state: Record<string, unknown>) => {
      renderedState = state;
    },
    updateModelPickerButtonState: (_button: unknown, state: { summary?: string }) => {
      buttonSummary = state.summary || "";
    },
    showToast: () => {},
  });

  await controller.refresh("conv_speed_test");
  assert.equal(buttonSummary, "gpt-5.6-sol\nmedium");

  await controller.applySpeed("conv_speed_test", "fast");
  assert.equal(speedPatchCount, 1);
  assert.equal(buttonSummary, "gpt-5.6-sol\nmedium ⚡");

  await controller.apply("conv_speed_test", "llamacpp/Qwen3.6-27B-MTP");
  assert.equal((renderedState as { speedSupported?: boolean } | null)?.speedSupported, false);
  assert.equal(buttonSummary, "Qwen3.6-27B-MTP\nmedium");

  await controller.applySpeed("conv_speed_test", "fast");
  assert.equal(speedPatchCount, 1);
});

test("PWA Speed choices remain visible but disabled for non-OpenAI models", (t) => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => new FakeElement() },
  });
  t.after(() => {
    delete (globalThis as Record<string, unknown>).document;
  });

  const panel = new FakeElement();
  const status = new FakeElement();
  const list = new FakeElement();
  const button = new FakeElement();
  renderModelPicker({
    modelPickerPanel: panel,
    modelPickerStatus: status,
    modelPickerList: list,
    modelPickerButton: button,
  }, {
    expanded: true,
    loading: false,
    canChange: true,
    hasConversation: true,
    speedSupported: false,
    models: [{ ref: "llamacpp/Qwen3.6-27B-MTP", label: "Qwen3.6-27B-MTP", selected: true }],
    thinkingLevels: [{ ref: "medium", label: "medium", selected: true }],
    speedModes: [
      { ref: "standard", label: "Standard", selected: true },
      { ref: "fast", label: "Fast", selected: false },
    ],
  }, () => {}, () => {}, () => {});

  const speedButtons = list.children.filter((child) => Boolean(child.dataset.speedRef));
  assert.deepEqual(speedButtons.map((entry) => entry.dataset.speedRef), ["standard", "fast"]);
  assert.equal(speedButtons.every((entry) => entry.disabled), true);
  assert.equal(speedButtons.every((entry) => entry.title === "OpenAI 모델에서만 사용할 수 있습니다."), true);
});

test("PWA model button appends lightning beside the Think level in Fast mode", () => {
  const modelLabel = new FakeElement();
  const thinkingLabel = new FakeElement();
  const label = {
    querySelector(selector: string) {
      return selector === ".model-picker-model-label" ? modelLabel : thinkingLabel;
    },
  };
  const button = new FakeElement() as FakeElement & { querySelector(selector: string): unknown };
  button.querySelector = (selector: string) => selector === ".model-picker-button-label" ? label : null;

  updateModelPickerButtonState(button, {
    hasConversation: true,
    expanded: false,
    summary: "gpt-5.6-sol\nmedium ⚡",
  });

  assert.equal(modelLabel.textContent, "gpt-5.6-sol");
  assert.equal(thinkingLabel.textContent, "medium ⚡");
});
