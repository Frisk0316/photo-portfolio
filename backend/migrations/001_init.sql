-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(200) NOT NULL,
  slug          VARCHAR(200) NOT NULL UNIQUE,
  description   TEXT,
  sort_order    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Albums
CREATE TABLE IF NOT EXISTS albums (
  id              SERIAL PRIMARY KEY,
  category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  title           VARCHAR(500) NOT NULL,
  slug            VARCHAR(500) NOT NULL UNIQUE,
  description     TEXT,
  shot_date       DATE,
  folder_name     VARCHAR(500),
  cover_photo_id  INTEGER,
  photo_count     INTEGER DEFAULT 0,
  is_published    BOOLEAN DEFAULT false,
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Photos
CREATE TABLE IF NOT EXISTS photos (
  id                SERIAL PRIMARY KEY,
  album_id          INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  file_name         VARCHAR(500) NOT NULL,
  caption           TEXT,
  group_tag         VARCHAR(200),
  aspect_ratio      REAL,
  aspect_category   VARCHAR(20),
  width             INTEGER,
  height            INTEGER,
  blur_hash         VARCHAR(100),
  url_original      TEXT,
  url_thumbnail     TEXT,
  url_medium        TEXT,
  url_webp          TEXT,
  file_size         INTEGER,
  sort_order        INTEGER DEFAULT 0,
  exif_data         JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_photos_album_id ON photos(album_id);
CREATE INDEX IF NOT EXISTS idx_photos_sort_order ON photos(album_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_albums_slug ON albums(slug);
CREATE INDEX IF NOT EXISTS idx_albums_category ON albums(category_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_albums_shot_date ON albums(shot_date DESC);
