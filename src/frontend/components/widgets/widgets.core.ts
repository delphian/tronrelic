/**
 * @fileoverview Core (non-plugin) widget component registry.
 *
 * `widgets.generated.ts` is rewritten by the plugin registry generator
 * and only ever holds plugin-exported components, so core-owned widget
 * types need a stable, hand-written home that the generator never
 * clobbers. This module is that home: it maps each core widget type id
 * to its React component, keyed by the exact `typeId` the backend
 * registers (the resolver sets `IWidgetData.id` to the placement's
 * `typeId`, which is what the renderer looks up).
 *
 * The merged lookup in `getWidgetComponent.ts` consults this map before
 * the generated plugin map, so a core type resolves without depending on
 * the generated file's shape.
 *
 * @module frontend/components/widgets/widgets.core
 */

import type { WidgetComponent } from '@/types';
import {
    ADDRESS_CONVERTER_WIDGET_TYPE_ID,
    ADDRESS_GENERATOR_WIDGET_TYPE_ID,
    ADDRESS_ORIGINS_WIDGET_TYPE_ID,
    APPROVAL_CHECKER_WIDGET_TYPE_ID,
    ENERGY_ESTIMATOR_WIDGET_TYPE_ID,
    SIGNATURE_VERIFIER_WIDGET_TYPE_ID,
    STAKE_CALCULATOR_WIDGET_TYPE_ID,
    STAKING_REWARDS_WIDGET_TYPE_ID,
    TIMESTAMP_CONVERTER_WIDGET_TYPE_ID
} from '@/types';
// Imported by path rather than through the tools barrel: this registry is
// loaded with the site layout, and the barrel would pull every tool's
// components and styles into that bundle.
import { StakeCalculatorWidget } from '../../modules/tools/components/StakeCalculator/StakeCalculatorWidget';
import { StakingRewardsWidget } from '../../modules/tools/components/StakingRewards/StakingRewardsWidget';
import { EnergyEstimatorWidget } from '../../modules/tools/components/EnergyEstimator/EnergyEstimatorWidget';
import { TimestampConverterWidget } from '../../modules/tools/components/TimestampConverter/TimestampConverterWidget';
import { AddressConverterWidget } from '../../modules/tools/components/AddressConverter/AddressConverterWidget';
import { AddressGeneratorWidget } from '../../modules/tools/components/AddressGenerator/AddressGeneratorWidget';
import { SignatureVerifierWidget } from '../../modules/tools/components/SignatureVerifier/SignatureVerifierWidget';
import { ApprovalCheckerWidget } from '../../modules/tools/components/ApprovalChecker/ApprovalCheckerWidget';
import { AddressOriginsWidget } from '../../modules/tools/components/AddressOrigins/AddressOriginsWidget';
import { RawHtmlWidget } from './RawHtmlWidget';
import { WorldClocksWidget } from './WorldClocksWidget';
import { BlockTickerWidget } from './BlockTickerWidget';
import { NetworkActivityWidget } from './NetworkActivityWidget';
import { AuthButtonWidget } from './AuthButtonWidget';
import { SiteLogoWidget } from './SiteLogoWidget';
import { MenuWidget } from './MenuWidget';
import { LanguageSwitcherWidget } from './LanguageSwitcherWidget';
import { TabBarWidget } from './TabBarWidget';

/**
 * Core widget components keyed by backend widget-type id. Mirrors the
 * `CORE_WIDGET_TYPE_DESCRIPTORS` registered in
 * `backend/modules/widgets/widget-types/core-widget-types.ts` — every id
 * registered there must have a matching renderer here. Types a core module
 * registers for itself, such as the tools module's stake calculator, belong
 * here too, because the generated file only ever holds plugin components.
 */
export const coreWidgetComponents: Record<string, WidgetComponent> = {
    'core:raw-html': RawHtmlWidget,
    'core:world-clocks': WorldClocksWidget,
    'core:block-ticker': BlockTickerWidget,
    'core:network-activity': NetworkActivityWidget,
    'core:auth-button': AuthButtonWidget,
    'core:site-logo': SiteLogoWidget,
    // The menu widget; the id predates its namespace setting and is kept so
    // existing placements keep rendering.
    'core:main-menu': MenuWidget,
    'core:language-switcher': LanguageSwitcherWidget,
    'core:tab-bar': TabBarWidget,
    [STAKE_CALCULATOR_WIDGET_TYPE_ID]: StakeCalculatorWidget,
    [STAKING_REWARDS_WIDGET_TYPE_ID]: StakingRewardsWidget,
    [ENERGY_ESTIMATOR_WIDGET_TYPE_ID]: EnergyEstimatorWidget,
    [TIMESTAMP_CONVERTER_WIDGET_TYPE_ID]: TimestampConverterWidget,
    [ADDRESS_CONVERTER_WIDGET_TYPE_ID]: AddressConverterWidget,
    [ADDRESS_GENERATOR_WIDGET_TYPE_ID]: AddressGeneratorWidget,
    [SIGNATURE_VERIFIER_WIDGET_TYPE_ID]: SignatureVerifierWidget,
    [APPROVAL_CHECKER_WIDGET_TYPE_ID]: ApprovalCheckerWidget,
    [ADDRESS_ORIGINS_WIDGET_TYPE_ID]: AddressOriginsWidget
};
