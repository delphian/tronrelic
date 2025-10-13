/**
 * Markets Feature Module
 *
 * This module handles all market-related functionality including:
 * - Market comparison and pricing
 * - Affiliate tracking
 * - Best deal finder
 */

// Components
export { AffiliateLink } from './components/AffiliateLink';
export { BestDealFinder } from './components/BestDealFinder';
export { MarketCard } from './components/MarketCard';
export { MarketDashboard } from './components/MarketDashboard';
export { MarketTable } from './components/MarketTable';
export { PriceCalculator } from './components/PriceCalculator';

// Redux slice
export { default as marketReducer } from './slice';
export * from './slice';
