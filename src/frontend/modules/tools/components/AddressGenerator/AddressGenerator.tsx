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
import { KeyRound, Search, Square, Copy, Check, Eye, EyeOff, ShieldCheck, TriangleAlert, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { ITranslator } from '@/types';
import { Page, PageHeader, Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Input } from '../../../../components/ui/Input';
import { Button } from '../../../../components/ui/Button';
import { Badge } from '../../../../components/ui/Badge';
import { useModal } from '../../../../components/ui/ModalProvider';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import styles from './AddressGenerator.module.scss';

/** Valid Base58 characters — excludes 0, O, I, l. */
const BASE58_CHARS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_SET = new Set(BASE58_CHARS);

/** Maximum vanity matches to store before auto-stopping the search. */
const MAX_VANITY_MATCHES = 100;

/**
 * Characters commonly confused with valid Base58 characters, each with the
 * translation key and English text of the hint shown beside it.
 */
const CONFUSED_CHARS: Record<string, { key: string; text: string }> = {
    '0': { key: 'tools.addressGenerator.base58.hintZero', text: '(zero) — did you mean O? (also excluded)' },
    'O': { key: 'tools.addressGenerator.base58.hintUpperO', text: '(uppercase O) — excluded to avoid confusion with 0' },
    'I': { key: 'tools.addressGenerator.base58.hintUpperI', text: '(uppercase I) — excluded to avoid confusion with l' },
    'l': { key: 'tools.addressGenerator.base58.hintLowerL', text: '(lowercase L) — excluded to avoid confusion with I' },
};

/** Generated address with its private key, optional mnemonic, and derived gender. */
interface IGeneratedAddress {
    address: string;
    privateKey: string;
    mnemonic?: string;
    gender: 'male' | 'female';
}

/**
 * Validate a vanity pattern against the Base58 alphabet.
 * Returns a warning message if invalid characters are found, null otherwise.
 *
 * @param pattern - The vanity search string to validate
 * @param t - Translator for the page, so the warning reads in the visitor's language
 * @returns Warning message or null
 */
function validateBase58(pattern: string, t: ITranslator['t']): string | null {
    const invalid = [...pattern].filter(ch => !BASE58_SET.has(ch));
    if (invalid.length === 0) return null;

    const details = invalid.map(ch => {
        const hint = CONFUSED_CHARS[ch];
        return hint ? `'${ch}' ${t(hint.key, hint.text)}` : `'${ch}'`;
    });

    return invalid.length > 1
        ? t('tools.addressGenerator.base58.invalidMany', 'Invalid Base58 characters: {details}', { details: details.join(', ') })
        : t('tools.addressGenerator.base58.invalidOne', 'Invalid Base58 character: {details}', { details: details.join(', ') });
}

/**
 * Estimate the expected number of addresses to check before finding a vanity
 * match anywhere in a 34-character TRON address.
 *
 * In case-insensitive mode, most letters match two Base58 characters (e.g.
 * 'a'/'A' both exist), giving 2/58 probability per position. But Base58
 * excludes 'I', 'O', and 'l', so their counterparts ('i', 'o', 'L') have
 * no case partner and remain 1/58 even when case-insensitive. Partner
 * existence is derived from BASE58_SET rather than a hardcoded list.
 *
 * @param pattern - The search pattern
 * @param caseSensitive - Whether matching is case-sensitive
 * @param t - Translator for the page, so the estimate reads in the visitor's language
 * @returns Human-readable difficulty string
 */
function getDifficultyEstimate(pattern: string, caseSensitive: boolean, t: ITranslator['t']): string {
    if (!pattern) return '';

    const n = pattern.length;
    const positions = Math.max(1, 34 - n + 1);

    let probPerPosition: number;
    if (caseSensitive) {
        probPerPosition = Math.pow(1 / 58, n);
    } else {
        probPerPosition = [...pattern].reduce((prob, ch) => {
            const isLetter = /[a-zA-Z]/.test(ch);
            const hasPartner = isLetter
                && BASE58_SET.has(ch.toLowerCase())
                && BASE58_SET.has(ch.toUpperCase());
            return prob * ((hasPartner ? 2 : 1) / 58);
        }, 1);
    }

    const probAnyPosition = Math.min(1, positions * probPerPosition);
    const expected = Math.round(1 / probAnyPosition);

    if (expected < 1000) return t('tools.addressGenerator.difficulty.attempts', '~{count} attempts', { count: expected });
    if (expected < 1_000_000) {
        return t('tools.addressGenerator.difficulty.thousands', '~{count}K attempts', { count: (expected / 1000).toFixed(1) });
    }
    if (expected < 1_000_000_000) {
        return t('tools.addressGenerator.difficulty.millions', '~{count}M attempts', { count: (expected / 1_000_000).toFixed(1) });
    }

    return t('tools.addressGenerator.difficulty.billions', '~{count}B attempts', { count: (expected / 1_000_000_000).toFixed(1) });
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
 * Inline QR code panel shown below a field when toggled. Renders the value as a
 * scannable SVG QR code with a label indicating what the code contains.
 *
 * @param props - Component props
 * @param props.value - String to encode in the QR code
 * @param props.label - Caption shown below the QR code (e.g. "Private Key" or "Recovery Phrase")
 */
function InlineQrCode({ value, label }: { value: string; label: string }) {
    return (
        <div className={styles.qr_panel}>
            <div className={styles.qr_panel__code}>
                <QRCodeSVG
                    value={value}
                    size={180}
                    level="M"
                    bgColor="#ffffff"
                    fgColor="#000000"
                />
            </div>
            <span className={styles.qr_panel__label}>{label}</span>
        </div>
    );
}

/**
 * Modal content for displaying a QR code. Used by vanity search rows where
 * inline display would clutter the table layout.
 *
 * @param props - Component props
 * @param props.address - TRON address shown as a heading
 * @param props.privateKey - Private key to encode in the QR code
 */
function QrModalContent({ address, privateKey }: { address: string; privateKey: string }) {
    const { t } = useTranslation();
    return (
        <div className={styles.qr_modal}>
            <div className={styles.qr_panel__code}>
                <QRCodeSVG
                    value={privateKey}
                    size={220}
                    level="M"
                    bgColor="#ffffff"
                    fgColor="#000000"
                />
            </div>
            <code className={styles.qr_modal__address}>{address}</code>
            <p className={styles.qr_modal__hint}>
                {t('tools.addressGenerator.qr.scanHint', 'Scan to import private key into a mobile wallet')}
            </p>
        </div>
    );
}

/**
 * Display a single generated address with mnemonic and private key, both masked by default.
 *
 * @param props - Component props
 * @param props.entry - The generated address entry including mnemonic
 */
function SingleAddressResult({ entry }: { entry: IGeneratedAddress }) {
    const { t } = useTranslation();
    const [revealedMnemonic, setRevealedMnemonic] = useState(false);
    const [revealedKey, setRevealedKey] = useState(false);
    const [copiedField, setCopiedField] = useState<'address' | 'mnemonic' | 'key' | null>(null);
    const [showMnemonicQr, setShowMnemonicQr] = useState(false);
    const [showKeyQr, setShowKeyQr] = useState(false);

    /** Reset all reveal/QR state when the underlying entry changes. */
    useEffect(() => {
        setRevealedMnemonic(false);
        setRevealedKey(false);
        setCopiedField(null);
        setShowMnemonicQr(false);
        setShowKeyQr(false);
    }, [entry.address, entry.privateKey, entry.mnemonic]);

    /** Copy a value to clipboard and show confirmation. */
    const handleCopy = useCallback(async (value: string, field: 'address' | 'mnemonic' | 'key') => {
        try {
            await navigator.clipboard.writeText(value);
            setCopiedField(field);
            setTimeout(() => setCopiedField(null), 2000);
        } catch {
            /* Clipboard API unavailable — fail silently */
        }
    }, []);

    const mnemonic = entry.mnemonic;
    const maskedMnemonic = !mnemonic
        ? t('tools.addressGenerator.result.unavailable', 'Unavailable')
        : revealedMnemonic
            ? mnemonic
            : mnemonic.split(' ').map(() => '\u2022\u2022\u2022\u2022').join(' ');
    const maskedKey = revealedKey ? entry.privateKey : '\u2022'.repeat(entry.privateKey.length);

    return (
        <div className={styles.single_result}>
            <div className={styles.single_result__field}>
                <span className={styles.single_result__label}>{t('tools.addressGenerator.label.address', 'Address')}</span>
                <div className={styles.single_result__value_row}>
                    <code className={styles.single_result__mono}>{entry.address}</code>
                    <Badge tone="neutral">
                        {entry.gender === 'male'
                            ? t('tools.addressGenerator.result.yang', 'Yang ☰')
                            : t('tools.addressGenerator.result.yin', 'Yin ☷')}
                    </Badge>
                    <button
                        className={styles.icon_button}
                        onClick={() => handleCopy(entry.address, 'address')}
                        aria-label={t('tools.addressGenerator.action.copyAddress', 'Copy address')}
                        title={t('tools.addressGenerator.action.copyAddress', 'Copy address')}
                    >
                        {copiedField === 'address'
                            ? <Check size={14} style={{ color: 'var(--color-success)' }} />
                            : <Copy size={14} />
                        }
                    </button>
                </div>
            </div>
            <div className={styles.single_result__field}>
                <span className={styles.single_result__label}>{t('tools.addressGenerator.label.recoveryPhrase', 'Recovery Phrase')}</span>
                <div className={styles.single_result__value_row}>
                    <code className={`${styles.single_result__mono} ${!revealedMnemonic ? styles.single_result__masked : ''}`}>
                        {maskedMnemonic}
                    </code>
                    <button
                        className={styles.icon_button}
                        onClick={() => {
                            const next = !revealedMnemonic;
                            setRevealedMnemonic(next);
                            if (!next) setShowMnemonicQr(false);
                        }}
                        aria-label={revealedMnemonic
                            ? t('tools.addressGenerator.action.hideRecoveryPhrase', 'Hide recovery phrase')
                            : t('tools.addressGenerator.action.revealRecoveryPhrase', 'Reveal recovery phrase')}
                        title={revealedMnemonic
                            ? t('tools.addressGenerator.action.hide', 'Hide')
                            : t('tools.addressGenerator.action.reveal', 'Reveal')}
                    >
                        {revealedMnemonic ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                        className={styles.icon_button}
                        onClick={() => handleCopy(entry.mnemonic!, 'mnemonic')}
                        aria-label={t('tools.addressGenerator.action.copyRecoveryPhrase', 'Copy recovery phrase')}
                        title={t('tools.addressGenerator.action.copyRecoveryPhrase', 'Copy recovery phrase')}
                    >
                        {copiedField === 'mnemonic'
                            ? <Check size={14} style={{ color: 'var(--color-success)' }} />
                            : <Copy size={14} />
                        }
                    </button>
                    {mnemonic && revealedMnemonic && (
                        <button
                            className={styles.icon_button}
                            onClick={() => setShowMnemonicQr(prev => !prev)}
                            aria-label={showMnemonicQr
                                ? t('tools.addressGenerator.action.hideQrCode', 'Hide QR code')
                                : t('tools.addressGenerator.action.showQrCode', 'Show QR code')}
                            title={showMnemonicQr
                                ? t('tools.addressGenerator.action.hideQr', 'Hide QR')
                                : t('tools.addressGenerator.action.showQr', 'Show QR')}
                        >
                            <QrCode size={14} />
                        </button>
                    )}
                </div>
                {showMnemonicQr && revealedMnemonic && mnemonic && (
                    <InlineQrCode value={mnemonic} label={t('tools.addressGenerator.label.recoveryPhrase', 'Recovery Phrase')} />
                )}
            </div>
            <div className={styles.single_result__field}>
                <span className={styles.single_result__label}>{t('tools.addressGenerator.label.privateKey', 'Private Key')}</span>
                <div className={styles.single_result__value_row}>
                    <code className={`${styles.single_result__mono} ${!revealedKey ? styles.single_result__masked : ''}`}>
                        {maskedKey}
                    </code>
                    <button
                        className={styles.icon_button}
                        onClick={() => {
                            const next = !revealedKey;
                            setRevealedKey(next);
                            if (!next) setShowKeyQr(false);
                        }}
                        aria-label={revealedKey
                            ? t('tools.addressGenerator.action.hidePrivateKey', 'Hide private key')
                            : t('tools.addressGenerator.action.revealPrivateKey', 'Reveal private key')}
                        title={revealedKey
                            ? t('tools.addressGenerator.action.hide', 'Hide')
                            : t('tools.addressGenerator.action.reveal', 'Reveal')}
                    >
                        {revealedKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                        className={styles.icon_button}
                        onClick={() => handleCopy(entry.privateKey, 'key')}
                        aria-label={t('tools.addressGenerator.action.copyPrivateKey', 'Copy private key')}
                        title={t('tools.addressGenerator.action.copyPrivateKey', 'Copy private key')}
                    >
                        {copiedField === 'key'
                            ? <Check size={14} style={{ color: 'var(--color-success)' }} />
                            : <Copy size={14} />
                        }
                    </button>
                    {revealedKey && (
                        <button
                            className={styles.icon_button}
                            onClick={() => setShowKeyQr(prev => !prev)}
                            aria-label={showKeyQr
                                ? t('tools.addressGenerator.action.hideQrCode', 'Hide QR code')
                                : t('tools.addressGenerator.action.showQrCode', 'Show QR code')}
                            title={showKeyQr
                                ? t('tools.addressGenerator.action.hideQr', 'Hide QR')
                                : t('tools.addressGenerator.action.showQr', 'Show QR')}
                        >
                            <QrCode size={14} />
                        </button>
                    )}
                </div>
                {showKeyQr && revealedKey && (
                    <InlineQrCode value={entry.privateKey} label={t('tools.addressGenerator.label.privateKey', 'Private Key')} />
                )}
            </div>
        </div>
    );
}

/**
 * Render an address with the first occurrence of the vanity pattern highlighted.
 *
 * @param address - Full TRON address
 * @param pattern - Vanity search pattern
 * @param caseSensitive - Whether the match was case-sensitive
 * @returns JSX with the matched substring wrapped in a highlight span
 */
function HighlightedAddress({ address, pattern, caseSensitive }: {
    address: string;
    pattern: string;
    caseSensitive: boolean;
}): React.ReactElement {
    if (!pattern) return <>{address}</>;

    const haystack = caseSensitive ? address : address.toLowerCase();
    const needle = caseSensitive ? pattern : pattern.toLowerCase();
    const matchIndex = haystack.indexOf(needle);

    if (matchIndex === -1) return <>{address}</>;

    const before = address.slice(0, matchIndex);
    const match = address.slice(matchIndex, matchIndex + pattern.length);
    const after = address.slice(matchIndex + pattern.length);

    return <>{before}<span className={styles.match_highlight}>{match}</span>{after}</>;
}

/**
 * Single vanity match row displayed as a compact table-like entry.
 *
 * @param props - Component props
 * @param props.entry - The generated address entry
 * @param props.index - Row number (1-based) for display
 * @param props.pattern - Vanity search pattern for highlight
 * @param props.caseSensitive - Whether match was case-sensitive
 */
function AddressRow({ entry, index, pattern, caseSensitive }: {
    entry: IGeneratedAddress;
    index: number;
    pattern: string;
    caseSensitive: boolean;
}) {
    const { t } = useTranslation();
    const [revealed, setRevealed] = useState(false);
    const [copiedField, setCopiedField] = useState<'address' | 'key' | null>(null);
    const { open: openModal } = useModal();

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
        <tr className={styles.match_row}>
            <td className={styles.match_row__index}>{index}</td>
            <td className={styles.match_row__cell}>
                <code className={styles.match_row__mono}>
                    <HighlightedAddress address={entry.address} pattern={pattern} caseSensitive={caseSensitive} />
                </code>
                <button
                    className={styles.icon_button}
                    onClick={() => handleCopy(entry.address, 'address')}
                    aria-label={t('tools.addressGenerator.action.copyAddress', 'Copy address')}
                    title={t('tools.addressGenerator.action.copyAddress', 'Copy address')}
                >
                    {copiedField === 'address'
                        ? <Check size={12} style={{ color: 'var(--color-success)' }} />
                        : <Copy size={12} />
                    }
                </button>
            </td>
            <td className={styles.match_row__cell}>
                <span className={styles.match_row__gender}>{entry.gender === 'male' ? '☰' : '☷'}</span>
            </td>
            <td className={styles.match_row__cell}>
                <code className={`${styles.match_row__mono} ${!revealed ? styles.match_row__masked : ''}`}>
                    {maskedKey}
                </code>
                <button
                    className={styles.icon_button}
                    onClick={() => setRevealed(prev => !prev)}
                    aria-label={revealed
                        ? t('tools.addressGenerator.action.hidePrivateKey', 'Hide private key')
                        : t('tools.addressGenerator.action.revealPrivateKey', 'Reveal private key')}
                    title={revealed
                        ? t('tools.addressGenerator.action.hide', 'Hide')
                        : t('tools.addressGenerator.action.reveal', 'Reveal')}
                >
                    {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
                <button
                    className={styles.icon_button}
                    onClick={() => handleCopy(entry.privateKey, 'key')}
                    aria-label={t('tools.addressGenerator.action.copyPrivateKey', 'Copy private key')}
                    title={t('tools.addressGenerator.action.copyPrivateKey', 'Copy private key')}
                >
                    {copiedField === 'key'
                        ? <Check size={12} style={{ color: 'var(--color-success)' }} />
                        : <Copy size={12} />
                    }
                </button>
                <button
                    className={styles.icon_button}
                    onClick={() => {
                        if (!revealed) return;
                        openModal({
                            title: t('tools.addressGenerator.qr.modalTitle', 'Private Key QR Code'),
                            size: 'sm',
                            content: <QrModalContent address={entry.address} privateKey={entry.privateKey} />,
                            dismissible: true,
                        });
                    }}
                    disabled={!revealed}
                    aria-label={revealed
                        ? t('tools.addressGenerator.action.showQrCode', 'Show QR code')
                        : t('tools.addressGenerator.action.revealBeforeQrCode', 'Reveal private key before showing QR code')}
                    title={revealed
                        ? t('tools.addressGenerator.action.showQr', 'Show QR')
                        : t('tools.addressGenerator.action.revealFirst', 'Reveal private key first')}
                >
                    <QrCode size={12} />
                </button>
            </td>
        </tr>
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
    const { t } = useTranslation();
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
                    setSingleResult({
                        address: event.data.address,
                        privateKey: event.data.privateKey,
                        mnemonic: event.data.mnemonic,
                        gender: event.data.gender,
                    });
                    setGenerating(false);
                    break;
                case 'vanity-match':
                    setMatches(prev => {
                        if (prev.length >= MAX_VANITY_MATCHES) {
                            worker.postMessage({ type: 'vanity-stop' });
                            return prev;
                        }
                        return [...prev, { address: event.data.address, privateKey: event.data.privateKey, gender: event.data.gender }];
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
        setBase58Warning(value ? validateBase58(value, t) : null);
    }, [t]);

    const difficulty = vanityPattern.trim() && !base58Warning
        ? getDifficultyEstimate(vanityPattern.trim(), caseSensitive, t)
        : '';

    return (
        <Page>
            <PageHeader
                title={t('tools.addressGenerator.title', 'Address Generator')}
                subtitle={t('tools.addressGenerator.subtitle', 'Generate random TRON addresses and search for vanity patterns')}
            />
            <div className={styles.container}>
                {/* Single generation */}
                <Card>
                    <Stack gap="md">
                        <div className={styles.section_header}>
                            <span className={styles.section_title}>{t('tools.addressGenerator.generate.title', 'Generate Address')}</span>
                            <Button
                                variant="primary"
                                onClick={handleGenerate}
                                disabled={generating}
                                loading={generating}
                            >
                                <KeyRound size={18} />
                                {t('tools.addressGenerator.generate.button', 'Generate')}
                            </Button>
                        </div>

                        {singleResult && <SingleAddressResult entry={singleResult} />}
                    </Stack>
                </Card>

                {/* Vanity search */}
                <Card>
                    <Stack gap="md">
                        <span className={styles.section_title}>{t('tools.addressGenerator.vanity.title', 'Vanity Search')}</span>

                        <label className={styles.label} htmlFor="vanity-input">
                            {t('tools.addressGenerator.vanity.patternLabel', 'Search pattern (matched anywhere in address)')}
                        </label>
                        <div className={styles.input_row}>
                            <Input
                                id="vanity-input"
                                value={vanityPattern}
                                onChange={e => handlePatternChange(e.target.value)}
                                placeholder={t('tools.addressGenerator.vanity.patternPlaceholder', 'e.g. cafe, TRON, abc')}
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
                                <span className={styles.toggle__label}>{t('tools.addressGenerator.vanity.caseSensitive', 'Case sensitive')}</span>
                            </label>
                            {searching ? (
                                <Button variant="danger" onClick={handleStopSearch}>
                                    <Square size={18} />
                                    {t('tools.addressGenerator.vanity.stop', 'Stop')}
                                </Button>
                            ) : (
                                <Button
                                    variant="primary"
                                    onClick={handleStartSearch}
                                    disabled={!vanityPattern.trim() || !!base58Warning}
                                >
                                    <Search size={18} />
                                    {t('tools.addressGenerator.vanity.search', 'Search')}
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
                                {t('tools.addressGenerator.vanity.difficulty', 'Expected difficulty: {difficulty}', { difficulty })}
                            </p>
                        )}

                        {(searching || stats.checked > 0) && (
                            <div className={styles.stats}>
                                <Badge tone={searching ? 'success' : 'neutral'} showLiveIndicator={searching}>
                                    {searching
                                        ? t('tools.addressGenerator.vanity.searching', 'Searching')
                                        : t('tools.addressGenerator.vanity.stopped', 'Stopped')}
                                </Badge>
                                <span className={styles.stats__text}>
                                    {t('tools.addressGenerator.vanity.progress', '{checked} attempts — ~{rate}/sec', {
                                        checked: formatNumber(stats.checked),
                                        rate: formatNumber(stats.rate)
                                    })}
                                </span>
                                {matches.length > 0 && (
                                    <span className={styles.stats__matches}>
                                        {matches.length === 1
                                            ? t('tools.addressGenerator.vanity.matchOne', '{count} match', { count: matches.length })
                                            : t('tools.addressGenerator.vanity.matchMany', '{count} matches', { count: matches.length })}
                                    </span>
                                )}
                            </div>
                        )}

                        {matches.length > 0 && (
                            <div className={styles.matches}>
                                <table className={styles.match_table}>
                                    <thead>
                                        <tr>
                                            <th className={styles.match_table__th}>#</th>
                                            <th className={styles.match_table__th}>{t('tools.addressGenerator.label.address', 'Address')}</th>
                                            <th className={styles.match_table__th}>{t('tools.addressGenerator.label.gender', 'Gender')}</th>
                                            <th className={styles.match_table__th}>{t('tools.addressGenerator.label.privateKey', 'Private Key')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {matches.map((entry, i) => (
                                            <AddressRow key={`${entry.address}-${i}`} entry={entry} index={i + 1} pattern={vanityPattern.trim()} caseSensitive={caseSensitive} />
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Stack>
                </Card>

                {/* Security notice */}
                <div className={styles.notice}>
                    <ShieldCheck size={16} />
                    <p>
                        {t(
                            'tools.addressGenerator.securityNotice',
                            'Keys are generated entirely in your browser using a Web Worker. No private keys are ever sent to a server. Use caution before sending real funds to a web-generated address — consider hardware wallets for significant holdings.'
                        )}
                    </p>
                </div>
            </div>
        </Page>
    );
}
