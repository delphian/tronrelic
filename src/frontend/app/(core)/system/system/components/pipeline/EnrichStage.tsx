'use client';

/**
 * @fileoverview The Enrich stage card: are receipts, and so decoded events, arriving?
 *
 * Receipts carry each transaction's energy, bandwidth, and event logs, and the
 * event logs are what core decodes into token transfers for plugins. The old
 * console did not show receipts at all, and their switch was the last card on
 * the Configuration tab. This card shows the switch beside the figures it
 * changes: coverage over recent blocks, what happened to the ones that were
 * not covered, and how many events were decoded.
 */

import { useState } from 'react';
import type { IPipelineStatus } from '@/types';
import { Switch } from '../../../../../../components/ui/Switch';
import { ConfirmDialog } from '../../../../../../components/ui/ConfirmDialog';
import { useModal } from '../../../../../../components/ui/ModalProvider';
import { useToast } from '../../../../../../components/ui/ToastProvider/ToastProvider';
import { StatStrip } from '../StatStrip';
import { updateTronGridConfig } from '../providers-api';
import { StageCard } from './StageCard';
import { StageTimings } from './StageTimings';
import { formatNumber } from './pipeline-format';

/** Inputs for the Enrich card. */
interface IEnrichStageProps {
    /** The pipeline payload. */
    pipeline: IPipelineStatus;
    /** Called after the switch changes, so the tab refreshes at once. */
    onChanged: () => void;
}

/** Timing keys that belong to enriching and parsing a block. */
const ENRICH_STAGE_KEYS = ['fetchReceipts', 'processTransactions', 'calculateStats', 'prepare'];

/**
 * Render the Enrich stage card.
 *
 * @param props - The payload and a refresh callback.
 * @returns The card.
 */
export function EnrichStage({ pipeline, onChanged }: IEnrichStageProps) {
    const { receipts, recentBlocks, stages } = pipeline;
    const { open: openModal, close: closeModal } = useModal();
    const { push: pushToast } = useToast();
    const [saving, setSaving] = useState(false);

    const recentEvents = recentBlocks.reduce((sum, block) => sum + block.eventCount, 0);
    const recentTransfers = recentBlocks.reduce((sum, block) => sum + block.tokenTransferCount, 0);
    const missed = receipts.partial + receipts.failed;

    /**
     * Save the receipts switch and refresh the tab.
     *
     * @param next - The new switch position.
     */
    const saveSwitch = async (next: boolean) => {
        setSaving(true);
        try {
            await updateTronGridConfig({ fetchBlockReceipts: next });
            pushToast({ tone: 'success', title: next ? 'Block receipts on' : 'Block receipts off', description: 'Takes effect from the next block.' });
            onChanged();
        } catch (error) {
            pushToast({ tone: 'danger', title: 'Receipts switch not saved', description: error instanceof Error ? error.message : 'Unknown error' });
        } finally {
            setSaving(false);
        }
    };

    /**
     * Handle a click on the switch, confirming before turning receipts on.
     *
     * Turning receipts on costs one extra TronGrid request per block, so it is
     * confirmed; turning them off saves at once.
     *
     * @param next - The position the operator asked for.
     */
    const handleToggle = (next: boolean) => {
        if (next) {
            const id = openModal({
                title: 'Turn on block receipts',
                size: 'sm',
                content: (
                    <ConfirmDialog
                        label="block receipts"
                        confirmLabel="Turn on"
                        message="Block sync will make one extra TronGrid request per block from the next block onward. New blocks will carry energy, bandwidth, internal transfers, and decoded event logs. Blocks already indexed are not backfilled."
                        onCancel={() => closeModal(id)}
                        onConfirm={async () => {
                            await saveSwitch(true);
                            closeModal(id);
                        }}
                    />
                )
            });
        } else {
            void saveSwitch(false);
        }
    };

    return (
        <StageCard
            title="Enrich"
            description="Each block's transaction receipts add energy, bandwidth, and event logs, which core decodes into token transfers."
            actions={(
                <Switch
                    on={receipts.enabled}
                    onChange={handleToggle}
                    disabled={saving}
                    size="sm"
                    aria-label={receipts.enabled ? 'Turn block receipts off' : 'Turn block receipts on'}
                    title="Block receipts (fetchBlockReceipts)"
                />
            )}
        >
            <StatStrip
                items={[
                    {
                        label: 'Receipts',
                        value: receipts.enabled ? 'On' : 'Off',
                        detail: receipts.enabled ? 'One request per block' : 'Transfers from call data only',
                        tone: receipts.enabled ? 'neutral' : 'warning'
                    },
                    {
                        label: 'Coverage',
                        value: receipts.coveragePercent !== null ? `${receipts.coveragePercent}%` : '—',
                        detail: `Last ${formatNumber(receipts.window - receipts.disabled)} blocks with receipts on`,
                        tone: receipts.coverageTone
                    },
                    {
                        label: 'Missed',
                        value: formatNumber(missed),
                        detail: `${formatNumber(receipts.partial)} partial, ${formatNumber(receipts.failed)} failed`,
                        tone: missed > 0 && receipts.enabled ? 'warning' : 'neutral'
                    },
                    {
                        label: 'Events decoded',
                        value: formatNumber(recentEvents),
                        detail: `${formatNumber(recentTransfers)} token transfers in the last ${formatNumber(recentBlocks.length)} blocks`
                    }
                ]}
            />

            <StageTimings stages={stages} keys={ENRICH_STAGE_KEYS} />
        </StageCard>
    );
}
