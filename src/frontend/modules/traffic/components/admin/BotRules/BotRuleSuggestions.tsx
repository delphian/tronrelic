'use client';

/**
 * BotRuleSuggestions — networks whose recent traffic looks automated but is
 * still counted as human.
 *
 * Why it exists: disguised crawlers were found only when someone noticed a
 * traffic spike and investigated it by hand. This list surfaces networks with a
 * crawler's shape over the last week — many cookies, about one page each,
 * almost never a referrer, no logins — so the operator can start a rule from
 * one with a click and preview it before saving. Networks an active rule
 * already names are left out by the server.
 */

import { Plus } from 'lucide-react';
import type { IBotRuleSuggestion } from '@/types';
import { Button } from '../../../../../components/ui/Button';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import styles from './BotRules.module.scss';

/** Props for {@link BotRuleSuggestions}. */
interface IBotRuleSuggestionsProps {
    /** Candidate networks, most cookies first. */
    suggestions: IBotRuleSuggestion[];
    /** Called when the operator starts a rule from a suggestion. */
    onUse: (suggestion: IBotRuleSuggestion) => void;
}

/**
 * Render the suggestions table, or a line saying there are none.
 *
 * @param props - The suggestions and the callback that starts a rule from one.
 * @returns The suggestions section.
 */
export function BotRuleSuggestions({ suggestions, onUse }: IBotRuleSuggestionsProps) {
    return (
        <section className={styles.suggestions} aria-label="Suggested networks">
            <h3 className={styles.subheading}>Suggested networks (last 7 days)</h3>
            {suggestions.length === 0 ? (
                <p className={styles.empty}>No network currently looks like a disguised crawler.</p>
            ) : (
                <Table variant="compact" stackAt="mobile">
                    <Thead>
                        <Tr>
                            <Th>Network</Th>
                            <Th numeric>Cookies</Th>
                            <Th numeric>Reports</Th>
                            <Th numeric>No referrer</Th>
                            <Th>Most common browser identifier</Th>
                            <Th>Last seen</Th>
                            <Th><span className={styles.visually_hidden}>Actions</span></Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {suggestions.map(s => (
                            <Tr key={s.asn}>
                                {/* No label: the network heads its entry when the table stacks on a phone. */}
                                <Td>
                                    <span className={styles.mono}>AS{s.asn}</span>
                                    {s.countries.length > 0 && <span className={styles.muted_inline}> · {s.countries.join(', ')}</span>}
                                </Td>
                                <Td label="Cookies" numeric>{s.cookies.toLocaleString()}</Td>
                                <Td label="Reports" numeric>{s.events.toLocaleString()}</Td>
                                <Td label="No referrer" numeric>{Math.round(s.noReferrerShare * 100)}%</Td>
                                <Td label="Most common browser identifier" muted className={styles.cell_wrap}>
                                    {s.topUserAgent ?? '—'}
                                    {s.distinctUserAgents > 1 && <span> (+{s.distinctUserAgents - 1} more)</span>}
                                </Td>
                                <Td label="Last seen" muted><ClientTime date={s.lastSeen} format="relative" /></Td>
                                {/* No label: the Rule button names its own action. */}
                                <Td>
                                    <Button type="button" size="xs" variant="secondary" onClick={() => onUse(s)} aria-label={`Start a rule for AS${s.asn}`}>
                                        <Plus size={14} aria-hidden="true" /> Rule
                                    </Button>
                                </Td>
                            </Tr>
                        ))}
                    </Tbody>
                </Table>
            )}
        </section>
    );
}
