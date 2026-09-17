/**
 * Public surface of the Address Origins tool.
 *
 * Only the page component is exported. The panel, the chain, the rung and the
 * reading aids beside it are implementation detail of this one tool and have no
 * meaning outside it, so they stay private rather than becoming part of the
 * tools module's API.
 */

export { AddressOrigins } from './AddressOrigins';
