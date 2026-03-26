-- Add cover crop data (offsetX, offsetY, zoom) for custom cover positioning
ALTER TABLE albums ADD COLUMN IF NOT EXISTS cover_crop_data JSONB;
