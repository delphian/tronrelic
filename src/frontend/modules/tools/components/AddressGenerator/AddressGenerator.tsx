/**
 * @fileoverview TRON address generator tool page.
 *
 * Generates random TRON addresses in-browser using a Web Worker so private
 * keys never leave the client. Supports single generation and continuous
 * vanity search with case-sensitivity toggle, live progress stats, and
 * difficulty estimation. No SSR data — purely interactive tool.
 */
'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { KeyRound, Search, Square, Copy, Check, Eye, EyeOff, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Page, PageHeader, Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Input } from '../../../../components/ui/Input';
import { Button } from '../../../../components/ui/Button';
import { Badge } from '../../../../components/ui/Badge';
import styles from './AddressGenerator.module.scss';

/** Valid Base58 characters — excludes 0, O, I, l. */
const BASE58_CHARS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_SET = new Set(BASE58_CHARS);

/** Maximum vanity matches to store before auto-stopping the search. */
const MAX_VANITY_MATCHES = 100;

/** Characters commonly confused with valid Base58 characters. */
const CONFUSED_CHARS: Record<string, string> = {
    '0': '(zero) — did you mean O? (also excluded)',
    'O': '(uppercase O) — excluded to avoid confusion with 0',
    'I': '(uppercase I) — excluded to avoid confusion with l',
    'l': '(lowercase L) — excluded to avoid confusion with I',
};

/** Generated address with its private key. */
interface IGeneratedAddress {
    address: string;
    privateKey: string;
}

/**
 * Validate a vanity pattern against the Base58 alphabet.
 * Returns a warning message if invalid characters are found, null otherwise.
 *
 * @param pattern - The vanity search string to validate
 * @returns Warning message or null
 */
function validateBase58(pattern: string): string | null {
    const invalid = [...pattern].filter(ch => !BASE58_SET.has(ch));
    if (invalid.length === 0) return null;

    const details = invalid.map(ch => {
        const hint = CONFUSED_CHARS[ch];
        return hint ? `'${ch}' ${hint}` : `'${ch}'`;
    });

    return `Invalid Base58 character${invalid.length > 1 ? 's' : ''}: ${details.join(', ')}`;
}

/**
 * Estimate the expected number of addresses to check before finding a vanity
 * match anywhere in a 34-character TRON address.
 *
 * @param pattern - The search pattern
 * @param caseSensitive - Whether matching is case-sensitive
 * @returns Human-readable difficulty string
 */
function getDifficultyEstimate(pattern: string, caseSensitive: boolean): string {
    if (!pattern) return '';

    const n = pattern.length;
    const positions = Math.max(1, 34 - n + 1);

    const letterCount = [...pattern].filter(ch => /[a-zA-Z]/.test(ch)).length;
    const digitCount = n - letterCount;

    let probPerPosition: number;
    if (caseSensitive) {
        probPerPosition = Math.pow(1 / 58, n);
    } else {
        const letterProb = 2 / 58;
        const digitProb = 1 / 58;
        probPerPosition = Math.pow(letterProb, letterCount) * Math.pow(digitProb, digitCount);
    }

    const probAnyPosition = Math.min(1, positions * probPerPosition);
    const expected = Math.round(1 / probAnyPosition);

    if (expected < 1000) return `~${expected} attempts (instant)`;
    if (expected < 1_000_000) return `~${(expected / 1000).toFixed(1)}K attempts (seconds)`;
    if (expected < 1_000_000_000) return `~${(expected / 1_000_000).toFixed(1)}M attempts (minutes to hours)`;

    return `~${(expected / 1_000_000_000).toFixed(1)}B attempts (hours to days)`;
}

/**
 * Format a large number with thousand separators.
 *
 * @param num - Number to format
 * @returns Formatted string
 */
function formatNumber(num: number): string {
    return num.toLocaleString();
}

/**
 * Single address row with copy buttons and private key reveal toggle.
 *
 * @param props - Component props
 * @param props.entry - The generated address entry
 */
