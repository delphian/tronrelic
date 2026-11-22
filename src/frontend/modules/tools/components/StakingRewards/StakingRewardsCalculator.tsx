/**
 * @fileoverview The staking rewards calculator's form, results, and
 * representative table, without page chrome.
 *
 * It appears on its own fixed page and inside a CMS page as an embedded
 * widget, so it is kept apart from the page header. Both callers hand it the
 * stored rewards snapshot read on the server, so the table and a worked
 * example render in the first HTML and the calculator needs no request after
 * that: it applies the chosen representative's rate to the amount typed.
 */
'use client';

import { useId, useMemo, useState } from 'react';
import type { IStakingRewardsSnapshot, ISuperRepresentativeReward } from '@/types';
import { Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Field } from '../../../../components/ui/Field';
import { Input } from '../../../../components/ui/Input';
import { Select } from '../../../../components/ui/Select';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { StatGrid, StatTile } from '../../../../components/ui/StatTile';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { estimateStakingReward } from '../../lib/estimateStakingReward';
import { describeRepresentative } from '../../lib/describeRepresentative';
import styles from './StakingRewards.module.scss';

/** The amount the calculator opens with, so the first render already shows a worked example. */
const DEFAULT_STAKE_TRX = 10_000;

/** Rows the table shows before the visitor asks for every representative. */
const INITIAL_ROWS = 27;

/**
 * Props for {@link StakingRewardsCalculator}.
 */
interface IStakingRewardsCalculatorProps {
    /** The stored snapshot read on the server, or null before the first refresh has finished. */
    snapshot: IStakingRewardsSnapshot | null;
}

/**
 * Staking rewards calculator: pick a stake and a Super Representative, see the
 * yearly, monthly, and daily reward, and compare every representative's rate.
 *
 * @param props - The server-read snapshot.
 * @returns The calculator, or a notice when no snapshot exists yet.
 */
