import { test, expect } from '@playwright/test';

test.describe('Homepage Monitoring', () => {
    test('should run for 60 seconds without console errors', async ({ page }) => {
        test.setTimeout(120000); // 2 minutes to accommodate 60 second wait + page load
        const consoleErrors: string[] = [];

        // Capture console errors
        page.on('console', msg => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
                console.error('❌ CONSOLE ERROR:', msg.text());
            }
        });

        // Capture failed requests
        page.on('requestfailed', request => {
            const url = request.url();
            // Ignore aborted React Server Component requests
            if (url.includes('_rsc=') && request.failure()?.errorText === 'net::ERR_ABORTED') {
                return;
            }            
            const error = `Failed to load: ${request.url()}`;
            consoleErrors.push(error);
            console.error('❌ REQUEST FAILED:', request.url(), request.failure()?.errorText);
        });

        // Navigate to homepage
        await page.goto('/', {
            waitUntil: 'networkidle',
            timeout: 30000
        });

        // Wait for 60 seconds while monitoring for errors
        await page.waitForTimeout(60000);

        // Assert no console errors occurred
        expect(consoleErrors, 'Console should not have error messages during 60 second monitoring period').toHaveLength(0);
    });
});
