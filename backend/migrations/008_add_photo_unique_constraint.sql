-- This migration adds a unique constraint to the photos table to prevent
-- duplicate entries for the same photo in the same album.
-- It's possible that duplicates already exist, which would cause this
-- migration to fail. If it fails, you need to manually clean up the
-- duplicate photo entries before this migration can succeed.
--
-- Example query to find duplicates:
-- SELECT album_id, file_name, COUNT(*)
-- FROM photos
-- GROUP BY album_id, file_name
-- HAVING COUNT(*) > 1;

ALTER TABLE photos ADD CONSTRAINT photos_album_id_file_name_key UNIQUE (album_id, file_name);
