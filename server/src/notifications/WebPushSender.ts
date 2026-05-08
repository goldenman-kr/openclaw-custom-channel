import webpush from "web-push";
import type { PushSubscriptionRecord, PushSubscriptionStore } from "../session/PushSubscriptionStore.js";

export interface PushNotificationPayload {
  title: string;
  body: string;
  url?: string;
  conversationId?: string;
  tag?: string;
}

export interface WebPushSenderOptions {
  publicKey?: string;
  privateKey?: string;
  subject?: string;
}

export interface WebPushSendResult {
  attempted: number;
  sent: number;
  disabled: number;
  failed: number;
}

export class WebPushSender {
  private readonly configured: boolean;

  constructor(
    private readonly store: PushSubscriptionStore,
    options: WebPushSenderOptions = {},
  ) {
    const publicKey = options.publicKey?.trim() ?? "";
    const privateKey = options.privateKey?.trim() ?? "";
    const subject = options.subject?.trim() || "mailto:admin@example.com";
    this.configured = Boolean(publicKey && privateKey);
    if (this.configured) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async sendToOwner(ownerId: string, payload: PushNotificationPayload): Promise<WebPushSendResult> {
    const empty = { attempted: 0, sent: 0, disabled: 0, failed: 0 };
    if (!this.configured) {
      return empty;
    }
    const subscriptions = this.store.listActiveByOwner(ownerId);
    const results = await Promise.all(subscriptions.map((subscription) => this.sendOne(subscription, payload)));
    return results.reduce((summary, result) => ({
      attempted: summary.attempted + 1,
      sent: summary.sent + (result === "sent" ? 1 : 0),
      disabled: summary.disabled + (result === "disabled" ? 1 : 0),
      failed: summary.failed + (result === "failed" ? 1 : 0),
    }), empty);
  }

  private async sendOne(subscription: PushSubscriptionRecord, payload: PushNotificationPayload): Promise<"sent" | "disabled" | "failed"> {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        JSON.stringify(payload),
      );
      return "sent";
    } catch (error) {
      const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number" ? (error as { statusCode: number }).statusCode : undefined;
      if (statusCode === 404 || statusCode === 410) {
        this.store.disableById(subscription.id);
        return "disabled";
      }
      console.warn(`Web Push send failed (${subscription.id}):`, error);
      return "failed";
    }
  }
}
