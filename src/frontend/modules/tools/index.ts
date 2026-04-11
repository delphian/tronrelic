/**
 * @fileoverview Tools frontend module entry point.
 *
 * Exports all tool components and API client functions for the tools module.
 */

// Components
export { AddressConverter } from './components/AddressConverter';
export { AddressGenerator } from './components/AddressGenerator';
export { EnergyEstimator } from './components/EnergyEstimator';
export { StakeCalculator } from './components/StakeCalculator';
export { SignatureVerifier } from './components/SignatureVerifier';
export { ApprovalChecker } from './components/ApprovalChecker';
export { TimestampConverter } from './components/TimestampConverter';

// API
export {
    convertAddress,
    estimateEnergy,
    estimateStakeFromTrx,
    estimateStakeFromEnergy,
    verifySignature,
    checkApprovals,
    convertTimestamp
} from './api';

// Types
export type {
    IAddressConversionResult,
    IEnergyEstimate,
    IStakeEstimate,
    ISignatureResult,
    IToolDescriptor,
    IApprovalEntry,
    IApprovalCheckResult,
    ITimestampConversionResult
} from './types';
