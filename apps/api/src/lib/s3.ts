import { S3Client, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import { log } from './logger.js';

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT_URL, // Support for DigitalOcean Spaces and other S3-compatible services
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
  forcePathStyle: false, // Required for DigitalOcean Spaces
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET || '';

/** Compute base URL once at module load (used for S3 API operations like delete) */
const S3_BASE_URL = (() => {
  if (process.env.AWS_ENDPOINT_URL) {
    const host = new URL(process.env.AWS_ENDPOINT_URL).host;
    return `https://${BUCKET_NAME}.${host}`;
  }
  return `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com`;
})();

/** Public-facing URL for uploaded files (prefer CDN if configured, else same as S3_BASE_URL) */
const S3_PUBLIC_URL = process.env.AWS_CDN_URL
  ? process.env.AWS_CDN_URL.replace(/\/$/, '')
  : S3_BASE_URL;

/** Upload a buffer to S3 with the given key and content type. Returns the public URL. */
async function executeUpload(key: string, file: Buffer, contentType: string): Promise<string> {
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: file,
    ContentType: contentType,
  }));

  return `${S3_PUBLIC_URL}/${key}`;
}

/**
 * Allowed image content types → safe file extension.
 *
 * The extension and content type are derived ONLY from this whitelist, keyed
 * off the server-validated MIME type — never from the client-supplied filename
 * (which the attacker controls and could use to inject a key segment/extension).
 */
const IMAGE_CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * Upload an image buffer to S3 under a fully server-controlled key.
 *
 * Key format: {NODE_ENV}/{folder}/{descriptor}-{uuid}.{ext}
 * The extension comes from `IMAGE_CONTENT_TYPE_TO_EXT` (keyed off the validated
 * `contentType`), so no client input ever reaches the key. Throws on a
 * non-whitelisted content type.
 */
export async function uploadToS3(
  file: Buffer,
  contentType: string,
  folder: string = 'uploads',
  descriptor: string = 'file'
): Promise<string> {
  const ext = IMAGE_CONTENT_TYPE_TO_EXT[contentType];
  if (!ext) {
    throw new Error(`Unsupported image content type: ${contentType}`);
  }

  const env = process.env.NODE_ENV || 'development';
  const key = `${env}/${folder}/${descriptor}-${crypto.randomUUID()}.${ext}`;

  return executeUpload(key, file, contentType);
}

/**
 * Upload a file to S3 with a deterministic (fixed) key.
 * Overwrites on re-upload — ideal for seeded/static assets.
 */
export async function uploadToS3Deterministic(
  file: Buffer,
  key: string,
  contentType: string,
): Promise<string> {
  return executeUpload(key, file, contentType);
}

/**
 * Delete a file from S3
 * @param fileUrl - Full S3 URL
 */
export async function deleteFromS3(fileUrl: string): Promise<void> {
  try {
    // Extract key from URL
    const url = new URL(fileUrl);
    const key = url.pathname.substring(1); // Remove leading slash

    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
  } catch (error) {
    log.general.error({ err: error }, 'Error deleting from S3');
    // Don't throw, just log - file might already be deleted
  }
}

