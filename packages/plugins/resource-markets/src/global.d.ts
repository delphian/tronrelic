/**
 * Global type declarations for the Resource Markets plugin.
 *
 * Provides TypeScript type information for non-TS file imports such as
 * CSS Modules, which would otherwise trigger module resolution errors.
 */

/** CSS Module type declarations */
declare module '*.module.css' {
    const classes: { [key: string]: string };
    export default classes;
}

/** Generic CSS imports */
declare module '*.css';
