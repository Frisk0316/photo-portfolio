'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AlbumForm from '@/components/admin/AlbumForm';
import PhotoGrid from '@/components/admin/PhotoGrid';
import CoverEditor from '@/components/admin/CoverEditor';
import { albums } from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import type { Album, Photo } from '@/lib/api';

export default function EditAlbumPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const albumId = Number(params.id);
  const [album, setAlbum] = useState<(Album & { photos: Photo[] }) | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch by id — we need the slug first so we get from admin endpoint
    albums.list(true).then((r) => {
      const found = r.data.find((a) => a.id === albumId);
      if (!found) { router.replace('/admin/albums'); return; }
      // Now fetch full album with photos
      albums.get(found.slug).then((full) => {
        setAlbum(full.data);
      }).finally(() => setLoading(false));
    });
  }, [albumId, router]);

  const { showSuccess, showError } = useToast();

  async function handleSave(data: Partial<Album>) {
    if (!album) return;
    try {
      const updated = await albums.update(album.id, data);
      setAlbum((prev) => prev ? { ...prev, ...updated.data } : prev);
      showSuccess('已順利儲存');
    } catch (err) {
      showError(err instanceof Error ? err.message : '儲存失敗');
      throw err;
    }
  }

  if (loading) return <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p>;
  if (!album) return null;

  return (
    <div>
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin" className="text-xs" style={{ color: 'var(--text-tertiary)' }}>← Albums</Link>
        <h1 className="text-2xl" style={{ fontFamily: 'var(--font-playfair)' }}>{album.title}</h1>
      </div>

      <div className="mb-10">
        <h2 className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>Album Settings</h2>
        <AlbumForm initial={album} onSubmit={handleSave} submitLabel="Save Changes" />
      </div>

      {album.photos && album.photos.length > 0 && (
        <div className="mb-10">
          <h2 className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>Cover Photo</h2>
          <CoverEditor
            photos={album.photos}
            coverPhotoId={album.cover_photo_id}
            coverCropData={album.cover_crop_data}
            coverAspectRatio={album.cover_aspect_ratio}
            onSave={async (coverPhotoId, cropData, aspectRatio) => {
              await handleSave({ cover_photo_id: coverPhotoId, cover_crop_data: cropData, cover_aspect_ratio: aspectRatio } as Partial<Album>);
            }}
          />
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Photos ({album.photos?.length || 0})
          </h2>
          <Link
            href={`/admin/albums/${album.id}/upload`}
            className="px-3 py-1.5 rounded text-xs"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
          >
            + Upload Photos
          </Link>
        </div>

        <PhotoGrid
          albumId={album.id}
          photos={album.photos || []}
          onChange={(updated) => setAlbum((prev) => prev ? { ...prev, photos: updated } : prev)}
        />
      </div>
    </div>
  );
}
