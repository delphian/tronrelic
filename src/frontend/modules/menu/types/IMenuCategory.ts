/**
 * @fileoverview Shape of a menu category as `GET /api/menu/resolve` returns it.
 *
 * A category is a menu container node with children. The site serves an
 * automatic landing page at its URL, and that URL is also a real address a
 * breadcrumb trail can point at. Both readers take the same shape from here.
 */

/**
 * A container node and its enabled children, resolved from a URL.
 */
export interface IMenuCategory {
    success: boolean;
    node: {
        _id?: string;
        label: string;
        description?: string;
        url?: string;
        icon?: string;
    };
    children: {
        _id?: string;
        label: string;
        description?: string;
        url: string;
        icon?: string;
    }[];
}
