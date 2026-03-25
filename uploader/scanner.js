import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';

const ALBUM_PATTERN = /^(\d{4})(\d{2})(\d{2})\s*-\s*(.+)$/;

export function parseAlbumFolder(folderName) {
  const match = folderName.match(ALBUM_PATTERN);
  if (!match) return null;
  const [, year, month, day, title] = match;
  const dateStr = `${year}-${month}-${day}`;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  return {
    date: dateStr,
    year: parseInt(year),
    month: parseInt(month),
    day: parseInt(day),
    title: title.trim(),
    slug: slugify(title.trim()),
  };
}

function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg']);

function isTargetImage(filename) {
  return IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

async function findEditedFolder(albumPath) {
  const entries = await fs.readdir(albumPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nameNormalized = entry.name.trim().toLowerCase();
    for (const editedName of config.editedFolderNames) {
      if (nameNormalized === editedName.toLowerCase()) {
        return path.join(albumPath, entry.name);
      }
    }
  }
  return null;
}

async function collectImages(dir, basePath = dir, images = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return 1;
    if (!a.isDirectory() && b.isDirectory()) return -1;
    return a.name.localeCompare(b.name, 'zh-Hant');
  });
  for (const entry of sorted) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectImages(fullPath, basePath, images);
    } else if (isTargetImage(entry.name)) {
      const relativePath = path.relative(basePath, fullPath);
      const subFolder = path.dirname(relativePath);
      images.push({
        absolutePath: fullPath,
        fileName: entry.name,
        group: subFolder === '.' ? null : subFolder,
        sortOrder: images.length,
      });
    }
  }
  return images;
}

export async function scanPhotosDirectory(rootDir = config.photosRootDir) {
  const manifest = {
    scannedAt: new Date().toISOString(),
    rootDir,
    albums: [],
    totalPhotos: 0,
    skippedFolders: [],
    errors: [],
  };

  let rootEntries;
  try {
    rootEntries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (err) {
    manifest.errors.push({ path: rootDir, error: `Cannot read root directory: ${err.message}` });
    return manifest;
  }

  const albumFolders = rootEntries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));

  for (const folder of albumFolders) {
    const folderPath = path.join(rootDir, folder.name);
    const parsed = parseAlbumFolder(folder.name);
    if (!parsed) {
      manifest.skippedFolders.push({ name: folder.name, reason: 'Does not match YYYYMMDD - Title format' });
      continue;
    }

    const editedPath = await findEditedFolder(folderPath);
    if (!editedPath) {
      manifest.skippedFolders.push({ name: folder.name, reason: `No edited folder found (looked for: ${config.editedFolderNames.join(', ')})` });
      continue;
    }

    let images;
    try {
      images = await collectImages(editedPath);
    } catch (err) {
      manifest.errors.push({ path: editedPath, error: `Failed to scan: ${err.message}` });
      continue;
    }

    if (images.length === 0) {
      manifest.skippedFolders.push({ name: folder.name, reason: 'Edited folder is empty' });
      continue;
    }

    const imagesWithSize = await Promise.all(
      images.map(async (img) => {
        try {
          const stat = await fs.stat(img.absolutePath);
          return { ...img, fileSize: stat.size };
        } catch {
          return { ...img, fileSize: 0 };
        }
      })
    );

    const groups = [...new Set(imagesWithSize.map(i => i.group).filter(Boolean))];

    manifest.albums.push({
      folderName: folder.name,
      ...parsed,
      editedFolderPath: editedPath,
      photos: imagesWithSize,
      photoCount: imagesWithSize.length,
      totalSize: imagesWithSize.reduce((sum, i) => sum + i.fileSize, 0),
      groups,
    });
    manifest.totalPhotos += imagesWithSize.length;
  }

  return manifest;
}

export function printManifest(manifest) {
  const { albums, totalPhotos, skippedFolders, errors } = manifest;
  console.log('\n══════════════════════════════════════════════════');
  console.log('  Photo Upload Scanner Report');
  console.log('══════════════════════════════════════════════════\n');
  console.log(`Root: ${manifest.rootDir}`);
  console.log(`Scanned at: ${manifest.scannedAt}\n`);
  console.log(`── Albums found: ${albums.length} ──\n`);
  for (const album of albums) {
    const sizeMB = (album.totalSize / (1024 * 1024)).toFixed(1);
    console.log(`  [${album.folderName}]`);
    console.log(`     Date: ${album.date}  |  Title: ${album.title}`);
    console.log(`     Photos: ${album.photoCount}  |  Size: ${sizeMB} MB`);
    if (album.groups.length > 0) console.log(`     Groups: ${album.groups.join(', ')}`);
    const sample = album.photos.slice(0, 3);
    for (const photo of sample) {
      const groupTag = photo.group ? ` [${photo.group}]` : '';
      console.log(`       - ${photo.fileName}${groupTag}`);
    }
    if (album.photos.length > 3) console.log(`       ... and ${album.photos.length - 3} more`);
    console.log('');
  }
  const totalSizeMB = albums.reduce((sum, a) => sum + a.totalSize, 0) / (1024 * 1024);
  console.log(`── Total: ${albums.length} albums, ${totalPhotos} photos, ${totalSizeMB.toFixed(1)} MB ──\n`);
  if (skippedFolders.length > 0) {
    console.log(`── Skipped: ${skippedFolders.length} folders ──\n`);
    for (const skip of skippedFolders) console.log(`  Skip: ${skip.name} — ${skip.reason}`);
    console.log('');
  }
  if (errors.length > 0) {
    console.log(`── Errors: ${errors.length} ──\n`);
    for (const err of errors) console.log(`  Error: ${err.path} — ${err.error}`);
    console.log('');
  }
}
