'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import UploadDropzone from '@/components/admin/UploadDropzone';
import { albums } from '@/lib/api';
import type { Album, Photo } from '@/lib/api';

export default function UploadPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const albumId = Number(params.id);
  const [album, setAlbum] = useState<Album | null>(null);
  const [uploadedCount, setUploadedCount] = useState(0);

  useEffect(() => {
    albums.list(true).then((r) => {
      const found = r.data.find((a) => a.id === albumId);
      if (!found) router.replace('/admin/albums');
      else setAlbum(found);
    });
  }, [albumId, router]);

  function handleComplete(photos: Photo[]) {
    setUploadedCount((c) => c + photos.length);
  }

  if (!album) return <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p>;

  return (
    <div>
      <div className="flex items-center gap-4 mb-8">
        <Link href={`/admin/albums/${albumId}`} className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          ← {album.title}
        </Link>
        <h1 className="text-2xl" style={{ fontFamily: 'var(--font-playfair)' }}>Upload Photos</h1>
      </div>

      {uploadedCount > 0 && (
        <div className="mb-6 px-4 py-3 rounded text-sm" style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)', color: '#4ade80' }}>
          ✓ {uploadedCount} photo{uploadedCount !== 1 ? 's' : ''} uploaded successfully
        </div>
      )}

      <UploadDropzone
        albumId={albumId}
        albumSlug={album.slug}
        onComplete={handleComplete}
      />

      {uploadedCount > 0 && (
        <div className="mt-6">
          <Link
            href={`/admin/albums/${albumId}`}
            className="px-4 py-2 rounded text-sm"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
          >
            Done — back to album
          </Link>
        </div>
      )}
    </div>
  );
}
