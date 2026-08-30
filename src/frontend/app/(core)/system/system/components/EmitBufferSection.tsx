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
 * the underrun count on the Blockchain tab, which is a reading taken from a
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
import { Gauge, Save } from 'lucide-react';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Input } from '../../../../../components/ui/Input';
import { Badge } from '../../../../../components/ui/Badge';
import { Stack } from '../../../../../components/layout';
import { useToast } from '../../../../../components/ui/ToastProvider/ToastProvider';
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
     * @param key - Which setting the input belongs to.
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
        <Card padding="sm" noBackgroundImage>
            <Stack gap="md">
                <div className={styles.provider_header}>
                    <Gauge size={16} aria-hidden style={{ color: 'var(--color-primary)' }} />
                    <h3 className={styles.provider_title}>Block feed buffer</h3>
                    {bufferingOff
                        ? <Badge tone="warning">Buffering off</Badge>
                        : <Badge tone="success">Holding {saved.emitBufferTargetDepth} blocks</Badge>}
                </div>

                <p className="text-muted">
                    The backend holds a lead of finished blocks and broadcasts them on its own clock, so a slow
                    upstream response or a late sync tick is covered rather than shown as a gap. Saving applies these
                    values to the live feed straight away, with no restart. Judge them from the underrun count on the{' '}
                    <strong>Blockchain</strong> tab: a deployment holding a real lead never drains to zero, so any
                    increase means the target depth is too small for what this deployment&apos;s upstream access
                    actually does.
                </p>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor="emit-buffer-target">
                        {FIELD_LABELS.emitBufferTargetDepth}
                    </label>
                    <Input
                        id="emit-buffer-target"
                        type="number"
                        value={form.emitBufferTargetDepth}
                        onChange={(event) => handleChange('emitBufferTargetDepth', event.target.value)}
                        disabled={saving}
                        aria-label="Blocks of lead the feed holds"
                    />
                    <span className={styles.hint}>
                        Blocks held back before broadcasting. This is the lead a hiccup draws on, and each block of it
                        costs one block time of feed latency. Eight covers a fully missed sync tick plus a skipped
                        chain slot. <strong>Zero switches buffering off</strong>, which is a supported setting for a
                        staged rollout rather than a broken one.
                    </span>
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor="emit-buffer-catchup-depth">
                        {FIELD_LABELS.emitBufferCatchupDepth}
                    </label>
                    <Input
                        id="emit-buffer-catchup-depth"
                        type="number"
                        value={form.emitBufferCatchupDepth}
                        onChange={(event) => handleChange('emitBufferCatchupDepth', event.target.value)}
                        disabled={saving}
                        aria-label="Depth at which the buffer starts draining faster"
                    />
                    <span className={styles.hint}>
                        Depth above which the buffer drains faster than the chain produces, so the burst a sync tick
                        delivers does not settle in as permanent latency. Must be greater than the target depth.
                    </span>
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor="emit-buffer-max-depth">
                        {FIELD_LABELS.emitBufferMaxDepth}
                    </label>
                    <Input
                        id="emit-buffer-max-depth"
                        type="number"
                        value={form.emitBufferMaxDepth}
                        onChange={(event) => handleChange('emitBufferMaxDepth', event.target.value)}
                        disabled={saving}
                        aria-label="Depth beyond which blocks are broadcast immediately"
                    />
                    <span className={styles.hint}>
                        Depth beyond which blocks go out with no wait at all. A buffer this deep means something
                        upstream is wrong rather than merely uneven, and at that point the accumulated delay hurts a
                        viewer more than the uneven spacing would. Must be greater than the catch-up depth.
                    </span>
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor="emit-buffer-refill">
                        {FIELD_LABELS.emitBufferRefillIntervalMs} (ms)
                    </label>
                    <Input
                        id="emit-buffer-refill"
                        type="number"
                        value={form.emitBufferRefillIntervalMs}
                        onChange={(event) => handleChange('emitBufferRefillIntervalMs', event.target.value)}
                        disabled={saving}
                        aria-label="Milliseconds between broadcasts while below the target depth"
                    />
                    <span className={styles.hint}>
                        Spacing used while the buffer is below its target. <strong>Must be longer than one block
                        time.</strong> Releasing more slowly than blocks arrive is the only way a lead spent covering a
                        gap ever grows back. Set it equal to the block time and the buffer covers exactly one gap for
                        the life of the process and then runs flat, with nothing in the logs to say so.
                    </span>
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor="emit-buffer-catchup-interval">
                        {FIELD_LABELS.emitBufferCatchupIntervalMs} (ms)
                    </label>
                    <Input
                        id="emit-buffer-catchup-interval"
                        type="number"
                        value={form.emitBufferCatchupIntervalMs}
                        onChange={(event) => handleChange('emitBufferCatchupIntervalMs', event.target.value)}
                        disabled={saving}
                        aria-label="Milliseconds between broadcasts above the catch-up depth"
                    />
                    <span className={styles.hint}>
                        Spacing used above the catch-up depth, so a backlog that has built up drains faster than
                        blocks arrive instead of being held as permanent latency.
                    </span>
                </div>

                <div className={styles.actions}>
                    <Button
                        variant="primary"
                        size="md"
                        onClick={() => void handleSave()}
                        disabled={!dirty || saving}
                        loading={saving}
                        icon={<Save size={18} />}
                    >
                        Save
                    </Button>
                </div>
            </Stack>
        </Card>
    );
}
