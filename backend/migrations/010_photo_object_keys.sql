ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS key_original TEXT,
  ADD COLUMN IF NOT EXISTS key_thumbnail TEXT,
  ADD COLUMN IF NOT EXISTS key_small TEXT,
  ADD COLUMN IF NOT EXISTS key_medium TEXT,
  ADD COLUMN IF NOT EXISTS key_webp TEXT;

UPDATE photos SET
  key_original = COALESCE(key_original, CASE WHEN url_original LIKE 'albums/%' THEN url_original ELSE NULLIF(regexp_replace(url_original, '^https?://[^/]+/(?:[^/]+/)?(albums/.*)$', '\1'), url_original) END),
  key_thumbnail = COALESCE(key_thumbnail, CASE WHEN url_thumbnail LIKE 'albums/%' THEN url_thumbnail ELSE NULLIF(regexp_replace(url_thumbnail, '^https?://[^/]+/(?:[^/]+/)?(albums/.*)$', '\1'), url_thumbnail) END),
  key_small = COALESCE(key_small, CASE WHEN url_small LIKE 'albums/%' THEN url_small ELSE NULLIF(regexp_replace(url_small, '^https?://[^/]+/(?:[^/]+/)?(albums/.*)$', '\1'), url_small) END),
  key_medium = COALESCE(key_medium, CASE WHEN url_medium LIKE 'albums/%' THEN url_medium ELSE NULLIF(regexp_replace(url_medium, '^https?://[^/]+/(?:[^/]+/)?(albums/.*)$', '\1'), url_medium) END),
  key_webp = COALESCE(key_webp, CASE WHEN url_webp LIKE 'albums/%' THEN url_webp ELSE NULLIF(regexp_replace(url_webp, '^https?://[^/]+/(?:[^/]+/)?(albums/.*)$', '\1'), url_webp) END)
WHERE key_original IS NULL
   OR key_thumbnail IS NULL
   OR key_small IS NULL
   OR key_medium IS NULL
   OR key_webp IS NULL;

CREATE INDEX IF NOT EXISTS idx_photos_key_original ON photos(key_original);
