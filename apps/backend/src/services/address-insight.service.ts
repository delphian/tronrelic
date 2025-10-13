import { lookupAddressTag } from '../data/address-tags.js';

export interface AddressInsight {
  address: string;
  name?: string;
  type?: string;
  labels?: string[];
}

const CONTRACT_PREFIX = 'T';

export class AddressInsightService {
  enrich(address: string | null | undefined): AddressInsight {
    const normalized = address?.trim();
    if (!normalized) {
      return { address: 'unknown' };
    }

    const tag = lookupAddressTag(normalized);
    if (tag) {
      return {
        address: normalized,
        name: tag.name,
        type: tag.type,
        labels: tag.labels
      };
    }

    const insight: AddressInsight = { address: normalized };

    if (normalized.length === 34 && normalized.startsWith(CONTRACT_PREFIX)) {
      insight.type = 'wallet';
    } else if (normalized.length > 34) {
      insight.type = 'contract';
    }

    return insight;
  }
}