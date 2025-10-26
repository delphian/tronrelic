import mongoose, { Schema, type Document } from 'mongoose';
import type { IPage } from '@tronrelic/types';

/**
 * Mongoose document interface for Page model.
 * Combines IPage interface with Mongoose Document properties.
 */
export interface IPageDocument extends Omit<IPage, '_id'>, Document {}

/**
 * Mongoose schema for custom pages.
 *
 * Pages store markdown content with frontmatter that is rendered to HTML
 * for server-side delivery. Slugs must be unique and cannot conflict with
 * blacklisted route patterns.
 */
const PageSchema = new Schema<IPageDocument>(
    {
        title: {
            type: String,
            required: true,
            index: true,
        },
        slug: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            index: true,
        },
        content: {
            type: String,
            required: true,
        },
        description: {
            type: String,
            default: '',
        },
        keywords: {
            type: [String],
            default: [],
        },
        published: {
            type: Boolean,
            default: false,
            index: true,
        },
        ogImage: {
            type: String,
            default: null,
        },
        authorId: {
            type: String,
            default: null,
            index: true,
        },
    },
    {
        timestamps: true, // Automatically adds createdAt and updatedAt
        collection: 'pages',
    }
);

/**
 * Compound index for filtering published pages by creation date.
 * Used by admin UI for listing and public views for chronological ordering.
 */
PageSchema.index({ published: 1, createdAt: -1 });

/**
 * Text index for full-text search across title, slug, and description.
 * Supports search queries in admin UI.
 */
PageSchema.index(
    { title: 'text', slug: 'text', description: 'text' },
    { name: 'text_search' }
);

/**
 * Mongoose model for Page documents.
 */
export const PageModel = mongoose.model<IPageDocument>('Page', PageSchema);
