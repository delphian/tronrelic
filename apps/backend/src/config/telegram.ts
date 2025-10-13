import ipaddr from 'ipaddr.js';
import { env } from './env.js';

const RAW_ALLOWLIST = env.TELEGRAM_IP_ALLOWLIST ?? '';

type ParsedAddress = ipaddr.IPv4 | ipaddr.IPv6;
type AllowlistEntry =
  | { type: 'single'; value: ParsedAddress }
  | { type: 'range'; value: [ParsedAddress, number] };

function parseAddress(address: string): ParsedAddress | null {
  try {
    const parsed = ipaddr.parse(address.trim());
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
      return (parsed as ipaddr.IPv6).toIPv4Address();
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

function parseAllowlist(source: string): AllowlistEntry[] {
  if (!source.trim()) {
    return [];
  }

  const entries: AllowlistEntry[] = [];
  const parts = source.split(',');

  for (const part of parts) {
    const token = part.trim();
    if (!token) {
      continue;
    }

    if (token.includes('/')) {
      try {
        const cidr = ipaddr.parseCIDR(token) as [ParsedAddress, number];
        const [address, prefix] = cidr;
        entries.push({ type: 'range', value: [address, prefix] });
      } catch {
        // Ignore malformed CIDR entries; they will never match
      }
      continue;
    }

    const parsed = parseAddress(token);
    if (parsed) {
      entries.push({ type: 'single', value: parsed });
    }
  }

  return entries;
}

const allowlistEntries = parseAllowlist(RAW_ALLOWLIST);

function normalizeIp(ip: string | undefined): ParsedAddress | null {
  if (!ip) {
    return null;
  }

  try {
    const parsed = ipaddr.parse(ip);
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
      return (parsed as ipaddr.IPv6).toIPv4Address();
    }
    return parsed;
  } catch {
    return null;
  }
}

function matchEntry(candidate: ParsedAddress, entry: AllowlistEntry): boolean {
  if (entry.type === 'single') {
    return (
      candidate.kind() === entry.value.kind() &&
      candidate.toNormalizedString() === entry.value.toNormalizedString()
    );
  }

  return candidate.match(entry.value);
}

export const telegramConfig = {
  webhookSecret: env.TELEGRAM_WEBHOOK_SECRET ?? null,
  miniAppUrl: env.TELEGRAM_MINI_APP_URL ?? null,
  tapIncrement: 1,
  parity: {
    maxUnnotifiedLagMs: 15 * 60 * 1000
  },
  allowlist: allowlistEntries.map(entry => {
    if (entry.type === 'single') {
      return entry.value.toString();
    }
    const [address, prefix] = entry.value;
    return `${address.toString()}/${prefix}`;
  }),
  isIpAllowed(ip: string | undefined): boolean {
    if (!allowlistEntries.length) {
      return true;
    }

    const parsed = normalizeIp(ip);
    if (!parsed) {
      return false;
    }

    return allowlistEntries.some(entry => matchEntry(parsed, entry));
  }
};
