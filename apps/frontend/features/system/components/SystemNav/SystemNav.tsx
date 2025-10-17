'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './SystemNav.module.css';

/**
 * Navigation component for system monitoring pages.
 *
 * Displays tabbed navigation for all system routes with active state highlighting based
 * on the current URL. Uses Next.js Link components for client-side navigation while
 * maintaining a traditional tab appearance. Links are styled to show which section is
 * currently active based on the pathname.
 */
export function SystemNav() {
    const pathname = usePathname();

    const tabs = [
        { id: 'overview', label: 'Overview', href: '/system/overview' },
        { id: 'blockchain', label: 'Blockchain', href: '/system/blockchain' },
        { id: 'scheduler', label: 'Scheduler', href: '/system/scheduler' },
        { id: 'markets', label: 'Markets', href: '/system/markets' },
        { id: 'health', label: 'Health', href: '/system/health' },
        { id: 'config', label: 'Config', href: '/system/config' },
        { id: 'plugins', label: 'Plugins', href: '/system/plugins' },
        { id: 'websockets', label: 'WebSockets', href: '/system/websockets' }
    ];

    return (
        <nav className={styles.nav}>
            {tabs.map(tab => {
                const isActive = pathname === tab.href;
                return (
                    <Link
                        key={tab.id}
                        href={tab.href}
                        className={`${styles.tab} ${isActive ? styles.active : ''}`}
                    >
                        {tab.label}
                    </Link>
                );
            })}
        </nav>
    );
}
