/**
 * @fileoverview Address converter tool route.
 *
 * Thin wrapper rendering the AddressConverter component. No SSR data — the tool
 * is a user-driven interactive form.
 */

import { AddressConverter } from '../../../../modules/tools';

export default function AddressConverterPage() {
    return <AddressConverter />;
}
