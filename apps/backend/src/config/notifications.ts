import type { NotificationChannel } from '@tronrelic/shared';
import { env } from './env.js';

export const supportedChannels: NotificationChannel[] = ['websocket', 'email'];

export const notificationConfig = {
  defaultChannels: ['websocket'] as NotificationChannel[],
  throttleMs: {
    websocket: env.NOTIFICATION_WEBSOCKET_THROTTLE_MS,
    email: env.NOTIFICATION_EMAIL_THROTTLE_MS
  }
};

export function resolveChannels(channels: NotificationChannel[] | undefined): NotificationChannel[] {
  if (channels === undefined) {
    return notificationConfig.defaultChannels;
  }
  const unique = new Set<NotificationChannel>();
  for (const channel of channels) {
    if (supportedChannels.includes(channel)) {
      unique.add(channel);
    }
  }
  return [...unique];
}

export function resolveThrottleMs(
  channel: NotificationChannel,
  overrides?: Partial<Record<NotificationChannel, number>>
): number {
  const override = overrides?.[channel];
  if (override !== undefined && Number.isFinite(override) && override >= 0) {
    return override;
  }
  return notificationConfig.throttleMs[channel];
}
