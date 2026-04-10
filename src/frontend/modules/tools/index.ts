/**
 * @fileoverview Tools frontend module entry point.
 *
 * Exports all tool components and API client functions for the tools module.
 */

// Components
export { AddressConverter } from './components/AddressConverter';
export { EnergyEstimator } from './components/EnergyEstimator';
export { StakeCalculator } from './components/StakeCalculator';
export { SignatureVerifier } from './components/SignatureVerifier';

// API
export {
    convertAddress,
    estimateEnergy,
    estimateStakeFromTrx,
    estimateStakeFromEnergy,
    verifySignature
} from './api';

// Types
export type {
    IAddressConversionResult,
    IEnergyEstimate,
    IStakeEstimate,
    ISignatureResult,
    IToolDescriptor
} from './types';
