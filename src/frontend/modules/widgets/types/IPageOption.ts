/**
 * @fileoverview One selectable page in the placement editor's page picker.
 *
 * The editor is organised around a page: the operator picks a page, then
 * sees exactly what each zone renders on it. Options come from three
 * sources, and the group tells the picker which heading to list the option
 * under so an operator can tell a real navigation page from a route pattern
 * a placement already targets, or from a path they typed themselves.
 *
 * @module modules/widgets/types/IPageOption
 */

/**
 * Where a page option came from. `menu` is a real page taken from the site
 * navigation, `pattern` is a route filter some placement already uses (an
 * exact path or a glob), and `custom` is a path the operator typed into the
 * picker during this session.
 */
export type PageOptionSource = 'menu' | 'pattern' | 'custom';

/**
 * A page the editor can scope itself to.
 */
export interface IPageOption {
    /** The route or route pattern, exactly as a placement's `routes` entry would store it. */
    value: string;
    /** Human label shown in the picker; falls back to the path itself. */
    label: string;
    /** Which heading the picker lists the option under. */
    source: PageOptionSource;
}
