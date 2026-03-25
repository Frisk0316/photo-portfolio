import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

let client = null;

function getClient() {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: config.r2.endpoint,
      credentials: {
        accessKeyId: config.r2.accessKeyId,
        secretAccessKey: config.r2.secretAccessKey,
      },
    });
  }
  return client;
}

export function buildPublicUrl(key) {
  if (config.r2.publicUrl) return `${config.r2.publicUrl}/${key}`;
  return `${config.r2.endpoint}/${config.r2.bucketName}/${key}`;
}

export async function uploadToR2(key, buffer, contentType, metadata = {}) {
  const s3 = getClient();
  await s3.send(new PutObjectCommand({
    Bucket: config.r2.bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
    Metadata: metadata,
  }));
  return { key, url: buildPublicUrl(key) };
}

export async function deleteFromR2(key) {
  const s3 = getClient();
  await s3.send(new DeleteObjectCommand({ Bucket: config.r2.bucketName, Key: key }));
}

export async function fileExistsInR2(key) {
  const s3 = getClient();
  try {
    await s3.send(new HeadObjectCommand({ Bucket: config.r2.bucketName, Key: key }));
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

export async function generatePresignedUrl(key, contentType, expiresIn = 3600) {
  const s3 = getClient();
  const command = new PutObjectCommand({
    Bucket: config.r2.bucketName,
    Key: key,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  });
  return getSignedUrl(s3, command, { expiresIn });
}

export async function deleteAlbumFromR2(albumSlug) {
  // This would list and delete all objects under albums/{albumSlug}/
  // For simplicity, we pass individual keys to deleteFromR2
}
