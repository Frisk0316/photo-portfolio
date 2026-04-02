CREATE TABLE IF NOT EXISTS homepage_featured (
  id          SERIAL PRIMARY KEY,
  section     VARCHAR(20) NOT NULL CHECK (section IN ('events', 'other')),
  album_id    INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (section, album_id)
);
