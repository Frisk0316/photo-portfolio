import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { config } from './config.js';

let client = null;

function getClient() {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: config.r2.endpoint,
      credentials: { accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey },
    });
  }
  return client;
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
  return {
    key,
    url: config.r2.publicUrl ? `${config.r2.publicUrl}/${key}` : `${config.r2.endpoint}/${config.r2.bucketName}/${key}`,
    size: buffer.length,
  };
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

export async function uploadImageVariants(albumSlug, fileName, processed) {
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const prefix = `albums/${albumSlug}`;
  const uploads = await Promise.all([
    uploadToR2(`${prefix}/original/${baseName}.jpg`, processed.original.buffer, 'image/jpeg', { variant: 'original' }),
    uploadToR2(`${prefix}/thumbnail/${baseName}.jpg`, processed.thumbnail.buffer, 'image/jpeg', { variant: 'thumbnail' }),
    uploadToR2(`${prefix}/medium/${baseName}.jpg`, processed.medium.buffer, 'image/jpeg', { variant: 'medium' }),
    uploadToR2(`${prefix}/webp/${baseName}.webp`, processed.webp.buffer, 'image/webp', { variant: 'webp' }),
  ]);
  return { original: uploads[0], thumbnail: uploads[1], medium: uploads[2], webp: uploads[3] };
}
