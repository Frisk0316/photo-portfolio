'use client';

import { useRouter } from 'next/navigation';
import AlbumForm from '@/components/admin/AlbumForm';
import { albums } from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import type { Album } from '@/lib/api';

export default function NewAlbumPage() {
  const router = useRouter();
  const { showSuccess, showError } = useToast();

  async function handleCreate(data: Partial<Album>) {
    try {
      const result = await albums.create(data);
      showSuccess('已順利儲存');
      router.push(`/admin/albums/${result.data.id}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : '儲存失敗');
      throw err;
    }
  }

  return (
    <div>
      <h1 className="text-2xl mb-8" style={{ fontFamily: 'var(--font-playfair)' }}>New Album</h1>
      <AlbumForm onSubmit={handleCreate} submitLabel="Create Album" />
    </div>
  );
}
