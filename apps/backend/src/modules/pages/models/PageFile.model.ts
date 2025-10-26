import mongoose, { Schema, type Document } from 'mongoose';
import type { IPageFile } from '@tronrelic/types';

/**
 * Mongoose document interface for PageFile model.
 * Combines IPageFile interface with Mongoose Document properties.
 */
export interface IPageFileDocument extends Omit<IPageFile, '_id'>, Document {}

/**
 * Mongoose schema for uploaded files.
 *
 * Tracks files uploaded via the pages module for admin management and usage tracking.
 * Files are stored via configurable storage providers (local filesystem, S3, etc.).
 */
const PageFileSchema = new Schema<IPageFileDocument>(
    {
        originalName: {
            type: String,
            required: true,
        },
        storedName: {
            type: String,
            required: true,
        },
        mimeType: {
            type: String,
            required: true,
            index: true,
        },
        size: {
            type: Number,
            required: true,
        },
        path: {
            type: String,
            required: true,
            unique: true,
        },
        uploadedBy: {
            type: String,
            default: null,
            index: true,
        },
        uploadedAt: {
            type: Date,
            default: () => new Date(),
            index: true,
        },
    },
    {
        collection: 'page_files',
    }
);

/**
 * Compound index for filtering files by type and date.
 * Used by admin UI for browsing uploaded files.
 */
PageFileSchema.index({ mimeType: 1, uploadedAt: -1 });

/**
 * Mongoose model for PageFile documents.
 */
export const PageFileModel = mongoose.model<IPageFileDocument>('PageFile', PageFileSchema);
