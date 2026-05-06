type Listener = (event?: unknown) => unknown;

export class TestElement {
  tagName: string;
  type = '';
  className = '';
  textContent = '';
  disabled = false;
  hidden = false;
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: TestElement[] = [];
  listeners = new Map<string, Listener[]>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  append(...nodes: Array<TestElement | string | undefined | null>) {
    for (const node of nodes) {
      if (node === undefined || node === null) {
        continue;
      }
      if (typeof node === 'string') {
        const textNode = new TestElement('#text');
        textNode.textContent = node;
        this.children.push(textNode);
        continue;
      }
      this.children.push(node);
    }
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }

  getAttribute(name: string) {
    return this.attributes[name];
  }

  addEventListener(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) || [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  async click() {
    for (const listener of this.listeners.get('click') || []) {
      await listener({ currentTarget: this });
    }
  }

  all(predicate: (element: TestElement) => boolean): TestElement[] {
    const self: TestElement = this;
    const matches: TestElement[] = predicate(self) ? [self] : [];
    for (const child of this.children) {
      matches.push(...child.all(predicate));
    }
    return matches;
  }

  text(): string {
    return `${this.textContent}${this.children.map((child) => child.text()).join('')}`;
  }
}

export function setBrowserGlobals({ ethereum, reown, userAgent = 'Mozilla/5.0', coarsePointer = false }: {
  ethereum?: unknown;
  reown?: unknown;
  userAgent?: string;
  coarsePointer?: boolean;
} = {}) {
  const windowListeners = new Map<string, Set<Listener>>();
  const documentMock = {
    createElement: (tagName: string) => new TestElement(tagName),
    querySelector: () => null,
    body: new TestElement('body'),
    readyState: 'complete',
    addEventListener: () => {},
  };
  const windowMock: Record<string, unknown> = {
    ethereum,
    SpotReownWallet: reown,
    location: { pathname: '/chat/test-conversation' },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    matchMedia: (query: string) => ({ matches: query === '(pointer: coarse)' ? coarsePointer : false }),
    addEventListener: (event: string, handler: Listener) => {
      const handlers = windowListeners.get(event) || new Set<Listener>();
      handlers.add(handler);
      windowListeners.set(event, handlers);
    },
    removeEventListener: (event: string, handler: Listener) => {
      windowListeners.get(event)?.delete(handler);
    },
    dispatchEvent: (event: Event) => {
      for (const handler of windowListeners.get(event.type) || []) {
        handler(event);
      }
      return true;
    },
  };
  Object.defineProperty(globalThis, 'document', { value: documentMock, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: windowMock, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true });
  return { windowMock, documentMock };
}

export function clearBrowserGlobals() {
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).navigator;
}
