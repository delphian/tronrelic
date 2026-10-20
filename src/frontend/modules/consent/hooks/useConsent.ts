'use client';

/**
 * @fileoverview Hook returning the visitor's consent state and its actions.
 *
 * @module modules/consent/hooks/useConsent
 */

import { useContext } from 'react';
import { ConsentContext } from '../components/ConsentProvider';
import type { IConsentContextValue } from '../types';

/**
 * Read what the visitor allows, and the actions the banner and "Privacy
 * choices" use to change it. Code that only needs to know whether to send
 * analytics reads `state.analytics`; it never repeats the region rules.
 *
 * @returns The value the nearest `ConsentProvider` supplies.
 */
export function useConsent(): IConsentContextValue {
    return useContext(ConsentContext);
}
