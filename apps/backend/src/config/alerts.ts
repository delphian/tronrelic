import { env } from './env.js';
import { blockchainConfig } from './blockchain.js';

const parseThreadId = (value: string | number | undefined): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const DEFAULT_MEMO_CHANNEL = '-1002576694182';
const DEFAULT_MEMO_THREAD = 51;
const DEFAULT_SUNPUMP_CHANNEL = '-1002576694182';
const DEFAULT_SUNPUMP_THREAD = 150;
const DEFAULT_WHALE_CHANNEL = '-1002576694182';
const DEFAULT_WHALE_THREAD = 200;

const parseNumber = (value: string | number | undefined): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const alertConfig = {
  memos: {
    channelId: env.TELEGRAM_MEMO_CHANNEL_ID ?? DEFAULT_MEMO_CHANNEL,
    threadId: parseThreadId(env.TELEGRAM_MEMO_THREAD_ID) ?? DEFAULT_MEMO_THREAD
  },
  sunpump: {
    channelId: env.TELEGRAM_SUNPUMP_CHANNEL_ID ?? DEFAULT_SUNPUMP_CHANNEL,
    threadId: parseThreadId(env.TELEGRAM_SUNPUMP_THREAD_ID) ?? DEFAULT_SUNPUMP_THREAD
  },
};
