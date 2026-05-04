const codeBlockPlugins = new Map();

export function registerCodeBlockPlugin(plugin) {
  if (!plugin || typeof plugin.language !== 'string' || typeof plugin.render !== 'function') {
    throw new TypeError('Code block plugin must include language and render().');
  }
  codeBlockPlugins.set(plugin.language.trim().toLowerCase(), plugin);
}

export function renderCodeBlockPlugin(parent, codeText, language, context = {}) {
  const plugin = codeBlockPlugins.get(String(language || '').trim().toLowerCase());
  if (!plugin) {
    return false;
  }

  const fallback = () => {
    context.renderFallbackCodeBlock?.(parent, codeText, language);
  };

  try {
    const rendered = plugin.render({ parent, codeText, language, context, fallback });
    if (rendered === false) {
      fallback();
    }
  } catch (error) {
    console.error(`Code block plugin failed: ${plugin.language}`, error);
    fallback();
  }

  return true;
}

export function listCodeBlockPlugins() {
  return [...codeBlockPlugins.keys()];
}
