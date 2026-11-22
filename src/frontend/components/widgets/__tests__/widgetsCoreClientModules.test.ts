/// <reference types="vitest" />

/**
 * Guards the rule that every component in the core widget registry is a
 * client module.
 *
 * `WidgetRenderer` hands each widget's component to the client-side
 * `WidgetWithContext`, including on a CMS page rendered on the server. React
 * can pass a component across that boundary only when its module starts with
 * `'use client'`; otherwise the page fails at render with "Functions cannot be
 * passed directly to Client Components". The stake calculator widget shipped
 * without the directive and took its page down in production, and nothing in
 * the browser-only workbench could see it, so this test reads each registered
 * component's source and checks the directive is there.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

/** Folder holding `widgets.core.ts`, which import paths are resolved against. */
const WIDGETS_DIR = path.resolve(__dirname, '..');

/**
 * Resolve a relative import specifier from `widgets.core.ts` to the component
 * file on disk.
 *
 * @param specifier - The import path, such as `./RawHtmlWidget`.
 * @returns The absolute path of the `.tsx` or `.ts` file it names.
 */
function resolveComponentFile(specifier: string): string {
    const base = path.resolve(WIDGETS_DIR, specifier);
    const candidates = [`${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx'), path.join(base, 'index.ts')];
    const found = candidates.find((candidate) => existsSync(candidate));
    if (!found) {
        throw new Error(`Cannot resolve widget component import "${specifier}"`);
    }

    return found;
}

/**
 * The relative import of every component `widgets.core.ts` registers, read
 * from its source so a component added later is checked with no test change.
 *
 * @returns Pairs of the imported name and its import path.
 */
function registeredComponentImports(): Array<{ name: string; specifier: string }> {
    const source = readFileSync(path.join(WIDGETS_DIR, 'widgets.core.ts'), 'utf8');
    const imports = [...source.matchAll(/^import \{ (\w+Widget) \} from '(\.[^']+)';$/gm)];

    return imports.map((match) => ({ name: match[1], specifier: match[2] }));
}

/**
 * Whether a module's first statement is the `'use client'` directive,
 * skipping the leading comment block every file in this codebase carries.
 *
 * @param file - Absolute path of the module.
 * @returns True when the directive comes before any other statement.
 */
function startsWithUseClient(file: string): boolean {
    const withoutComments = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .trimStart();

    return /^['"]use client['"];?/.test(withoutComments);
}

describe('core widget registry', () => {
    const components = registeredComponentImports();

    it('registers the components this test reads', () => {
        expect(components.map((component) => component.name)).toContain('StakeCalculatorWidget');
        expect(components.length).toBeGreaterThan(5);
    });

    it.each(registeredComponentImports())('$name is a client module', ({ specifier }) => {
        expect(startsWithUseClient(resolveComponentFile(specifier))).toBe(true);
    });
});
