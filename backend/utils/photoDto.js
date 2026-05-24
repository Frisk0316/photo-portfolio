export function serveUrl(photoId, variant, admin = false) {
  const suffix = admin ? '?admin=1' : '';
  return `/api/serve/${photoId}/${variant}${suffix}`;
}

export function sanitizePhoto(row, { admin = false } = {}) {
  if (!row) return row;
  const photo = { ...row };
  delete photo.key_original;
  delete photo.key_thumbnail;
  delete photo.key_small;
  delete photo.key_medium;
  delete photo.key_webp;

  photo.url_thumbnail = serveUrl(photo.id, 'thumb', admin);
  photo.url_small = serveUrl(photo.id, 'thumb', admin);
  photo.url_medium = serveUrl(photo.id, 'medium', admin);
  photo.url_webp = serveUrl(photo.id, 'medium', admin);
  photo.url_original = admin ? serveUrl(photo.id, 'medium', true) : null;
  return photo;
}

export function sanitizePhotos(rows, options) {
  return rows.map(row => sanitizePhoto(row, options));
}

export function sanitizeAlbum(row, { admin = false } = {}) {
  if (!row) return row;
  const album = { ...row };
  if (album.cover_photo_id) {
    album.cover_url = serveUrl(album.cover_photo_id, 'medium', admin);
  } else {
    album.cover_url = null;
  }
  return album;
}

export function sanitizeAlbums(rows, options) {
  return rows.map(row => sanitizeAlbum(row, options));
}
