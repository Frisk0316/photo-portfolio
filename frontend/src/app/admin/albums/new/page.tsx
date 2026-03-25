'use client';

import { useRouter } from 'next/navigation';
import AlbumForm from '@/components/admin/AlbumForm';
import { albums } from '@/lib/api';
import type { Album } from '@/lib/api';

export default function NewAlbumPage() {
  const router = useRouter();

  async function handleCreate(data: Partial<Album>) {
    const result = await albums.create(data);
    router.push(`/admin/albums/${result.data.id}`);
  }

  return (
    <div>
      <h1 className="text-2xl mb-8" style={{ fontFamily: 'var(--font-playfair)' }}>New Album</h1>
      <AlbumForm onSubmit={handleCreate} submitLabel="Create Album" />
    </div>
  );
}
