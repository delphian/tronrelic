'use client';

/**
 * @fileoverview A select for choosing which installed AI provider and model an
 * admin feature runs on.
 *
 * Several settings pages let an administrator pin the provider and model for
 * their AI requests, such as the localization Settings tab and the Pages
 * Settings tab. They share this control so the choice looks and behaves the
 * same everywhere: an automatic option for the active provider, then one group
 * per installed provider with its default model and its catalog.
 *
 * @module modules/ai-tools/components/AiModelSelect
 */

import { Select } from '../../../../components/ui/Select';
import type { IAiProviderModels } from '../../api/client';

/** A provider and model pair; each null means "automatic". */
export interface IAiModelChoice {
    /** Provider registry id, or null for the active provider. */
    providerId: string | null;
    /** Model id, or null for the provider's default model. */
    model: string | null;
}

/** Props for {@link AiModelSelect}. */
interface IAiModelSelectProps {
    /** Id for the select, so a `<Field>` label can point at it. */
    id: string;
    /** Installed providers with their model catalogs, from `getQueryProviders()`. */
    providers: IAiProviderModels[];
    /** The current choice. */
    value: IAiModelChoice;
    /** Receives the new choice when the administrator picks one. */
    onChange: (choice: IAiModelChoice) => void;
}

/**
 * Encode a provider and model as one select value. The empty string is the
 * automatic choice: the active provider with its own default model.
 *
 * @param choice - The provider and model.
 * @returns The select value.
 */
function encodeChoice(choice: IAiModelChoice): string {
    return choice.providerId ? `${choice.providerId}|${choice.model ?? ''}` : '';
}

/**
 * Decode a select value back into the provider and model it names.
 *
 * @param value - Value from the select.
 * @returns The provider id and model id, each null when automatic.
 */
function decodeChoice(value: string): IAiModelChoice {
    const separator = value.indexOf('|');
    return separator === -1
        ? { providerId: null, model: null }
        : { providerId: value.slice(0, separator), model: value.slice(separator + 1) || null };
}

/**
 * Whether two choices name the same provider and model, for deciding whether
 * a settings form has unsaved changes.
 *
 * @param a - One choice.
 * @param b - The other choice.
 * @returns True when both name the same provider and model.
 */
export function isSameAiModelChoice(a: IAiModelChoice, b: IAiModelChoice): boolean {
    return encodeChoice(a) === encodeChoice(b);
}

/**
 * Render the provider and model select.
 *
 * A stored choice whose provider or model is no longer offered still gets an
 * option, marked not installed, so the select shows what is saved rather than
 * silently switching to something else.
 *
 * @param props - The providers, the current choice, and the change handler.
 * @returns The select element.
 */
export function AiModelSelect({ id, providers, value, onChange }: IAiModelSelectProps) {
    const encoded = encodeChoice(value);
    const listed = encoded === '' || providers.some(provider =>
        encoded === encodeChoice({ providerId: provider.id, model: null })
        || provider.models.some(model => encoded === encodeChoice({ providerId: provider.id, model: model.id })));

    return (
        <Select id={id} size="sm" value={encoded} onChange={event => onChange(decodeChoice(event.target.value))}>
            <option value="">Active provider, its default model</option>
            {!listed && (
                <option value={encoded}>{value.providerId} / {value.model ?? 'default'} (not installed)</option>
            )}
            {providers.map(provider => (
                <optgroup key={provider.id} label={provider.active ? `${provider.label} (active)` : provider.label}>
                    <option value={encodeChoice({ providerId: provider.id, model: null })}>{provider.label}, its default model</option>
                    {provider.models.map(model => (
                        <option key={model.id} value={encodeChoice({ providerId: provider.id, model: model.id })}>
                            {model.display_name}
                        </option>
                    ))}
                </optgroup>
            ))}
        </Select>
    );
}