export function StakingRewardsCalculator({ snapshot }: IStakingRewardsCalculatorProps) {
    const { t, language } = useTranslation();

    // Highest rate first: the question a visitor brings is "where do I earn most".
    const byRate = useMemo<ISuperRepresentativeReward[]>(
        () => (snapshot ? [...snapshot.representatives].sort((a, b) => b.totalRewardPercent - a.totalRewardPercent) : []),
        [snapshot]
    );

    const [trxInput, setTrxInput] = useState(String(DEFAULT_STAKE_TRX));
    const [selectedAddress, setSelectedAddress] = useState(byRate[0]?.address ?? '');
    const [showAll, setShowAll] = useState(false);
    const stakeInputId = useId();
    const representativeSelectId = useId();

    // Formatted in the page's language on both server and client, so the
    // server HTML and the first client render agree.
    const formatTrx = useMemo(() => new Intl.NumberFormat(language, { maximumFractionDigits: 2 }), [language]);
    const formatWhole = useMemo(() => new Intl.NumberFormat(language, { maximumFractionDigits: 0 }), [language]);
    const formatPercent = useMemo(
        () => new Intl.NumberFormat(language, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        [language]
    );

    const selected = byRate.find(representative => representative.address === selectedAddress) ?? byRate[0];
    const estimate = estimateStakingReward(Number(trxInput), selected?.totalRewardPercent ?? 0);
    const visibleRows = showAll ? byRate : byRate.slice(0, INITIAL_ROWS);

    /**
     * Render a reward rate held as a percentage number, such as 3.12, in the
     * page's percent format.
     */
    const percent = (value: number) => formatPercent.format(value / 100);

    return snapshot && selected ? (
        <div className={styles.container}>
            <Stack gap="md">
                <Card>
                    <Stack gap="md">
                        <div className={styles.fields}>
                            <Field label={t('tools.stakingRewards.stakeLabel', 'TRX to stake and vote with')} htmlFor={stakeInputId}>
                                <Input
                                    id={stakeInputId}
                                    type="number"
                                    min="1"
                                    inputMode="decimal"
                                    value={trxInput}
                                    onChange={event => setTrxInput(event.target.value)}
                                />
                            </Field>
                            <Field label={t('tools.stakingRewards.representativeLabel', 'Super Representative')} htmlFor={representativeSelectId}>
                                <Select
                                    id={representativeSelectId}
                                    value={selected.address}
                                    onChange={event => setSelectedAddress(event.target.value)}
                                >
                                    {byRate.map(representative => (
                                        <option key={representative.address} value={representative.address}>
                                            {`${describeRepresentative(representative.url, representative.address)} — ${percent(representative.totalRewardPercent)}`}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                        </div>

                        <StatGrid size="sm">
                            <StatTile
                                size="sm"
                                tone="primary"
                                label={t('tools.stakingRewards.rate', 'Yearly reward rate')}
                                value={percent(selected.totalRewardPercent)}
                                note={t('tools.stakingRewards.commissionNote', 'After {commission} commission', { commission: percent(selected.commissionPercent) })}
                            />
                            <StatTile size="sm" label={t('tools.stakingRewards.perYear', 'Per year')} value={`${formatTrx.format(estimate.perYear)} TRX`} />
                            <StatTile size="sm" label={t('tools.stakingRewards.perMonth', 'Per month')} value={`${formatTrx.format(estimate.perMonth)} TRX`} />
                            <StatTile size="sm" label={t('tools.stakingRewards.perDay', 'Per day')} value={`${formatTrx.format(estimate.perDay)} TRX`} />
                        </StatGrid>

                        <p className={styles.note}>
                            {t(
                                'tools.stakingRewards.howItWorks',
                                'Staked TRX gives one vote per TRX. Rewards build up every block and are claimed by hand, at most once every 24 hours. Figures assume the representative keeps its current commission and vote count.'
                            )}
                        </p>
                    </Stack>
                </Card>

                <Card>
                    <Stack gap="sm">
                        <div className={styles.table_header}>
                            <h2 className={styles.table_title}>{t('tools.stakingRewards.tableTitle', 'Reward rate by Super Representative')}</h2>
                            <span className={styles.updated}>
                                {t('tools.stakingRewards.updated', 'Updated')} <ClientTime date={snapshot.fetchedAt} format="relative" />
                            </span>
                        </div>
                        {/* Not `flush`: the show-all button follows the table inside this card. */}
                        <Table stackAt="mobile">
                            <Thead>
                                <Tr>
                                    <Th width="shrink" numeric>{t('tools.stakingRewards.rank', 'Rank')}</Th>
                                    <Th width="expand">{t('tools.stakingRewards.representative', 'Representative')}</Th>
                                    <Th numeric>{t('tools.stakingRewards.votes', 'Votes')}</Th>
                                    <Th numeric>{t('tools.stakingRewards.commission', 'Commission')}</Th>
                                    <Th numeric>{t('tools.stakingRewards.rateColumn', 'Reward rate')}</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {visibleRows.map(representative => (
                                    <Tr key={representative.address}>
                                        {/* No label: on a phone the rank shares the name's line instead of taking one of its own. */}
                                        <Td numeric>{representative.rank}</Td>
                                        <Td>
                                            <span className={styles.representative}>
                                                <button
                                                    type="button"
                                                    className={styles.representative_button}
                                                    onClick={() => setSelectedAddress(representative.address)}
                                                    aria-pressed={representative.address === selected.address}
                                                >
                                                    {describeRepresentative(representative.url, representative.address)}
                                                </button>
                                                {representative.producesBlocks && (
                                                    <Badge size="xs" tone="info">{t('tools.stakingRewards.producer', 'Block producer')}</Badge>
                                                )}
                                            </span>
                                        </Td>
                                        <Td numeric label={t('tools.stakingRewards.votes', 'Votes')}>{formatWhole.format(representative.votes)}</Td>
                                        <Td numeric label={t('tools.stakingRewards.commission', 'Commission')}>{percent(representative.commissionPercent)}</Td>
                                        <Td numeric label={t('tools.stakingRewards.rateColumn', 'Reward rate')}>{percent(representative.totalRewardPercent)}</Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                        {byRate.length > INITIAL_ROWS && (
                            <div className={styles.table_footer}>
                                <Button variant="ghost" size="sm" onClick={() => setShowAll(current => !current)}>
                                    {showAll
                                        ? t('tools.stakingRewards.showFewer', 'Show the top {count}', { count: INITIAL_ROWS })
                                        : t('tools.stakingRewards.showAll', 'Show all {count}', { count: byRate.length })}
                                </Button>
                            </div>
                        )}
                    </Stack>
                </Card>
            </Stack>
        </div>
    ) : (
        <Card>
            <p className={styles.note}>
                {t('tools.stakingRewards.unavailable', 'Reward figures are being calculated from the chain. Check back in a few minutes.')}
            </p>
        </Card>
    );
}
