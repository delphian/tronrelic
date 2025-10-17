import { redirect } from 'next/navigation';

/**
 * Base system route redirect.
 *
 * Redirects /system to /system/overview to ensure all system pages have
 * unique URLs. This is a server component that performs the redirect before
 * rendering any content.
 */
export default function SystemPage() {
    redirect('/system/overview');
}
