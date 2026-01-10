import { logger } from '../lib/logger.js';

export interface EmailNotificationPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export class EmailService {
  constructor(private readonly configured = false) {}

  isConfigured(): boolean {
    return this.configured;
  }

  // Intentionally returns boolean to allow future SMTP integrations without
  // changing NotificationService control flow.
  async sendNotification(_payload: EmailNotificationPayload): Promise<boolean> {
    logger.warn('Email notifications are not configured; skipping delivery');
    return false;
  }
}
