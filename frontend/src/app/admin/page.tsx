'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { albums } from '@/lib/api';
import type { Album } from '@/lib/api';

export default function AdminDashboard() {
  const [albumList, setAlbumList] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    albums.list(true).then((r) => setAlbumList(r.data)).finally(() => setLoading(false));
  }, []);

  const totalPhotos = albumList.reduce((sum, a) => sum + a.photo_count, 0);
  const publishedCount = albumList.filter((a) => a.is_published).length;

  return (
    <div>
      <h1 className="text-2xl mb-8" style={{ fontFamily: 'var(--font-playfair)' }}>Dashboard</h1>

      <div className="grid grid-cols-3 gap-4 mb-10">
        {[
          { label: 'Albums', value: loading ? '—' : albumList.length },
          { label: 'Published', value: loading ? '—' : publishedCount },
          { label: 'Photos', value: loading ? '—' : totalPhotos },
        ].map((stat) => (
          <div key={stat.label} className="rounded p-5"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            <p className="text-2xl mb-1 font-mono" style={{ fontFamily: 'var(--font-dm-mono)' }}>
              {stat.value}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-4">
        <Link
          href="/admin/albums"
          className="px-4 py-2 rounded text-sm transition-colors"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          Manage Albums
        </Link>
        <Link
          href="/admin/categories"
          className="px-4 py-2 rounded text-sm transition-colors"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          Manage Categories
        </Link>
      </div>
    </div>
  );
}
