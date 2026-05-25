export function extractObjectKeyFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const albumIdx = url.indexOf('/albums/');
  const key = albumIdx !== -1 ? url.slice(albumIdx + 1) : url;
  if (isSafeObjectKey(key)) return key;
  return null;
}

export function isSafeObjectKey(key) {
  if (!key || typeof key !== 'string') return false;
  if (!key.startsWith('albums/') || key.startsWith('/') || key.includes('..') || key.includes('\\')) return false;
  const parts = key.split('/');
  if (parts.length !== 4) return false;
  const [, albumSlug, variant, fileName] = parts;
  if (!isSafeObjectSegment(albumSlug) || !isSafeObjectSegment(fileName)) return false;
  if (!['original', 'thumbnail', 'small', 'medium', 'webp'].includes(variant)) return false;
  const expectedExtension = variant === 'webp' ? 'webp' : 'jpe?g';
  return new RegExp(`\\.(?:${expectedExtension})$`, 'i').test(fileName);
}

function isSafeObjectSegment(segment) {
  if (!segment || typeof segment !== 'string') return false;
  if (segment === '.' || segment === '..') return false;
  return !segment.includes('/') && !segment.includes('\\') && !segment.includes('\0');
}

export function keyForVariant(photo, variant) {
  const keyColumn = {
    original: 'key_original',
    thumbnail: 'key_thumbnail',
    small: 'key_small',
    medium: 'key_medium',
    webp: 'key_webp',
  }[variant];
  const urlColumn = {
    original: 'url_original',
    thumbnail: 'url_thumbnail',
    small: 'url_small',
    medium: 'url_medium',
    webp: 'url_webp',
  }[variant];
  const storedKey = photo?.[keyColumn];
  if (isSafeObjectKey(storedKey)) return storedKey;
  return extractObjectKeyFromUrl(photo?.[urlColumn]);
}

export function isSafeUploadKeyForPrefix(key, prefix) {
  if (!key || typeof key !== 'string') return false;
  if (!prefix || typeof prefix !== 'string') return false;
  if (!key.startsWith(`${prefix}/`)) return false;
  if (key.includes('..') || key.includes('\\') || key.startsWith('/')) return false;

  const rest = key.slice(prefix.length + 1);
  const parts = rest.split('/');
  if (parts.length !== 2) return false;
  const [variant, fileName] = parts;
  if (!['original', 'thumbnail', 'small', 'medium', 'webp'].includes(variant)) return false;
  const expectedExtension = variant === 'webp' ? 'webp' : 'jpe?g';
  return new RegExp(`^[A-Za-z0-9._-]+\\.(?:${expectedExtension})$`, 'i').test(fileName);
}