function AddressRow({ entry }: { entry: IGeneratedAddress }) {
    const [revealed, setRevealed] = useState(false);
    const [copiedField, setCopiedField] = useState<'address' | 'key' | null>(null);

    /** Copy a value to clipboard and show confirmation. */
    const handleCopy = useCallback(async (value: string, field: 'address' | 'key') => {
        try {
            await navigator.clipboard.writeText(value);
            setCopiedField(field);
            setTimeout(() => setCopiedField(null), 2000);
        } catch {
            /* Clipboard API unavailable — fail silently */
        }
    }, []);

    const maskedKey = revealed ? entry.privateKey : '\u2022'.repeat(entry.privateKey.length);

    return (
        <div className={styles.address_row}>
            <div className={styles.address_row__field}>
                <span className={styles.address_row__label}>Address</span>
                <div className={styles.address_row__value_group}>
                    <code className={styles.address_row__value}>{entry.address}</code>
                    <button
                        className={styles.icon_button}
                        onClick={() => handleCopy(entry.address, 'address')}
                        aria-label="Copy address"
                        title="Copy address"
                    >
                        {copiedField === 'address'
                            ? <Check size={14} style={{ color: 'var(--color-success)' }} />
                            : <Copy size={14} />
                        }
                    </button>
                </div>
            </div>
            <div className={styles.address_row__field}>
                <span className={styles.address_row__label}>Private Key</span>
                <div className={styles.address_row__value_group}>
                    <code className={`${styles.address_row__value} ${!revealed ? styles['address_row__value--masked'] : ''}`}>
                        {maskedKey}
                    </code>
                    <button
                        className={styles.icon_button}
                        onClick={() => setRevealed(prev => !prev)}
                        aria-label={revealed ? 'Hide private key' : 'Reveal private key'}
                        title={revealed ? 'Hide' : 'Reveal'}
                    >
                        {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                        className={styles.icon_button}
                        onClick={() => handleCopy(entry.privateKey, 'key')}
                        aria-label="Copy private key"
                        title="Copy private key"
                    >
                        {copiedField === 'key'
                            ? <Check size={14} style={{ color: 'var(--color-success)' }} />
                            : <Copy size={14} />
                        }
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * Address generator tool.
 *
 * Provides two modes: single random address generation and continuous vanity
 * search. All cryptographic operations run in a Web Worker — private keys
 * are generated in-browser and never sent to a server.
 */
export function AddressGenerator() {
    const workerRef = useRef<Worker | null>(null);

    const [singleResult, setSingleResult] = useState<IGeneratedAddress | null>(null);
    const [generating, setGenerating] = useState(false);

    const [vanityPattern, setVanityPattern] = useState('');
    const [caseSensitive, setCaseSensitive] = useState(true);
    const [searching, setSearching] = useState(false);
    const [matches, setMatches] = useState<IGeneratedAddress[]>([]);
    const [stats, setStats] = useState<{ checked: number; rate: number }>({ checked: 0, rate: 0 });
    const [base58Warning, setBase58Warning] = useState<string | null>(null);

    /** Initialize the Web Worker on mount. */
    useEffect(() => {
        const worker = new Worker(
            new URL('./address-generator.worker.ts', import.meta.url)
        );

        worker.onmessage = (event: MessageEvent) => {
            const { type } = event.data;

            switch (type) {
                case 'generated':
                    setSingleResult({ address: event.data.address, privateKey: event.data.privateKey });
                    setGenerating(false);
                    break;
                case 'vanity-match':
                    setMatches(prev => {
                        if (prev.length >= MAX_VANITY_MATCHES) {
                            worker.postMessage({ type: 'vanity-stop' });
                            return prev;
                        }
                        return [...prev, { address: event.data.address, privateKey: event.data.privateKey }];
                    });
                    break;
                case 'vanity-progress':
                    setStats({ checked: event.data.checked, rate: event.data.rate });
                    break;
                case 'vanity-stopped':
                    setStats({ checked: event.data.checked, rate: event.data.rate });
                    setSearching(false);
                    break;
            }
        };

        workerRef.current = worker;

        return () => {
            worker.terminate();
        };
    }, []);

    /** Generate a single random address. */
    const handleGenerate = useCallback(() => {
        if (!workerRef.current) return;
        setGenerating(true);
        workerRef.current.postMessage({ type: 'generate' });
    }, []);

    /** Start the vanity search. */
    const handleStartSearch = useCallback(() => {
        if (!workerRef.current || !vanityPattern.trim()) return;
        setMatches([]);
        setStats({ checked: 0, rate: 0 });
        setSearching(true);
        workerRef.current.postMessage({
            type: 'vanity-start',
            pattern: vanityPattern.trim(),
            caseSensitive,
        });
    }, [vanityPattern, caseSensitive]);

    /** Stop the vanity search. */
    const handleStopSearch = useCallback(() => {
        if (!workerRef.current) return;
        workerRef.current.postMessage({ type: 'vanity-stop' });
    }, []);

    /** Validate vanity input on change. */
    const handlePatternChange = useCallback((value: string) => {
        setVanityPattern(value);
        setBase58Warning(value ? validateBase58(value) : null);
    }, []);

    const difficulty = vanityPattern.trim() && !base58Warning
        ? getDifficultyEstimate(vanityPattern.trim(), caseSensitive)
        : '';

    return (
        <Page>
            <PageHeader
                title="Address Generator"
                subtitle="Generate random TRON addresses and search for vanity patterns"
            />
            <div className={styles.container}>
                {/* Single generation */}
                <Card>
                    <Stack gap="md">
                        <div className={styles.section_header}>
                            <span className={styles.section_title}>Generate Address</span>
                            <Button
                                variant="primary"
                                onClick={handleGenerate}
                                disabled={generating}
                                loading={generating}
                            >
                                <KeyRound size={18} />
                                Generate
                            </Button>
                        </div>

                        {singleResult && <AddressRow entry={singleResult} />}
                    </Stack>
                </Card>

                {/* Vanity search */}
                <Card>
                    <Stack gap="md">
                        <span className={styles.section_title}>Vanity Search</span>

                        <label className={styles.label} htmlFor="vanity-input">
                            Search pattern (matched anywhere in address)
                        </label>
                        <div className={styles.input_row}>
                            <Input
                                id="vanity-input"
                                value={vanityPattern}
                                onChange={e => handlePatternChange(e.target.value)}
                                placeholder="e.g. cafe, TRON, abc"
                                disabled={searching}
                                onKeyDown={e => e.key === 'Enter' && !searching && !base58Warning && handleStartSearch()}
                            />
                            <label className={styles.toggle} htmlFor="case-toggle">
                                <input
                                    id="case-toggle"
                                    type="checkbox"
                                    checked={caseSensitive}
                                    onChange={e => setCaseSensitive(e.target.checked)}
                                    disabled={searching}
                                />
                                <span className={styles.toggle__label}>Case sensitive</span>
                            </label>
                            {searching ? (
                                <Button variant="danger" onClick={handleStopSearch}>
                                    <Square size={18} />
                                    Stop
                                </Button>
                            ) : (
                                <Button
                                    variant="primary"
                                    onClick={handleStartSearch}
                                    disabled={!vanityPattern.trim() || !!base58Warning}
                                >
                                    <Search size={18} />
                                    Search
                                </Button>
                            )}
                        </div>

                        {base58Warning && (
                            <p className={styles.warning}>
                                <TriangleAlert size={14} />
                                {base58Warning}
                            </p>
                        )}

                        {difficulty && !base58Warning && (
                            <p className={styles.difficulty}>
                                Expected difficulty: {difficulty}
                            </p>
                        )}

                        {(searching || stats.checked > 0) && (
                            <div className={styles.stats}>
                                <Badge tone={searching ? 'success' : 'neutral'} showLiveIndicator={searching}>
                                    {searching ? 'Searching' : 'Stopped'}
                                </Badge>
                                <span className={styles.stats__text}>
                                    {formatNumber(stats.checked)} checked &mdash; ~{formatNumber(stats.rate)}/sec
                                </span>
                                {matches.length > 0 && (
                                    <span className={styles.stats__matches}>
                                        {matches.length} match{matches.length !== 1 ? 'es' : ''}
                                    </span>
                                )}
                            </div>
                        )}

                        {matches.length > 0 && (
                            <div className={styles.matches}>
                                {matches.map((entry, i) => (
                                    <AddressRow key={`${entry.address}-${i}`} entry={entry} />
                                ))}
                            </div>
                        )}
                    </Stack>
                </Card>

                {/* Security notice */}
                <div className={styles.notice}>
                    <ShieldCheck size={16} />
                    <p>
                        Keys are generated entirely in your browser using a Web Worker.
                        No private keys are ever sent to a server. Use caution before
                        sending real funds to a web-generated address — consider hardware
                        wallets for significant holdings.
                    </p>
                </div>
            </div>
        </Page>
    );
}
