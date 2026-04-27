export interface SessionStore {
  getSessionId(input: { deviceId?: string; userId?: string }): string;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, string>();

  getSessionId(input: { deviceId?: string; userId?: string }): string {
    const identity = input.deviceId?.trim() || input.userId?.trim() || "anonymous";
    const existing = this.sessions.get(identity);
    if (existing) {
      return existing;
    }

    const sessionId = `mobile-${identity}`;
    this.sessions.set(identity, sessionId);
    return sessionId;
  }
}
