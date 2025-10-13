import { randomUUID } from 'node:crypto';
import { S3Client, DeleteObjectCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

interface AttachmentRequest {
  wallet: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface SignedAttachment {
  attachmentId: string;
  storageKey: string;
  uploadUrl: string;
  expiresAt: Date;
}

class StorageServiceSingleton {
  private client: S3Client | null = null;
  private readonly bucket = env.STORAGE_BUCKET;
  private readonly expirySeconds = env.COMMENTS_ATTACHMENT_URL_TTL;

  constructor() {
    if (!this.bucket) {
      logger.warn('Storage bucket not configured; attachment features disabled');
      return;
    }

    this.client = new S3Client({
      region: env.STORAGE_REGION ?? 'auto',
      endpoint: env.STORAGE_ENDPOINT,
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE ?? false,
      credentials: env.STORAGE_ACCESS_KEY_ID && env.STORAGE_SECRET_ACCESS_KEY
        ? {
            accessKeyId: env.STORAGE_ACCESS_KEY_ID,
            secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY
          }
        : undefined
    });
  }

  isEnabled() {
    return Boolean(this.client && this.bucket);
  }

  async createSignedAttachment({ wallet, filename, contentType, size }: AttachmentRequest): Promise<SignedAttachment> {
    if (!this.client || !this.bucket) {
      throw new Error('Object storage is not configured');
    }

    const attachmentId = randomUUID();
    const sanitizedFilename = filename.replace(/[^A-Za-z0-9_.-]/g, '_');
    const storageKey = `comments/${wallet}/${attachmentId}-${sanitizedFilename}`;

    const putCommand = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: contentType,
      ContentLength: size
    });

    const uploadUrl = await getSignedUrl(this.client, putCommand, { expiresIn: this.expirySeconds });
    return {
      attachmentId,
      storageKey,
      uploadUrl,
      expiresAt: new Date(Date.now() + this.expirySeconds * 1000)
    };
  }

  async getDownloadUrl(storageKey: string) {
    if (!this.client || !this.bucket) {
      throw new Error('Object storage is not configured');
    }

    const getCommand = new GetObjectCommand({ Bucket: this.bucket, Key: storageKey });
    return getSignedUrl(this.client, getCommand, { expiresIn: this.expirySeconds });
  }

  async deleteObject(storageKey: string) {
    if (!this.client || !this.bucket) {
      return;
    }

    try {
      const command = new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey });
      await this.client.send(command);
    } catch (error) {
      logger.error({ error, storageKey }, 'Failed to delete object from storage');
    }
  }
}

const instance = new StorageServiceSingleton();

export const StorageService = {
  isEnabled: () => instance.isEnabled(),
  createSignedAttachment: (req: AttachmentRequest) => instance.createSignedAttachment(req),
  getDownloadUrl: (storageKey: string) => instance.getDownloadUrl(storageKey),
  deleteObject: (storageKey: string) => instance.deleteObject(storageKey)
};
