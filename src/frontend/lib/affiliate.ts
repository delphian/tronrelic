import { config } from './config';

const recordedImpressions = new Set<string>();

function shouldTrack() {
  return typeof window !== 'undefined' && typeof fetch !== 'undefined';
}

async function postAffiliateEvent(path: string, payload: Record<string, unknown>, options: { keepalive?: boolean } = {}) {
  if (!shouldTrack()) {
    return;
  }

  const url = `${config.apiBaseUrl}${path}`;
  const body = JSON.stringify(payload);

  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body,
      keepalive: options.keepalive ?? false,
      credentials: 'include'
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Failed to record affiliate event', error);
    }
  }
}

export function recordAffiliateImpression(guid: string, trackingCode: string) {
  if (!shouldTrack()) {
    return;
  }

  const key = `${guid}:${trackingCode}`;
  if (recordedImpressions.has(key)) {
    return;
  }
  recordedImpressions.add(key);

  void postAffiliateEvent(`/markets/${guid}/affiliate/impression`, { trackingCode });
}

export function recordAffiliateClick(guid: string, trackingCode: string) {
  if (!shouldTrack()) {
    return;
  }

  const url = `${config.apiBaseUrl}/markets/${guid}/affiliate/click`;
  const payload = JSON.stringify({ trackingCode });

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([payload], { type: 'application/json' });
    const accepted = navigator.sendBeacon(url, blob);
    if (accepted) {
      return;
    }
  }

  void postAffiliateEvent(`/markets/${guid}/affiliate/click`, { trackingCode }, { keepalive: true });
}
