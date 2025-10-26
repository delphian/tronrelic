import { Schema, model, Document } from 'mongoose';

/**
 * MongoDB document interface for migration execution records.
 *
 * Tracks execution history of database migrations including success/failure status,
 * timing, errors, and environment metadata.
 */
export interface IMigrationDocument extends Document {
    /**
     * Unique migration identifier.
     */
    migrationId: string;

    /**
     * Execution status.
     */
    status: 'completed' | 'failed';

    /**
     * Source category (system, module:{name}, plugin:{id}).
     */
    source: string;

    /**
     * Timestamp when migration executed.
     */
    executedAt: Date;

    /**
     * Execution duration in milliseconds.
     */
    executionDuration: number;

    /**
     * Error message if failed.
     */
    error?: string;

    /**
     * Full error stack trace if failed.
     */
    errorStack?: string;

    /**
     * SHA-256 checksum of migration file.
     */
    checksum?: string;

    /**
     * NODE_ENV when executed.
     */
    environment?: string;

    /**
     * Git commit hash when executed.
     */
    codebaseVersion?: string;
}

/**
 * Mongoose schema for migration execution records.
 */
const migrationSchema = new Schema<IMigrationDocument>(
    {
        migrationId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        status: {
            type: String,
            required: true,
            enum: ['completed', 'failed'],
            index: true
        },
        source: {
            type: String,
            required: true
        },
        executedAt: {
            type: Date,
            required: true,
            index: true
        },
        executionDuration: {
            type: Number,
            required: true
        },
        error: {
            type: String,
            required: false
        },
        errorStack: {
            type: String,
            required: false
        },
        checksum: {
            type: String,
            required: false
        },
        environment: {
            type: String,
            required: false
        },
        codebaseVersion: {
            type: String,
            required: false
        }
    },
    {
        timestamps: false,
        collection: 'migrations'
    }
);

/**
 * Compound index for admin UI filtering.
 */
migrationSchema.index({ status: 1, executedAt: -1 });

export const Migration = model<IMigrationDocument>('Migration', migrationSchema);
