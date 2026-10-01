/**
 * @fileoverview Attaching address tags, such as `ofac:sdn` and `usdt:frozen`, to chain query results.
 *
 * A counterparty list is far more useful when the model can see that one of
 * the addresses is on a sanctions list or frozen by Tether. The tags come from
 * the core `'address-tags'` service, looked up once per response for every
 * address the response names. The service is optional from this module's point
 * of view: when it is absent or fails, the response carries no tags and a note
 * saying tags were unavailable, rather than failing the whole call.
 *
 * @module backend/modules/blockchain/chain-query/AddressTagLookup
 */

import type { IAddressTagService } from '@/types';
import { logger } from '../logger.js';

/** The tags found for a set of addresses. */
export interface IAddressTagsResult {
    /** Active tags per address, containing only addresses that have at least one. */
    tags: Record<string, string[]>;
    /** False when the tag service was absent or failed, so an empty map means "unknown", not "untagged". */
    available: boolean;
}

/**
 * Looks up active address tags through the service registry.
 *
 * A utility shared by every tool. The service is resolved on each call rather
 * than once, because the address tags module publishes it during its own
 * startup and the tools register before that finishes.
 */
export class AddressTagLookup {
    /**
     * @param resolveService - Returns the `'address-tags'` service, or undefined when it is not registered.
     */
    constructor(private readonly resolveService: () => IAddressTagService | undefined) {}

    /**
     * Find the addresses carrying any of a set of tags.
     *
     * Used where a tag is the evidence a tool reports, such as an operator's
     * `token:usdt` marking which contract is the real USDT. Only active tags
     * count, which the service already guarantees.
     *
     * @param tags - Tag texts to look for, matched exactly as stored.
     * @returns The tagged addresses with their matching tags, and whether the lookup could be made at all.
     */
    public async findAddresses(tags: readonly string[]): Promise<IAddressTagsResult> {
        const service = this.resolveService();
        const result: IAddressTagsResult = { tags: {}, available: service !== undefined };
        if (service && tags.length > 0) {
            try {
                for (const record of await service.getAddressesByTags([...new Set(tags)])) {
                    if (record.active) {
                        (result.tags[record.address] ??= []).push(record.tag);
                    }
                }
            } catch (error) {
                logger.warn({ error, tags }, 'Reverse address tag lookup failed for a chain query; answering without it');
                result.tags = {};
                result.available = false;
            }
        }
        return result;
    }

    /**
     * Find the active tags on a set of addresses.
     *
     * @param addresses - Every address a response names; duplicates are fine.
     * @returns The tags, and whether the lookup could be made at all.
     */
    public async lookup(addresses: readonly string[]): Promise<IAddressTagsResult> {
        const unique = [...new Set(addresses.filter(address => address.length > 0))];
        const service = this.resolveService();
        const result: IAddressTagsResult = { tags: {}, available: service !== undefined };
        if (service && unique.length > 0) {
            try {
                for (const record of await service.getTagsByAddresses(unique)) {
                    if (record.active) {
                        (result.tags[record.address] ??= []).push(record.tag);
                    }
                }
            } catch (error) {
                logger.warn({ error, addresses: unique.length }, 'Address tag lookup failed for a chain query; answering without tags');
                result.tags = {};
                result.available = false;
            }
        }
        return result;
    }
}
