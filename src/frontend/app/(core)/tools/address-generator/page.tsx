/**
 * @fileoverview Address generator tool route.
 *
 * Thin wrapper rendering the AddressGenerator component. No SSR data — the tool
 * is a user-driven interactive form with in-browser key generation.
 */

import { AddressGenerator } from '../../../../modules/tools';

export default function AddressGeneratorPage() {
    return <AddressGenerator />;
}
