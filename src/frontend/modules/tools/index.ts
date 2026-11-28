/**
 * @fileoverview Tools frontend module entry point.
 *
 * Exports all tool components and API client functions for the tools module.
 */

// Components
export { AddressConverterForm, AddressConverterWidget } from './components/AddressConverter';
export { AddressGeneratorForm, AddressGeneratorWidget } from './components/AddressGenerator';
export { EnergyEstimatorForm, EnergyEstimatorWidget } from './components/EnergyEstimator';
export { StakeCalculatorForm, StakeCalculatorWidget } from './components/StakeCalculator';
export { StakingRewardsCalculator, StakingRewardsWidget } from './components/StakingRewards';
export { SignatureVerifierForm, SignatureVerifierWidget } from './components/SignatureVerifier';
export { ApprovalCheckerForm, ApprovalCheckerWidget } from './components/ApprovalChecker';
export { AddressOriginsTool, AddressOriginsWidget } from './components/AddressOrigins';
export { TimestampConverterForm, TimestampConverterWidget } from './components/TimestampConverter';
export { ToolsAdminClient } from './components/ToolsAdmin';

// API
export {
    convertAddress,
    estimateEnergy,
    estimateStakeFromTrx,
    estimateStakeFromEnergy,
    verifySignature,
    checkApprovals,
    createAddressOriginsStream,
    convertTimestamp,
    createBootstrapPage
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
    IOriginHop,
    IOriginLadder,
    OriginLadderStatus,
    ITimestampConversionResult
} from './types';
