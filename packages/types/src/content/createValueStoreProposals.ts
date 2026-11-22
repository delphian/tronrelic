/**
 * @file createValueStoreProposals.ts
 *
 * Builds the `ITranslationProposals` a content type supplies when it keeps its
 * translations in the store core hands out from
 * `IContentTranslationService.createValueStore`. Every such type needs the
 * same three storage steps, so this keeps them from each writing a copy; the
 * type passes only the validation rule that is its own.
 */

import type { ITranslationProposals } from './ITranslationProposals.js';
import type { ITranslationValueStore } from './ITranslationValueStore.js';
import type { TranslationValues } from './TranslationValues.js';

/**
 * Build proposal storage over a value store.
 *
 * @param store - The value store the type keeps its translations in.
 * @param validate - The type's own rule for translated values, the same one
 *   its `writeTranslation` applies, so a proposal it would refuse is refused
 *   when it is made. Leave it out for a type with no rule of its own.
 * @returns Proposal storage that holds proposals beside the served values.
 */
export function createValueStoreProposals(
    store: ITranslationValueStore,
    validate?: (values: TranslationValues) => void
): ITranslationProposals {
    return {
        validate: validate ?? noTypeRules,
        read: store.readProposed.bind(store),
        write: store.writeProposed.bind(store),
        clear: store.clearProposed.bind(store)
    };
}

/** Accept every value, for a type that adds no rule beyond core's field checks. */
function noTypeRules(): void {
    return;
}
