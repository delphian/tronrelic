/// <reference types="vitest" />

/**
 * Tests for the list of menu namespaces the root layout fetches per visitor.
 *
 * A namespace missing from this list reaches its widget without a server
 * seed, so the menu renders empty during server rendering and only fills in
 * after a browser fetch. The tab bar names two namespaces, its tabs and its
 * Menu panel, so both must be collected.
 */

import { describe, it, expect } from 'vitest';
import type { IWidgetData } from '@/types';
import { collectMenuNamespaces } from '../collectMenuNamespaces';

/**
 * Build a resolved widget with only the fields the collector reads.
 *
 * @param id - The widget type id, such as `core:main-menu`.
 * @param data - The widget's data payload.
 * @param children - Nested widgets, for a layout group.
 * @returns A widget record shaped like the resolver's output.
 */
function widget(id: string, data: unknown, children?: IWidgetData[]): IWidgetData {
    return { id, zone: 'site-top', pluginId: 'core', order: 0, data, children };
}

describe('collectMenuNamespaces', () => {
    it('collects the namespace of each menu widget, including ones nested in a layout group', () => {
        const widgets = [
            widget('core:layout-group', {}, [widget('core:main-menu', { namespace: 'main' })]),
            widget('core:main-menu', { namespace: 'footer' })
        ];
        expect(collectMenuNamespaces(widgets)).toEqual(['footer', 'main']);
    });

    it('collects both the tab namespace and the panel namespace of a tab bar', () => {
        const widgets = [widget('core:tab-bar', { namespace: 'mobile', panelNamespace: 'main', menuTab: true })];
        expect(collectMenuNamespaces(widgets)).toEqual(['mobile', 'main']);
    });

    it('skips the panel namespace when the tab bar has no Menu tab', () => {
        const widgets = [widget('core:tab-bar', { namespace: 'mobile', panelNamespace: 'footer', menuTab: false })];
        expect(collectMenuNamespaces(widgets)).toEqual(['mobile']);
    });

    it('falls back to main when a widget names no namespace, and lists each namespace once', () => {
        const widgets = [widget('core:tab-bar', {}), widget('core:main-menu', null)];
        expect(collectMenuNamespaces(widgets)).toEqual(['main']);
    });

    it('ignores widgets that render no menu', () => {
        expect(collectMenuNamespaces([widget('core:site-logo', { text: 'TronRelic' })])).toEqual([]);
    });
});
