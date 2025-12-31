/**
 * Label filters component.
 *
 * Provides filtering and search controls for the labels list.
 */

import { Search } from 'lucide-react';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { CATEGORIES, SOURCE_TYPES } from './types';
import styles from '../page.module.css';

interface LabelFiltersProps {
    categoryFilter: string;
    sourceTypeFilter: string;
    searchInput: string;
    onCategoryChange: (category: string) => void;
    onSourceTypeChange: (sourceType: string) => void;
    onSearchChange: (search: string) => void;
    onSearch: () => void;
}

/**
 * Filter bar for address labels list.
 */
export function LabelFilters({
    categoryFilter,
    sourceTypeFilter,
    searchInput,
    onCategoryChange,
    onSourceTypeChange,
    onSearchChange,
    onSearch
}: LabelFiltersProps) {
    return (
        <Card padding="md">
            <div className={styles.filters}>
                <div className={styles.filterGroup}>
                    <select
                        value={categoryFilter}
                        onChange={e => onCategoryChange(e.target.value)}
                        className={styles.select}
                    >
                        <option value="">All Categories</option>
                        {CATEGORIES.map(cat => (
                            <option key={cat.value} value={cat.value}>{cat.label}</option>
                        ))}
                    </select>
                    <select
                        value={sourceTypeFilter}
                        onChange={e => onSourceTypeChange(e.target.value)}
                        className={styles.select}
                    >
                        <option value="">All Sources</option>
                        {SOURCE_TYPES.map(st => (
                            <option key={st.value} value={st.value}>{st.label}</option>
                        ))}
                    </select>
                </div>
                <div className={styles.searchBox}>
                    <input
                        type="text"
                        value={searchInput}
                        onChange={e => onSearchChange(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && onSearch()}
                        placeholder="Search labels..."
                        className={styles.input}
                    />
                    <Button variant="secondary" size="sm" onClick={onSearch} aria-label="Search">
                        <Search size={16} />
                    </Button>
                </div>
            </div>
        </Card>
    );
}
