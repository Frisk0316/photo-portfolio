'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { albums, categories } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import type { Album, Category } from '@/lib/api';

export default function HomePage() {
  const [albumList, setAlbumList] = useState<Album[]>([]);
  const [categoryList, setCategoryList] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [sortOrder, setSortOrder] = useState<'date_desc' | 'date_asc'>('date_desc');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([albums.list(false, sortOrder), categories.list()])
      .then(([a, c]) => {
        setAlbumList(a.data);
        setCategoryList(c.data);
      })
      .finally(() => setLoading(false));
  }, [sortOrder]);

  const filtered = activeCategory
    ? albumList.filter((a) => a.category_id === activeCategory)
    : albumList;

  return (
    <>
      <Header
        categories={categoryList}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        sortOrder={sortOrder}
        onSortChange={setSortOrder}
      />

      <main className="px-6 pb-8">
        {/* Hero */}
        <section className="py-16 md:py-24">
          <p className="text-xs tracking-[0.2em] uppercase mb-4"
            style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
            Photography
          </p>
          <h1 className="text-4xl md:text-6xl mb-4" style={{ fontFamily: 'var(--font-playfair)' }}>
            Portfolio
          </h1>
          <p className="text-sm max-w-md" style={{ color: 'var(--text-secondary)' }}>
            A collection of photographs captured over time.
          </p>
        </section>

        {/* Album grid */}
        {loading ? (
          <div className="flex justify-center py-20">
            <LoadingSpinner />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center py-20 text-sm" style={{ color: 'var(--text-tertiary)' }}>
            No albums yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        )}
      </main>

      <Footer />
    </>
  );
}

function AlbumCard({ album }: { album: Album }) {
  return (
    <Link
      href={`/albums/${album.slug}`}
      className="group block rounded overflow-hidden"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      {/* Cover image */}
      <div className="aspect-[4/3] overflow-hidden bg-[var(--bg-elevated)] relative">
        {album.cover_url ? (
          <div className="w-full h-full transition-transform duration-500 group-hover:scale-105">
            <img
              src={album.cover_url}
              alt={album.title}
              className="w-full h-full object-cover"
              style={album.cover_crop_data ? {
                transform: `translate(${album.cover_crop_data.offsetX}%, ${album.cover_crop_data.offsetY}%) scale(${album.cover_crop_data.zoom})`,
              } : undefined}
            />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm"
            style={{ color: 'var(--text-tertiary)' }}>
            No cover
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        {album.shot_date && (
          <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
            {formatDate(album.shot_date)}
          </p>
        )}
        <h2 className="text-base mb-1 group-hover:text-white transition-colors" style={{ fontFamily: 'var(--font-playfair)' }}>
          {album.title}
        </h2>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
          {album.photo_count} photos
        </p>
      </div>
    </Link>
  );
}
