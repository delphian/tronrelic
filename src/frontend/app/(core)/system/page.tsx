import { redirect } from 'next/navigation';

/**
 * Base system route redirect.
 *
 * Redirects /system to the first admin tab so all system pages have unique
 * URLs. Runs server-side before any content is rendered.
 */
export default function SystemPage() {
    redirect('/system/config');
}
