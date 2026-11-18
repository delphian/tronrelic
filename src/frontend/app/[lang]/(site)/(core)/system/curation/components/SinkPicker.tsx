'use client';

/**
 * @fileoverview The choice of where approved content goes. Destinations are
 * split into two lanes by who will see the result: Private (admins and
 * internal systems) and Public (anyone, or somewhere outside TronRelic). The
 * Public lane is amber, the only amber in the review sheet besides the approve
 * button that echoes it, so a public destination never looks like a routine
 * choice.
 */

import { Globe, Lock, type LucideIcon } from 'lucide-react';
import { useId } from 'react';
import { Button } from '../../../../../../../components/ui/Button';
import { cn } from '../../../../../../../lib/cn';
import type { ICurationEligibleSink } from '../../../../../../../modules/curation';
import { sinkIsExternal } from './sinkIsExternal';
import styles from './DecisionBar.module.scss';

/** Which lane a destination belongs to. */
type LaneKind = 'private' | 'public';

/** The heading, explanation, and icon each lane shows. */
const LANE_COPY: Record<LaneKind, { title: string; note: string; Icon: LucideIcon }> = {
    private: { title: 'Private', note: 'Only admins and internal systems see it.', Icon: Lock },
    public: { title: 'Public', note: 'Anyone can see it, or it leaves TronRelic.', Icon: Globe }
};

/** Props for {@link SinkPicker}. */
export interface ISinkPickerProps {
    /** The item's eligible destinations. */
    sinks: ICurationEligibleSink[];
    /** The destination ids currently selected. */
    selected: Set<string>;
    /** Lock the controls while a decision is in flight. */
    disabled: boolean;
    /** Toggle one destination in the selection. */
    onToggle: (sinkId: string) => void;
    /** Save the current selection as the default for this content type. */
    onSetDefault: () => void;
}

/** Props for {@link SinkLane}. */
interface ISinkLaneProps {
    kind: LaneKind;
    sinks: ICurationEligibleSink[];
    selected: Set<string>;
    disabled: boolean;
    onToggle: (sinkId: string) => void;
}

/**
 * Say what a destination's reach adds to its lane's heading, or nothing when
 * the heading already says it all. The Private lane note covers admins and
 * internal systems, so only a destination signed-in users can see needs a
 * word. The Public lane note covers both "anyone on TronRelic" and "leaves
 * TronRelic", so every public destination says which of the two it is. The
 * full reach pair repeated on every row read as noise and squeezed the
 * destination names.
 *
 * @param kind - The lane the destination sits in.
 * @param reach - The destination's reach, as the content router reports it.
 * @returns A short phrase, or null when the lane heading is enough.
 */
function reachNote(kind: LaneKind, reach: ICurationEligibleSink['reach']): string | null {
    let note: string | null = null;
    if (kind === 'public') {
        note = reach.egress === 'external' ? 'external' : 'on site';
    } else if (reach.audience === 'user') {
        note = 'signed-in users';
    }
    return note;
}

/**
 * One lane of destinations, each a labelled checkbox with a short muted note
 * where its reach differs from what the lane heading says. The lane is a
 * named group so a screen reader announces "Public" before the options inside
 * it.
 *
 * @param props - See {@link ISinkLaneProps}.
 * @returns The lane.
 */
function SinkLane({ kind, sinks, selected, disabled, onToggle }: ISinkLaneProps) {
    const headingId = useId();
    const { title, note, Icon } = LANE_COPY[kind];
    const isPublic = kind === 'public';

    return (
        <div role="group" aria-labelledby={headingId} className={cn(styles.lane, isPublic && styles.lane_public)}>
            <span id={headingId} className={styles.lane_head}>
                <Icon size={14} aria-hidden="true" /> {title}
            </span>
            <p className={styles.lane_note}>{note}</p>
            {sinks.map(sink => {
                const name = sink.label ?? sink.sinkId;
                const note = reachNote(kind, sink.reach);
                return (
                    <label key={sink.sinkId} className={styles.option}>
                        <input
                            type="checkbox"
                            checked={selected.has(sink.sinkId)}
                            disabled={disabled}
                            onChange={() => onToggle(sink.sinkId)}
                        />
                        <span className={styles.option_label} title={name}>{name}</span>
                        {note && <span className={styles.option_reach}>{note}</span>}
                    </label>
                );
            })}
        </div>
    );
}

/**
 * The destination picker for an item that publishes to destinations.
 *
 * @param props - See {@link ISinkPickerProps}.
 * @returns The two lanes and the save-as-default control.
 */
export function SinkPicker({ sinks, selected, disabled, onToggle, onSetDefault }: ISinkPickerProps) {
    const privateSinks = sinks.filter(sink => !sinkIsExternal(sink.reach));
    const publicSinks = sinks.filter(sink => sinkIsExternal(sink.reach));

    return (
        <fieldset className={styles.picker}>
            <legend className={styles.picker_legend}>Where it goes when approved</legend>
            <div className={styles.lanes}>
                {privateSinks.length > 0 && (
                    <SinkLane kind="private" sinks={privateSinks} selected={selected} disabled={disabled} onToggle={onToggle} />
                )}
                {publicSinks.length > 0 && (
                    <SinkLane kind="public" sinks={publicSinks} selected={selected} disabled={disabled} onToggle={onToggle} />
                )}
            </div>
            <div className={styles.picker_footer}>
                <Button variant="ghost" size="xs" disabled={disabled} onClick={onSetDefault}>
                    Save as the default for this type
                </Button>
            </div>
        </fieldset>
    );
}
