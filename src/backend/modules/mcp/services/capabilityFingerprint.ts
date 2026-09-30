/**
 * @fileoverview Stable fingerprint of an AI tool's capability declaration.
 *
 * An admin's approval to expose a tool over MCP is only valid for the
 * capability the admin saw. Storing a fingerprint beside the approval lets the
 * MCP module notice when a plugin update changes that capability, and drop the
 * tool back to hidden until an admin approves it again.
 */

import { createHash } from 'node:crypto';
import type { IAiToolCapability } from '@/types';

/**
 * The capability fields that decide how a tool is governed, in a fixed order.
 * Listed explicitly rather than read from the object's keys, so the
 * fingerprint does not change when a field is added to the interface with no
 * value set, and does change when any governing field changes value.
 */
const FINGERPRINT_FIELDS: ReadonlyArray<keyof IAiToolCapability> = [
    'sideEffect',
    'reversible',
    'spendsMoney',
    'costPerCallUsd',
    'sensitivity',
    'surfacesUntrustedContent',
    'operatesOnUserOwnedObjects',
    'forcesCuratorReview',
    'curationTypeId'
];

/**
 * Compute a fingerprint of a tool's capability declaration.
 *
 * Builds a canonical array of the governing fields (absent fields become
 * `null`) and hashes its JSON with SHA-256, so two declarations produce the
 * same fingerprint exactly when every governing field matches.
 *
 * @param capability - The tool's declared capability, or undefined when it
 *   declares none. An undeclared capability has its own fingerprint, so adding
 *   a declaration later also counts as a change.
 * @returns A hex SHA-256 digest identifying the declaration.
 */
export function capabilityFingerprint(capability: IAiToolCapability | undefined): string {
    const canonical = FINGERPRINT_FIELDS.map(field => capability?.[field] ?? null);
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
