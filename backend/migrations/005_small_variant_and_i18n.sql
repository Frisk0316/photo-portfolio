-- Add 800px "small" image variant
ALTER TABLE photos ADD COLUMN IF NOT EXISTS url_small TEXT;

-- Add multilingual title/description for albums
ALTER TABLE albums ADD COLUMN IF NOT EXISTS title_en VARCHAR(500);
ALTER TABLE albums ADD COLUMN IF NOT EXISTS description_en TEXT;

-- Add cover aspect ratio preference per album
ALTER TABLE albums ADD COLUMN IF NOT EXISTS cover_aspect_ratio VARCHAR(10) DEFAULT '4:3';
