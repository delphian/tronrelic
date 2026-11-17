'use client';

/**
 * @fileoverview Emit buffer configuration section.
 *
 * The backend holds a small lead of finished blocks and broadcasts them on a
 * steady clock, so a slow upstream response or a late sync tick is covered by
 * blocks already in hand instead of appearing as a gap in the feed. The five
 * settings here decide how big that lead is and how fast it is spent.
 *
 * They were environment variables until it became clear the loop for tuning
 * them did not close. The only reliable evidence that a lead is too small is
 * the underrun count on the Pipeline tab, which is a reading taken from a
 * running deployment — and acting on it meant editing a `.env` file and
 * recreating the container. Saving here applies the values to the live feed
 * immediately, so an operator can watch that same counter respond.
 *
 * Like its sibling cards on this tab, the section fetches on mount rather than
 * receiving server-rendered data. The tab mounts only once an administrator
 * selects it, so there is no server-rendered markup for the first client render
 * to disagree with, and the fetch is deferred until the tab is actually opened.
 */

import { useCallback, useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { Card } from '../../../../../../../components/ui/Card';
import { Panel } from '../../../../../../../components/ui/Panel';
import { Button } from '../../../../../../../components/ui/Button';
import { Field } from '../../../../../../../components/ui/Field';
import { Input } from '../../../../../../../components/ui/Input';
import { Badge } from '../../../../../../../components/ui/Badge';
import { useToast } from '../../../../../../../components/ui/ToastProvider/ToastProvider';
import { readFieldInteger } from './field-integer';
import {
    getEmitBufferConfig,
    updateEmitBufferConfig,
    EMIT_BUFFER_FIELD_LIMITS,
    type IEmitBufferConfigView
} from './emit-buffer-api';
import styles from './ProviderSection.module.scss';

/** Which setting an input belongs to, used as the key for state and labels. */
type EmitBufferField = keyof IEmitBufferConfigView;

/** The form's fields as text, so a half-typed value survives editing. */
type EmitBufferFormState = Record<EmitBufferField, string>;

/**
 * What each field is called on screen.
 *
 * Doubles as the list of fields the form owns: the parse and dirty checks walk
 * these keys, so adding a setting here and nowhere else cannot leave one of
 * them silently unvalidated.
 */
const FIELD_LABELS: Record<EmitBufferField, string> = {
    emitBufferTargetDepth: 'Target depth',
    emitBufferCatchupDepth: 'Catch-up depth',
    emitBufferMaxDepth: 'Max depth',
    emitBufferRefillIntervalMs: 'Refill interval',
    emitBufferCatchupIntervalMs: 'Catch-up interval'
};

/** The fields in the order the card lists them. */
const FIELD_KEYS = Object.keys(FIELD_LABELS) as EmitBufferField[];

/**
 * The visible label suffix and the one-line hint for each field.
 *
 * Each hint keeps the rule that stops a value being saved or working, such as
 * an ordering between two depths, beside the field it governs. The reasoning
 * behind the defaults lives in the panel's closed guide instead, so the fields
 * can share rows.
 */
const FIELD_DETAILS: Record<EmitBufferField, { id: string; unit?: string; hint: string }> = {
    emitBufferTargetDepth: {
        id: 'emit-buffer-target',
        hint: 'Blocks held back before broadcasting; each costs one block time of feed latency. 0 switches buffering off.'
    },
    emitBufferCatchupDepth: {
        id: 'emit-buffer-catchup-depth',
        hint: 'Above this depth the buffer drains faster than the chain produces. Must be greater than the target depth.'
    },
    emitBufferMaxDepth: {
        id: 'emit-buffer-max-depth',
        hint: 'Beyond this depth blocks go out with no wait. Must be greater than the catch-up depth.'
    },
    emitBufferRefillIntervalMs: {
        id: 'emit-buffer-refill',
        unit: 'ms',
        hint: 'Spacing while below the target. Must be longer than one block time, or a spent lead never grows back.'
    },
    emitBufferCatchupIntervalMs: {
        id: 'emit-buffer-catchup-interval',
        unit: 'ms',
        hint: 'Spacing above the catch-up depth, so a backlog drains faster than blocks arrive.'
    }
};

/** Placeholder state held only until the first fetch resolves. */
const EMPTY_FORM: EmitBufferFormState = {
    emitBufferTargetDepth: '',
    emitBufferCatchupDepth: '',
    emitBufferMaxDepth: '',
    emitBufferRefillIntervalMs: '',
    emitBufferCatchupIntervalMs: ''
};

/**
 * Turn saved values into the text the form edits.
 *
 * @param config - The five values as the backend stores them.
 * @returns The same values as strings, ready for controlled inputs.
 */
function toFormState(config: IEmitBufferConfigView): EmitBufferFormState {
    const form: EmitBufferFormState = {
        emitBufferTargetDepth: String(config.emitBufferTargetDepth),
        emitBufferCatchupDepth: String(config.emitBufferCatchupDepth),
        emitBufferMaxDepth: String(config.emitBufferMaxDepth),
        emitBufferRefillIntervalMs: String(config.emitBufferRefillIntervalMs),
        emitBufferCatchupIntervalMs: String(config.emitBufferCatchupIntervalMs)
    };

    return form;
}

/**
 * Parse the whole form, collecting every problem rather than stopping at the
 * first one.
 *
 * An operator adjusting the buffer usually changes two or three fields at once,
 * and reporting a single error per save would make them discover the rest one
 * round trip at a time. The ordering rule is checked here as well, because it
 * is a relation between fields the operator can see on screen. The rule about
 * the refill interval clearing one block time is deliberately left to the
 * backend, which is the only side that knows how fast the chain produces
 * blocks.
 *
 * @param form - Current text contents of all five inputs.
 * @returns The parsed values, and the problems that stop them being saved. The
 *          values are only meaningful when the problem list is empty.
 */
function parseForm(form: EmitBufferFormState): { values: IEmitBufferConfigView; problems: string[] } {
    const problems: string[] = [];
    const parsed: Partial<IEmitBufferConfigView> = {};

    for (const key of FIELD_KEYS) {
        const bounds = EMIT_BUFFER_FIELD_LIMITS[key];
        const value = readFieldInteger(form[key], bounds);

        if (value === null) {
            problems.push(`${FIELD_LABELS[key]} must be a whole number between ${bounds.min} and ${bounds.max}`);
        } else {
            parsed[key] = value;
        }
    }

    const values = parsed as IEmitBufferConfigView;

    if (problems.length === 0) {
        if (values.emitBufferCatchupDepth <= values.emitBufferTargetDepth) {
            problems.push('Catch-up depth must be greater than target depth, or the buffer never holds its lead');
        }
        if (values.emitBufferMaxDepth <= values.emitBufferCatchupDepth) {
            problems.push('Max depth must be greater than catch-up depth');
        }
    }

    return { values, problems };
}

/**
 * Render the emit buffer configuration card.
 *
 * @returns The card, or a placeholder line while the first fetch is in flight.
 */
export function EmitBufferSection() {
    const [form, setForm] = useState<EmitBufferFormState>(EMPTY_FORM);
    const [saved, setSaved] = useState<EmitBufferFormState>(EMPTY_FORM);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const { push: pushToast } = useToast();

    useEffect(() => {
        let active = true;

        getEmitBufferConfig()
            .then((config) => {
                if (active) {
                    const next = toFormState(config);
                    setForm(next);
                    setSaved(next);
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    pushToast({
                        tone: 'danger',
                        title: 'Failed to load emit buffer settings',
                        description: error instanceof Error ? error.message : 'Unknown error'
                    });
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [pushToast]);

    /**
     * Record what an operator typed into one field, leaving the others alone.
     *
     * @param value - The raw text, kept unparsed so a partly-typed number is
     *                not corrected out from under the cursor.
     */
    const handleChange = useCallback((key: EmitBufferField, value: string) => {
        setForm((current) => ({ ...current, [key]: value }));
    }, []);

    /**
     * Validate the form, save it, and adopt whatever the backend stored.
     *
     * The response reseeds the form rather than the locally parsed values,
     * because the backend is the authority on what was actually written and may
     * have corrected an ordering the form did not catch.
     */
    const handleSave = useCallback(async () => {
        const { values, problems } = parseForm(form);

        if (problems.length > 0) {
            pushToast({
                tone: 'danger',
                title: 'Emit buffer settings not saved',
                description: problems.join('; ')
            });
            return;
        }

        setSaving(true);

        try {
            const next = toFormState(await updateEmitBufferConfig(values));
            setForm(next);
            setSaved(next);
            pushToast({
                tone: 'success',
                title: 'Emit buffer settings applied',
                description: 'The running feed picked them up immediately.'
            });
        } catch (error) {
            pushToast({
                tone: 'danger',
                title: 'Failed to save emit buffer settings',
                description: error instanceof Error ? error.message : 'Unknown error'
            });
        } finally {
            setSaving(false);
        }
    }, [form, pushToast]);

    if (loading) {
        return (
            <Card padding="sm" noBackgroundImage>
                <span className="text-muted">Loading emit buffer settings…</span>
            </Card>
        );
    }

    const dirty = FIELD_KEYS.some((key) => form[key] !== saved[key]);
    const bufferingOff = saved.emitBufferTargetDepth === '0';

    return (
        <Panel
            title="Block feed buffer"
            meta={bufferingOff
                ? <Badge tone="warning">Buffering off</Badge>
                : <Badge tone="success">Holding {saved.emitBufferTargetDepth} blocks</Badge>}
            actions={(
                <Button
                    variant="primary"
                    onClick={() => void handleSave()}
                    disabled={!dirty || saving}
                    loading={saving}
                    icon={<Save size={18} />}
                >
                    Save
                </Button>
            )}
        >
            <p className={styles.description}>
                The backend holds a lead of finished blocks and broadcasts them on its own clock, so a slow upstream
                response or a late sync tick is covered rather than shown as a gap. Saving applies to the live feed at
                once; judge the values by the underrun count on the Pipeline tab&apos;s Buffer card, which should not rise.
            </p>

            <div className={styles.field_grid}>
                {FIELD_KEYS.map((key) => {
                    const details = FIELD_DETAILS[key];
                    return (
                        <Field
                            key={key}
                            label={details.unit ? `${FIELD_LABELS[key]} (${details.unit})` : FIELD_LABELS[key]}
                            hint={details.hint}
                        >
                            <Input
                                id={details.id}
                                type="number"
                                value={form[key]}
                                onChange={(event) => handleChange(key, event.target.value)}
                                disabled={saving}
                            />
                        </Field>
                    );
                })}
            </div>

            <details className={styles.guide}>
                <summary>How to size the buffer</summary>
                <p>
                    The target depth is the lead a hiccup draws on. The default of twenty covers three fully missed
                    15-second sync ticks plus a skipped chain slot. Zero switches buffering off, which is a supported
                    setting for a staged rollout rather than a broken one. A deployment holding a real lead never drains
                    to zero, so any rise in underruns means the target is too small for what this deployment&apos;s
                    upstream access actually does.
                </p>
                <p>
                    The catch-up depth stops the burst a sync tick delivers from settling in as permanent latency. A
                    buffer as deep as the max depth means something upstream is wrong rather than merely uneven, and at
                    that point the accumulated delay hurts a viewer more than uneven spacing would.
                </p>
                <p>
                    Releasing more slowly than blocks arrive is the only way a lead spent covering a gap grows back. Set
                    the refill interval equal to the block time and the buffer covers exactly one gap for the life of the
                    process and then runs flat, with nothing in the logs to say so.
                </p>
            </details>
        </Panel>
    );
}
